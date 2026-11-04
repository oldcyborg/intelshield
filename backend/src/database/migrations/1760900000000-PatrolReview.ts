import { MigrationInterface, QueryRunner } from 'typeorm';

/** Plan 06 review: rounds remember being revived or started from a backdated offline report; ticks and day views get indexes. */
export class PatrolReview1760900000000 implements MigrationInterface {
  name = 'PatrolReview1760900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE patrol_rounds ADD COLUMN backdated boolean NOT NULL DEFAULT false`);
    await q.query(`CREATE INDEX patrol_rounds_to_remind ON patrol_rounds (expected_start) WHERE status = 'pending' AND reminder_sent_at IS NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS patrol_rounds_to_remind`);
    await q.query(`ALTER TABLE patrol_rounds DROP COLUMN IF EXISTS backdated`);
  }
}
