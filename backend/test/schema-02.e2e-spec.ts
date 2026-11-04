import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTenantWithAdmin, createTestApp } from './helpers';

describe('Clients/contracts/deployments schema (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  it('grants the new permissions to the system roles of companies that already existed', async () => {
    const t = await createTenantWithAdmin(app, 'sch2');
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE ANY (ARRAY['client.%','contract.%','deployment.%'])
        ORDER BY r.code, rp.permission`,
      [t.tenant.id],
    );
    const by = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission);
    expect(by('admin')).toEqual([
      'client.manage', 'client.view', 'contract.manage', 'contract.view', 'deployment.manage', 'deployment.view',
    ]);
    expect(by('accountant')).toEqual(['client.manage', 'client.view', 'contract.manage', 'contract.view', 'deployment.view']);
    expect(by('hr')).toEqual(['client.view', 'deployment.manage', 'deployment.view']);
    expect(by('manager')).toEqual(['client.view', 'deployment.view']);
    expect(by('team_leader')).toEqual([]);
  });

  it('refuses two deployments of one employee that overlap', async () => {
    const t = await createTenantWithAdmin(app, 'sch2-dep');
    const [e] = await ds.query(`INSERT INTO employees (tenant_id, code, full_name) VALUES ($1, 'E1', 'E') RETURNING id`, [t.tenant.id]);
    const [c1] = await ds.query(`INSERT INTO clients (tenant_id, code, name) VALUES ($1, 'K1', 'K1') RETURNING id`, [t.tenant.id]);
    const [c2] = await ds.query(`INSERT INTO clients (tenant_id, code, name) VALUES ($1, 'K2', 'K2') RETURNING id`, [t.tenant.id]);
    await ds.query(
      `INSERT INTO deployments (tenant_id, employee_id, client_id, start_date, end_date) VALUES ($1, $2, $3, '2026-01-01', '2026-06-30')`,
      [t.tenant.id, e.id, c1.id],
    );
    await expect(
      ds.query(`INSERT INTO deployments (tenant_id, employee_id, client_id, start_date) VALUES ($1, $2, $3, '2026-06-30')`, [
        t.tenant.id, e.id, c2.id,
      ]),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('refuses two price lines for one position that overlap in time', async () => {
    const t = await createTenantWithAdmin(app, 'sch2-line');
    const [c] = await ds.query(`INSERT INTO clients (tenant_id, code, name) VALUES ($1, 'K', 'K') RETURNING id`, [t.tenant.id]);
    const [k] = await ds.query(
      `INSERT INTO contracts (tenant_id, client_id, contract_no, start_date, end_date) VALUES ($1, $2, 'HD1', '2026-01-01', '2026-12-31') RETURNING id`,
      [t.tenant.id, c.id],
    );
    const line = (from: string, to: string | null) =>
      ds.query(
        `INSERT INTO contract_lines (tenant_id, contract_id, position, headcount, unit, unit_price, effective_from, effective_to)
         VALUES ($1, $2, 'guard', 2, 'per_guard_month', 8500000, $3, $4)`,
        [t.tenant.id, k.id, from, to],
      );
    await line('2026-01-01', '2026-03-31');
    await expect(line('2026-03-15', null)).rejects.toMatchObject({ code: '23P01' });
    await line('2026-04-01', null);
  });
});
