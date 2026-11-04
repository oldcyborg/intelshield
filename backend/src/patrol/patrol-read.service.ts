import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { RoundsFilter } from './dto';
import { RoundProgress } from './round-progress';

const STATUSES = ['pending', 'in_progress', 'completed', 'partial', 'missed'] as const;

@Injectable()
export class PatrolReadService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly progress: RoundProgress,
  ) {}

  /** One site, one local day: every round with who did it and how far they got. */
  async list(actor: AuthUser, filter: RoundsFilter) {
    if (!(await this.scopes.canSeeSite(actor, filter.site_id))) throw new BusinessException('NOT_FOUND');
    const rounds: { status: (typeof STATUSES)[number]; late: boolean; backdated: boolean; suspicious_count: number }[] = await this.ds.query(
      `SELECT r.id, r.expected_start, r.expected_end, r.status, r.late, r.backdated, r.started_at, r.ended_at, r.ended_by,
              r.required_count, r.done_required, ro.name AS route_name, p.name AS schedule_name, e.full_name AS employee_name,
              (SELECT count(*)::int FROM patrol_scans sc WHERE sc.round_id = r.id) AS scan_count,
              (SELECT count(*)::int FROM patrol_scans sc WHERE sc.round_id = r.id AND sc.validity = 'suspicious') AS suspicious_count
         FROM patrol_rounds r
         JOIN routes ro ON ro.id = r.route_id
         JOIN patrol_schedules p ON p.id = r.schedule_id
         LEFT JOIN employees e ON e.id = r.employee_id
        WHERE r.tenant_id = $1 AND r.site_id = $2
          AND r.expected_start >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND r.expected_start < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        ORDER BY r.expected_start, ro.name`,
      [tenantOf(actor), filter.site_id, filter.date],
    );
    const summary: Record<string, number> = { total: rounds.length, late: 0, suspicious: 0 };
    for (const s of STATUSES) summary[s] = 0;
    for (const r of rounds) {
      summary[r.status] += 1;
      if (r.late) summary.late += 1;
      if (r.suspicious_count || r.backdated) summary.suspicious += 1;
    }
    return { summary, rounds };
  }

  /** A round with every scan, for the guard who did it or anyone watching the site. */
  async get(actor: AuthUser, id: string) {
    const [row] = await this.ds.query(`SELECT site_id, employee_id FROM patrol_rounds WHERE id = $1 AND tenant_id = $2`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const own = Boolean(actor.employee_id) && row.employee_id === actor.employee_id;
    if (!own && !((await this.permissions.has(actor.id, ['patrol.view'])) && (await this.scopes.canSeeSite(actor, row.site_id)))) {
      throw new BusinessException('NOT_FOUND');
    }
    const view = await this.progress.view(this.ds.manager, id, actor.employee_id);
    const scans = await this.ds.query(
      `SELECT sc.id, sc.checkpoint_id, k.code AS checkpoint_code, k.name AS checkpoint_name, sc.method, sc.scanned_at, sc.device_time,
              sc.server_time, sc.captured_offline, sc.lat, sc.lng, sc.accuracy_m, sc.distance_m, sc.mock_location, sc.photo_id,
              sc.flags, sc.validity, e.full_name AS employee_name
         FROM patrol_scans sc
         JOIN checkpoints k ON k.id = sc.checkpoint_id
         JOIN employees e ON e.id = sc.employee_id
        WHERE sc.round_id = $1 ORDER BY sc.scanned_at`,
      [id],
    );
    return { ...view, scans };
  }

  /** Today's tally per visible site, for the dashboard. */
  async today(actor: AuthUser) {
    const tenantId = tenantOf(actor);
    const sites = await this.scopes.siteVisibility(actor);
    const params: unknown[] = [tenantId, todayLocal()];
    let where = '';
    if (!sites.all) {
      params.push(sites.siteIds);
      where = ` AND r.site_id = ANY($3::uuid[])`;
    }
    return this.ds.query(
      `SELECT r.site_id, s.name AS site_name, count(*)::int AS total,
              count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
              count(*) FILTER (WHERE r.status = 'partial')::int AS partial,
              count(*) FILTER (WHERE r.status = 'missed')::int AS missed,
              count(*) FILTER (WHERE r.status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE r.backdated OR EXISTS (SELECT 1 FROM patrol_scans sc WHERE sc.round_id = r.id AND sc.validity = 'suspicious'))::int AS suspicious
         FROM patrol_rounds r JOIN sites s ON s.id = r.site_id
        WHERE r.tenant_id = $1
          AND r.expected_start >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND r.expected_start < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')${where}
        GROUP BY r.site_id, s.name ORDER BY s.name`,
      params,
    );
  }
}
