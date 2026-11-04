import { MigrationInterface, QueryRunner } from 'typeorm';

/** When an incident really happened — for reports kept on a phone without signal and sent later. */
export class IncidentOccurredAt1761400000000 implements MigrationInterface {
  name = 'IncidentOccurredAt1761400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE incidents ADD COLUMN occurred_at timestamptz`);
    await q.query(`UPDATE incidents SET occurred_at = created_at`);
    await q.query(`ALTER TABLE incidents ALTER COLUMN occurred_at SET NOT NULL, ALTER COLUMN occurred_at SET DEFAULT now()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE incidents DROP COLUMN IF EXISTS occurred_at`);
  }
}
