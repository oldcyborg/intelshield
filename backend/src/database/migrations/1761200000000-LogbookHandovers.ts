import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'logbook.view'], ['admin', 'logbook.write'], ['admin', 'logbook.manage'], ['admin', 'handover.review'],
  ['manager', 'logbook.view'], ['manager', 'logbook.manage'], ['manager', 'handover.review'],
  ['team_leader', 'logbook.view'], ['team_leader', 'logbook.write'], ['team_leader', 'handover.review'],
  ['guard', 'logbook.write'],
  ['hr', 'logbook.view'], ['hr', 'logbook.write'],
];

export class LogbookHandovers1761200000000 implements MigrationInterface {
  name = 'LogbookHandovers1761200000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sites ADD COLUMN handover_items jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await q.query(`ALTER TABLE shift_assignments ADD COLUMN handover_alerted_at timestamptz`);
    await q.query(`
      CREATE TABLE logbook_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        assignment_id uuid REFERENCES shift_assignments(id),
        author_user_id uuid NOT NULL REFERENCES users(id),
        author_employee_id uuid REFERENCES employees(id),
        type varchar(20) NOT NULL CHECK (type IN ('note', 'visitor', 'vehicle', 'asset', 'other')),
        body text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL,
        exited_at timestamptz,
        exited_by uuid REFERENCES users(id),
        client_uuid uuid NOT NULL,
        captured_offline boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT logbook_client_uq UNIQUE (tenant_id, client_uuid),
        CONSTRAINT logbook_exit_after CHECK (exited_at IS NULL OR exited_at >= occurred_at)
      )`);
    await q.query(`CREATE INDEX logbook_site_time ON logbook_entries (tenant_id, site_id, occurred_at DESC)`);
    await q.query(`CREATE INDEX logbook_inside ON logbook_entries (site_id) WHERE type IN ('visitor', 'vehicle') AND exited_at IS NULL`);

    await q.query(`
      CREATE TABLE handovers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        from_assignment_id uuid NOT NULL REFERENCES shift_assignments(id),
        from_employee_id uuid NOT NULL REFERENCES employees(id),
        to_assignment_id uuid REFERENCES shift_assignments(id),
        to_employee_id uuid REFERENCES employees(id),
        items jsonb NOT NULL DEFAULT '[]'::jsonb,
        notes text,
        status varchar(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'disputed')),
        submitted_at timestamptz NOT NULL DEFAULT now(),
        receiver_note text,
        answered_at timestamptz,
        reviewed_by uuid REFERENCES users(id),
        reviewed_at timestamptz,
        review_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT handovers_once UNIQUE (from_assignment_id)
      )`);
    await q.query(`CREATE INDEX handovers_site_time ON handovers (tenant_id, site_id, submitted_at DESC)`);
    await q.query(`CREATE INDEX handovers_to ON handovers (to_assignment_id)`);
    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'logbook.%' OR permission LIKE 'handover.%'`);
    await q.query(`DROP TABLE IF EXISTS handovers`);
    await q.query(`DROP TABLE IF EXISTS logbook_entries`);
    await q.query(`ALTER TABLE shift_assignments DROP COLUMN IF EXISTS handover_alerted_at`);
    await q.query(`ALTER TABLE sites DROP COLUMN IF EXISTS handover_items`);
  }
}
