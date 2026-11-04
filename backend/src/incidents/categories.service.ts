import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { CategoryDto, UpdateCategoryDto } from './dto';
import { IncidentCategory } from './incident-category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Active categories for the report form; people managing them also see retired ones. */
  async list(actor: AuthUser, includeInactive = false) {
    const rows = await this.repo().find(tenantOf(actor), { order: { sort: 'ASC', name: 'ASC' } });
    return (includeInactive ? rows : rows.filter((c) => c.status === 'active')).map((c) => ({
      id: c.id, name: c.name, default_severity: c.default_severity, sort: c.sort, status: c.status,
    }));
  }

  async create(actor: AuthUser, dto: CategoryDto) {
    const tenantId = tenantOf(actor);
    await this.assertNameFree(tenantId, dto.name, null);
    const saved = await this.repo().create(tenantId, { name: dto.name, default_severity: dto.default_severity, sort: dto.sort ?? 100 });
    await this.audit.record(null, { tenant_id: tenantId, actor_user_id: actor.id, action: 'incident_category.create', entity_type: 'incident_category', entity_id: saved.id, data: { ...dto } });
    return { id: saved.id, name: saved.name, default_severity: saved.default_severity, sort: saved.sort, status: saved.status };
  }

  async update(actor: AuthUser, id: string, dto: UpdateCategoryDto) {
    const tenantId = tenantOf(actor);
    await this.repo().get(tenantId, id);
    if (dto.name !== undefined) await this.assertNameFree(tenantId, dto.name, id);
    const saved = await this.repo().update(tenantId, id, { ...dto });
    await this.audit.record(null, { tenant_id: tenantId, actor_user_id: actor.id, action: 'incident_category.update', entity_type: 'incident_category', entity_id: id, data: { ...dto } });
    return { id: saved.id, name: saved.name, default_severity: saved.default_severity, sort: saved.sort, status: saved.status };
  }

  private repo() {
    return new TenantRepository(this.ds.getRepository(IncidentCategory));
  }

  private async assertNameFree(tenantId: string, name: string, exceptId: string | null) {
    const rows = await this.ds.query(
      `SELECT 1 FROM incident_categories WHERE tenant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [tenantId, name, exceptId],
    );
    if (rows.length) throw new BusinessException('INCIDENT_CATEGORY_TAKEN');
  }
}
