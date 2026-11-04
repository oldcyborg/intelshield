import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuthUser } from '../auth/auth-user';
import { todayLocal } from '../common/date';

type Db = DataSource | EntityManager;

/**
 * Whether the caller looks after this person: company-wide scope does; otherwise the person must be in one of
 * the caller's teams today (a leader their team, a group manager the group's teams) — the same rule as rostering.
 */
export async function looksAfter(db: Db, scopes: ScopeService, actor: AuthUser, employeeId: string): Promise<boolean> {
  const teams = await scopes.teamVisibility(actor);
  if (teams.all) return true;
  if (!teams.teamIds.length) return false;
  const today = todayLocal();
  const rows = await db.query(
    `SELECT 1 FROM team_members WHERE employee_id = $1 AND team_id = ANY($2::uuid[]) AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3)`,
    [employeeId, teams.teamIds, today],
  );
  return rows.length > 0;
}

/** A filter on an employee column: people in the caller's teams today, or nothing extra for company-wide scope. */
export async function lookedAfterFilter(scopes: ScopeService, actor: AuthUser, column: string, params: unknown[]): Promise<string> {
  const teams = await scopes.teamVisibility(actor);
  if (teams.all) return '';
  params.push(teams.teamIds, todayLocal());
  const t = `$${params.length - 1}`;
  const d = `$${params.length}`;
  return ` AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.employee_id = ${column} AND tm.team_id = ANY(${t}::uuid[])
             AND tm.start_date <= ${d} AND (tm.end_date IS NULL OR tm.end_date >= ${d}))`;
}

/** The leader of the person's team today, and the manager of that team's group (either may be missing). */
export async function bossesOf(db: Db, employeeId: string): Promise<{ leaders: string[]; managers: string[] }> {
  const today = todayLocal();
  const rows: { id: string; kind: 'leader' | 'manager' }[] = await db.query(
    `SELECT u.id, 'leader' AS kind
       FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
       JOIN users u ON u.employee_id = t.leader_employee_id AND u.status = 'active' AND u.deleted_at IS NULL
      WHERE tm.employee_id = $1 AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2) AND t.leader_employee_id <> $1
     UNION
     SELECT u.id, 'manager' AS kind
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
       JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
       JOIN users u ON u.id = g.manager_user_id AND u.status = 'active' AND u.deleted_at IS NULL
      WHERE tm.employee_id = $1 AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)`,
    [employeeId, today],
  );
  return { leaders: rows.filter((r) => r.kind === 'leader').map((r) => r.id), managers: rows.filter((r) => r.kind === 'manager').map((r) => r.id) };
}

/** Accounts of the person themselves. */
export async function usersOf(db: Db, employeeId: string): Promise<string[]> {
  const rows: { id: string }[] = await db.query(`SELECT id FROM users WHERE employee_id = $1 AND status = 'active' AND deleted_at IS NULL`, [employeeId]);
  return rows.map((r) => r.id);
}

/** Files the caller uploaded, images, not attached to anything yet. */
export async function ownLoosePhotos(db: Db, actor: AuthUser, tenantId: string, fileIds: string[]): Promise<boolean> {
  if (!fileIds.length) return true;
  if (new Set(fileIds).size !== fileIds.length) return false;
  const rows = await db.query(
    `SELECT id FROM files WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
        AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL`,
    [fileIds, tenantId, actor.id],
  );
  return rows.length === fileIds.length;
}
