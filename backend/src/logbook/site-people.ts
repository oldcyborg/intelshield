import { DataSource, EntityManager } from 'typeorm';

/** The leader of the team that runs the site, and the manager of its group — who hears about trouble there. */
export async function leaderAndManager(db: DataSource | EntityManager, siteId: string): Promise<string[]> {
  const rows: { id: string }[] = await db.query(
    `SELECT u.id FROM sites s JOIN teams t ON t.id = s.responsible_team_id AND t.deleted_at IS NULL
       JOIN users u ON u.employee_id = t.leader_employee_id AND u.status = 'active' AND u.deleted_at IS NULL
      WHERE s.id = $1
     UNION
     SELECT g.manager_user_id FROM sites s JOIN teams t ON t.id = s.responsible_team_id
       JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
       JOIN users u ON u.id = g.manager_user_id AND u.status = 'active' AND u.deleted_at IS NULL
      WHERE s.id = $1`,
    [siteId],
  );
  return rows.map((r) => r.id);
}
