import { MigrationInterface, QueryRunner } from 'typeorm';

export class Foundation1760227200000 implements MigrationInterface {
  name = 'Foundation1760227200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    await q.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(40) NOT NULL UNIQUE,
        name varchar(200) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE employees (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        code varchar(30) NOT NULL,
        full_name varchar(200) NOT NULL,
        phone varchar(20),
        position varchar(50) NOT NULL DEFAULT 'guard',
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX employees_tenant_code_uq ON employees (tenant_id, lower(code)) WHERE deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES tenants(id),
        user_type varchar(20) NOT NULL CHECK (user_type IN ('platform_admin', 'staff', 'guard', 'client_user')),
        full_name varchar(200) NOT NULL,
        phone varchar(20),
        email varchar(200),
        password_hash varchar(100) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
        employee_id uuid REFERENCES employees(id),
        must_change_password boolean NOT NULL DEFAULT false,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT users_tenant_matches_type CHECK ((user_type = 'platform_admin') = (tenant_id IS NULL)),
        CONSTRAINT users_identifier_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
      )`);
    await q.query(`CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX users_employee_uq ON users (employee_id) WHERE deleted_at IS NULL AND employee_id IS NOT NULL`);

    await q.query(`
      CREATE TABLE sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        device_label varchar(200),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
      )`);
    await q.query(`CREATE INDEX sessions_user_idx ON sessions (user_id)`);

    await q.query(`
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        code varchar(50) NOT NULL,
        name varchar(100) NOT NULL,
        is_system boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX roles_tenant_code_uq ON roles (tenant_id, code) WHERE deleted_at IS NULL`);
    await q.query(`
      CREATE TABLE role_permissions (
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission varchar(80) NOT NULL,
        PRIMARY KEY (role_id, permission)
      )`);
    await q.query(`
      CREATE TABLE user_roles (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      )`);

    await q.query(`
      CREATE TABLE team_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        name varchar(100) NOT NULL,
        manager_user_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`
      CREATE TABLE teams (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        name varchar(100) NOT NULL,
        team_group_id uuid REFERENCES team_groups(id),
        leader_employee_id uuid REFERENCES employees(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`
      CREATE TABLE team_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        team_id uuid NOT NULL REFERENCES teams(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        start_date date NOT NULL,
        end_date date,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT team_members_dates CHECK (end_date IS NULL OR end_date >= start_date),
        CONSTRAINT team_members_no_overlap EXCLUDE USING gist (
          employee_id WITH =,
          daterange(start_date, end_date, '[]') WITH &&
        )
      )`);
    await q.query(`CREATE INDEX team_members_team_idx ON team_members (team_id)`);

    await q.query(`
      CREATE TABLE user_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope_type varchar(20) NOT NULL CHECK (scope_type IN ('tenant', 'team_group', 'team', 'client', 'site')),
        scope_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT user_scopes_shape CHECK ((scope_type = 'tenant') = (scope_id IS NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX user_scopes_uq ON user_scopes (user_id, scope_type, scope_id) NULLS NOT DISTINCT`);

    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES tenants(id),
        actor_user_id uuid REFERENCES users(id),
        action varchar(80) NOT NULL,
        entity_type varchar(50) NOT NULL,
        entity_id uuid,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'audit_logs', 'user_scopes', 'team_members', 'teams', 'team_groups', 'user_roles',
      'role_permissions', 'roles', 'sessions', 'users', 'employees', 'tenants',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
