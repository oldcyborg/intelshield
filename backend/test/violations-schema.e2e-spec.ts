import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTenantWithAdmin, createTestApp } from './helpers';

describe('Violations — schema and roles (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'vsc');
  });
  afterAll(async () => app.close());

  it('lets leaders propose, managers review, office staff only read', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'violation.%'`,
      [admin.tenant.id],
    );
    const of = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission).sort();
    expect(of('manager')).toEqual(['violation.propose', 'violation.review', 'violation.view']);
    expect(of('team_leader')).toEqual(['violation.propose', 'violation.view']);
    expect(of('hr')).toEqual(['violation.view']);
    expect(of('accountant')).toEqual(['violation.view']);
    expect(of('guard')).toEqual([]);
  });

  it('records each violation once per thing and person', async () => {
    const [cols] = await ds.query(
      `SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name = 'violations' AND constraint_name = 'violations_once'`,
    );
    expect(cols.n).toBe(1);
    const [late] = await ds.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'shift_assignments' AND column_name = 'late_alerted_at'`);
    expect(late.n).toBe(1);
  });
});
