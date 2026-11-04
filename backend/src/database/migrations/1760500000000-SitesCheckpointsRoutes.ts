import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'site.view'], ['admin', 'site.manage'],
  ['manager', 'site.view'], ['manager', 'site.manage'],
  ['team_leader', 'site.view'], ['hr', 'site.view'], ['accountant', 'site.view'],
];

export class SitesCheckpointsRoutes1760500000000 implements MigrationInterface {
  name = 'SitesCheckpointsRoutes1760500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE sites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        client_id uuid NOT NULL REFERENCES clients(id),
        code varchar(30) NOT NULL,
        name varchar(200) NOT NULL,
        address varchar(300),
        lat numeric(9, 6) CHECK (lat BETWEEN -90 AND 90),
        lng numeric(9, 6) CHECK (lng BETWEEN -180 AND 180),
        geofence_radius_m integer NOT NULL DEFAULT 150 CHECK (geofence_radius_m BETWEEN 20 AND 2000),
        responsible_team_id uuid REFERENCES teams(id),
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT sites_coordinates_pair CHECK ((lat IS NULL) = (lng IS NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX sites_tenant_code_uq ON sites (tenant_id, lower(code)) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX sites_client_idx ON sites (client_id)`);

    await q.query(`
      CREATE TABLE posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        name varchar(100) NOT NULL,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);

    await q.query(`
      CREATE TABLE checkpoints (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        code varchar(30) NOT NULL,
        name varchar(200) NOT NULL,
        lat numeric(9, 6) CHECK (lat BETWEEN -90 AND 90),
        lng numeric(9, 6) CHECK (lng BETWEEN -180 AND 180),
        radius_m integer NOT NULL DEFAULT 30 CHECK (radius_m BETWEEN 5 AND 500),
        allowed_methods text[] NOT NULL DEFAULT '{qr}',
        qr_secret varchar(64) NOT NULL,
        require_photo boolean NOT NULL DEFAULT false,
        instructions text,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT checkpoints_methods CHECK (cardinality(allowed_methods) > 0 AND allowed_methods <@ ARRAY['qr', 'gps', 'photo', 'nfc']),
        CONSTRAINT checkpoints_coordinates_pair CHECK ((lat IS NULL) = (lng IS NULL)),
        CONSTRAINT checkpoints_gps_needs_location CHECK (NOT ('gps' = ANY(allowed_methods)) OR lat IS NOT NULL)
      )`);
    await q.query(`CREATE UNIQUE INDEX checkpoints_site_code_uq ON checkpoints (site_id, lower(code)) WHERE deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE routes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        name varchar(100) NOT NULL,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`
      CREATE TABLE route_checkpoints (
        route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        checkpoint_id uuid NOT NULL REFERENCES checkpoints(id),
        seq integer NOT NULL CHECK (seq > 0),
        required boolean NOT NULL DEFAULT true,
        PRIMARY KEY (route_id, seq),
        CONSTRAINT route_checkpoints_once UNIQUE (route_id, checkpoint_id)
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
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'site.%'`);
    await q.query(`DELETE FROM user_scopes WHERE scope_type = 'site'`);
    for (const table of ['route_checkpoints', 'routes', 'checkpoints', 'posts', 'sites']) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
