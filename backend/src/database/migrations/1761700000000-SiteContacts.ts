import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Frozen copy of the defaults at the time of this migration; later edits to the code list do not rewrite history.
 * A wider level comes with the narrower ones, so whoever may hand out a role keeps holding what it grants.
 */
const VIEW = { staff: ['contact.view.staff', 'contact.view.leader', 'contact.view.guard'], leader: ['contact.view.leader', 'contact.view.guard'], guard: ['contact.view.guard'] };
const GRANTS: [string, string][] = [
  ...[...VIEW.staff, 'contact.manage'].map((p): [string, string] => ['admin', p]),
  ...[...VIEW.staff, 'contact.manage'].map((p): [string, string] => ['manager', p]),
  ...VIEW.staff.map((p): [string, string] => ['hr', p]),
  ...VIEW.staff.map((p): [string, string] => ['accountant', p]),
  ...VIEW.leader.map((p): [string, string] => ['team_leader', p]),
  ...VIEW.guard.map((p): [string, string] => ['guard', p]),
];

const EVENT_TYPES = ['created', 'acknowledged', 'assigned', 'comment', 'status_changed', 'escalated'];

export class SiteContacts1761700000000 implements MigrationInterface {
  name = 'SiteContacts1761700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE site_contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        full_name varchar(200) NOT NULL,
        title varchar(100),
        phone varchar(20),
        zalo varchar(20),
        email varchar(200),
        hours varchar(100),
        priority int NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 99),
        visibility varchar(10) NOT NULL DEFAULT 'staff' CHECK (visibility IN ('staff', 'leader', 'guard')),
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT site_contacts_reachable CHECK (phone IS NOT NULL OR zalo IS NOT NULL OR email IS NOT NULL)
      )`);
    await q.query(`CREATE INDEX site_contacts_site ON site_contacts (tenant_id, site_id, priority) WHERE deleted_at IS NULL`);

    // The one contact a client had becomes an office-only contact of each of its sites: nothing is lost, nobody new sees it.
    await q.query(`
      INSERT INTO site_contacts (tenant_id, site_id, full_name, title, phone, email, priority, visibility)
      SELECT s.tenant_id, s.id, COALESCE(NULLIF(trim(c.contact_name), ''), c.name), 'Người liên hệ của khách', c.contact_phone, c.contact_email, 1, 'staff'
        FROM sites s JOIN clients c ON c.id = s.client_id
       WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND (c.contact_phone IS NOT NULL OR c.contact_email IS NOT NULL)`);

    // Calling a contact about an incident is written to its timeline.
    await q.query(`ALTER TABLE incident_events DROP CONSTRAINT incident_events_type_check`);
    await q.query(`ALTER TABLE incident_events ADD CONSTRAINT incident_events_type_check CHECK (type IN (${[...EVENT_TYPES, 'contact_called'].map((t) => `'${t}'`).join(', ')}))`);

    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission IN ('contact.view.staff', 'contact.view.leader', 'contact.view.guard', 'contact.manage')`);
    await q.query(`ALTER TABLE incident_events DROP CONSTRAINT incident_events_type_check`);
    await q.query(`ALTER TABLE incident_events ADD CONSTRAINT incident_events_type_check CHECK (type IN (${EVENT_TYPES.map((t) => `'${t}'`).join(', ')}))`);
    await q.query(`DROP TABLE site_contacts`);
  }
}
