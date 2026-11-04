import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccessService } from '../access/access.service';
import { ADMIN_ROLE_CODE } from '../access/permissions';
import { UserRole, UserScope } from '../access/role.entity';
import { ScopeInput } from '../access/scope.types';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { hashPassword } from '../auth/password';
import { BusinessException } from '../common/errors/business.exception';
import { normalizeEmail, normalizePhone, PHONE_PATTERN } from '../common/identifiers';
import { EmployeesService } from '../employees/employees.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { User, UserType } from './user.entity';

export interface NewUserInput {
  user_type: 'staff' | 'guard';
  full_name: string;
  phone?: string | null;
  email?: string | null;
  password: string;
  employee_id?: string | null;
  role_ids: string[];
  scopes: ScopeInput[];
  must_change_password?: boolean;
}

export interface UserRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  user_type: UserType;
  status: 'active' | 'locked';
  employee_id: string | null;
  last_login_at: Date | null;
  roles: { id: string; code: string; name: string }[];
}

export interface UserView extends UserRow {
  must_change_password: boolean;
  scopes: { scope_type: string; scope_id: string | null }[];
}

const USER_ROWS = `
  SELECT u.id, u.full_name, u.phone, u.email, u.user_type, u.status, u.employee_id, u.last_login_at,
         COALESCE(json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name)
                  FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
   WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND ($2::uuid IS NULL OR u.id = $2::uuid)
   GROUP BY u.id
   ORDER BY u.full_name`;

@Injectable()
export class UsersService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}

  list(actor: AuthUser): Promise<UserRow[]> {
    return this.ds.query(USER_ROWS, [tenantOf(actor), null]);
  }

  async get(actor: AuthUser, id: string): Promise<UserView> {
    const [row]: UserRow[] = await this.ds.query(USER_ROWS, [tenantOf(actor), id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const [{ must_change_password }] = await this.ds.query(`SELECT must_change_password FROM users WHERE id = $1`, [id]);
    const scopes = await this.ds.query(
      `SELECT scope_type, scope_id FROM user_scopes WHERE user_id = $1 ORDER BY scope_type, scope_id`,
      [id],
    );
    return { ...row, must_change_password, scopes };
  }

  /** Accounts created by someone else start with a password the owner must replace. */
  async create(actor: AuthUser, dto: CreateUserDto): Promise<UserView> {
    const tenantId = tenantOf(actor);
    await this.access.assertCanGrant(actor, dto.role_ids, dto.scopes);
    if (dto.employee_id) await this.employees.get(actor, dto.employee_id);
    const user = await this.ds.transaction(async (m) => {
      const created = await this.insertUser(m, tenantId, { ...dto, must_change_password: true });
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'user.create', entity_type: 'user', entity_id: created.id,
        data: { user_type: dto.user_type, role_ids: dto.role_ids, scopes: dto.scopes },
      });
      return created;
    });
    return this.get(actor, user.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto): Promise<UserView> {
    const tenantId = tenantOf(actor);
    await this.get(actor, id); // 404 before anything reveals the account exists
    await this.access.assertCanManageUser(actor, id);
    if (dto.role_ids || dto.scopes) await this.access.assertCanGrant(actor, dto.role_ids ?? [], dto.scopes ?? []);
    if (id === actor.id && dto.status === 'locked') throw new BusinessException('USER_CANNOT_LOCK_SELF');

    await this.ds.transaction(async (m) => {
      // Serialise account changes per company so two admins cannot demote each other at once.
      await m.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
      const current = await m.findOneByOrFail(User, { id, tenant_id: tenantId });
      const phone = dto.phone === undefined ? current.phone : dto.phone ? checkedPhone(dto.phone) : null;
      const email = dto.email === undefined ? current.email : dto.email ? normalizeEmail(dto.email) : null;
      if (!phone && !email) throw new BusinessException('USER_IDENTIFIER_REQUIRED');
      if (dto.phone !== undefined || dto.email !== undefined) await assertIdentifiersFree(m, phone, email, id);

      const patch: Partial<User> = { phone, email };
      if (dto.full_name !== undefined) patch.full_name = dto.full_name;
      if (dto.status !== undefined) patch.status = dto.status;
      await m.update(User, { id, tenant_id: tenantId }, patch);
      if (dto.role_ids) await replaceRoles(m, id, dto.role_ids);
      if (dto.scopes) await replaceScopes(m, tenantId, id, dto.scopes);
      if (dto.status === 'locked') await revokeSessions(m, id);
      await assertTenantKeepsAdmin(m, tenantId);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'user.update', entity_type: 'user', entity_id: id,
        data: { ...dto },
      });
    });
    return this.get(actor, id);
  }

  async resetPassword(actor: AuthUser, id: string, newPassword: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.get(actor, id);
    await this.access.assertCanManageUser(actor, id);
    await this.ds.transaction(async (m) => {
      await m.update(User, { id, tenant_id: tenantId }, { password_hash: await hashPassword(newPassword), must_change_password: true });
      await revokeSessions(m, id);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'user.reset_password', entity_type: 'user', entity_id: id,
      });
    });
    return { ok: true };
  }

  /**
   * Writes a user with roles and scopes. Checks identity rules only, not who is
   * asking: callers either bootstrap a company or have already passed AccessService.
   */
  async insertUser(m: EntityManager, tenantId: string, input: NewUserInput): Promise<User> {
    const phone = input.phone ? checkedPhone(input.phone) : null;
    const email = input.email ? normalizeEmail(input.email) : null;
    if (!phone && !email) throw new BusinessException('USER_IDENTIFIER_REQUIRED');
    await assertIdentifiersFree(m, phone, email, null);
    if (input.employee_id) await assertEmployeeFree(m, input.employee_id, null);

    const user = await m.save(
      m.create(User, {
        tenant_id: tenantId,
        user_type: input.user_type,
        full_name: input.full_name,
        phone,
        email,
        password_hash: await hashPassword(input.password),
        employee_id: input.employee_id ?? null,
        must_change_password: input.must_change_password ?? false,
      }),
    );
    await replaceRoles(m, user.id, input.role_ids);
    await replaceScopes(m, tenantId, user.id, input.scopes);
    return user;
  }
}

export function checkedPhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!PHONE_PATTERN.test(phone)) {
    throw new BusinessException('VALIDATION_FAILED', ['phone: Số điện thoại không hợp lệ']);
  }
  return phone;
}

export async function assertIdentifiersFree(
  m: EntityManager,
  phone: string | null,
  email: string | null,
  exceptUserId: string | null,
): Promise<void> {
  if (!phone && !email) return;
  const qb = m
    .createQueryBuilder(User, 'u')
    .where('(u.phone = :phone OR lower(u.email) = :email)', { phone: phone ?? '', email: email ?? '' });
  if (exceptUserId) qb.andWhere('u.id <> :id', { id: exceptUserId });
  if (await qb.getExists()) throw new BusinessException('USER_IDENTIFIER_TAKEN');
}

export async function assertEmployeeFree(m: EntityManager, employeeId: string, exceptUserId: string | null) {
  const qb = m.createQueryBuilder(User, 'u').where('u.employee_id = :employeeId', { employeeId });
  if (exceptUserId) qb.andWhere('u.id <> :id', { id: exceptUserId });
  if (await qb.getExists()) throw new BusinessException('USER_EMPLOYEE_TAKEN');
}

export async function replaceRoles(m: EntityManager, userId: string, roleIds: string[]) {
  await m.delete(UserRole, { user_id: userId });
  const unique = [...new Set(roleIds)];
  if (unique.length) await m.insert(UserRole, unique.map((role_id) => ({ user_id: userId, role_id })));
}

export async function replaceScopes(m: EntityManager, tenantId: string, userId: string, scopes: ScopeInput[]) {
  await m.delete(UserScope, { user_id: userId });
  const seen = new Set<string>();
  for (const scope of scopes) {
    const key = `${scope.scope_type}:${scope.scope_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await m.insert(UserScope, {
      tenant_id: tenantId,
      user_id: userId,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id ?? null,
    });
  }
}

async function revokeSessions(m: EntityManager, userId: string): Promise<void> {
  await m.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

/**
 * The admin role is the one role defined by identity (see permissions.ts): a
 * company with no active admin could never manage roles again. Runs inside the
 * transaction so the offending change rolls back.
 */
async function assertTenantKeepsAdmin(m: EntityManager, tenantId: string): Promise<void> {
  const [{ count }]: { count: number }[] = await m.query(
    `SELECT count(*)::int AS count
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
        AND r.code = $2 AND r.is_system AND r.deleted_at IS NULL`,
    [tenantId, ADMIN_ROLE_CODE],
  );
  if (count === 0) throw new BusinessException('LAST_ADMIN');
}
