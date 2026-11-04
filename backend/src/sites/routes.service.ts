import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { RouteDto } from './dto';
import { Route, RouteCheckpoint } from './route.entity';
import { SitesService } from './sites.service';

export interface RouteView {
  id: string;
  site_id: string;
  name: string;
  note: string | null;
  checkpoints: { checkpoint_id: string; code: string; name: string; seq: number; required: boolean }[];
}

const ROUTE_ROWS = `
  SELECT r.id, r.site_id, r.name, r.note,
         COALESCE(json_agg(json_build_object('checkpoint_id', k.id, 'code', k.code, 'name', k.name, 'seq', rc.seq, 'required', rc.required)
                  ORDER BY rc.seq) FILTER (WHERE rc.route_id IS NOT NULL), '[]') AS checkpoints
    FROM routes r
    LEFT JOIN route_checkpoints rc ON rc.route_id = r.id
    LEFT JOIN checkpoints k ON k.id = rc.checkpoint_id
   WHERE r.tenant_id = $1 AND r.deleted_at IS NULL`;

@Injectable()
export class RoutesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<RouteView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(`${ROUTE_ROWS} AND r.site_id = $2 GROUP BY r.id ORDER BY r.name`, [tenantOf(actor), siteId]);
  }

  async create(actor: AuthUser, siteId: string, dto: RouteDto): Promise<RouteView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    const id = await this.ds.transaction(async (m) => {
      const route = await new TenantRepository(m.getRepository(Route)).create(tenantId, { site_id: siteId, name: dto.name, note: dto.note ?? null });
      await this.writeStops(m, tenantId, siteId, route.id, dto);
      return route.id;
    });
    await this.log(actor, 'route.create', id, { site_id: siteId, name: dto.name });
    return this.one(tenantId, id);
  }

  async replace(actor: AuthUser, routeId: string, dto: RouteDto): Promise<RouteView> {
    const tenantId = tenantOf(actor);
    const route = await new TenantRepository(this.ds.getRepository(Route)).get(tenantId, routeId);
    await this.sites.writable(actor, route.site_id);
    await this.ds.transaction(async (m) => {
      await m.update(Route, { id: routeId }, { name: dto.name, note: dto.note ?? null });
      await m.delete(RouteCheckpoint, { route_id: routeId });
      await this.writeStops(m, tenantId, route.site_id, routeId, dto);
    });
    await this.log(actor, 'route.replace', routeId, { name: dto.name, stops: dto.checkpoints.length });
    return this.one(tenantId, routeId);
  }

  async remove(actor: AuthUser, routeId: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const repo = new TenantRepository(this.ds.getRepository(Route));
    const route = await repo.get(tenantId, routeId);
    await this.sites.writable(actor, route.site_id);
    await repo.softDelete(tenantId, routeId);
    await this.log(actor, 'route.remove', routeId, {});
    return { ok: true };
  }

  /** Stops must be active checkpoints of this very site, each once, at least one. */
  private async writeStops(m: EntityManager, tenantId: string, siteId: string, routeId: string, dto: RouteDto) {
    if (!dto.checkpoints.length) throw new BusinessException('ROUTE_EMPTY');
    const ids = dto.checkpoints.map((s) => s.checkpoint_id);
    if (new Set(ids).size !== ids.length) throw new BusinessException('ROUTE_DUPLICATE_CHECKPOINT');
    const valid = await m.query(
      `SELECT id FROM checkpoints WHERE tenant_id = $1 AND site_id = $2 AND deleted_at IS NULL AND status = 'active' AND id = ANY($3::uuid[])`,
      [tenantId, siteId, ids],
    );
    if (valid.length !== ids.length) throw new BusinessException('ROUTE_FOREIGN_CHECKPOINT');
    await m.insert(
      RouteCheckpoint,
      dto.checkpoints.map((s, i) => ({ route_id: routeId, checkpoint_id: s.checkpoint_id, seq: i + 1, required: s.required ?? true })),
    );
  }

  private async one(tenantId: string, id: string): Promise<RouteView> {
    const [row] = await this.ds.query(`${ROUTE_ROWS} AND r.id = $2 GROUP BY r.id`, [tenantId, id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'route', entity_id: id, data });
  }
}
