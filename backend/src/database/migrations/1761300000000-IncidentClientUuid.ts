import { MigrationInterface, QueryRunner } from 'typeorm';

/** The app's own id for a report: sending it again (offline queue) never makes a second incident. */
export class IncidentClientUuid1761300000000 implements MigrationInterface {
  name = 'IncidentClientUuid1761300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE incidents ADD COLUMN client_uuid uuid`);
    await q.query(`CREATE UNIQUE INDEX incidents_client_uq ON incidents (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS incidents_client_uq`);
    await q.query(`ALTER TABLE incidents DROP COLUMN IF EXISTS client_uuid`);
  }
}
