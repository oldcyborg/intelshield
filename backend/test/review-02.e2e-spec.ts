import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

/** Regressions found by the Plan 02 final review. */
describe('Plan 02 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'rev2');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newEmployee = async () => (await api.post('/api/employees', { code: `R${++seq}`, full_name: `NV ${seq}` }).expect(201)).body.data;
  const newClient = async () => (await api.post('/api/clients', { code: `RK${++seq}`, name: `Khách ${seq}` }).expect(201)).body.data;
  const upload = async (name: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${admin.token}`).attach('file', Buffer.from('%PDF-1.4\n%%EOF'), name).expect(201)).body.data;

  it("keeps ID numbers and scans away from people who only see the employee's team", async () => {
    const team = (await api.post('/api/org/teams', { name: 'Đội R' }).expect(201)).body.data;
    const lead = await newEmployee();
    const e = await newEmployee();
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: lead.id }).expect(201);
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: e.id }).expect(201);
    await api.put(`/api/org/teams/${team.id}/leader`, { employee_id: lead.id }).expect(200);
    const scan = await upload('cccd.pdf');
    await api.post(`/api/employees/${e.id}/documents`, { kind: 'national_id', number: '001090099999', file_id: scan.id, expires_on: addDays(today, 9) }).expect(201);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });

    const seen = (await client(app, leader.token).get(`/api/employees/${e.id}/profile`).expect(200)).body.data;
    expect(seen.documents).toEqual([expect.objectContaining({ kind: 'national_id', number: null, file: null, days_left: 9 })]);
    await client(app, leader.token).get(`/api/files/${scan.id}`).expect(404);
  });

  it('cancelling a scheduled transfer gives the guard back their current posting', async () => {
    const e = await newEmployee();
    const a = await newClient();
    const b = await newClient();
    await api.post('/api/deployments', { employee_id: e.id, client_id: a.id, start_date: addDays(today, -10) }).expect(201);
    const planned = (await api.post('/api/deployments', { employee_id: e.id, client_id: b.id, start_date: addDays(today, 5) }).expect(201)).body.data;
    await api.delete(`/api/deployments/${planned.id}`).expect(200);
    const rows = await ds.query(`SELECT client_id, end_date, end_reason FROM deployments WHERE employee_id = $1`, [e.id]);
    expect(rows).toEqual([{ client_id: a.id, end_date: null, end_reason: null }]);
  });

  it('ends the postings of a guard who leaves the company', async () => {
    const e = await newEmployee();
    const c = await newClient();
    await api.post('/api/deployments', { employee_id: e.id, client_id: c.id, start_date: addDays(today, -10) }).expect(201);
    await api.patch(`/api/employees/${e.id}`, { status: 'inactive' }).expect(200);
    expect((await api.get(`/api/clients/${c.id}`).expect(200)).body.data.guards_today).toBe(0);
    const [row] = await ds.query(`SELECT end_date, end_reason FROM deployments WHERE employee_id = $1`, [e.id]);
    expect(row).toEqual({ end_date: addDays(today, -1), end_reason: 'Nghỉ việc' });
  });

  it('keeps Vietnamese file names intact', async () => {
    const f = await upload('Hợp đồng.pdf');
    expect(f.original_name).toBe('Hợp đồng.pdf');
  });

  it('answers an impossible date with 400, not 500', async () => {
    const c = await newClient();
    const res = await api.post('/api/contracts', { client_id: c.id, contract_no: 'BADDATE', start_date: '2026-02-30', end_date: '2026-12-31', lines: [] }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('shows contract shortfalls only to people who may see contracts', async () => {
    const c = await newClient();
    const k = (await api.post('/api/contracts', { client_id: c.id, contract_no: `SF-${++seq}`, start_date: addDays(today, -1), end_date: addDays(today, 100), lines: [{ position: 'guard', headcount: 2, unit: 'per_guard_month', unit_price: 1 }] }).expect(201)).body.data;
    await api.patch(`/api/contracts/${k.id}`, { state: 'signed' }).expect(200);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    expect((await client(app, manager.token).get('/api/dashboard/company').expect(200)).body.data.shortfalls).toEqual([]);
    expect((await api.get('/api/dashboard/company').expect(200)).body.data.shortfalls.map((s: { contract_id: string }) => s.contract_id)).toContain(k.id);
  });
});
