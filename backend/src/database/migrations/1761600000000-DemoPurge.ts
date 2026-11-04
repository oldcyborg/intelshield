import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The incident timeline stays append-only, with one exception: deleting a whole company that the demo reset
 * is wiping. The reset names that company in a setting that lives only inside its own transaction.
 */
export class DemoPurge1761600000000 implements MigrationInterface {
  name = 'DemoPurge1761600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION incident_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND OLD.tenant_id::text = current_setting('app.purging_tenant', true) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'incident_events is append-only';
      END $$`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION incident_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'incident_events is append-only'; END $$`);
  }
}
