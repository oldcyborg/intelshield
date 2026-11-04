import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rowsOf } from '../violations/engine.service';
import { LeaveDto, LeaveFilter } from './dto';
import { LeaveRequest } from './leave-request.entity';
import { PayService } from './pay.service';
import { bossesOf, lookedAfterFilter, looksAfter, ownLoosePhotos, usersOf } from './people';

const BACK_DAYS = 7;
const AHEAD_DAYS = 90;
const MAX_DAYS = 31;
/** A shift this close (or already begun) makes the request urgent: the manager hears too. */
const URGENT_MS = 12 * 60 * 60_000;
const OPEN_VIOLATION = `('auto', 'proposed_confirm', 'proposed_waive')`;
const TYPE_LABEL: Record<string, string> = { annual: 'phép năm', sick: 'ốm', personal: 'việc riêng', unpaid: 'không lương' };

/**
 * One row per request, with the shifts it touches: while waiting, the person's planned shifts on those days;
 * once approved, the shifts it cancelled.
 */
const ROWS = `
  SELECT r.id, r.employee_id, e.code AS employee_code, e.full_name AS employee_name, r.type, r.from_date, r.to_date, r.days,
         r.reason, r.status, r.urgent, r.created_at, r.created_by, cu.full_name AS created_by_name,
         r.decided_at, du.full_name AS decided_by_name, r.decision_note,
         COALESCE((SELECT json_agg(f.id ORDER BY f.created_at) FROM files f WHERE f.owner_type = 'leave_request' AND f.owner_id = r.id AND f.deleted_at IS NULL), '[]') AS file_ids,
         COALESCE((SELECT json_agg(json_build_object(
                     'id', a.id, 'site_id', a.site_id, 'site_name', s.name, 'planned_start', a.planned_start, 'planned_end', a.planned_end,
                     'status', a.status, 'checked_in', EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = a.id),
                     'substitute', (SELECT se.full_name FROM shift_assignments sa JOIN employees se ON se.id = sa.employee_id
                                     WHERE sa.substitute_for_id = a.id AND sa.status = 'planned' LIMIT 1))
                     ORDER BY a.planned_start)
                     FROM shift_assignments a JOIN sites s ON s.id = a.site_id
                    WHERE a.employee_id = r.employee_id AND a.shift_date BETWEEN r.from_date AND r.to_date
                      AND (a.leave_request_id = r.id OR (r.status = 'pending' AND a.status = 'planned'))), '[]') AS shifts
    FROM leave_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users du ON du.id = r.decided_by
   WHERE r.tenant_id = $1`;

@Injectable()
export class LeaveService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly pay: PayService,
  ) {}

  async create(actor: AuthUser, dto: LeaveDto) {
    const tenantId = tenantOf(actor);
    const [prior] = await this.ds.query(`SELECT id, created_by FROM leave_requests WHERE tenant_id = $1 AND client_uuid = $2`, [tenantId, dto.client_uuid]);
    if (prior) {
      if (prior.created_by !== actor.id) throw new BusinessException('CONFLICT');
      return this.one(actor, prior.id);
    }
    const employeeId = dto.employee_id ?? actor.employee_id;
    if (!employeeId) throw new BusinessException('LEAVE_NO_EMPLOYEE');
    const forSomeoneElse = employeeId !== actor.employee_id;
    if (forSomeoneElse) {
      if (!(await this.permissions.has(actor.id, ['leave.review']))) throw new BusinessException('AUTH_FORBIDDEN');
      if (!(await looksAfter(this.ds, this.scopes, actor, employeeId))) throw new BusinessException('NOT_FOUND');
    }
    const today = todayLocal();
    const days = dayCount(dto.from_date, dto.to_date);
    if (days < 1 || days > MAX_DAYS || dto.from_date < addDays(today, -BACK_DAYS) || dto.to_date > addDays(today, AHEAD_DAYS)) {
      throw new BusinessException('LEAVE_RANGE_INVALID');
    }
    const fileIds = dto.file_ids ?? [];
    if (!(await ownLoosePhotos(this.ds, actor, tenantId, fileIds))) throw new BusinessException('REQUEST_PHOTO_INVALID');

    const made = await this.ds.transaction(async (m) => {
      // One person's requests are written one at a time, so two overlapping ones cannot both slip in.
      const [person] = await m.query(`SELECT id, full_name FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`, [employeeId, tenantId]);
      if (!person) throw new BusinessException('NOT_FOUND');
      // The same request sent twice at once: the second waited on the lock above and gets the first.
      const [twin] = await m.query(`SELECT id FROM leave_requests WHERE tenant_id = $1 AND client_uuid = $2`, [tenantId, dto.client_uuid]);
      if (twin) return twin.id as string;
      const overlap = await m.query(
        `SELECT 1 FROM leave_requests WHERE employee_id = $1 AND status IN ('pending', 'approved') AND from_date <= $3 AND to_date >= $2`,
        [employeeId, dto.from_date, dto.to_date],
      );
      if (overlap.length) throw new BusinessException('LEAVE_OVERLAP');
      const [first] = await m.query(
        `SELECT min(planned_start) AS at FROM shift_assignments WHERE employee_id = $1 AND status = 'planned' AND shift_date BETWEEN $2 AND $3`,
        [employeeId, dto.from_date, dto.to_date],
      );
      const urgent = first.at !== null && new Date(first.at).getTime() < Date.now() + URGENT_MS;
      const saved = await m.save(m.create(LeaveRequest, {
        tenant_id: tenantId, employee_id: employeeId, type: dto.type, from_date: dto.from_date, to_date: dto.to_date, days,
        reason: dto.reason?.trim() || null, status: 'pending', urgent, created_by: actor.id, client_uuid: dto.client_uuid,
      }));
      for (const fileId of fileIds) await this.files.claim(m, tenantId, fileId, { type: 'leave_request', id: saved.id });
      await this.log(m, actor, 'leave.create', saved.id, { employee_id: employeeId, from: dto.from_date, to: dto.to_date, type: dto.type });
      const bosses = await bossesOf(m, employeeId);
      // Nobody is left out: no leader (or the leader asking for themself) sends it to the manager.
      const people = [...bosses.leaders, ...(urgent || !bosses.leaders.length ? bosses.managers : [])].filter((id) => id !== actor.id);
      await this.notifications.notify(tenantId, people, {
        type: 'leave.submitted', title: `${urgent ? 'Xin nghỉ gấp' : 'Xin nghỉ'} · ${person.full_name}`,
        body: `${TYPE_LABEL[dto.type]} ${dateRange(dto.from_date, dto.to_date)}${dto.reason?.trim() ? ` — ${dto.reason.trim()}` : ''}`,
        data: { leave_request_id: saved.id }, priority: urgent ? 'high' : 'normal', push: true,
      }, m);
      return saved.id;
    });
    return this.one(actor, made);
  }

  async list(actor: AuthUser, filter: LeaveFilter) {
    const params: unknown[] = [tenantOf(actor)];
    let sql = ROWS + (await lookedAfterFilter(this.scopes, actor, 'r.employee_id', params));
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND r.status = $${params.length}`;
    }
    if (filter.employee_id) {
      params.push(filter.employee_id);
      sql += ` AND r.employee_id = $${params.length}`;
    }
    if (filter.from) {
      params.push(filter.from);
      sql += ` AND r.to_date >= $${params.length}`;
    }
    if (filter.to) {
      params.push(filter.to);
      sql += ` AND r.from_date <= $${params.length}`;
    }
    const rows = await this.ds.query(`${sql} ORDER BY (r.status = 'pending') DESC, r.urgent DESC, r.from_date, r.created_at LIMIT 300`, params);
    return this.withBalance(tenantOf(actor), rows);
  }

  async mine(actor: AuthUser) {
    if (!actor.employee_id) return [];
    const rows = await this.ds.query(`${ROWS} AND r.employee_id = $2 AND r.to_date >= $3 ORDER BY r.from_date DESC LIMIT 100`, [
      tenantOf(actor), actor.employee_id, addDays(todayLocal(), -180),
    ]);
    return this.withBalance(tenantOf(actor), rows);
  }

  async approve(actor: AuthUser, id: string, note?: string) {
    await this.ds.transaction(async (m) => {
      const r = await this.lockDecidable(m, actor, id);
      // Rostering this person waits until the leave is settled, so no new shift lands on a day being approved off.
      await m.query(`SELECT 1 FROM employees WHERE id = $1 FOR UPDATE`, [r.employee_id]);
      // One statement decides which shifts are still free to cancel: a clock-in committed meanwhile keeps its shift.
      const shiftIds = rowsOf<{ id: string }>(await m.query(
        `UPDATE shift_assignments a SET status = 'cancelled', leave_request_id = $4, updated_at = now()
          WHERE a.employee_id = $1 AND a.status = 'planned' AND a.shift_date BETWEEN $2 AND $3
            AND NOT EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = a.id)
         RETURNING a.id`,
        [r.employee_id, r.from_date, r.to_date, id],
      )).map((s) => s.id);
      // Off with leave: an absence or lateness written on those days no longer stands — also on a shift already
      // cancelled or handed to a stand-in before the leave was approved.
      await m.query(
        `UPDATE violations v SET status = 'waived', review_note = 'Hệ thống: nghỉ có đơn được duyệt', reviewed_at = now(), updated_at = now()
           FROM shift_assignments a
          WHERE v.ref_type = 'assignment' AND v.ref_id = a.id AND v.employee_id = $1 AND a.employee_id = $1 AND a.status = 'cancelled'
            AND a.shift_date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = a.id)
            AND v.type IN ('absent', 'late_check_in') AND v.status IN ${OPEN_VIOLATION}`,
        [r.employee_id, r.from_date, r.to_date],
      );
      if (shiftIds.length) {
        // A request to add a clock-in to a shift that is now a day off has nothing left to correct.
        await m.query(
          `UPDATE attendance_corrections SET status = 'cancelled', review_note = 'Hệ thống: ca đã huỷ vì nghỉ có đơn', updated_at = now()
            WHERE assignment_id = ANY($1::uuid[]) AND status IN ('pending', 'proposed_approve', 'proposed_reject')`,
          [shiftIds],
        );
      }
      await m.update(LeaveRequest, { id }, { status: 'approved', decided_by: actor.id, decided_at: new Date(), decision_note: note?.trim() || null });
      await this.log(m, actor, 'leave.approve', id, { cancelled_shifts: shiftIds, note: note?.trim() || null });
      await this.tell(m, r, `Đơn nghỉ được duyệt`, shiftIds.length ? `${shiftIds.length} ca đã được huỷ` : dateRange(r.from_date, r.to_date));
    });
    return this.one(actor, id);
  }

  async reject(actor: AuthUser, id: string, note?: string) {
    const reason = note?.trim();
    if (!reason) throw new BusinessException('LEAVE_NOTE_REQUIRED');
    await this.ds.transaction(async (m) => {
      const r = await this.lockDecidable(m, actor, id);
      await m.update(LeaveRequest, { id }, { status: 'rejected', decided_by: actor.id, decided_at: new Date(), decision_note: reason });
      await this.log(m, actor, 'leave.reject', id, { note: reason });
      await this.tell(m, r, 'Đơn nghỉ không được duyệt', reason);
    });
    return this.one(actor, id);
  }

  /** The person (or whoever wrote it for them) takes back a request still waiting. */
  async cancel(actor: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const r = await this.lock(m, actor, id);
      if (r.employee_id !== actor.employee_id && r.created_by !== actor.id) throw new BusinessException('NOT_FOUND');
      if (r.status !== 'pending') throw new BusinessException('LEAVE_NOT_PENDING');
      await m.update(LeaveRequest, { id }, { status: 'cancelled' });
      await this.log(m, actor, 'leave.cancel', id, {});
    });
    return this.one(actor, id);
  }

  private async lock(m: EntityManager, actor: AuthUser, id: string): Promise<LeaveRequest> {
    const [row] = await m.query(`SELECT id FROM leave_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return m.findOneByOrFail(LeaveRequest, { id });
  }

  /** Waiting, about someone the caller looks after, and not the caller's own. */
  private async lockDecidable(m: EntityManager, actor: AuthUser, id: string): Promise<LeaveRequest> {
    const r = await this.lock(m, actor, id);
    if (actor.employee_id && r.employee_id === actor.employee_id) throw new BusinessException('LEAVE_OWN');
    if (!(await looksAfter(m, this.scopes, actor, r.employee_id))) throw new BusinessException('NOT_FOUND');
    if (r.status !== 'pending') throw new BusinessException('LEAVE_NOT_PENDING');
    return r;
  }

  private async tell(m: EntityManager, r: LeaveRequest, title: string, body: string) {
    await this.notifications.notify(r.tenant_id, await usersOf(m, r.employee_id), {
      type: 'leave.decided', title, body, data: { leave_request_id: r.id }, priority: 'normal', push: true,
    }, m);
  }

  private async one(actor: AuthUser, id: string) {
    const rows = await this.ds.query(`${ROWS} AND r.id = $2`, [tenantOf(actor), id]);
    return (await this.withBalance(tenantOf(actor), rows))[0];
  }

  /**
   * Annual leave shows what is left in the year it starts — only when the person has a standard allowance
   * (empty or 0 means the company does not count it, and nothing is shown).
   */
  private async withBalance<T extends { id: string; type: string; employee_id: string; from_date: string }>(tenantId: string, rows: T[]) {
    const out = [];
    for (const r of rows) {
      const balance = r.type === 'annual' ? await this.pay.balance(this.ds.manager, tenantId, r.employee_id, Number(r.from_date.slice(0, 4))) : null;
      out.push({ ...r, balance: balance && balance.allowance ? balance : null });
    }
    return out;
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: tenantOf(actor), actor_user_id: actor.id, action, entity_type: 'leave_request', entity_id: id, data });
  }
}

function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function dateRange(from: string, to: string): string {
  const d = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return from === to ? `ngày ${d(from)}` : `${d(from)}–${d(to)}`;
}
