import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { Checkpoint, CheckMethod, PhotoRule } from './checkpoint.entity';
import { CreateCheckpointDto, UpdateCheckpointDto } from './dto';
import { newQrSecret, parseQr, qrMatches, qrPayload } from './qr';
import { assertPair, SitesService } from './sites.service';

export interface CheckpointView {
  id: string;
  site_id: string;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  photo_rule: PhotoRule;
  instructions: string | null;
  status: 'active' | 'inactive';
}

const view = (c: Checkpoint): CheckpointView => ({
  id: c.id, site_id: c.site_id, code: c.code, name: c.name, lat: c.lat, lng: c.lng, radius_m: c.radius_m,
  allowed_methods: c.allowed_methods, photo_rule: c.photo_rule, instructions: c.instructions, status: c.status,
});

@Injectable()
export class CheckpointsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<CheckpointView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const rows = await this.repo().find(tenantOf(actor), { where: { site_id: siteId }, order: { code: 'ASC' } });
    return rows.map(view);
  }

  async create(actor: AuthUser, siteId: string, dto: CreateCheckpointDto): Promise<CheckpointView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    const methods = dto.allowed_methods ?? ['qr'];
    assertPair(dto.lat ?? null, dto.lng ?? null);
    assertLocation(methods, dto.lat ?? null);
    await this.assertCodeFree(siteId, dto.code, null);
    const saved = await this.repo().create(tenantId, {
      site_id: siteId, code: dto.code, name: dto.name,
      lat: dto.lat === undefined ? null : String(dto.lat), lng: dto.lng === undefined ? null : String(dto.lng),
      radius_m: dto.radius_m ?? 30, allowed_methods: methods, photo_rule: dto.photo_rule ?? 'never',
      instructions: dto.instructions ?? null, qr_secret: newQrSecret(),
    });
    await this.log(actor, 'checkpoint.create', saved.id, { site_id: siteId, code: dto.code });
    return view(await this.repo().get(tenantId, saved.id));
  }

  async update(actor: AuthUser, id: string, dto: UpdateCheckpointDto): Promise<CheckpointView> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    const methods = dto.allowed_methods ?? current.allowed_methods;
    const lat = dto.lat !== undefined ? dto.lat : current.lat;
    assertPair(lat, dto.lng !== undefined ? dto.lng : current.lng);
    assertLocation(methods, lat);
    if (dto.code !== undefined) await this.assertCodeFree(current.site_id, dto.code, id);
    const patch: DeepPartial<Checkpoint> = { ...dto } as DeepPartial<Checkpoint>;
    if (dto.lat !== undefined) patch.lat = dto.lat === null ? null : String(dto.lat);
    if (dto.lng !== undefined) patch.lng = dto.lng === null ? null : String(dto.lng);
    await this.repo().update(tenantId, id, patch);
    await this.log(actor, 'checkpoint.update', id, { ...dto });
    return view(await this.repo().get(tenantId, id));
  }

  /** New secret: every tag printed before stops scanning. */
  async rotateQr(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    await this.ds.getRepository(Checkpoint).update({ id, tenant_id: tenantId }, { qr_secret: newQrSecret() });
    await this.log(actor, 'checkpoint.rotate_qr', id, {});
    return { ok: true };
  }

  async qrSheet(actor: AuthUser, siteId: string) {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    const [site] = await this.ds.query(
      `SELECT s.id, s.code, s.name, c.name AS client_name FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.id = $1`,
      [siteId],
    );
    const rows: { id: string; code: string; name: string; qr_secret: string }[] = await this.ds.query(
      `SELECT id, code, name, qr_secret FROM checkpoints
        WHERE tenant_id = $1 AND site_id = $2 AND deleted_at IS NULL AND status = 'active' ORDER BY code`,
      [tenantId, siteId],
    );
    return { site, tags: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, payload: qrPayload(r.qr_secret, r.id) })) };
  }

  /** What a scanned tag points at — only an active checkpoint of the caller's company with a current signature. */
  async resolve(actor: AuthUser, payload: string): Promise<CheckpointView & { site_name: string }> {
    const tenantId = tenantOf(actor);
    const parsed = parseQr(payload);
    if (!parsed) throw new BusinessException('QR_INVALID');
    const [row]: { qr_secret: string; site_name: string }[] = await this.ds.query(
      `SELECT k.qr_secret, s.name AS site_name FROM checkpoints k JOIN sites s ON s.id = k.site_id
        WHERE k.id = $1 AND k.tenant_id = $2 AND k.deleted_at IS NULL AND k.status = 'active' AND s.deleted_at IS NULL AND s.status = 'active'`,
      [parsed.checkpointId, tenantId],
    );
    if (!row || !qrMatches(row.qr_secret, parsed.checkpointId, parsed.signature)) throw new BusinessException('QR_INVALID');
    const checkpoint = view(await this.repo().get(tenantId, parsed.checkpointId));
    if (!(await this.scopes.canSeeSite(actor, checkpoint.site_id))) throw new BusinessException('QR_INVALID');
    return { ...checkpoint, site_name: row.site_name };
  }

  private repo() {
    return new TenantRepository(this.ds.getRepository(Checkpoint));
  }

  private async assertCodeFree(siteId: string, code: string, exceptId: string | null) {
    const rows = await this.ds.query(
      `SELECT 1 FROM checkpoints WHERE site_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [siteId, code, exceptId],
    );
    if (rows.length) throw new BusinessException('CHECKPOINT_CODE_TAKEN');
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'checkpoint', entity_id: id, data });
  }
}

function assertLocation(methods: CheckMethod[], lat: number | string | null): void {
  if (methods.includes('gps') && (lat === null || lat === undefined)) throw new BusinessException('CHECKPOINT_GPS_NEEDS_LOCATION');
}
