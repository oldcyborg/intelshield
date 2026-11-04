import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { CreateRoleDto } from './dto';
import { PermissionService } from './permission.service';
import { ADMIN_ROLE_CODE } from './permissions';
import { Role, RolePermission } from './role.entity';

export interface RoleView {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  permissions: string[];
}

@Injectable()
export class RolesService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<RoleView[]> {
    return this.query(tenantId, null);
  }

  async create(actor: AuthUser, dto: CreateRoleDto): Promise<RoleView> {
    const tenantId = tenantOf(actor);
    await this.assertHolds(actor, dto.permissions);
    const role = await this.ds.transaction(async (m) => {
      if (await m.exists(Role, { where: { tenant_id: tenantId, code: dto.code } })) {
        throw new BusinessException('ROLE_CODE_TAKEN');
      }
      const created = await m.save(m.create(Role, { tenant_id: tenantId, code: dto.code, name: dto.name, is_system: false }));
      await this.writePermissions(m, created.id, dto.permissions);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'role.create', entity_type: 'role',
        entity_id: created.id, data: { code: dto.code, permissions: dto.permissions },
      });
      return created;
    });
    return this.one(tenantId, role.id);
  }

  async setPermissions(actor: AuthUser, id: string, permissions: string[]): Promise<RoleView> {
    const tenantId = tenantOf(actor);
    const role = await this.ds.getRepository(Role).findOneBy({ id, tenant_id: tenantId });
    if (!role) throw new BusinessException('NOT_FOUND');
    if (role.is_system && role.code === ADMIN_ROLE_CODE) throw new BusinessException('ROLE_ADMIN_LOCKED');

    const before: { permission: string }[] = await this.ds.query(
      `SELECT permission FROM role_permissions WHERE role_id = $1`,
      [id],
    );
    // To edit a role you must hold everything it grants, before and after the edit.
    // Otherwise HR could strip the manager role of permissions HR was never given.
    await this.assertHolds(actor, [...before.map((r) => r.permission), ...permissions]);

    await this.ds.transaction(async (m) => {
      await m.delete(RolePermission, { role_id: id });
      await this.writePermissions(m, id, permissions);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'role.permissions', entity_type: 'role', entity_id: id,
        data: { before: before.map((r) => r.permission), after: permissions },
      });
    });
    return this.one(tenantId, id);
  }

  private async one(tenantId: string, id: string): Promise<RoleView> {
    const [role] = await this.query(tenantId, id);
    if (!role) throw new BusinessException('NOT_FOUND');
    return role;
  }

  private query(tenantId: string, id: string | null): Promise<RoleView[]> {
    return this.ds.query(
      `SELECT r.id, r.code, r.name, r.is_system,
              COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND ($2::uuid IS NULL OR r.id = $2::uuid)
        GROUP BY r.id
        ORDER BY r.is_system DESC, r.name`,
      [tenantId, id],
    );
  }

  private async assertHolds(actor: AuthUser, permissions: string[]): Promise<void> {
    const held = await this.permissions.permissionsOf(actor.id);
    if (permissions.some((p) => !held.has(p))) throw new BusinessException('ROLE_ESCALATION');
  }

  private async writePermissions(m: EntityManager, roleId: string, permissions: string[]): Promise<void> {
    const unique = [...new Set(permissions)];
    if (unique.length) await m.insert(RolePermission, unique.map((permission) => ({ role_id: roleId, permission })));
  }
}
