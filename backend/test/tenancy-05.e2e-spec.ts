import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { NotificationsService } from '../src/notifications/notifications.service';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for incidents and notifications (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let apiA: ReturnType<typeof client>;
  const B: Record<'incident' | 'category' | 'notification' | 'client', string> = { incident: '', category: '', notification: '', client: '' };
  let aClient: string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso5-a');
    const b = await createTenantWithAdmin(app, 'iso5-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    B.client = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data.id;
    B.category = (await apiB.get('/api/incident-categories').expect(200)).body.data[0].id;
    B.incident = (await apiB.post('/api/incidents', { client_id: B.client, category_id: B.category, description: 'B', source: 'staff' }).expect(201)).body.data.id;
    await app.get(NotificationsService).notify(b.tenant.id, [b.adminUserId], { type: 'test', title: 'B', body: '', data: {}, priority: 'normal', push: false });
    B.notification = (await ds.query(`SELECT id FROM notifications WHERE tenant_id = $1 LIMIT 1`, [b.tenant.id]))[0].id;
    aClient = (await apiA.post('/api/clients', { code: 'AK', name: 'A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or move of B's incident with 404", async () => {
    await apiA.get(`/api/incidents/${B.incident}`).expect(404);
    for (const step of ['acknowledge', 'start', 'close']) await apiA.post(`/api/incidents/${B.incident}/${step}`).expect(404);
    await apiA.post(`/api/incidents/${B.incident}/comments`, { body: 'x' }).expect(404);
    await apiA.post(`/api/incidents/${B.incident}/reject`, { reason: 'x' }).expect(404);
    await apiA.patch(`/api/incident-categories/${B.category}`, { name: 'x' }).expect(404);
    await apiA.post(`/api/me/notifications/${B.notification}/read`).expect(404);
  });

  it("refuses B's category, client or people in A's reports", async () => {
    await apiA.post('/api/incidents', { client_id: aClient, category_id: B.category, description: 'x', source: 'staff' }).expect(404);
    await apiA.post('/api/incidents', { client_id: B.client, category_id: (await apiA.get('/api/incident-categories').expect(200)).body.data[0].id, description: 'x', source: 'staff' }).expect(404);
  });

  it("keeps B's incidents out of A's list", async () => {
    const ids = (await apiA.get('/api/incidents').expect(200)).body.data.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(B.incident);
  });
});
