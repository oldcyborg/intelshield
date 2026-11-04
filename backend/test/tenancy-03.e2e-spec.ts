import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for sites, checkpoints, routes (e2e)', () => {
  let app: NestExpressApplication;
  let apiA: ReturnType<typeof client>;
  const B: Record<'client' | 'site' | 'checkpoint' | 'route' | 'post', string> = { client: '', site: '', checkpoint: '', route: '', post: '' };
  let aSite: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso3-a');
    const b = await createTenantWithAdmin(app, 'iso3-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    B.client = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data.id;
    B.site = (await apiB.post('/api/sites', { client_id: B.client, code: 'BS', name: 'B' }).expect(201)).body.data.id;
    B.post = (await apiB.post(`/api/sites/${B.site}/posts`, { name: 'Cổng B' }).expect(201)).body.data.id;
    B.checkpoint = (await apiB.post(`/api/sites/${B.site}/checkpoints`, { code: 'BP', name: 'B' }).expect(201)).body.data.id;
    B.route = (await apiB.post(`/api/sites/${B.site}/routes`, { name: 'B', checkpoints: [{ checkpoint_id: B.checkpoint }] }).expect(201)).body.data.id;
    const aClient = (await apiA.post('/api/clients', { code: 'AK', name: 'A' }).expect(201)).body.data.id;
    aSite = (await apiA.post('/api/sites', { client_id: aClient, code: 'AS', name: 'A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or write of B's records with 404", async () => {
    await apiA.get(`/api/sites/${B.site}`).expect(404);
    await apiA.patch(`/api/sites/${B.site}`, { name: 'x' }).expect(404);
    await apiA.get(`/api/sites/${B.site}/checkpoints`).expect(404);
    await apiA.get(`/api/sites/${B.site}/routes`).expect(404);
    await apiA.get(`/api/sites/${B.site}/qr-sheet`).expect(404);
    await apiA.post(`/api/sites/${B.site}/checkpoints`, { code: 'X', name: 'X' }).expect(404);
    await apiA.patch(`/api/checkpoints/${B.checkpoint}`, { name: 'x' }).expect(404);
    await apiA.post(`/api/checkpoints/${B.checkpoint}/rotate-qr`).expect(404);
    await apiA.put(`/api/routes/${B.route}`, { name: 'x', checkpoints: [] }).expect(404);
    await apiA.delete(`/api/routes/${B.route}`).expect(404);
    await apiA.delete(`/api/posts/${B.post}`).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post('/api/sites', { client_id: B.client, code: 'X', name: 'X' }).expect(404);
    const res = await apiA.post(`/api/sites/${aSite}/routes`, { name: 'X', checkpoints: [{ checkpoint_id: B.checkpoint }] }).expect(400);
    expect(res.body.error.code).toBe('ROUTE_FOREIGN_CHECKPOINT');
  });

  it("keeps B out of A's lists", async () => {
    const ids = (await apiA.get('/api/sites').expect(200)).body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual([aSite]);
  });
});
