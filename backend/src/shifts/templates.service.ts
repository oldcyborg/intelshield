import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { SitesService } from '../sites/sites.service';
import { TemplateDto, UpdateTemplateDto } from './dto';
import { ShiftTemplate } from './shift-template.entity';

export interface TemplateView {
  id: string;
  site_id: string;
  name: string;
  start_time: string;
  end_time: string;
  overnight: boolean;
  headcount: number;
  position: string;
  status: 'active' | 'inactive';
}

const TEMPLATE_ROWS = `
  SELECT id, site_id, name, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time,
         (end_time <= start_time) AS overnight, headcount, position, status
    FROM shift_templates
   WHERE tenant_id = $1 AND deleted_at IS NULL`;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<TemplateView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(`${TEMPLATE_ROWS} AND site_id = $2 ORDER BY start_time`, [tenantOf(actor), siteId]);
  }

  async create(actor: AuthUser, siteId: string, dto: TemplateDto): Promise<TemplateView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    assertDistinct(dto.start_time, dto.end_time);
    const saved = await this.repo().create(tenantId, {
      site_id: siteId, name: dto.name, start_time: dto.start_time, end_time: dto.end_time,
      headcount: dto.headcount ?? 1, position: dto.position ?? 'guard',
    });
    await this.log(actor, 'shift_template.create', saved.id, { site_id: siteId, ...dto });
    return this.one(tenantId, saved.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateTemplateDto): Promise<TemplateView> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    assertDistinct(dto.start_time ?? current.start_time.slice(0, 5), dto.end_time ?? current.end_time.slice(0, 5));
    await this.repo().update(tenantId, id, { ...dto });
    await this.log(actor, 'shift_template.update', id, { ...dto });
    return this.one(tenantId, id);
  }

  /** Shifts already rostered from a template keep their times; the template just stops being offered. */
  async remove(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    await this.repo().softDelete(tenantId, id);
    await this.log(actor, 'shift_template.remove', id, {});
    return { ok: true };
  }

  private async one(tenantId: string, id: string): Promise<TemplateView> {
    const [row] = await this.ds.query(`${TEMPLATE_ROWS} AND id = $2`, [tenantId, id]);
    return row;
  }

  private repo() {
    return new TenantRepository(this.ds.getRepository(ShiftTemplate));
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'shift_template', entity_id: id, data });
  }
}

function assertDistinct(start: string, end: string): void {
  if (start === end) throw new BusinessException('VALIDATION_FAILED', ['end_time: giờ kết thúc phải khác giờ bắt đầu']);
}
