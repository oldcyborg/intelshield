import { Injectable } from '@nestjs/common';
import { Between, DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { CopyWeekDto, CreateAssignmentDto, RosterFilter, SubstituteDto } from './dto';
import { ViolationsEngine } from '../violations/engine.service';
import { ShiftAssignment } from './shift-assignment.entity';

export interface AssignmentRow {
  id: string;
  site_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  template_id: string | null;
  template_name: string | null;
  post_id: string | null;
  shift_date: string;
  planned_start: Date;
  planned_end: Date;
  status: 'planned' | 'cancelled';
  substitute_for_id: string | null;
  leave_request_id: string | null;
  note: string | null;
  attendance: { check_in_at: string; check_out_at: string | null; late_minutes: number } | null;
}

const ASSIGNMENT_ROWS = `
  SELECT a.id, a.site_id, a.employee_id, e.code AS employee_code, e.full_name AS employee_name, a.template_id,
         t.name AS template_name, a.post_id, a.shift_date, a.planned_start, a.planned_end, a.status, a.substitute_for_id, a.leave_request_id, a.note,
         CASE WHEN at.id IS NULL THEN NULL ELSE json_build_object(
           'check_in_at', at.check_in_at, 'check_out_at', at.check_out_at, 'late_minutes', at.late_minutes) END AS attendance
    FROM shift_assignments a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shift_templates t ON t.id = a.template_id
    LEFT JOIN attendances at ON at.assignment_id = a.id
   WHERE a.tenant_id = $1`;

const DAY_MS = 86_400_000;

interface NewShift {
  site_id: string;
  employee_id: string;
  template_id: string | null;
  post_id: string | null;
  start: Date;
  end: Date;
  note: string | null;
  substitute_for_id: string | null;
}

@Injectable()
export class RosterService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
    private readonly violations: ViolationsEngine,
  ) {}

  async list(actor: AuthUser, filter: RosterFilter): Promise<AssignmentRow[]> {
    if (!(await this.scopes.canSeeSite(actor, filter.site_id))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `${ASSIGNMENT_ROWS} AND a.site_id = $2 AND a.shift_date BETWEEN $3 AND $4 ORDER BY a.planned_start, e.full_name`,
      [tenantOf(actor), filter.site_id, filter.from, filter.to],
    );
  }

  async create(actor: AuthUser, dto: CreateAssignmentDto): Promise<AssignmentRow> {
    const tenantId = tenantOf(actor);
    const times = await this.timesFor(tenantId, dto);
    const id = await this.ds.transaction((m) =>
      this.insert(m, actor, {
        site_id: dto.site_id, employee_id: dto.employee_id, template_id: dto.template_id ?? null, post_id: dto.post_id ?? null,
        start: times.start, end: times.end, note: dto.note ?? null, substitute_for_id: null,
      }),
    );
    return this.one(tenantId, id);
  }

  /** Repeats a week's planned shifts seven days later. Each shift that no longer fits is skipped with its reason. */
  async copyWeek(actor: AuthUser, dto: CopyWeekDto) {
    const tenantId = tenantOf(actor);
    if (!isMonday(dto.from_week) || !isMonday(dto.to_week)) throw new BusinessException('ROSTER_WEEK_INVALID');
    if (!(await this.scopes.canSeeSite(actor, dto.site_id))) throw new BusinessException('NOT_FOUND');
    const shiftMs = (Date.UTC(...ymd(dto.to_week)) - Date.UTC(...ymd(dto.from_week)));
    const week: ShiftAssignment[] = await this.ds.getRepository(ShiftAssignment).find({
      where: { tenant_id: tenantId, site_id: dto.site_id, status: 'planned', shift_date: Between(dto.from_week, addDays(dto.from_week, 6)) },
      order: { planned_start: 'ASC' },
    });
    let created = 0;
    const skipped: { employee_name: string; shift_date: string; reason: string }[] = [];
    for (const a of week) {
      const start = new Date(a.planned_start.getTime() + shiftMs);
      try {
        await this.ds.transaction((m) =>
          this.insert(m, actor, {
            site_id: a.site_id, employee_id: a.employee_id, template_id: a.template_id, post_id: a.post_id,
            start, end: new Date(a.planned_end.getTime() + shiftMs), note: a.note, substitute_for_id: null,
          }),
        );
        created += 1;
      } catch (error) {
        if (!(error instanceof BusinessException)) throw error;
        const [e] = await this.ds.query(`SELECT full_name FROM employees WHERE id = $1`, [a.employee_id]);
        skipped.push({ employee_name: e.full_name, shift_date: todayLocal(start), reason: error.message });
      }
    }
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'roster.copy_week', entity_type: 'site', entity_id: dto.site_id,
      data: { from_week: dto.from_week, to_week: dto.to_week, created, skipped: skipped.length },
    });
    return { created, skipped };
  }

  /**
   * Someone else works this shift: the original is cancelled, the new one remembers whom it replaces.
   * A shift already cancelled by approved leave takes one stand-in the same way.
   */
  async substitute(actor: AuthUser, id: string, dto: SubstituteDto): Promise<AssignmentRow> {
    const tenantId = tenantOf(actor);
    const newId = await this.ds.transaction(async (m) => {
      const onLeave = await this.lockOnLeave(m, actor, id);
      const a = onLeave ?? (await this.lockOpen(m, actor, id));
      if (!onLeave) {
        // An absence already due belongs to the person who did not come, before anyone else takes the shift.
        await this.violations.recordAbsenceIfDue(m, id);
        await m.update(ShiftAssignment, { id }, { status: 'cancelled' });
      }
      const created = await this.insert(m, actor, {
        site_id: a.site_id, employee_id: dto.employee_id, template_id: a.template_id, post_id: a.post_id,
        start: a.planned_start, end: a.planned_end, note: a.note, substitute_for_id: a.id,
      });
      await this.log(m, actor, 'roster.substitute', id, { from: a.employee_id, to: dto.employee_id, new_id: created });
      return created;
    });
    return this.one(tenantId, newId);
  }

  async cancel(actor: AuthUser, id: string): Promise<{ ok: true }> {
    await this.ds.transaction(async (m) => {
      const a = await this.lockOpen(m, actor, id);
      await this.violations.recordAbsenceIfDue(m, id);
      await m.update(ShiftAssignment, { id }, { status: 'cancelled' });
      await this.log(m, actor, 'roster.cancel', id, { employee_id: a.employee_id, shift_date: a.shift_date });
    });
    return { ok: true };
  }

  /** A shift cancelled because its person is on approved leave, not yet given to a stand-in; null for any other shift. */
  private async lockOnLeave(m: EntityManager, actor: AuthUser, id: string): Promise<ShiftAssignment | null> {
    const [row] = await m.query(
      `SELECT id FROM shift_assignments WHERE id = $1 AND tenant_id = $2 AND status = 'cancelled' AND leave_request_id IS NOT NULL FOR UPDATE`,
      [id, tenantOf(actor)],
    );
    if (!row) return null;
    const a = await m.findOneByOrFail(ShiftAssignment, { id });
    await this.assertCanRoster(actor, a.employee_id, a.site_id);
    if ((await m.query(`SELECT 1 FROM shift_assignments WHERE substitute_for_id = $1 AND status = 'planned'`, [id])).length) {
      throw new BusinessException('NOT_FOUND');
    }
    return a;
  }

  /** The planned, not yet clocked-in shift, if the caller may roster its person. */
  private async lockOpen(m: EntityManager, actor: AuthUser, id: string): Promise<ShiftAssignment> {
    const [row] = await m.query(`SELECT id FROM shift_assignments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const a = await m.findOneByOrFail(ShiftAssignment, { id });
    if (a.status !== 'planned') throw new BusinessException('NOT_FOUND');
    await this.assertCanRoster(actor, a.employee_id, a.site_id);
    if ((await m.query(`SELECT 1 FROM attendances WHERE assignment_id = $1`, [id])).length) throw new BusinessException('ROSTER_LOCKED');
    return a;
  }

  private async insert(m: EntityManager, actor: AuthUser, s: NewShift): Promise<string> {
    const tenantId = tenantOf(actor);
    const [site] = await m.query(`SELECT id, client_id FROM sites WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [s.site_id, tenantId]);
    if (!site) throw new BusinessException('NOT_FOUND');
    await this.assertCanRoster(actor, s.employee_id, s.site_id);
    const [employee] = await m.query(
      `SELECT id, status FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [s.employee_id, tenantId],
    );
    if (!employee) throw new BusinessException('NOT_FOUND');
    if (employee.status !== 'active') throw new BusinessException('EMPLOYEE_INACTIVE');
    if (s.end.getTime() <= s.start.getTime() || s.end.getTime() - s.start.getTime() > DAY_MS) {
      throw new BusinessException('VALIDATION_FAILED', ['end_at: ca phải dài hơn 0 và tối đa 24 giờ']);
    }
    const shiftDate = todayLocal(s.start);
    if (s.post_id) {
      const post = await m.query(`SELECT 1 FROM posts WHERE id = $1 AND site_id = $2 AND deleted_at IS NULL`, [s.post_id, s.site_id]);
      if (!post.length) throw new BusinessException('NOT_FOUND');
    }
    const posted = await m.query(
      `SELECT 1 FROM deployments WHERE employee_id = $1 AND client_id = $2 AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3)`,
      [s.employee_id, site.client_id, shiftDate],
    );
    if (!posted.length) throw new BusinessException('ROSTER_NOT_DEPLOYED');
    const off = await m.query(
      `SELECT 1 FROM leave_requests WHERE employee_id = $1 AND status = 'approved' AND $2::date BETWEEN from_date AND to_date`,
      [s.employee_id, shiftDate],
    );
    if (off.length) throw new BusinessException('ROSTER_ON_LEAVE');
    const clash = await m.query(
      `SELECT 1 FROM shift_assignments WHERE employee_id = $1 AND status = 'planned' AND tstzrange(planned_start, planned_end) && tstzrange($2, $3)`,
      [s.employee_id, s.start, s.end],
    );
    if (clash.length) throw new BusinessException('ROSTER_OVERLAP');
    const saved = await m.save(
      m.create(ShiftAssignment, {
        tenant_id: tenantId, site_id: s.site_id, employee_id: s.employee_id, template_id: s.template_id, post_id: s.post_id,
        shift_date: shiftDate, planned_start: s.start, planned_end: s.end, status: 'planned',
        substitute_for_id: s.substitute_for_id, note: s.note, created_by: actor.id,
      }),
    );
    await this.log(m, actor, 'roster.create', saved.id, { employee_id: s.employee_id, site_id: s.site_id, start: s.start, end: s.end });
    return saved.id;
  }

  /**
   * Company-wide scope rosters anyone. Otherwise the caller must see the site and the
   * person must be in one of the caller's teams today: a leader rosters their team,
   * a group manager the group's teams.
   */
  private async assertCanRoster(actor: AuthUser, employeeId: string, siteId: string): Promise<void> {
    if (await this.scopes.hasTenantScope(actor)) return;
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const teams = await this.scopes.teamVisibility(actor);
    const teamIds = teams.all ? [] : teams.teamIds;
    const today = todayLocal();
    const inTeam = await this.ds.query(
      `SELECT 1 FROM team_members WHERE employee_id = $1 AND team_id = ANY($2::uuid[]) AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3)`,
      [employeeId, teamIds, today],
    );
    if (!inTeam.length) throw new BusinessException('ROSTER_NOT_YOUR_TEAM');
  }

  /** Template + date → instants, computed by PostgreSQL in Vietnam time; or the explicit one-off instants. */
  private async timesFor(tenantId: string, dto: CreateAssignmentDto): Promise<{ start: Date; end: Date }> {
    if (dto.template_id) {
      if (!dto.shift_date) throw new BusinessException('VALIDATION_FAILED', ['shift_date: cần ngày của ca']);
      const [t] = await this.ds.query(
        `SELECT (($3::date + start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start,
                ((($3::date + CASE WHEN end_time <= start_time THEN 1 ELSE 0 END) + end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS "end"
           FROM shift_templates
          WHERE id = $1 AND tenant_id = $2 AND site_id = $4 AND deleted_at IS NULL AND status = 'active'`,
        [dto.template_id, tenantId, dto.shift_date, dto.site_id],
      );
      if (!t) throw new BusinessException('NOT_FOUND');
      return { start: new Date(t.start), end: new Date(t.end) };
    }
    if (!dto.start_at || !dto.end_at) throw new BusinessException('VALIDATION_FAILED', ['start_at, end_at: cần mẫu ca hoặc giờ bắt đầu và kết thúc']);
    return { start: new Date(dto.start_at), end: new Date(dto.end_at) };
  }

  private async one(tenantId: string, id: string): Promise<AssignmentRow> {
    const [row] = await this.ds.query(`${ASSIGNMENT_ROWS} AND a.id = $2`, [tenantId, id]);
    return row;
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'shift_assignment', entity_id: id, data });
  }
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

function isMonday(iso: string): boolean {
  return new Date(Date.UTC(...ymd(iso))).getUTCDay() === 1;
}
