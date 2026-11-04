import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';

export type TeamVisibility = { all: true } | { all: false; teamIds: string[] };
export type ClientVisibility = { all: true } | { all: false; clientIds: string[] };
export type SiteVisibility = { all: true } | { all: false; siteIds: string[] };

/**
 * Which teams a person may see. Comes from two places: explicit `user_scopes`
 * rows, and the organisation itself — a group's manager sees its teams, a team's
 * leader sees that team — so naming someone leader is enough, no extra grant.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly ds: DataSource) {}

  async hasTenantScope(user: AuthUser): Promise<boolean> {
    const rows = await this.ds.query(
      `SELECT 1 FROM user_scopes WHERE user_id = $1 AND scope_type = 'tenant' LIMIT 1`,
      [user.id],
    );
    return rows.length > 0;
  }

  async assertTenantScope(user: AuthUser): Promise<void> {
    if (!(await this.hasTenantScope(user))) throw new BusinessException('AUTH_FORBIDDEN');
  }

  async teamVisibility(user: AuthUser): Promise<TeamVisibility> {
    if (await this.hasTenantScope(user)) return { all: true };
    const rows: { id: string }[] = await this.ds.query(
      `SELECT t.id FROM teams t
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL AND (
              t.id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'team')
           OR t.team_group_id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'team_group')
           OR t.team_group_id IN (SELECT g.id FROM team_groups g WHERE g.manager_user_id = $2 AND g.deleted_at IS NULL)
           OR ($3::uuid IS NOT NULL AND t.leader_employee_id = $3::uuid))`,
      [user.tenant_id, user.id, user.employee_id],
    );
    return { all: false, teamIds: rows.map((r) => r.id) };
  }

  /**
   * Clients a person may see: company-wide scope sees all; otherwise the clients
   * they were scoped to, the clients they look after as account manager, and the
   * clients where someone from a team they can see is deployed today.
   */
  async clientVisibility(user: AuthUser): Promise<ClientVisibility> {
    const teams = await this.teamVisibility(user);
    if (teams.all) return { all: true };
    const rows: { id: string }[] = await this.ds.query(
      `SELECT c.id FROM clients c
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND (
              c.id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'client')
           OR c.account_manager_id = $2
           OR EXISTS (
                SELECT 1 FROM deployments d
                  JOIN team_members tm ON tm.employee_id = d.employee_id
                 WHERE d.client_id = c.id
                   AND d.start_date <= $4 AND (d.end_date IS NULL OR d.end_date >= $4)
                   AND tm.team_id = ANY($3::uuid[])
                   AND tm.start_date <= $4 AND (tm.end_date IS NULL OR tm.end_date >= $4)))`,
      [user.tenant_id, user.id, teams.teamIds, todayLocal()],
    );
    return { all: false, clientIds: rows.map((r) => r.id) };
  }

  async canSeeClient(user: AuthUser, clientId: string): Promise<boolean> {
    const visibility = await this.clientVisibility(user);
    return visibility.all ? this.inTenant('clients', clientId, user) : visibility.clientIds.includes(clientId);
  }

  /** Sites of visible clients, sites scoped to the person, and sites their visible teams look after. */
  async siteVisibility(user: AuthUser): Promise<SiteVisibility> {
    const [teams, clients] = await Promise.all([this.teamVisibility(user), this.clientVisibility(user)]);
    if (teams.all || clients.all) return { all: true };
    const rows: { id: string }[] = await this.ds.query(
      `SELECT s.id FROM sites s
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND (
              s.client_id = ANY($2::uuid[])
           OR s.id IN (SELECT scope_id FROM user_scopes WHERE user_id = $3 AND scope_type = 'site')
           OR s.responsible_team_id = ANY($4::uuid[]))`,
      [user.tenant_id, clients.clientIds, user.id, teams.teamIds],
    );
    return { all: false, siteIds: rows.map((r) => r.id) };
  }

  async canSeeSite(user: AuthUser, siteId: string): Promise<boolean> {
    const visibility = await this.siteVisibility(user);
    return visibility.all ? this.inTenant('sites', siteId, user) : visibility.siteIds.includes(siteId);
  }

  /**
   * Whose records (violations, attendance corrections) this person may decide on. Seeing a site is not enough:
   * a team leader sees every site of a client their people work at, but decides only for their own team's
   * people. A company-wide scope decides for anyone; an explicit site or client scope for anyone working there.
   */
  async judgeable(user: AuthUser): Promise<{ all: true } | { all: false; employeeIds: string[]; siteIds: string[] }> {
    const teams = await this.teamVisibility(user);
    if (teams.all) return { all: true };
    const today = todayLocal();
    const [people, sites]: [{ id: string }[], { id: string }[]] = await Promise.all([
      this.ds.query(
        `SELECT DISTINCT tm.employee_id AS id FROM team_members tm
          WHERE tm.team_id = ANY($1::uuid[]) AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)`,
        [teams.teamIds, today],
      ),
      this.ds.query(
        `SELECT s.id FROM sites s
          WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND (
                s.id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'site')
             OR s.client_id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'client')
             OR s.client_id IN (SELECT c.id FROM clients c WHERE c.account_manager_id = $2 AND c.deleted_at IS NULL))`,
        [user.tenant_id, user.id],
      ),
    ]);
    return { all: false, employeeIds: people.map((p) => p.id), siteIds: sites.map((s) => s.id) };
  }

  async canJudge(user: AuthUser, record: { employee_id: string; site_id: string }): Promise<boolean> {
    const j = await this.judgeable(user);
    return j.all || j.employeeIds.includes(record.employee_id) || j.siteIds.includes(record.site_id);
  }

  async canSeeTeam(user: AuthUser, teamId: string): Promise<boolean> {
    const visibility = await this.teamVisibility(user);
    return visibility.all ? this.inTenant('teams', teamId, user) : visibility.teamIds.includes(teamId);
  }

  /**
   * "Sees everything" means everything of the caller's own company: a company-wide
   * scope must never vouch for an id from another tenant.
   */
  private async inTenant(table: 'sites' | 'clients' | 'teams', id: string, user: AuthUser): Promise<boolean> {
    const rows = await this.ds.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, user.tenant_id]);
    return rows.length > 0;
  }
}

/** Each row with whether this person may decide on it — the apps show the decision buttons only then. */
export function markJudgeable<T extends { employee_id: string; site_id: string }>(
  rows: T[],
  j: { all: true } | { all: false; employeeIds: string[]; siteIds: string[] },
): (T & { can_judge: boolean })[] {
  return rows.map((r) => ({ ...r, can_judge: j.all || j.employeeIds.includes(r.employee_id) || j.siteIds.includes(r.site_id) }));
}
