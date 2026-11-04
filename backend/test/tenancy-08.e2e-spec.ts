import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for logbook and handovers (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let apiA: ReturnType<typeof client>;
  const B: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso8-a');
    const b = await createTenantWithAdmin(app, 'iso8-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const c = (await apiB.post('/api/clients', { code: 'K', name: 'B' }).expect(201)).body.data.id;
    B.site = (await apiB.post('/api/sites', { client_id: c, code: 'S', name: 'B' }).expect(201)).body.data.id;
    B.entry = (await apiB.post(`/api/sites/${B.site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'visitor', visitor_name: 'Khách B' }).expect(201)).body.data.id;
    const e = (await apiB.post('/api/employees', { code: 'E', full_name: 'B' }).expect(201)).body.data.id;
    const [shift] = await ds.query(
      `INSERT INTO shift_assignments (tenant_id, site_id, employee_id, shift_date, planned_start, planned_end)
       VALUES ($1, $2, $3, current_date, now() - interval '8 hours', now()) RETURNING id`,
      [b.tenant.id, B.site, e],
    );
    [{ id: B.handover }] = await ds.query(
      `INSERT INTO handovers (tenant_id, site_id, from_assignment_id, from_employee_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [b.tenant.id, B.site, shift.id, e],
    );
  });
  afterAll(async () => app.close());

  it("answers every read or change of B's book and handovers with 404", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await apiA.get(`/api/sites/${B.site}/logbook?date=${today}`).expect(404);
    await apiA.get(`/api/sites/${B.site}/logbook/inside`).expect(404);
    await apiA.post(`/api/sites/${B.site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'note', body: 'x' }).expect(404);
    await apiA.post(`/api/logbook/${B.entry}/exit`, { device_time: new Date().toISOString() }).expect(404);
    await apiA.get(`/api/sites/${B.site}/handover-items`).expect(404);
    await apiA.put(`/api/sites/${B.site}/handover-items`, { items: ['x'] }).expect(404);
    await apiA.get(`/api/sites/${B.site}/handovers?date=${today}`).expect(404);
    await apiA.post(`/api/handovers/${B.handover}/review`, {}).expect(404);
    await apiA.post(`/api/handovers/${B.handover}/accept`, {}).expect(404);
  });
});
