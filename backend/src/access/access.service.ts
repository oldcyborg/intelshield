import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { PermissionService } from './permission.service';
import { ScopeService } from './scope.service';
import { ScopeInput } from './scope.types';

/** The rule behind every grant: you can only hand out what you already hold. */
@Injectable()
export class AccessService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionService,
    private readonly scopes: ScopeService,
  ) {}

  async assertCanGrant(actor: AuthUser, roleIds: string[], scopes: ScopeInput[]): Promise<void> {
    const tenantId = tenantOf(actor);
    const unique = [...new Set(roleIds)];
    if (unique.length) {
      const found: { id: string }[] = await this.ds.query(
        `SELECT id FROM roles WHERE tenant_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
        [tenantId, unique],
      );
      if (found.length !== unique.length) throw new BusinessException('NOT_FOUND');
      const granted: { permission: string }[] = await this.ds.query(
        `SELECT DISTINCT permission FROM role_permissions WHERE role_id = ANY($1::uuid[])`,
        [unique],
      );
      const held = await this.permissions.permissionsOf(actor.id);
      if (granted.some((g) => !held.has(g.permission))) throw new BusinessException('ROLE_ESCALATION');
    }

    if (!scopes.length) return;
    const visibility = await this.scopes.teamVisibility(actor);
    for (const scope of scopes) {
      if (scope.scope_type === 'tenant') {
        if (scope.scope_id) throw new BusinessException('SCOPE_INVALID');
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else if (scope.scope_type === 'team') {
        if (!scope.scope_id || !(await this.exists('teams', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all && !visibility.teamIds.includes(scope.scope_id)) throw new BusinessException('ROLE_ESCALATION');
      } else if (scope.scope_type === 'team_group') {
        if (!scope.scope_id || !(await this.exists('team_groups', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else if (scope.scope_type === 'client') {
        if (!scope.scope_id || !(await this.exists('clients', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else if (scope.scope_type === 'site') {
        if (!scope.scope_id || !(await this.exists('sites', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else {
        throw new BusinessException('SCOPE_INVALID');
      }
    }
  }

  /** Nobody changes, locks or resets an account that holds more than they do. */
  async assertCanManageUser(actor: AuthUser, targetUserId: string): Promise<void> {
    if (targetUserId === actor.id) return;
    const [held, target] = await Promise.all([
      this.permissions.permissionsOf(actor.id),
      this.permissions.permissionsOf(targetUserId),
    ]);
    if ([...target].some((p) => !held.has(p))) throw new BusinessException('ROLE_ESCALATION');

    // Scope as well as permissions: whatever the target can see must already be visible to the actor,
    // or resetting their password would hand the actor the target's view of the company.
    const [row]: { employee_id: string | null }[] = await this.ds.query(`SELECT employee_id FROM users WHERE id = $1`, [
      targetUserId,
    ]);
    const targetUser: AuthUser = {
      id: targetUserId,
      tenant_id: actor.tenant_id,
      user_type: 'staff',
      employee_id: row?.employee_id ?? null,
      session_id: '',
    };
    const [mine, theirs] = await Promise.all([this.scopes.teamVisibility(actor), this.scopes.teamVisibility(targetUser)]);
    if (mine.all) return;
    if (theirs.all || theirs.teamIds.some((id) => !mine.teamIds.includes(id))) {
      throw new BusinessException('ROLE_ESCALATION');
    }
    // Only company-wide scope may grant group or client scopes, so only it may manage such accounts.
    const groupScoped = await this.ds.query(
      `SELECT 1 FROM user_scopes WHERE user_id = $1 AND scope_type IN ('team_group', 'client', 'site') LIMIT 1`,
      [targetUserId],
    );
    if (groupScoped.length) throw new BusinessException('ROLE_ESCALATION');
  }

  private async exists(table: 'teams' | 'team_groups' | 'clients' | 'sites', id: string, tenantId: string): Promise<boolean> {
    const rows = await this.ds.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, tenantId]);
    return rows.length > 0;
  }
}
