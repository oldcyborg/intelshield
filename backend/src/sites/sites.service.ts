import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { CreateSiteDto, PostDto, UpdateSiteDto } from './dto';
import { Post, Site } from './site.entity';

export interface SiteRow {
  id: string;
  client_id: string;
  client_name: string;
  code: string;
  name: string;
  address: string | null;
  lat: string | null;
  lng: string | null;
  geofence_radius_m: number;
  responsible_team_id: string | null;
  responsible_team_name: string | null;
  status: 'active' | 'inactive';
  note: string | null;
  checkpoint_count: number;
  route_count: number;
}

export interface SiteDetail extends SiteRow {
  posts: { id: string; name: string; note: string | null }[];
}

const SITE_ROWS = `
  SELECT s.id, s.client_id, c.name AS client_name, s.code, s.name, s.address, s.lat, s.lng, s.geofence_radius_m,
         s.responsible_team_id, t.name AS responsible_team_name, s.status, s.note,
         (SELECT count(*)::int FROM checkpoints k WHERE k.site_id = s.id AND k.deleted_at IS NULL) AS checkpoint_count,
         (SELECT count(*)::int FROM routes r WHERE r.site_id = s.id AND r.deleted_at IS NULL) AS route_count
    FROM sites s
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN teams t ON t.id = s.responsible_team_id
   WHERE s.tenant_id = $1 AND s.deleted_at IS NULL`;

@Injectable()
export class SitesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: { client_id?: string }): Promise<SiteRow[]> {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.siteVisibility(actor);
    if (!visibility.all && !visibility.siteIds.length) return [];
    const params: unknown[] = [tenantId];
    let sql = SITE_ROWS;
    if (!visibility.all) {
      params.push(visibility.siteIds);
      sql += ` AND s.id = ANY($${params.length}::uuid[])`;
    }
    if (filter.client_id) {
      params.push(filter.client_id);
      sql += ` AND s.client_id = $${params.length}`;
    }
    return this.ds.query(`${sql} ORDER BY c.name, s.name`, params);
  }

  async get(actor: AuthUser, id: string): Promise<SiteDetail> {
    const tenantId = tenantOf(actor);
    const [row]: SiteRow[] = await this.ds.query(`${SITE_ROWS} AND s.id = $2`, [tenantId, id]);
    if (!row || !(await this.scopes.canSeeSite(actor, id))) throw new BusinessException('NOT_FOUND');
    const posts = await this.ds.query(
      `SELECT id, name, note FROM posts WHERE site_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    );
    return { ...row, posts };
  }

  async create(actor: AuthUser, dto: CreateSiteDto): Promise<SiteDetail> {
    const tenantId = tenantOf(actor);
    if (!(await this.scopes.canSeeClient(actor, dto.client_id))) throw new BusinessException('NOT_FOUND');
    const [clientRow] = await this.ds.query(
      `SELECT management_mode FROM clients WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [dto.client_id, tenantId],
    );
    if (!clientRow) throw new BusinessException('NOT_FOUND');
    if (clientRow.management_mode !== 'managed') throw new BusinessException('SITE_CLIENT_SELF_MANAGED');
    await this.assertCodeFree(tenantId, dto.code, null);
    assertPair(dto.lat ?? null, dto.lng ?? null);
    if (dto.responsible_team_id) await this.assertTeam(actor, dto.responsible_team_id);
    const site = await new TenantRepository(this.ds.getRepository(Site)).create(tenantId, {
      ...dto,
      lat: dto.lat === undefined ? null : String(dto.lat),
      lng: dto.lng === undefined ? null : String(dto.lng),
    });
    await this.log(actor, 'site.create', site.id, { code: dto.code, client_id: dto.client_id });
    return this.get(actor, site.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateSiteDto): Promise<SiteDetail> {
    const tenantId = tenantOf(actor);
    const current = await this.writable(actor, id);
    assertPair(dto.lat !== undefined ? dto.lat : current.lat, dto.lng !== undefined ? dto.lng : current.lng);
    if (dto.code !== undefined) await this.assertCodeFree(tenantId, dto.code, id);
    if (dto.responsible_team_id) await this.assertTeam(actor, dto.responsible_team_id);
    const patch: DeepPartial<Site> = { ...dto } as DeepPartial<Site>;
    if (dto.lat !== undefined) patch.lat = dto.lat === null ? null : String(dto.lat);
    if (dto.lng !== undefined) patch.lng = dto.lng === null ? null : String(dto.lng);
    await new TenantRepository(this.ds.getRepository(Site)).update(tenantId, id, patch);
    await this.log(actor, 'site.update', id, { ...dto });
    return this.get(actor, id);
  }

  async addPost(actor: AuthUser, siteId: string, dto: PostDto) {
    const tenantId = tenantOf(actor);
    await this.writable(actor, siteId);
    const post = await new TenantRepository(this.ds.getRepository(Post)).create(tenantId, { site_id: siteId, name: dto.name, note: dto.note ?? null });
    await this.log(actor, 'site.post.add', siteId, { post_id: post.id, name: dto.name });
    return { id: post.id, name: post.name, note: post.note };
  }

  async updatePost(actor: AuthUser, postId: string, dto: PostDto) {
    const tenantId = tenantOf(actor);
    const posts = new TenantRepository(this.ds.getRepository(Post));
    const post = await posts.get(tenantId, postId);
    await this.writable(actor, post.site_id);
    const saved = await posts.update(tenantId, postId, { name: dto.name, note: dto.note ?? null });
    return { id: saved.id, name: saved.name, note: saved.note };
  }

  async removePost(actor: AuthUser, postId: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const posts = new TenantRepository(this.ds.getRepository(Post));
    const post = await posts.get(tenantId, postId);
    await this.writable(actor, post.site_id);
    await posts.softDelete(tenantId, postId);
    await this.log(actor, 'site.post.remove', post.site_id, { post_id: postId });
    return { ok: true };
  }

  /**
   * The site, if the caller may configure it: site.manage (checked by the guard) and
   * company-wide scope, sight of the site's client, or an explicit site scope.
   * Being the team that looks after a site lets you see it, not reconfigure it.
   */
  async writable(actor: AuthUser, siteId: string, m: EntityManager = this.ds.manager): Promise<Site> {
    const site = await new TenantRepository(m.getRepository(Site)).get(tenantOf(actor), siteId);
    const allowed =
      (await this.scopes.hasTenantScope(actor)) ||
      (await this.scopes.canSeeClient(actor, site.client_id)) ||
      (await this.ds.query(`SELECT 1 FROM user_scopes WHERE user_id = $1 AND scope_type = 'site' AND scope_id = $2`, [actor.id, siteId])).length > 0;
    if (!allowed) throw new BusinessException('NOT_FOUND');
    return site;
  }

  private async assertCodeFree(tenantId: string, code: string, exceptId: string | null) {
    const rows = await this.ds.query(
      `SELECT 1 FROM sites WHERE tenant_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [tenantId, code, exceptId],
    );
    if (rows.length) throw new BusinessException('SITE_CODE_TAKEN');
  }

  /** A site can only be handed to a team the caller can see — of their own company. */
  private async assertTeam(actor: AuthUser, teamId: string) {
    if (!(await this.scopes.canSeeTeam(actor, teamId))) throw new BusinessException('NOT_FOUND');
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'site', entity_id: id, data });
  }
}

/** Latitude and longitude come together or not at all. */
export function assertPair(lat: number | string | null, lng: number | string | null): void {
  if ((lat === null) !== (lng === null)) {
    throw new BusinessException('VALIDATION_FAILED', ['lat/lng: cần nhập đủ cả vĩ độ và kinh độ']);
  }
}
