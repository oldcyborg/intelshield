import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Patrol routes (e2e)', () => {
  let app: NestExpressApplication;
  let api: ReturnType<typeof client>;
  let siteId: string;
  let otherSiteId: string;
  let seq = 0;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'rt');
    api = client(app, admin.token);
    const c = (await api.post('/api/clients', { code: 'RK', name: 'Khách R' }).expect(201)).body.data;
    siteId = (await api.post('/api/sites', { client_id: c.id, code: 'RS1', name: 'Toà 1' }).expect(201)).body.data.id;
    otherSiteId = (await api.post('/api/sites', { client_id: c.id, code: 'RS2', name: 'Toà 2' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const cp = async (site = siteId) =>
    (await api.post(`/api/sites/${site}/checkpoints`, { code: `C${++seq}`, name: `Điểm ${seq}` }).expect(201)).body.data;

  it('keeps the checkpoints in the order given, with optional stops', async () => {
    const [a, b, c] = [await cp(), await cp(), await cp()];
    const route = (
      await api
        .post(`/api/sites/${siteId}/routes`, {
          name: 'Vòng 1',
          checkpoints: [{ checkpoint_id: c.id }, { checkpoint_id: a.id, required: false }, { checkpoint_id: b.id }],
        })
        .expect(201)
    ).body.data;
    expect(route.checkpoints.map((s: { checkpoint_id: string; seq: number; required: boolean }) => [s.checkpoint_id, s.seq, s.required])).toEqual([
      [c.id, 1, true], [a.id, 2, false], [b.id, 3, true],
    ]);
    const listed = (await api.get(`/api/sites/${siteId}/routes`).expect(200)).body.data;
    expect(listed.find((r: { id: string }) => r.id === route.id).checkpoints).toHaveLength(3);
  });

  it('replaces the stops of a route as a whole', async () => {
    const [a, b] = [await cp(), await cp()];
    const route = (await api.post(`/api/sites/${siteId}/routes`, { name: 'Vòng 2', checkpoints: [{ checkpoint_id: a.id }] }).expect(201)).body.data;
    const res = await api.put(`/api/routes/${route.id}`, { name: 'Vòng 2b', checkpoints: [{ checkpoint_id: b.id }, { checkpoint_id: a.id }] }).expect(200);
    expect(res.body.data).toMatchObject({ name: 'Vòng 2b' });
    expect(res.body.data.checkpoints.map((s: { checkpoint_id: string }) => s.checkpoint_id)).toEqual([b.id, a.id]);
  });

  it('refuses empty routes, repeated stops, other sites and inactive checkpoints', async () => {
    const a = await cp();
    const foreign = await cp(otherSiteId);
    const off = await cp();
    await api.patch(`/api/checkpoints/${off.id}`, { status: 'inactive' }).expect(200);
    const post = (checkpoints: object[]) => api.post(`/api/sites/${siteId}/routes`, { name: 'X', checkpoints });
    expect((await post([]).expect(400)).body.error.code).toBe('ROUTE_EMPTY');
    expect((await post([{ checkpoint_id: a.id }, { checkpoint_id: a.id }]).expect(400)).body.error.code).toBe('ROUTE_DUPLICATE_CHECKPOINT');
    expect((await post([{ checkpoint_id: foreign.id }]).expect(400)).body.error.code).toBe('ROUTE_FOREIGN_CHECKPOINT');
    expect((await post([{ checkpoint_id: off.id }]).expect(400)).body.error.code).toBe('ROUTE_FOREIGN_CHECKPOINT');
  });

  it('deletes a route', async () => {
    const a = await cp();
    const route = (await api.post(`/api/sites/${siteId}/routes`, { name: 'Xoá', checkpoints: [{ checkpoint_id: a.id }] }).expect(201)).body.data;
    await api.delete(`/api/routes/${route.id}`).expect(200);
    const listed = (await api.get(`/api/sites/${siteId}/routes`).expect(200)).body.data;
    expect(listed.map((r: { id: string }) => r.id)).not.toContain(route.id);
  });
});
