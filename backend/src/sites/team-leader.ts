import { DataSource, EntityManager } from 'typeorm';

/**
 * Sites whose responsible team this employee leads. A team leader walks every site of the team, not one post on
 * a roster, so writing the logbook and taking a patrol round there need no shift of their own.
 */
export const LED_SITES = `
  SELECT s.id FROM sites s JOIN teams t ON t.id = s.responsible_team_id AND t.deleted_at IS NULL
   WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND t.leader_employee_id = $2`;

export async function leadsSite(db: DataSource | EntityManager, tenantId: string, employeeId: string | null, siteId: string): Promise<boolean> {
  if (!employeeId) return false;
  const rows = await db.query(`${LED_SITES} AND s.id = $3 LIMIT 1`, [tenantId, employeeId, siteId]);
  return rows.length > 0;
}
