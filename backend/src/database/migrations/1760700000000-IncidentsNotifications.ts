import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'incident.view'], ['admin', 'incident.report'], ['admin', 'incident.manage'], ['admin', 'incident.close'],
  ['admin', 'incident.final_escalation'],
  ['manager', 'incident.view'], ['manager', 'incident.report'], ['manager', 'incident.manage'], ['manager', 'incident.close'],
  ['team_leader', 'incident.view'], ['team_leader', 'incident.report'], ['team_leader', 'incident.manage'],
  ['guard', 'incident.report'],
  ['hr', 'incident.view'], ['hr', 'incident.report'],
];

/** Frozen copy of the defaults at the time of this migration; later edits to the code list do not rewrite history. */
const CATEGORIES: [string, string, number][] = [
  ['Cháy nổ', 'critical', 1], ['Trộm cắp', 'high', 2], ['Xâm nhập', 'high', 3],
  ['Hư hỏng thiết bị', 'medium', 4], ['Vệ sinh / an toàn', 'low', 5], ['Khác', 'medium', 6],
];

export class IncidentsNotifications1760700000000 implements MigrationInterface {
  name = 'IncidentsNotifications1760700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE incident_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        name varchar(100) NOT NULL,
        default_severity varchar(10) NOT NULL CHECK (default_severity IN ('low', 'medium', 'high', 'critical')),
        sort integer NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX incident_categories_name_uq ON incident_categories (tenant_id, lower(name)) WHERE deleted_at IS NULL`);
    for (const [name, severity, sort] of CATEGORIES) {
      await q.query(`INSERT INTO incident_categories (tenant_id, name, default_severity, sort) SELECT id, $1, $2, $3 FROM tenants`, [name, severity, sort]);
    }

    await q.query(`
      CREATE TABLE incidents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        seq bigint GENERATED ALWAYS AS IDENTITY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        client_id uuid NOT NULL REFERENCES clients(id),
        site_id uuid REFERENCES sites(id),
        category_id uuid REFERENCES incident_categories(id),
        severity varchar(10) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        is_sos boolean NOT NULL DEFAULT false,
        title varchar(200) NOT NULL,
        description text,
        lat numeric(9, 6),
        lng numeric(9, 6),
        source varchar(20) NOT NULL CHECK (source IN ('guard_app', 'staff', 'client_report')),
        client_reporter_name varchar(200),
        client_channel varchar(20) CHECK (client_channel IN ('phone', 'zalo', 'email', 'in_person')),
        reported_by uuid NOT NULL REFERENCES users(id),
        reporter_employee_id uuid REFERENCES employees(id),
        assignee_user_id uuid REFERENCES users(id),
        status varchar(20) NOT NULL DEFAULT 'new'
          CHECK (status IN ('new', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')),
        acknowledged_at timestamptz,
        acknowledged_by uuid REFERENCES users(id),
        resolved_at timestamptz,
        resolution_note text,
        closed_at timestamptz,
        closed_by uuid REFERENCES users(id),
        rejected_reason text,
        escalation_level integer NOT NULL DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 3),
        next_escalation_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT incidents_sos_is_critical CHECK (NOT is_sos OR severity = 'critical')
      )`);
    await q.query(`CREATE INDEX incidents_tenant_status_idx ON incidents (tenant_id, status, created_at DESC)`);
    await q.query(`CREATE INDEX incidents_escalation_idx ON incidents (next_escalation_at) WHERE next_escalation_at IS NOT NULL`);

    await q.query(`
      CREATE TABLE incident_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        incident_id uuid NOT NULL REFERENCES incidents(id),
        type varchar(20) NOT NULL CHECK (type IN ('created', 'acknowledged', 'assigned', 'comment', 'status_changed', 'escalated')),
        actor_user_id uuid REFERENCES users(id),
        body text,
        from_status varchar(20),
        to_status varchar(20),
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX incident_events_incident_idx ON incident_events (incident_id, created_at)`);
    // The timeline is evidence: once written, an event is never changed or removed.
    await q.query(`
      CREATE FUNCTION incident_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'incident_events is append-only'; END $$`);
    await q.query(`CREATE TRIGGER incident_events_no_change BEFORE UPDATE OR DELETE ON incident_events FOR EACH ROW EXECUTE FUNCTION incident_events_append_only()`);

    await q.query(`
      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type varchar(40) NOT NULL,
        title varchar(200) NOT NULL,
        body text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        priority varchar(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC)`);

    await q.query(`ALTER TABLE devices ADD COLUMN push_token varchar(4096), ADD COLUMN push_token_updated_at timestamptz`);

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
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'incident.%'`);
    await q.query(`ALTER TABLE devices DROP COLUMN IF EXISTS push_token, DROP COLUMN IF EXISTS push_token_updated_at`);
    await q.query(`DROP TABLE IF EXISTS notifications`);
    await q.query(`DROP TABLE IF EXISTS incident_events`);
    await q.query(`DROP FUNCTION IF EXISTS incident_events_append_only`);
    await q.query(`DROP TABLE IF EXISTS incidents`);
    await q.query(`DROP TABLE IF EXISTS incident_categories`);
  }
}
