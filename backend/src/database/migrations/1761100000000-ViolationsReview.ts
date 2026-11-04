import { MigrationInterface, QueryRunner } from 'typeorm';

/** Plan 07 review: missed rounds are charged once; the violation tick's lookups get indexes. */
export class ViolationsReview1761100000000 implements MigrationInterface {
  name = 'ViolationsReview1761100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE patrol_rounds ADD COLUMN missed_charged_at timestamptz`);
    await q.query(`CREATE INDEX patrol_rounds_missed_uncharged ON patrol_rounds (expected_start) WHERE status = 'missed' AND missed_charged_at IS NULL`);
    await q.query(`CREATE INDEX patrol_rounds_partial ON patrol_rounds (expected_start) WHERE status = 'partial'`);
    await q.query(`CREATE INDEX attendances_check_in ON attendances (check_in_at)`);
    await q.query(`CREATE INDEX attendances_early_out ON attendances (check_out_at) WHERE early_minutes > 0`);
    await q.query(`CREATE INDEX patrol_scans_suspicious ON patrol_scans (created_at) WHERE validity = 'suspicious'`);
    await q.query(`CREATE INDEX shift_assignments_planned_start ON shift_assignments (planned_start) WHERE status = 'planned'`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const i of ['shift_assignments_planned_start', 'patrol_scans_suspicious', 'attendances_early_out', 'attendances_check_in', 'patrol_rounds_partial', 'patrol_rounds_missed_uncharged']) {
      await q.query(`DROP INDEX IF EXISTS ${i}`);
    }
    await q.query(`ALTER TABLE patrol_rounds DROP COLUMN IF EXISTS missed_charged_at`);
  }
}
