import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ADMIN_ROLE_CODE, ROLE_TEMPLATES } from '../access/permissions';
import { Role, RolePermission } from '../access/role.entity';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { DEFAULT_INCIDENT_CATEGORIES } from '../incidents/categories';
import { UsersService } from '../users/users.service';
import { CreateTenantDto, UpdateTenantDto } from './dto';
import { Tenant } from './tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    private readonly ds: DataSource,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /** A company, its system roles and its first admin — all or nothing. */
  async createTenant(dto: CreateTenantDto, actor: AuthUser | null): Promise<{ tenant: Tenant; admin_user_id: string }> {
    return this.ds.transaction(async (m) => {
      if (await m.exists(Tenant, { where: { code: dto.code } })) {
        throw new BusinessException('TENANT_CODE_TAKEN');
      }
      const tenant = await m.save(m.create(Tenant, { code: dto.code, name: dto.name, settings: {} }));

      let adminRoleId: string | null = null;
      for (const template of ROLE_TEMPLATES) {
        const role = await m.save(
          m.create(Role, { tenant_id: tenant.id, code: template.code, name: template.name, is_system: true }),
        );
        if (template.permissions.length) {
          await m.insert(RolePermission, template.permissions.map((permission) => ({ role_id: role.id, permission })));
        }
        if (template.code === ADMIN_ROLE_CODE) adminRoleId = role.id;
      }
      if (!adminRoleId) throw new Error('ROLE_TEMPLATES must contain the admin role');
      for (const [i, c] of DEFAULT_INCIDENT_CATEGORIES.entries()) {
        await m.query(`INSERT INTO incident_categories (tenant_id, name, default_severity, sort) VALUES ($1, $2, $3, $4)`, [
          tenant.id, c.name, c.default_severity, i + 1,
        ]);
      }

      const admin = await this.users.insertUser(m, tenant.id, {
        user_type: 'staff',
        full_name: dto.admin.full_name,
        phone: dto.admin.phone ?? null,
        email: dto.admin.email ?? null,
        password: dto.admin.password,
        role_ids: [adminRoleId],
        scopes: [{ scope_type: 'tenant' }],
      });

      await this.audit.record(m, {
        tenant_id: tenant.id,
        actor_user_id: actor?.id ?? null,
        action: 'tenant.create',
        entity_type: 'tenant',
        entity_id: tenant.id,
        data: { code: tenant.code },
      });
      return { tenant, admin_user_id: admin.id };
    });
  }

  list() {
    return this.ds.query(
      `SELECT t.id, t.code, t.name, t.status, t.created_at,
              (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS user_count
         FROM tenants t
        ORDER BY t.created_at DESC`,
    );
  }

  async update(id: string, dto: UpdateTenantDto, actor: AuthUser): Promise<Tenant> {
    const repo = this.ds.getRepository(Tenant);
    const tenant = await repo.findOneBy({ id });
    if (!tenant) throw new BusinessException('NOT_FOUND');
    if (dto.name !== undefined) tenant.name = dto.name;
    if (dto.status !== undefined) tenant.status = dto.status;
    const saved = await repo.save(tenant);
    // Suspension needs no session clean-up: JwtStrategy checks the company on every request.
    await this.audit.record(null, {
      tenant_id: id, actor_user_id: actor.id, action: 'tenant.update', entity_type: 'tenant', entity_id: id,
      data: { ...dto },
    });
    return saved;
  }
}
