import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { markJudgeable, ScopeService } from '../access/scope.service';
import { Attendance } from '../attendance/attendance.entity';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ViolationsEngine } from '../violations/engine.service';
import { AttendanceCorrection, OPEN_CORRECTION } from './attendance-correction.entity';
import { CorrectionDecisionDto, CorrectionDto, CorrectionFilter } from './dto';
import { bossesOf, ownLoosePhotos, usersOf } from './people';

const HOUR = 60 * 60_000;
/** A guard asks within this long after the shift ends; a manager correcting directly is not limited. */
const ASK_WITHIN_MS = 48 * HOUR;
/** The same windows as clocking in and out (attendance.service). */
const EARLY_IN_MS = HOUR;
const LATE_OUT_MS = 6 * HOUR;
const OPEN = `('pending', 'proposed_approve', 'proposed_reject')`;
const REASON_LABEL: Record<string, string> = {
  phone_dead: 'máy hết pin', phone_broken: 'máy hỏng', forgot: 'quên chấm', no_signal: 'mất sóng', app_error: 'lỗi ứng dụng', other: 'lý do khác',
};

/**
 * One row per request, with the clock-in/out as they stand now and what the person left behind during the shift
 * (patrol scans, logbook lines, handovers) so the reviewer can see whether they were really there.
 */
const ROWS = `
  SELECT c.id, c.assignment_id, c.employee_id, e.code AS employee_code, e.full_name AS employee_name, c.site_id, s.name AS site_name,
         a.planned_start, a.planned_end, c.check_in_at, c.check_out_at, c.reason_code, c.reason, c.status, c.before,
         c.created_at, c.created_by, cu.full_name AS created_by_name, c.proposed_note, c.proposed_at, pu.full_name AS proposed_by_name,
         c.review_note, c.reviewed_at, ru.full_name AS reviewed_by_name,
         CASE WHEN at.id IS NULL THEN NULL ELSE json_build_object('check_in_at', at.check_in_at, 'check_out_at', at.check_out_at) END AS current,
         COALESCE((SELECT json_agg(f.id ORDER BY f.created_at) FROM files f WHERE f.owner_type = 'attendance_correction' AND f.owner_id = c.id AND f.deleted_at IS NULL), '[]') AS file_ids,
         json_build_object(
           'scans', (SELECT count(*)::int FROM patrol_scans sc WHERE sc.employee_id = c.employee_id
                       AND sc.scanned_at BETWEEN a.planned_start - interval '1 hour' AND a.planned_end + interval '6 hours'),
           'first_scan_at', (SELECT min(sc.scanned_at) FROM patrol_scans sc WHERE sc.employee_id = c.employee_id
                       AND sc.scanned_at BETWEEN a.planned_start - interval '1 hour' AND a.planned_end + interval '6 hours'),
           'last_scan_at', (SELECT max(sc.scanned_at) FROM patrol_scans sc WHERE sc.employee_id = c.employee_id
                       AND sc.scanned_at BETWEEN a.planned_start - interval '1 hour' AND a.planned_end + interval '6 hours'),
           'logbook', (SELECT count(*)::int FROM logbook_entries l WHERE l.author_employee_id = c.employee_id
                       AND l.occurred_at BETWEEN a.planned_start - interval '1 hour' AND a.planned_end + interval '6 hours'),
           'handovers', COALESCE((SELECT json_agg(json_build_object('role', CASE WHEN h.from_assignment_id = a.id THEN 'gave' ELSE 'took' END,
                       'at', CASE WHEN h.from_assignment_id = a.id THEN h.submitted_at ELSE h.answered_at END))
                       FROM handovers h WHERE h.from_assignment_id = a.id OR h.to_assignment_id = a.id), '[]')
         ) AS evidence
    FROM attendance_corrections c
    JOIN shift_assignments a ON a.id = c.assignment_id
    JOIN employees e ON e.id = c.employee_id
    JOIN sites s ON s.id = c.site_id
    JOIN users cu ON cu.id = c.created_by
    LEFT JOIN users pu ON pu.id = c.proposed_by
    LEFT JOIN users ru ON ru.id = c.reviewed_by
    LEFT JOIN attendances at ON at.assignment_id = c.assignment_id
   WHERE c.tenant_id = $1`;

interface ShiftRow {
  id: string;
  tenant_id: string;
  site_id: string;
  employee_id: string;
  status: string;
  planned_start: Date;
  planned_end: Date;
  site_name: string;
  employee_name: string;
}

const ms = (d: Date | string | null | undefined) => (d === null || d === undefined ? null : new Date(d).getTime());

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly engine: ViolationsEngine,
  ) {}

  /**
   * The person asks for their own shift (within 48 hours of its end). A manager with the review permission
   * may correct someone else's shift directly: same checks, a reason required, applied at once.
   */
  async create(actor: AuthUser, dto: CorrectionDto) {
    const tenantId = tenantOf(actor);
    const [prior] = await this.ds.query(`SELECT id, created_by FROM attendance_corrections WHERE tenant_id = $1 AND client_uuid = $2`, [tenantId, dto.client_uuid]);
    if (prior) {
      if (prior.created_by !== actor.id) throw new BusinessException('CONFLICT');
      return this.one(actor, prior.id);
    }
    const fileIds = dto.file_ids ?? [];
    if (!(await ownLoosePhotos(this.ds, actor, tenantId, fileIds))) throw new BusinessException('REQUEST_PHOTO_INVALID');
    const id = await this.ds.transaction(async (m) => {
      const shift = await this.lockShift(m, tenantId, dto.assignment_id);
      if (!shift || shift.status !== 'planned') throw new BusinessException('NOT_FOUND');
      // The same request sent twice at once: the second waited on the shift's lock and gets the first.
      const [twin] = await m.query(`SELECT id FROM attendance_corrections WHERE tenant_id = $1 AND client_uuid = $2`, [tenantId, dto.client_uuid]);
      if (twin) return twin.id as string;
      const own = Boolean(actor.employee_id) && shift.employee_id === actor.employee_id;
      const reason = dto.reason?.trim() || null;
      if (!own) {
        if (!(await this.permissions.has(actor.id, ['attendance.correct.review']))) throw new BusinessException('AUTH_FORBIDDEN');
        if (!(await this.scopes.canSeeSite(actor, shift.site_id))) throw new BusinessException('NOT_FOUND');
        if (!reason) throw new BusinessException('CORRECTION_NOTE_REQUIRED');
      } else if (Date.now() > shift.planned_end.getTime() + ASK_WITHIN_MS) {
        throw new BusinessException('CORRECTION_TOO_LATE');
      }
      const current = await m.findOneBy(Attendance, { assignment_id: shift.id });
      const asked = { in: dto.check_in_at ? new Date(dto.check_in_at) : null, out: dto.check_out_at ? new Date(dto.check_out_at) : null };
      const changesIn = asked.in !== null && ms(asked.in) !== ms(current?.check_in_at);
      const changesOut = asked.out !== null && ms(asked.out) !== ms(current?.check_out_at);
      if (!changesIn && !changesOut) throw new BusinessException('CORRECTION_NOTHING');
      assertTimes(shift, asked.in ?? current?.check_in_at ?? null, asked.out ?? current?.check_out_at ?? null);
      if ((await m.query(`SELECT 1 FROM attendance_corrections WHERE assignment_id = $1 AND status IN ${OPEN}`, [shift.id])).length) {
        throw new BusinessException('CORRECTION_OPEN_EXISTS');
      }
      const saved = await m.save(m.create(AttendanceCorrection, {
        tenant_id: tenantId, assignment_id: shift.id, employee_id: shift.employee_id, site_id: shift.site_id,
        check_in_at: changesIn ? asked.in : null, check_out_at: changesOut ? asked.out : null,
        reason_code: dto.reason_code, reason, status: 'pending', created_by: actor.id, client_uuid: dto.client_uuid,
      }));
      for (const fileId of fileIds) await this.files.claim(m, tenantId, fileId, { type: 'attendance_correction', id: saved.id });
      if (own) {
        await this.log(m, actor, 'attendance.correction.create', saved.id, { assignment_id: shift.id });
        const bosses = await bossesOf(m, shift.employee_id);
        await this.notifications.notify(tenantId, (bosses.leaders.length ? bosses.leaders : bosses.managers).filter((u) => u !== actor.id), {
          type: 'attendance.correction.submitted', title: `Xin bổ sung chấm công · ${shift.employee_name}`,
          body: `${shift.site_name} — ${REASON_LABEL[dto.reason_code]}${reason ? `: ${reason}` : ''}`,
          data: { correction_id: saved.id }, priority: 'normal', push: true,
        }, m);
      } else {
        await this.apply(m, actor, saved, reason);
      }
      return saved.id;
    });
    return this.one(actor, id);
  }

  async list(actor: AuthUser, filter: CorrectionFilter) {
    const params: unknown[] = [tenantOf(actor)];
    let sql = ROWS + (await this.visible(actor, params));
    if (filter.status === 'open') sql += ` AND c.status IN ${OPEN}`;
    else if (filter.status) {
      params.push(filter.status);
      sql += ` AND c.status = $${params.length}`;
    }
    for (const key of ['site_id', 'employee_id'] as const) {
      if (filter[key]) {
        params.push(filter[key]);
        sql += ` AND c.${key} = $${params.length}`;
      }
    }
    const rows: { employee_id: string; site_id: string }[] = await this.ds.query(`${sql} ORDER BY (c.status IN ${OPEN}) DESC, c.created_at DESC LIMIT 300`, params);
    return markJudgeable(rows, await this.scopes.judgeable(actor));
  }

  async get(actor: AuthUser, id: string) {
    const row = await this.one(actor, id);
    if (!row) throw new BusinessException('NOT_FOUND');
    const own = Boolean(actor.employee_id) && row.employee_id === actor.employee_id;
    if (!own && !(await this.scopes.canSeeSite(actor, row.site_id))) throw new BusinessException('NOT_FOUND');
    return row;
  }

  async mine(actor: AuthUser) {
    if (!actor.employee_id) return [];
    return this.ds.query(`${ROWS} AND c.employee_id = $2 AND c.created_at > now() - interval '60 days' ORDER BY c.created_at DESC`, [tenantOf(actor), actor.employee_id]);
  }

  /** The leader's word on it: approve or reject, a reason to reject. Changing one's own proposal is allowed until the manager decides. */
  async propose(actor: AuthUser, id: string, dto: CorrectionDecisionDto) {
    const note = dto.note?.trim() || null;
    await this.ds.transaction(async (m) => {
      const c = await this.lockJudgeable(m, actor, id);
      if (dto.decision === 'reject' && !note) throw new BusinessException('CORRECTION_NOTE_REQUIRED');
      const status = dto.decision === 'approve' ? 'proposed_approve' : 'proposed_reject';
      await m.update(AttendanceCorrection, { id }, { status, proposed_by: actor.id, proposed_note: note, proposed_at: new Date() });
      await this.log(m, actor, 'attendance.correction.propose', id, { from: c.status, to: status, note });
      const [s] = await m.query(`SELECT e.full_name FROM employees e WHERE e.id = $1`, [c.employee_id]);
      await this.notifications.notify(c.tenant_id, (await bossesOf(m, c.employee_id)).managers.filter((u) => u !== actor.id), {
        type: 'attendance.correction.proposed', title: `Chờ duyệt bổ sung chấm công · ${s.full_name}`,
        body: `Đội trưởng đề xuất ${dto.decision === 'approve' ? 'duyệt' : 'từ chối'}${note ? `: ${note}` : ''}`,
        data: { correction_id: id }, priority: 'normal', push: true,
      }, m);
    });
    return this.one(actor, id);
  }

  /** The manager decides. Rejecting, or going against the leader's proposal, needs a reason. */
  async review(actor: AuthUser, id: string, dto: CorrectionDecisionDto) {
    const note = dto.note?.trim() || null;
    await this.ds.transaction(async (m) => {
      const c = await this.lockJudgeable(m, actor, id);
      const against = (c.status === 'proposed_approve' && dto.decision === 'reject') || (c.status === 'proposed_reject' && dto.decision === 'approve');
      if ((dto.decision === 'reject' || against) && !note) throw new BusinessException('CORRECTION_NOTE_REQUIRED');
      if (dto.decision === 'approve') {
        await this.apply(m, actor, c, note);
      } else {
        await m.update(AttendanceCorrection, { id }, { status: 'rejected', reviewed_by: actor.id, review_note: note, reviewed_at: new Date() });
        await this.log(m, actor, 'attendance.correction.reject', id, { from: c.status, note });
      }
      await this.notifications.notify(c.tenant_id, await usersOf(m, c.employee_id), {
        type: 'attendance.correction.decided', title: dto.decision === 'approve' ? 'Đơn bổ sung chấm công được duyệt' : 'Đơn bổ sung chấm công không được duyệt',
        body: note ?? '', data: { correction_id: id }, priority: 'normal', push: true,
      }, m);
    });
    return this.one(actor, id);
  }

  async cancel(actor: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const c = await this.lock(m, actor, id);
      if (c.employee_id !== actor.employee_id && c.created_by !== actor.id) throw new BusinessException('NOT_FOUND');
      if (!(OPEN_CORRECTION as readonly string[]).includes(c.status)) throw new BusinessException('CORRECTION_NOT_OPEN');
      await m.update(AttendanceCorrection, { id }, { status: 'cancelled' });
      await this.log(m, actor, 'attendance.correction.cancel', id, {});
    });
    return this.one(actor, id);
  }

  /**
   * Writes the asked times into the shift's clock-in/out (marked "corrected", no selfie or position), keeps what was
   * there before, and lets the violation rules look again at this shift's open violations.
   */
  private async apply(m: EntityManager, actor: AuthUser, c: AttendanceCorrection, note: string | null): Promise<void> {
    const shift = await this.lockShift(m, c.tenant_id, c.assignment_id);
    if (!shift || shift.status !== 'planned') throw new BusinessException('NOT_FOUND');
    const [row] = await m.query(`SELECT id FROM attendances WHERE assignment_id = $1 FOR UPDATE`, [c.assignment_id]);
    const current = row ? await m.findOneByOrFail(Attendance, { id: row.id }) : null;
    const checkIn = c.check_in_at ?? current?.check_in_at ?? null;
    const checkOut = c.check_out_at ?? current?.check_out_at ?? null;
    // Things may have moved since the request was written (the guard clocked out after all): checked again.
    assertTimes(shift, checkIn, checkOut, false);
    const start = shift.planned_start.getTime();
    const end = shift.planned_end.getTime();
    const inAt = new Date(checkIn!);
    const outAt = checkOut ? new Date(checkOut) : null;
    const figures = {
      late_minutes: Math.max(0, Math.floor((inAt.getTime() - start) / 60_000)),
      early_minutes: outAt ? Math.max(0, Math.ceil((end - outAt.getTime()) / 60_000)) : null,
      worked_minutes: outAt ? Math.floor((outAt.getTime() - inAt.getTime()) / 60_000) : null,
      corrected_at: new Date(),
    };
    const mark = (flags: string[]) => (flags.includes('corrected') ? flags : [...flags, 'corrected']);
    if (!current) {
      await m.save(m.create(Attendance, {
        tenant_id: c.tenant_id, assignment_id: c.assignment_id, employee_id: c.employee_id, check_in_at: inAt,
        check_in_flags: ['corrected'], check_out_at: outAt, check_out_flags: outAt ? ['corrected'] : [], ...figures,
      }));
    } else {
      await m.update(Attendance, { id: current.id }, {
        ...(c.check_in_at ? { check_in_at: inAt, check_in_flags: mark(current.check_in_flags) } : {}),
        ...(c.check_out_at ? { check_out_at: outAt, check_out_flags: mark(current.check_out_flags) } : {}),
        ...figures,
      });
    }
    const before = { check_in_at: current?.check_in_at?.toISOString() ?? null, check_out_at: current?.check_out_at?.toISOString() ?? null };
    await m.update(AttendanceCorrection, { id: c.id }, { status: 'approved', before, reviewed_by: actor.id, review_note: note, reviewed_at: new Date() });
    await this.log(m, actor, 'attendance.correct', c.id, {
      assignment_id: c.assignment_id, before, after: { check_in_at: inAt.toISOString(), check_out_at: outAt?.toISOString() ?? null }, note,
    });
    await this.engine.reconcileAttendance(m, c.assignment_id);
  }

  private async lockShift(m: EntityManager, tenantId: string, assignmentId: string): Promise<ShiftRow | null> {
    const [row] = await m.query(
      `SELECT a.id, a.tenant_id, a.site_id, a.employee_id, a.status, a.planned_start, a.planned_end, s.name AS site_name, e.full_name AS employee_name
         FROM shift_assignments a JOIN sites s ON s.id = a.site_id JOIN employees e ON e.id = a.employee_id
        WHERE a.id = $1 AND a.tenant_id = $2 FOR UPDATE OF a`,
      [assignmentId, tenantId],
    );
    return row ? { ...row, planned_start: new Date(row.planned_start), planned_end: new Date(row.planned_end) } : null;
  }

  private async lock(m: EntityManager, actor: AuthUser, id: string): Promise<AttendanceCorrection> {
    const [row] = await m.query(`SELECT id FROM attendance_corrections WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return m.findOneByOrFail(AttendanceCorrection, { id });
  }

  /** Open, at a site the caller sees, and not about the caller themself. */
  private async lockJudgeable(m: EntityManager, actor: AuthUser, id: string): Promise<AttendanceCorrection> {
    const c = await this.lock(m, actor, id);
    if (!(await this.scopes.canSeeSite(actor, c.site_id))) throw new BusinessException('NOT_FOUND');
    // Seen is not decided: only for one's own people (or where one's scope names the site).
    if (!(await this.scopes.canJudge(actor, c))) throw new BusinessException('AUTH_FORBIDDEN');
    if (actor.employee_id && c.employee_id === actor.employee_id) throw new BusinessException('CORRECTION_OWN');
    if (!(OPEN_CORRECTION as readonly string[]).includes(c.status)) throw new BusinessException('CORRECTION_NOT_OPEN');
    return c;
  }

  private async one(actor: AuthUser, id: string) {
    const [row] = await this.ds.query(`${ROWS} AND c.id = $2`, [tenantOf(actor), id]);
    return row;
  }

  private async visible(actor: AuthUser, params: unknown[]): Promise<string> {
    const sites = await this.scopes.siteVisibility(actor);
    if (sites.all) return '';
    params.push(sites.siteIds);
    return ` AND c.site_id = ANY($${params.length}::uuid[])`;
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: tenantOf(actor), actor_user_id: actor.id, action, entity_type: 'attendance_correction', entity_id: id, data });
  }
}

/**
 * A clock-in within the clock-in window (an hour before the start to the end), a clock-out after it and at most
 * six hours past the end; neither in the future. A clock-out alone needs a clock-in already there.
 */
function assertTimes(shift: ShiftRow, checkIn: Date | string | null, checkOut: Date | string | null, futureChecked = true): void {
  const now = Date.now();
  const start = shift.planned_start.getTime();
  const end = shift.planned_end.getTime();
  const i = ms(checkIn);
  const o = ms(checkOut);
  const bad =
    i === null ||
    i < start - EARLY_IN_MS || i > end || (futureChecked && i > now) ||
    (o !== null && (o <= i || o > end + LATE_OUT_MS || (futureChecked && o > now)));
  if (bad) throw new BusinessException('CORRECTION_TIME_INVALID');
}
