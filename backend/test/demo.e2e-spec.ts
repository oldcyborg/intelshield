import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { client, createTestApp, login as signIn, server } from './helpers';

const KEY = 'demo-test-key-0123456789';

describe('Demo company and its reset page (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;

  beforeAll(async () => {
    process.env.DEMO_RESET_KEY = KEY;
    ({ app, ds } = await createTestApp());
  });
  afterAll(async () => {
    delete process.env.DEMO_RESET_KEY;
    await app.close();
  });

  const count = async (sql: string, id: string) => (await ds.query(sql, [id]))[0].n as number;

  it('hides the page without the key', async () => {
    await request(server(app)).get('/api/demo').expect(404);
    await request(server(app)).post('/api/demo/reset').send({ key: 'wrong' }).expect(404);
  });

  it('builds the company asked for, with a month of clock-ins, and rebuilds it from scratch', async () => {
    const first = (await request(server(app)).post('/api/demo/reset').send({ key: KEY }).expect(200)).body.data;
    expect(first.accounts).toHaveLength(20);
    const [t] = await ds.query(`SELECT id FROM tenants WHERE code = 'demo'`);
    const roles = await ds.query(
      `SELECT r.code, count(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.tenant_id = $1 GROUP BY r.code ORDER BY r.code`,
      [t.id],
    );
    expect(roles).toEqual([{ code: 'accountant', n: 1 }, { code: 'admin', n: 1 }, { code: 'guard', n: 15 }, { code: 'manager', n: 1 }, { code: 'team_leader', n: 2 }]);
    expect(await count(`SELECT count(*)::int AS n FROM clients WHERE tenant_id = $1`, t.id)).toBe(2);
    expect(await count(`SELECT count(*)::int AS n FROM sites WHERE tenant_id = $1`, t.id)).toBe(3);
    expect(await count(`SELECT count(*)::int AS n FROM attendances WHERE tenant_id = $1 AND check_in_at < now() - interval '25 days'`, t.id)).toBeGreaterThan(20);
    expect(first.figures.violations).toBeGreaterThan(0);
    // What a guard's own web pages read: their labour contract, and a payslip from last month.
    expect(await count(`SELECT count(*)::int AS n FROM employee_documents WHERE tenant_id = $1 AND kind = 'labor_contract'`, t.id)).toBe(17);
    const guard = client(app, await signIn(app, '0910000003', 'Demo@123456'));
    expect((await guard.get('/api/me/documents').expect(200)).body.data).toHaveLength(1);
    expect((await guard.get('/api/me/payslips').expect(200)).body.data).toEqual([expect.objectContaining({ status: 'paid' })]);
    const [line] = await ds.query(
      `SELECT l.unit, l.headcount FROM contract_lines l JOIN contracts c ON c.id = l.contract_id JOIN clients k ON k.id = c.client_id WHERE k.tenant_id = $1 AND k.code = 'KLB'`,
      [t.id],
    );
    expect(line).toMatchObject({ unit: 'per_guard_month', headcount: 5 });

    // A guard who tried the demo leaves traces; the reset clears them.
    await ds.query(`UPDATE employees SET full_name = 'Đã sửa' WHERE tenant_id = $1 AND code = 'BV003'`, [t.id]);
    await request(server(app)).post('/api/demo/reset').send({ key: KEY }).expect(200);
    const [t2] = await ds.query(`SELECT id FROM tenants WHERE code = 'demo'`);
    expect(t2.id).not.toBe(t.id);
    expect(await count(`SELECT count(*)::int AS n FROM users WHERE tenant_id = $1`, t.id)).toBe(0);
    const [e] = await ds.query(`SELECT full_name FROM employees WHERE tenant_id = $1 AND code = 'BV003'`, [t2.id]);
    expect(e.full_name).toBe('Phạm Văn Cường');
    const info = (await request(server(app)).get(`/api/demo?key=${KEY}`).expect(200)).body.data;
    expect(info.accounts).toHaveLength(20);
    const login = await request(server(app)).post('/api/auth/login').send({ identifier: '0900000002', password: 'Demo@123456' }).expect(200);
    expect(login.body.data.user.full_name).toBe('Trần Quản Lý');

    // One published password for everyone: a forced change on first login would lock the next visitor out.
    expect(login.body.data.user.must_change_password).toBe(false);
    expect(await count(`SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND must_change_password`, t2.id)).toBe(0);
  }, 120_000);
});
