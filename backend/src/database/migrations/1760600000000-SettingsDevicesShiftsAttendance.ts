import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'roster.view'], ['admin', 'roster.manage'], ['admin', 'attendance.view'], ['admin', 'device.manage'],
  ['manager', 'roster.view'], ['manager', 'roster.manage'], ['manager', 'attendance.view'],
  ['team_leader', 'roster.view'], ['team_leader', 'roster.manage'], ['team_leader', 'attendance.view'],
  ['hr', 'roster.view'], ['hr', 'roster.manage'], ['hr', 'attendance.view'], ['hr', 'device.manage'],
  ['accountant', 'roster.view'], ['accountant', 'attendance.view'],
];

export class SettingsDevicesShiftsAttendance1760600000000 implements MigrationInterface {
  name = 'SettingsDevicesShiftsAttendance1760600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sites ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb`);

    await q.query(`
      CREATE TABLE devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id varchar(200) NOT NULL,
        platform varchar(20),
        label varchar(200),
        restricted boolean NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
        decided_by uuid REFERENCES users(id),
        decided_at timestamptz,
        last_seen_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT devices_user_device_uq UNIQUE (user_id, device_id)
      )`);
    // Guards and team leaders (restricted) keep exactly one working phone; office staff may use several.
    await q.query(`CREATE UNIQUE INDEX devices_one_active ON devices (user_id) WHERE status = 'active' AND restricted`);
    await q.query(`ALTER TABLE sessions ADD COLUMN device_id uuid REFERENCES devices(id)`);

    await q.query(`
      CREATE TABLE shift_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        name varchar(100) NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        headcount integer NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 100),
        position varchar(50) NOT NULL DEFAULT 'guard',
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT shift_templates_not_zero CHECK (start_time <> end_time)
      )`);

    await q.query(`
      CREATE TABLE shift_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        template_id uuid REFERENCES shift_templates(id),
        post_id uuid REFERENCES posts(id),
        shift_date date NOT NULL,
        planned_start timestamptz NOT NULL,
        planned_end timestamptz NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled')),
        substitute_for_id uuid REFERENCES shift_assignments(id),
        note text,
        created_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT shift_assignments_order CHECK (planned_end > planned_start),
        CONSTRAINT shift_assignments_max_24h CHECK (planned_end - planned_start <= interval '24 hours'),
        CONSTRAINT shift_assignments_no_overlap EXCLUDE USING gist (
          employee_id WITH =, tstzrange(planned_start, planned_end) WITH &&
        ) WHERE (status = 'planned')
      )`);
    await q.query(`CREATE INDEX shift_assignments_site_date_idx ON shift_assignments (site_id, shift_date)`);

    await q.query(`
      CREATE TABLE attendances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        assignment_id uuid NOT NULL UNIQUE REFERENCES shift_assignments(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        check_in_at timestamptz NOT NULL,
        check_in_lat numeric(9, 6),
        check_in_lng numeric(9, 6),
        check_in_accuracy_m integer,
        check_in_distance_m integer,
        check_in_selfie_id uuid REFERENCES files(id),
        check_in_device_time timestamptz,
        check_in_flags text[] NOT NULL DEFAULT '{}',
        late_minutes integer NOT NULL DEFAULT 0,
        check_out_at timestamptz,
        check_out_lat numeric(9, 6),
        check_out_lng numeric(9, 6),
        check_out_accuracy_m integer,
        check_out_distance_m integer,
        check_out_selfie_id uuid REFERENCES files(id),
        check_out_device_time timestamptz,
        check_out_flags text[] NOT NULL DEFAULT '{}',
        early_minutes integer,
        worked_minutes integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT attendances_order CHECK (check_out_at IS NULL OR check_out_at > check_in_at)
      )`);

    for (const [code, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL
         ON CONFLICT DO NOTHING`,
        [code, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE ANY (ARRAY['roster.%', 'attendance.%', 'device.%'])`);
    await q.query(`DROP TABLE IF EXISTS attendances`);
    await q.query(`DROP TABLE IF EXISTS shift_assignments`);
    await q.query(`DROP TABLE IF EXISTS shift_templates`);
    await q.query(`ALTER TABLE sessions DROP COLUMN IF EXISTS device_id`);
    await q.query(`DROP TABLE IF EXISTS devices`);
    await q.query(`ALTER TABLE sites DROP COLUMN IF EXISTS settings`);
  }
}
