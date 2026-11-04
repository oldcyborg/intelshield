import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, server } from './helpers';

describe('Tenant isolation for clients, contracts, deployments, files (e2e)', () => {
  let app: NestExpressApplication;
  let apiA: ReturnType<typeof client>;
  const B: Record<'client' | 'contract' | 'employee' | 'deployment' | 'file', string> = {
    client: '', contract: '', employee: '', deployment: '', file: '',
  };
  let aEmployee: string;
  let aClient: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso2-a');
    const b = await createTenantWithAdmin(app, 'iso2-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const today = todayLocal();
    B.file = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${b.token}`).attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'b.pdf').expect(201)).body.data.id;
    B.client = (await apiB.post('/api/clients', { code: 'BK', name: 'Khách B' }).expect(201)).body.data.id;
    B.contract = (await apiB.post('/api/contracts', { client_id: B.client, contract_no: 'HD-B', start_date: today, end_date: today, lines: [], file_id: B.file }).expect(201)).body.data.id;
    await apiB.patch(`/api/contracts/${B.contract}`, { state: 'signed' }).expect(200);
    B.employee = (await apiB.post('/api/employees', { code: 'BE', full_name: 'NV B' }).expect(201)).body.data.id;
    B.deployment = (await apiB.post('/api/deployments', { employee_id: B.employee, client_id: B.client }).expect(201)).body.data.id;
    aEmployee = (await apiA.post('/api/employees', { code: 'AE', full_name: 'NV A' }).expect(201)).body.data.id;
    aClient = (await apiA.post('/api/clients', { code: 'AK', name: 'Khách A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or write of B's records with 404", async () => {
    await apiA.get(`/api/clients/${B.client}`).expect(404);
    await apiA.patch(`/api/clients/${B.client}`, { name: 'x' }).expect(404);
    await apiA.get(`/api/contracts/${B.contract}`).expect(404);
    await apiA.patch(`/api/contracts/${B.contract}`, { note: 'x' }).expect(404);
    await apiA.post(`/api/contracts/${B.contract}/terminate`, {}).expect(404);
    await apiA.post(`/api/deployments/${B.deployment}/end`, { last_day: todayLocal() }).expect(404);
    await apiA.delete(`/api/deployments/${B.deployment}`).expect(404);
    await apiA.get(`/api/files/${B.file}`).expect(404);
    await apiA.get(`/api/employees/${B.employee}/profile`).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post('/api/deployments', { employee_id: B.employee, client_id: aClient }).expect(404);
    await apiA.post('/api/deployments', { employee_id: aEmployee, client_id: B.client }).expect(404);
    await apiA.post('/api/deployments', { employee_id: aEmployee, client_id: aClient, contract_id: B.contract }).expect(400);
    await apiA.post('/api/contracts', { client_id: B.client, contract_no: 'X', start_date: todayLocal(), end_date: todayLocal(), lines: [] }).expect(404);
    await apiA.post(`/api/employees/${aEmployee}/documents`, { kind: 'other', file_id: B.file }).expect(404);
  });

  it("keeps B out of A's lists and dashboard", async () => {
    const ids = async (url: string) => (await apiA.get(url).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(await ids('/api/clients')).not.toContain(B.client);
    expect(await ids('/api/contracts')).not.toContain(B.contract);
    expect(await ids('/api/deployments')).not.toContain(B.deployment);
    const d = (await apiA.get('/api/dashboard/company').expect(200)).body.data;
    expect(d.guards).toEqual({ active: 1, deployed: 0, idle: 1 });
  });
});
