import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'violation.view'], ['admin', 'violation.propose'], ['admin', 'violation.review'],
  ['manager', 'violation.view'], ['manager', 'violation.propose'], ['manager', 'violation.review'],
  ['team_leader', 'violation.view'], ['team_leader', 'violation.propose'],
  ['hr', 'violation.view'],
  ['accountant', 'violation.view'],
];

export class Violations1761000000000 implements MigrationInterface {
  name = 'Violations1761000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE shift_assignments ADD COLUMN late_alerted_at timestamptz`);
    await q.query(`
      CREATE TABLE violations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        type varchar(30) NOT NULL CHECK (type IN ('late_check_in', 'absent', 'early_check_out', 'missed_round', 'missed_checkpoint', 'suspicious_scan')),
        ref_type varchar(20) NOT NULL CHECK (ref_type IN ('assignment', 'round', 'scan')),
        ref_id uuid NOT NULL,
        occurred_at timestamptz NOT NULL,
        minutes integer,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        status varchar(20) NOT NULL DEFAULT 'auto'
          CHECK (status IN ('auto', 'proposed_confirm', 'proposed_waive', 'confirmed', 'waived')),
        proposed_by uuid REFERENCES users(id),
        proposed_note text,
        proposed_at timestamptz,
        reviewed_by uuid REFERENCES users(id),
        review_note text,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT violations_once UNIQUE (ref_type, ref_id, employee_id, type)
      )`);
    await q.query(`CREATE INDEX violations_site_time ON violations (tenant_id, site_id, occurred_at DESC)`);
    await q.query(`CREATE INDEX violations_open ON violations (tenant_id, status) WHERE status IN ('auto', 'proposed_confirm', 'proposed_waive')`);
    await q.query(`CREATE INDEX violations_employee ON violations (employee_id, occurred_at DESC)`);
    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'violation.%'`);
    await q.query(`DROP TABLE IF EXISTS violations`);
    await q.query(`ALTER TABLE shift_assignments DROP COLUMN IF EXISTS late_alerted_at`);
  }
}
