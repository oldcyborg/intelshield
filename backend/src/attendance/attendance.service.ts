import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { attendanceStatus } from './attendance-status';
import { Attendance } from './attendance.entity';
import { BoardFilter, CheckDto, MyShiftsFilter } from './dto';
import { distanceMeters } from './geo';

const EARLY_WINDOW_MS = 60 * 60_000;
const LATE_CHECKOUT_MS = 6 * 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const LOW_ACCURACY_M = 100;

interface ShiftForCheck {
  id: string;
  site_id: string;
  planned_start: Date;
  planned_end: Date;
  lat: string | null;
  lng: string | null;
  geofence_radius_m: number;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
  ) {}

  /** The caller's own planned shifts, with where to go and what they have done so far. */
  async myShifts(actor: AuthUser, filter: MyShiftsFilter) {
    if (!actor.employee_id) return [];
    return this.ds.query(
      `SELECT a.id, a.shift_date, a.planned_start, a.planned_end, a.site_id, s.name AS site_name, s.address AS site_address,
              s.lat AS site_lat, s.lng AS site_lng, s.geofence_radius_m, t.name AS template_name,
              CASE WHEN at.id IS NULL THEN NULL ELSE json_build_object(
                'check_in_at', at.check_in_at, 'check_out_at', at.check_out_at, 'late_minutes', at.late_minutes,
                'corrected', at.corrected_at IS NOT NULL) END AS attendance,
              (SELECT c.status FROM attendance_corrections c WHERE c.assignment_id = a.id ORDER BY c.created_at DESC LIMIT 1) AS correction
         FROM shift_assignments a
         JOIN sites s ON s.id = a.site_id
         LEFT JOIN shift_templates t ON t.id = a.template_id
         LEFT JOIN attendances at ON at.assignment_id = a.id
        WHERE a.tenant_id = $1 AND a.employee_id = $2 AND a.status = 'planned' AND a.shift_date BETWEEN $3 AND $4
        ORDER BY a.planned_start`,
      [tenantOf(actor), actor.employee_id, filter.from, filter.to],
    );
  }

  async checkIn(actor: AuthUser, dto: CheckDto): Promise<Attendance> {
    const tenantId = tenantOf(actor);
    if (!actor.device_id) throw new BusinessException('ATTENDANCE_DEVICE_REQUIRED');
    const now = new Date();
    return this.ds.transaction(async (m) => {
      const shift = await this.ownShift(m, actor, dto.assignment_id);
      if (now.getTime() < shift.planned_start.getTime() - EARLY_WINDOW_MS || now.getTime() > shift.planned_end.getTime()) {
        throw new BusinessException('ATTENDANCE_OUTSIDE_WINDOW');
      }
      if (await m.exists(Attendance, { where: { assignment_id: shift.id } })) throw new BusinessException('ATTENDANCE_ALREADY');
      await this.assertOwnSelfie(m, actor, dto.selfie_file_id);
      const { distance, flags } = this.observe(shift, dto, now);
      const saved = await m.save(
        m.create(Attendance, {
          tenant_id: tenantId, assignment_id: shift.id, employee_id: actor.employee_id!, check_in_at: now,
          check_in_lat: String(dto.lat), check_in_lng: String(dto.lng), check_in_accuracy_m: dto.accuracy_m ?? null,
          check_in_distance_m: distance, check_in_selfie_id: dto.selfie_file_id, check_in_device_time: new Date(dto.device_time),
          check_in_flags: flags, late_minutes: Math.max(0, Math.floor((now.getTime() - shift.planned_start.getTime()) / 60_000)),
        }),
      );
      await this.files.claim(m, tenantId, dto.selfie_file_id, { type: 'attendance', id: saved.id });
      return saved;
    });
  }

  async checkOut(actor: AuthUser, dto: CheckDto): Promise<Attendance> {
    const tenantId = tenantOf(actor);
    if (!actor.device_id) throw new BusinessException('ATTENDANCE_DEVICE_REQUIRED');
    const now = new Date();
    return this.ds.transaction(async (m) => {
      const shift = await this.ownShift(m, actor, dto.assignment_id);
      const record = await m.findOneBy(Attendance, { assignment_id: shift.id });
      if (!record) throw new BusinessException('ATTENDANCE_NOT_CHECKED_IN');
      if (record.check_out_at) throw new BusinessException('ATTENDANCE_ALREADY');
      if (now.getTime() > shift.planned_end.getTime() + LATE_CHECKOUT_MS) throw new BusinessException('ATTENDANCE_OUTSIDE_WINDOW');
      await this.assertOwnSelfie(m, actor, dto.selfie_file_id);
      const { distance, flags } = this.observe(shift, dto, now);
      await m.update(Attendance, { id: record.id }, {
        check_out_at: now, check_out_lat: String(dto.lat), check_out_lng: String(dto.lng), check_out_accuracy_m: dto.accuracy_m ?? null,
        check_out_distance_m: distance, check_out_selfie_id: dto.selfie_file_id, check_out_device_time: new Date(dto.device_time),
        check_out_flags: flags,
        early_minutes: Math.max(0, Math.ceil((shift.planned_end.getTime() - now.getTime()) / 60_000)),
        worked_minutes: Math.floor((now.getTime() - record.check_in_at.getTime()) / 60_000),
      });
      await this.files.claim(m, tenantId, dto.selfie_file_id, { type: 'attendance', id: record.id });
      return m.findOneByOrFail(Attendance, { id: record.id });
    });
  }

  /** One site, one day: every shift with its live status under the site's own thresholds. */
  async board(actor: AuthUser, filter: BoardFilter) {
    const tenantId = tenantOf(actor);
    if (!(await this.scopes.canSeeSite(actor, filter.site_id))) throw new BusinessException('NOT_FOUND');
    const settings = await this.settings.effective(tenantId, filter.site_id);
    const rows: Record<string, unknown>[] = await this.ds.query(
      `SELECT a.id, a.employee_id, e.code AS employee_code, e.full_name AS employee_name, t.name AS template_name,
              a.planned_start, a.planned_end, a.status, at.check_in_at, at.check_out_at, at.late_minutes, at.early_minutes,
              at.check_in_flags, at.check_out_flags, at.check_in_distance_m, at.check_in_selfie_id, at.check_out_selfie_id,
              at.corrected_at, a.leave_request_id
         FROM shift_assignments a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN shift_templates t ON t.id = a.template_id
         LEFT JOIN attendances at ON at.assignment_id = a.id
        WHERE a.tenant_id = $1 AND a.site_id = $2 AND a.shift_date = $3
        ORDER BY a.planned_start, e.full_name`,
      [tenantId, filter.site_id, filter.date],
    );
    const now = new Date();
    return {
      settings: {
        late_after_minutes: settings.late_after_minutes,
        absent_after_minutes: settings.absent_after_minutes,
        early_checkout_minutes: settings.early_checkout_minutes,
      },
      rows: rows.map((r) => ({
        ...r,
        status: attendanceStatus(r as never, now, settings),
        late_in: r.check_in_at ? (r.late_minutes as number) > settings.late_after_minutes : false,
        early_out: r.check_out_at ? (r.early_minutes as number) > settings.early_checkout_minutes : false,
      })),
    };
  }

  /** The caller's own planned shift, locked; another person's shift is simply not found. */
  private async ownShift(m: EntityManager, actor: AuthUser, assignmentId: string): Promise<ShiftForCheck> {
    const [row]: ShiftForCheck[] = await m.query(
      `SELECT a.id, a.site_id, a.planned_start, a.planned_end, s.lat, s.lng, s.geofence_radius_m
         FROM shift_assignments a JOIN sites s ON s.id = a.site_id
        WHERE a.id = $1 AND a.tenant_id = $2 AND a.employee_id = $3 AND a.status = 'planned'
        FOR UPDATE OF a`,
      [assignmentId, tenantOf(actor), actor.employee_id],
    );
    if (!row) throw new BusinessException('NOT_FOUND');
    return { ...row, planned_start: new Date(row.planned_start), planned_end: new Date(row.planned_end) };
  }

  /** A selfie this very user uploaded in the last ten minutes, an image, not yet attached to anything. */
  private async assertOwnSelfie(m: EntityManager, actor: AuthUser, fileId: string): Promise<void> {
    const rows = await m.query(
      `SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
          AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL
          AND created_at > now() - interval '10 minutes'`,
      [fileId, tenantOf(actor), actor.id],
    );
    if (!rows.length) throw new BusinessException('ATTENDANCE_SELFIE_INVALID');
  }

  private observe(shift: ShiftForCheck, dto: CheckDto, now: Date): { distance: number | null; flags: string[] } {
    const flags: string[] = [];
    let distance: number | null = null;
    if (shift.lat !== null && shift.lng !== null) {
      distance = distanceMeters({ lat: Number(shift.lat), lng: Number(shift.lng) }, { lat: dto.lat, lng: dto.lng });
      if (distance > shift.geofence_radius_m) flags.push('outside_geofence');
    }
    if (dto.mock_location) flags.push('mock_location');
    if (Math.abs(new Date(dto.device_time).getTime() - now.getTime()) > CLOCK_SKEW_MS) flags.push('clock_skew');
    if (dto.accuracy_m !== undefined && dto.accuracy_m > LOW_ACCURACY_M) flags.push('low_accuracy');
    return { distance, flags };
  }
}
