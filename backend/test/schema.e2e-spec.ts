import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTestApp } from './helpers';

describe('Foundation schema (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  async function seedTenantEmployeeTeams() {
    const [tenant] = await ds.query(`INSERT INTO tenants (code, name) VALUES ('s1', 'S1') RETURNING id`);
    const [employee] = await ds.query(
      `INSERT INTO employees (tenant_id, code, full_name) VALUES ($1, 'NV1', 'An') RETURNING id`,
      [tenant.id],
    );
    const [teamA] = await ds.query(`INSERT INTO teams (tenant_id, name) VALUES ($1, 'A') RETURNING id`, [tenant.id]);
    const [teamB] = await ds.query(`INSERT INTO teams (tenant_id, name) VALUES ($1, 'B') RETURNING id`, [tenant.id]);
    return { tenantId: tenant.id as string, employeeId: employee.id as string, teamA: teamA.id as string, teamB: teamB.id as string };
  }

  it('creates every foundation table', async () => {
    const rows: { table_name: string }[] = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const table of [
      'tenants', 'users', 'sessions', 'roles', 'role_permissions', 'user_roles', 'user_scopes',
      'employees', 'team_groups', 'teams', 'team_members', 'audit_logs',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('refuses two team memberships that overlap in time', async () => {
    const s = await seedTenantEmployeeTeams();
    await ds.query(
      `INSERT INTO team_members (tenant_id, team_id, employee_id, start_date, end_date) VALUES ($1, $2, $3, '2026-01-01', '2026-03-31')`,
      [s.tenantId, s.teamA, s.employeeId],
    );
    await expect(
      ds.query(
        `INSERT INTO team_members (tenant_id, team_id, employee_id, start_date) VALUES ($1, $2, $3, '2026-03-31')`,
        [s.tenantId, s.teamB, s.employeeId],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
    // The day after is fine.
    await ds.query(
      `INSERT INTO team_members (tenant_id, team_id, employee_id, start_date) VALUES ($1, $2, $3, '2026-04-01')`,
      [s.tenantId, s.teamB, s.employeeId],
    );
  });

  it('requires a tenant for every user except the platform admin', async () => {
    await expect(
      ds.query(`INSERT INTO users (user_type, full_name, phone, password_hash) VALUES ('staff', 'X', '0911111111', 'h')`),
    ).rejects.toMatchObject({ code: '23514' });
    await ds.query(
      `INSERT INTO users (user_type, full_name, email, password_hash) VALUES ('platform_admin', 'P', 'p@x.vn', 'h')`,
    );
  });

  it('keeps phone numbers unique across companies', async () => {
    const [t1] = await ds.query(`INSERT INTO tenants (code, name) VALUES ('u1', 'U1') RETURNING id`);
    const [t2] = await ds.query(`INSERT INTO tenants (code, name) VALUES ('u2', 'U2') RETURNING id`);
    await ds.query(
      `INSERT INTO users (tenant_id, user_type, full_name, phone, password_hash) VALUES ($1, 'guard', 'A', '0922222222', 'h')`,
      [t1.id],
    );
    await expect(
      ds.query(
        `INSERT INTO users (tenant_id, user_type, full_name, phone, password_hash) VALUES ($1, 'guard', 'B', '0922222222', 'h')`,
        [t2.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
