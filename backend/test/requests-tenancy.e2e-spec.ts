import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Requests — company isolation (e2e)', () => {
  let app: NestExpressApplication;
  const a: Record<string, string> = {};
  let b: ReturnType<typeof client>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const ta = await createTenantWithAdmin(app, 'rqa');
    const api = client(app, ta.token);
    a.client = (await api.post('/api/clients', { code: 'K', name: 'K' }).expect(201)).body.data.id;
    a.site = (await api.post('/api/sites', { client_id: a.client, code: 'S', name: 'S' }).expect(201)).body.data.id;
    a.employee = (await api.post('/api/employees', { code: 'E', full_name: 'E' }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: a.employee, client_id: a.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    a.shift = (await api.post('/api/roster', { site_id: a.site, employee_id: a.employee, start_at: minutes(-6 * 60), end_at: minutes(-60) }).expect(201)).body.data.id;
    await api.put(`/api/employees/${a.employee}/pay`, { pay_type: 'monthly', base_pay: 7000000 }).expect(200);
    const g = client(app, (await createUserWithRoles(app, ta.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: a.employee })).token);
    a.leave = (await g.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', from_date: addDays(todayLocal(), 2), to_date: addDays(todayLocal(), 2) }).expect(201)).body.data.id;
    a.correction = (await g.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'forgot', assignment_id: a.shift, check_in_at: minutes(-6 * 60) }).expect(201)).body.data.id;
    b = client(app, (await createTenantWithAdmin(app, 'rqb')).token);
  });
  afterAll(async () => app.close());

  it('keeps another company away from requests and pay', async () => {
    await b.get(`/api/employees/${a.employee}/pay`).expect(404);
    await b.put(`/api/employees/${a.employee}/pay`, { pay_type: 'monthly' }).expect(404);
    expect((await b.get('/api/leave-requests').expect(200)).body.data).toEqual([]);
    expect((await b.get('/api/attendance-corrections').expect(200)).body.data).toEqual([]);
    await b.post(`/api/leave-requests/${a.leave}/approve`, {}).expect(404);
    await b.get(`/api/attendance-corrections/${a.correction}`).expect(404);
    await b.post(`/api/attendance-corrections/${a.correction}/review`, { decision: 'approve' }).expect(404);
    await b.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'other', reason: 'x', assignment_id: a.shift, check_in_at: minutes(-6 * 60) }).expect(404);
    await b.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', employee_id: a.employee, from_date: todayLocal(), to_date: todayLocal() }).expect(404);
  });
});
