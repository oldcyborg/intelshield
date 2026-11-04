import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Deployments (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'dep');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newEmployee = async () =>
    (await api.post('/api/employees', { code: `D${++seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data;
  const newClient = async () =>
    (await api.post('/api/clients', { code: `KD${++seq}`, name: `Khách ${seq}` }).expect(201)).body.data;
  const signedContract = async (clientId: string, headcount = 2) => {
    const k = (
      await api
        .post('/api/contracts', {
          client_id: clientId, contract_no: `HDD-${++seq}`, start_date: addDays(today, -90), end_date: addDays(today, 270),
          lines: [{ position: 'guard', headcount, unit: 'per_guard_month', unit_price: 8000000 }],
        })
        .expect(201)
    ).body.data;
    await api.patch(`/api/contracts/${k.id}`, { state: 'signed' }).expect(200);
    return k;
  };
  const deploy = (body: object) => api.post('/api/deployments', body);
  const history = (employeeId: string) =>
    ds.query(`SELECT client_id, start_date, end_date, end_reason FROM deployments WHERE employee_id = $1 ORDER BY start_date`, [employeeId]);

  it('sends a guard to a client under a contract and shows who is where', async () => {
    const e = await newEmployee();
    const c = await newClient();
    const k = await signedContract(c.id);
    const res = await deploy({ employee_id: e.id, client_id: c.id, contract_id: k.id, start_date: addDays(today, -5) }).expect(201);
    expect(res.body.data).toMatchObject({ employee_name: e.full_name, client_name: c.name, contract_no: k.contract_no, end_date: null });

    const atClient = (await api.get(`/api/deployments?client_id=${c.id}&on=${today}`).expect(200)).body.data;
    expect(atClient.map((d: { employee_id: string }) => d.employee_id)).toEqual([e.id]);
    const ofGuard = (await api.get(`/api/deployments?employee_id=${e.id}`).expect(200)).body.data;
    expect(ofGuard).toHaveLength(1);
    expect((await api.get(`/api/clients/${c.id}`).expect(200)).body.data.guards_today).toBe(1);
  });

  it('moves a guard to another client: the old posting ends the day before, with a reason', async () => {
    const e = await newEmployee();
    const a = await newClient();
    const b = await newClient();
    await deploy({ employee_id: e.id, client_id: a.id, start_date: addDays(today, -30) }).expect(201);
    await deploy({ employee_id: e.id, client_id: b.id, start_date: today }).expect(201);
    expect(await history(e.id)).toEqual([
      { client_id: a.id, start_date: addDays(today, -30), end_date: addDays(today, -1), end_reason: `Chuyển sang ${b.name}` },
      { client_id: b.id, start_date: today, end_date: null, end_reason: null },
    ]);
  });

  it('corrects a same-day posting in place and refuses one that would rewrite later history', async () => {
    const e = await newEmployee();
    const a = await newClient();
    const b = await newClient();
    await deploy({ employee_id: e.id, client_id: a.id, start_date: today }).expect(201);
    await deploy({ employee_id: e.id, client_id: b.id, start_date: today }).expect(201);
    expect(await history(e.id)).toEqual([{ client_id: b.id, start_date: today, end_date: null, end_reason: null }]);

    const conflict = await deploy({ employee_id: e.id, client_id: a.id, start_date: addDays(today, -3) }).expect(409);
    expect(conflict.body.error.code).toBe('DEPLOYMENT_OVERLAP');
  });

  it('plans a future posting and can cancel it before it starts', async () => {
    const e = await newEmployee();
    const c = await newClient();
    const d = (await deploy({ employee_id: e.id, client_id: c.id, start_date: addDays(today, 7) }).expect(201)).body.data;
    await api.delete(`/api/deployments/${d.id}`).expect(200);
    expect(await history(e.id)).toEqual([]);
    const started = (await deploy({ employee_id: e.id, client_id: c.id, start_date: today }).expect(201)).body.data;
    await api.delete(`/api/deployments/${started.id}`).expect(409);
  });

  it('ends a posting with a last day and a reason', async () => {
    const e = await newEmployee();
    const c = await newClient();
    const d = (await deploy({ employee_id: e.id, client_id: c.id, start_date: addDays(today, -10) }).expect(201)).body.data;
    const res = await api.post(`/api/deployments/${d.id}/end`, { last_day: today, reason: 'Khách yêu cầu đổi người' }).expect(200);
    expect(res.body.data).toMatchObject({ end_date: today, end_reason: 'Khách yêu cầu đổi người' });
    await api.post(`/api/deployments/${d.id}/end`, { last_day: addDays(today, -20) }).expect(400);
  });

  it('refuses inactive guards and contracts of another client or not in force', async () => {
    const e = await newEmployee();
    const a = await newClient();
    const b = await newClient();
    const kb = await signedContract(b.id);
    const mismatch = await deploy({ employee_id: e.id, client_id: a.id, contract_id: kb.id }).expect(400);
    expect(mismatch.body.error.code).toBe('DEPLOYMENT_CONTRACT_MISMATCH');
    const late = await deploy({ employee_id: e.id, client_id: b.id, contract_id: kb.id, start_date: addDays(today, 300) }).expect(400);
    expect(late.body.error.code).toBe('DEPLOYMENT_CONTRACT_MISMATCH');

    await api.patch(`/api/employees/${e.id}`, { status: 'inactive' }).expect(200);
    expect((await deploy({ employee_id: e.id, client_id: a.id }).expect(400)).body.error.code).toBe('EMPLOYEE_INACTIVE');
  });

  it("shows a team's manager where the team's people are posted, and only that", async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const group = (await api.post('/api/org/groups', { name: `Nhóm ${++seq}`, manager_user_id: manager.user.id }).expect(201)).body.data;
    const team = (await api.post('/api/org/teams', { name: `Đội ${++seq}`, team_group_id: group.id }).expect(201)).body.data;
    const mine = await newEmployee();
    const stranger = await newEmployee();
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: mine.id }).expect(201);
    const c = await newClient();
    const other = await newClient();
    await deploy({ employee_id: mine.id, client_id: c.id }).expect(201);
    await deploy({ employee_id: stranger.id, client_id: other.id }).expect(201);

    const asManager = client(app, manager.token);
    const seen = (await asManager.get(`/api/deployments?on=${today}`).expect(200)).body.data;
    expect(seen.map((d: { employee_id: string }) => d.employee_id)).toEqual([mine.id]);
    const clients = (await asManager.get('/api/clients').expect(200)).body.data;
    expect(clients.map((x: { id: string }) => x.id)).toEqual([c.id]);
    await asManager.post('/api/deployments', { employee_id: mine.id, client_id: other.id }).expect(403);
  });
});
