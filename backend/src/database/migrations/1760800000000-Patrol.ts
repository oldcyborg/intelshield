import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'patrol.view'], ['admin', 'patrol.perform'],
  ['manager', 'patrol.view'],
  ['team_leader', 'patrol.view'], ['team_leader', 'patrol.perform'],
  ['guard', 'patrol.perform'],
  ['hr', 'patrol.view'], ['hr', 'patrol.perform'],
  ['accountant', 'patrol.view'],
];

export class Patrol1760800000000 implements MigrationInterface {
  name = 'Patrol1760800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE checkpoints ADD COLUMN photo_rule varchar(10) NOT NULL DEFAULT 'never'
                     CHECK (photo_rule IN ('never', 'always', 'random'))`);
    await q.query(`UPDATE checkpoints SET photo_rule = 'always' WHERE require_photo`);
    await q.query(`ALTER TABLE checkpoints DROP COLUMN require_photo`);

    await q.query(`
      CREATE TABLE patrol_schedules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        route_id uuid NOT NULL REFERENCES routes(id),
        name varchar(100) NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        interval_minutes integer NOT NULL CHECK (interval_minutes BETWEEN 15 AND 720),
        days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}' CHECK (days <@ '{1,2,3,4,5,6,7}'::smallint[] AND cardinality(days) > 0),
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE INDEX patrol_schedules_site ON patrol_schedules (site_id) WHERE deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE patrol_rounds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        schedule_id uuid NOT NULL REFERENCES patrol_schedules(id),
        route_id uuid NOT NULL REFERENCES routes(id),
        expected_start timestamptz NOT NULL,
        expected_end timestamptz NOT NULL,
        photo_checkpoint_ids uuid[] NOT NULL DEFAULT '{}',
        stops jsonb,
        status varchar(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_progress', 'completed', 'partial', 'missed')),
        employee_id uuid REFERENCES employees(id),
        user_id uuid REFERENCES users(id),
        started_at timestamptz,
        ended_at timestamptz,
        ended_by varchar(10) CHECK (ended_by IN ('guard', 'system')),
        late boolean NOT NULL DEFAULT false,
        required_count integer NOT NULL DEFAULT 0,
        done_required integer NOT NULL DEFAULT 0,
        reminder_sent_at timestamptz,
        missed_notified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT patrol_rounds_slot_uq UNIQUE (schedule_id, expected_start),
        CONSTRAINT patrol_rounds_window CHECK (expected_end > expected_start)
      )`);
    await q.query(`CREATE INDEX patrol_rounds_site_time ON patrol_rounds (tenant_id, site_id, expected_start)`);
    await q.query(`CREATE INDEX patrol_rounds_open ON patrol_rounds (expected_end) WHERE status IN ('pending', 'in_progress')`);

    await q.query(`
      CREATE TABLE patrol_scans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        round_id uuid NOT NULL REFERENCES patrol_rounds(id),
        checkpoint_id uuid NOT NULL REFERENCES checkpoints(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        user_id uuid NOT NULL REFERENCES users(id),
        client_uuid uuid NOT NULL,
        method varchar(10) NOT NULL CHECK (method IN ('qr', 'gps', 'photo')),
        scanned_at timestamptz NOT NULL,
        device_time timestamptz NOT NULL,
        server_time timestamptz NOT NULL DEFAULT now(),
        captured_offline boolean NOT NULL DEFAULT false,
        lat numeric(9, 6),
        lng numeric(9, 6),
        accuracy_m integer,
        distance_m integer,
        mock_location boolean NOT NULL DEFAULT false,
        photo_id uuid REFERENCES files(id),
        flags text[] NOT NULL DEFAULT '{}',
        validity varchar(12) NOT NULL DEFAULT 'valid' CHECK (validity IN ('valid', 'suspicious')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT patrol_scans_client_uq UNIQUE (tenant_id, client_uuid),
        CONSTRAINT patrol_scans_once UNIQUE (round_id, checkpoint_id)
      )`);

    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'patrol.%'`);
    await q.query(`DROP TABLE IF EXISTS patrol_scans`);
    await q.query(`DROP TABLE IF EXISTS patrol_rounds`);
    await q.query(`DROP TABLE IF EXISTS patrol_schedules`);
    await q.query(`ALTER TABLE checkpoints ADD COLUMN require_photo boolean NOT NULL DEFAULT false`);
    await q.query(`UPDATE checkpoints SET require_photo = (photo_rule = 'always')`);
    await q.query(`ALTER TABLE checkpoints DROP COLUMN photo_rule`);
  }
}
