import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for settings, devices, shifts, attendance (e2e)', () => {
  let app: NestExpressApplication;
  let apiA: ReturnType<typeof client>;
  const B: Record<'site' | 'template' | 'shift' | 'employee', string> = { site: '', template: '', shift: '', employee: '' };
  let aSite: string;
  const D = addDays(todayLocal(), 20);

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso4-a');
    const b = await createTenantWithAdmin(app, 'iso4-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const cB = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data.id;
    B.site = (await apiB.post('/api/sites', { client_id: cB, code: 'BS', name: 'B' }).expect(201)).body.data.id;
    B.template = (await apiB.post(`/api/sites/${B.site}/shift-templates`, { name: 'Ca', start_time: '06:00', end_time: '18:00' }).expect(201)).body.data.id;
    B.employee = (await apiB.post('/api/employees', { code: 'BE', full_name: 'B' }).expect(201)).body.data.id;
    await apiB.post('/api/deployments', { employee_id: B.employee, client_id: cB, start_date: todayLocal() }).expect(201);
    B.shift = (await apiB.post('/api/roster', { site_id: B.site, employee_id: B.employee, template_id: B.template, shift_date: D }).expect(201)).body.data.id;
    const cA = (await apiA.post('/api/clients', { code: 'AK', name: 'A' }).expect(201)).body.data.id;
    aSite = (await apiA.post('/api/sites', { client_id: cA, code: 'AS', name: 'A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or write of B's records with 404", async () => {
    await apiA.get(`/api/sites/${B.site}/settings`).expect(404);
    await apiA.patch(`/api/sites/${B.site}/settings`, { late_after_minutes: 5 }).expect(404);
    await apiA.get(`/api/sites/${B.site}/shift-templates`).expect(404);
    await apiA.patch(`/api/shift-templates/${B.template}`, { name: 'x' }).expect(404);
    await apiA.get(`/api/roster?site_id=${B.site}&from=${D}&to=${D}`).expect(404);
    await apiA.post(`/api/roster/${B.shift}/cancel`).expect(404);
    await apiA.post(`/api/roster/${B.shift}/substitute`, { employee_id: B.employee }).expect(404);
    await apiA.get(`/api/attendance/board?site_id=${B.site}&date=${D}`).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post('/api/roster', { site_id: aSite, employee_id: B.employee, start_at: `${D}T01:00:00.000Z`, end_at: `${D}T05:00:00.000Z` }).expect(404);
    await apiA.post('/api/roster', { site_id: aSite, employee_id: B.employee, template_id: B.template, shift_date: D }).expect(404);
  });

  it("keeps B's devices out of A's list", async () => {
    const list = (await apiA.get('/api/devices').expect(200)).body.data;
    expect(list).toEqual([]);
  });
});
