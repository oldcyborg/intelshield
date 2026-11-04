import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { SitesService } from '../sites/sites.service';
import { SettingsPatchDto } from './dto';
import { cleanSettings, resolveSettings, SETTING_DEFAULTS, SETTING_KEYS, Settings } from './settings';

@Injectable()
export class SettingsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async company(actor: AuthUser) {
    const raw = await this.companyRaw(tenantOf(actor));
    const { effective, source } = resolveSettings(raw, {});
    return { values: effective, source, defaults: SETTING_DEFAULTS };
  }

  async updateCompany(actor: AuthUser, patch: SettingsPatchDto) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const [row] = await m.query(`SELECT settings FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
      const { next, before, after } = applyPatch(row.settings ?? {}, patch);
      assertCoherent(resolveSettings(next, {}).effective);
      await m.query(`UPDATE tenants SET settings = $2, updated_at = now() WHERE id = $1`, [tenantId, JSON.stringify(next)]);
      // Sites that override nothing follow the new company value; sites that override keep theirs.
      const sites: { id: string; settings: Record<string, unknown> }[] = await m.query(
        `SELECT id, settings FROM sites WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );
      for (const site of sites) assertCoherent(resolveSettings(next, site.settings).effective);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'settings.company', entity_type: 'tenant', entity_id: tenantId,
        data: { before, after },
      });
    });
    return this.company(actor);
  }

  async site(actor: AuthUser, siteId: string) {
    const tenantId = tenantOf(actor);
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const [row] = await this.ds.query(`SELECT settings FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantId]);
    const company = await this.companyRaw(tenantId);
    const { effective, source } = resolveSettings(company, row.settings);
    return { values: effective, source, overrides: cleanSettings(row.settings), company: resolveSettings(company, {}).effective };
  }

  async updateSite(actor: AuthUser, siteId: string, patch: SettingsPatchDto) {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    await this.ds.transaction(async (m) => {
      const [row] = await m.query(`SELECT settings FROM sites WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [siteId, tenantId]);
      const { next, before, after } = applyPatch(row.settings ?? {}, patch);
      const [company] = await m.query(`SELECT settings FROM tenants WHERE id = $1 FOR SHARE`, [tenantId]);
      assertCoherent(resolveSettings(company?.settings ?? {}, next).effective);
      await m.query(`UPDATE sites SET settings = $2, updated_at = now() WHERE id = $1`, [siteId, JSON.stringify(next)]);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'settings.site', entity_type: 'site', entity_id: siteId,
        data: { before, after },
      });
    });
    return this.site(actor, siteId);
  }

  /** What rules use: the site's value, else the company's, else the system default. */
  async effective(tenantId: string, siteId: string | null): Promise<Settings> {
    const company = await this.companyRaw(tenantId);
    if (!siteId) return resolveSettings(company, {}).effective;
    const [row] = await this.ds.query(`SELECT settings FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantId]);
    return resolveSettings(company, row?.settings ?? {}).effective;
  }

  private async companyRaw(tenantId: string): Promise<Record<string, unknown>> {
    const [row] = await this.ds.query(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    return row?.settings ?? {};
  }
}

/** Applies a patch to a stored settings object: values set, nulls removed; other stored keys untouched. */
function applyPatch(stored: Record<string, unknown>, patch: SettingsPatchDto) {
  const next: Record<string, unknown> = { ...stored };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    before[key] = stored[key] ?? null;
    after[key] = value;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return { next, before, after };
}

function assertCoherent(s: Settings): void {
  if (s.absent_after_minutes <= s.late_after_minutes) throw new BusinessException('SETTINGS_INVALID');
}
