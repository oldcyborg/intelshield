import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { SitesService } from '../sites/sites.service';
import { ScheduleDto, UpdateScheduleDto } from './dto';
import { PatrolSchedule } from './patrol-schedule.entity';

export interface ScheduleView {
  id: string;
  site_id: string;
  route_id: string;
  route_name: string;
  name: string;
  start_time: string;
  end_time: string;
  interval_minutes: number;
  days: number[];
  status: 'active' | 'inactive';
  rounds_per_day: number;
}

const SCHEDULE_ROWS = `
  SELECT p.id, p.site_id, p.route_id, r.name AS route_name, p.name, to_char(p.start_time, 'HH24:MI') AS start_time,
         to_char(p.end_time, 'HH24:MI') AS end_time, p.interval_minutes, p.days, p.status
    FROM patrol_schedules p JOIN routes r ON r.id = p.route_id
   WHERE p.tenant_id = $1 AND p.deleted_at IS NULL`;

/** Minutes the window lasts: across midnight when it ends "earlier", the whole day when both times match. */
export function windowMinutes(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<ScheduleView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const rows = await this.ds.query(`${SCHEDULE_ROWS} AND p.site_id = $2 ORDER BY p.start_time, p.name`, [tenantOf(actor), siteId]);
    return rows.map(view);
  }

  async create(actor: AuthUser, siteId: string, dto: ScheduleDto): Promise<ScheduleView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    await this.assertRoute(tenantId, siteId, dto.route_id);
    assertFits(dto.start_time, dto.end_time, dto.interval_minutes);
    const saved = await this.ds.getRepository(PatrolSchedule).save(
      this.ds.getRepository(PatrolSchedule).create({
        tenant_id: tenantId, site_id: siteId, route_id: dto.route_id, name: dto.name, start_time: dto.start_time,
        end_time: dto.end_time, interval_minutes: dto.interval_minutes, days: dto.days ? [...dto.days].sort() : [1, 2, 3, 4, 5, 6, 7],
      }),
    );
    await this.log(actor, 'patrol_schedule.create', saved.id, { site_id: siteId, ...dto });
    return this.one(tenantId, saved.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateScheduleDto): Promise<ScheduleView> {
    const tenantId = tenantOf(actor);
    const current = await this.get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    if (dto.route_id) await this.assertRoute(tenantId, current.site_id, dto.route_id);
    const start = dto.start_time ?? current.start_time.slice(0, 5);
    const end = dto.end_time ?? current.end_time.slice(0, 5);
    assertFits(start, end, dto.interval_minutes ?? current.interval_minutes);
    await this.ds.transaction(async (m) => {
      await m.update(PatrolSchedule, { id, tenant_id: tenantId }, { ...dto, ...(dto.days ? { days: [...dto.days].sort() } : {}) });
      await this.dropFuture(m, id);
    });
    await this.log(actor, 'patrol_schedule.update', id, { ...dto });
    return this.one(tenantId, id);
  }

  async remove(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const current = await this.get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    await this.ds.transaction(async (m) => {
      await m.softDelete(PatrolSchedule, { id, tenant_id: tenantId });
      await this.dropFuture(m, id);
    });
    await this.log(actor, 'patrol_schedule.delete', id, {});
    return { ok: true };
  }

  /** Rounds nobody has touched yet — the open one included — are regenerated from the new schedule by the next tick. */
  private async dropFuture(m: EntityManager, scheduleId: string) {
    await m.query(
      `DELETE FROM patrol_rounds WHERE schedule_id = $1 AND status = 'pending' AND started_at IS NULL AND expected_end > now()`,
      [scheduleId],
    );
  }

  private async get(tenantId: string, id: string): Promise<PatrolSchedule> {
    const row = await this.ds.getRepository(PatrolSchedule).findOneBy({ id, tenant_id: tenantId });
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private async one(tenantId: string, id: string): Promise<ScheduleView> {
    const [row] = await this.ds.query(`${SCHEDULE_ROWS} AND p.id = $2`, [tenantId, id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return view(row);
  }

  private async assertRoute(tenantId: string, siteId: string, routeId: string) {
    const rows = await this.ds.query(`SELECT 1 FROM routes WHERE id = $1 AND site_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`, [
      routeId, siteId, tenantId,
    ]);
    if (!rows.length) throw new BusinessException('NOT_FOUND');
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'patrol_schedule', entity_id: id, data });
  }
}

function assertFits(start: string, end: string, interval: number) {
  if (interval > windowMinutes(start, end)) throw new BusinessException('PATROL_INTERVAL_TOO_LONG');
}

function view(row: Omit<ScheduleView, 'rounds_per_day'>): ScheduleView {
  return { ...row, days: row.days.map(Number), rounds_per_day: Math.floor(windowMinutes(row.start_time, row.end_time) / row.interval_minutes) };
}
