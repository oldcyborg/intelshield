import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { markJudgeable, ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { DecisionDto, ViolationFilter } from './dto';
import { Violation } from './violation.entity';

const ROWS = `
  SELECT v.id, v.type, v.status, v.occurred_at, v.minutes, v.detail, v.ref_type, v.ref_id, v.site_id, s.name AS site_name,
         v.employee_id, e.code AS employee_code, e.full_name AS employee_name,
         v.proposed_note, v.proposed_at, pu.full_name AS proposed_by_name, v.review_note, v.reviewed_at, ru.full_name AS reviewed_by_name
    FROM violations v
    JOIN sites s ON s.id = v.site_id
    JOIN employees e ON e.id = v.employee_id
    LEFT JOIN users pu ON pu.id = v.proposed_by
    LEFT JOIN users ru ON ru.id = v.reviewed_by
   WHERE v.tenant_id = $1`;
const LOCAL_DAY = (p: string) => `(${p}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
const OPEN = ['auto', 'proposed_confirm', 'proposed_waive'];

@Injectable()
export class ViolationsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: ViolationFilter) {
    const params: unknown[] = [tenantOf(actor)];
    let sql = ROWS + (await this.visible(actor, params));
    if (filter.status === 'open') {
      params.push(OPEN);
      sql += ` AND v.status = ANY($${params.length})`;
    } else if (filter.status) {
      params.push(filter.status);
      sql += ` AND v.status = $${params.length}`;
    }
    for (const key of ['type', 'site_id', 'employee_id'] as const) {
      if (filter[key]) {
        params.push(filter[key]);
        sql += ` AND v.${key} = $${params.length}`;
      }
    }
    if (filter.from) {
      params.push(filter.from);
      sql += ` AND v.occurred_at >= ${LOCAL_DAY(`$${params.length}`)}`;
    }
    if (filter.to) {
      params.push(filter.to);
      sql += ` AND v.occurred_at < (${LOCAL_DAY(`$${params.length}`)} + interval '1 day')`;
    }
    const rows: { employee_id: string; site_id: string }[] = await this.ds.query(`${sql} ORDER BY v.occurred_at DESC, v.id LIMIT 500`, params);
    return markJudgeable(rows, await this.scopes.judgeable(actor));
  }

  async summary(actor: AuthUser) {
    const params: unknown[] = [tenantOf(actor)];
    const where = await this.visible(actor, params);
    const [row] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE v.status = 'auto')::int AS auto,
              count(*) FILTER (WHERE v.status = 'proposed_confirm')::int AS proposed_confirm,
              count(*) FILTER (WHERE v.status = 'proposed_waive')::int AS proposed_waive,
              count(*) FILTER (WHERE v.status = 'confirmed' AND v.reviewed_at > now() - interval '30 days')::int AS confirmed_30d,
              count(*) FILTER (WHERE v.status = 'waived' AND v.reviewed_at > now() - interval '30 days')::int AS waived_30d
         FROM violations v WHERE v.tenant_id = $1${where}`,
      params,
    );
    return row;
  }

  /** What a guard has on record — they see it as their leader does. */
  async mine(actor: AuthUser) {
    if (!actor.employee_id) return [];
    return this.ds.query(`${ROWS} AND v.employee_id = $2 AND v.occurred_at > now() - interval '90 days' ORDER BY v.occurred_at DESC`, [
      tenantOf(actor), actor.employee_id,
    ]);
  }

  async propose(actor: AuthUser, id: string, dto: DecisionDto) {
    await this.ds.transaction(async (m) => {
      const v = await this.lockJudgeable(m, actor, id);
      if (v.status === 'confirmed' || v.status === 'waived') throw new BusinessException('VIOLATION_ALREADY_REVIEWED');
      const note = dto.note?.trim() || null;
      if (dto.decision === 'waive' && !note) throw new BusinessException('VIOLATION_NOTE_REQUIRED');
      const status = dto.decision === 'confirm' ? 'proposed_confirm' : 'proposed_waive';
      await m.update(Violation, { id }, { status, proposed_by: actor.id, proposed_note: note, proposed_at: new Date() });
      await this.audit.record(m, { tenant_id: v.tenant_id, actor_user_id: actor.id, action: 'violation.propose', entity_type: 'violation', entity_id: id, data: { from: v.status, to: status, note } });
    });
    return this.one(actor, id);
  }

  async review(actor: AuthUser, id: string, dto: DecisionDto) {
    await this.ds.transaction(async (m) => {
      const v = await this.lockJudgeable(m, actor, id);
      const note = dto.note?.trim() || null;
      const status = dto.decision === 'confirm' ? 'confirmed' : 'waived';
      const changingDecision = (v.status === 'confirmed' || v.status === 'waived') && v.status !== status;
      // The same decision again without a word changes nothing: the earlier reviewer and reason stand.
      if (v.status === status && !note) return;
      if ((dto.decision === 'waive' || changingDecision) && !note) throw new BusinessException('VIOLATION_NOTE_REQUIRED');
      await m.update(Violation, { id }, { status, reviewed_by: actor.id, review_note: note, reviewed_at: new Date() });
      await this.audit.record(m, { tenant_id: v.tenant_id, actor_user_id: actor.id, action: 'violation.review', entity_type: 'violation', entity_id: id, data: { from: v.status, to: status, note } });
    });
    return this.one(actor, id);
  }

  /** Locked, in the caller's company and sight, and not about the caller themself. */
  private async lockJudgeable(m: EntityManager, actor: AuthUser, id: string): Promise<Violation> {
    const [row] = await m.query(`SELECT id FROM violations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const v = await m.findOneByOrFail(Violation, { id });
    if (!(await this.scopes.canSeeSite(actor, v.site_id))) throw new BusinessException('NOT_FOUND');
    // Seen is not decided: only for one's own people (or where one's scope names the site).
    if (!(await this.scopes.canJudge(actor, v))) throw new BusinessException('AUTH_FORBIDDEN');
    if (actor.employee_id && v.employee_id === actor.employee_id) throw new BusinessException('VIOLATION_OWN');
    return v;
  }

  private async one(actor: AuthUser, id: string) {
    const [row] = await this.ds.query(`${ROWS} AND v.id = $2`, [tenantOf(actor), id]);
    return row;
  }

  private async visible(actor: AuthUser, params: unknown[]): Promise<string> {
    const sites = await this.scopes.siteVisibility(actor);
    if (sites.all) return '';
    params.push(sites.siteIds);
    return ` AND v.site_id = ANY($${params.length}::uuid[])`;
  }
}
