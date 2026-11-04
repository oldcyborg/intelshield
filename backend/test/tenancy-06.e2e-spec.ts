import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Tenant isolation for patrol (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const A: Record<string, string> = {};
  const B: Record<string, string> = {};
  let apiA: ReturnType<typeof client>;
  let guardA: ReturnType<typeof client>;

  async function company(prefix: string, out: Record<string, string>) {
    const t = await createTenantWithAdmin(app, prefix);
    const api = client(app, t.token);
    out.tenant = t.tenant.id;
    out.client = (await api.post('/api/clients', { code: 'K', name: prefix }).expect(201)).body.data.id;
    out.site = (await api.post('/api/sites', { client_id: out.client, code: 'S', name: prefix }).expect(201)).body.data.id;
    out.cp = (await api.post(`/api/sites/${out.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    out.route = (await api.post(`/api/sites/${out.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: out.cp }] }).expect(201)).body.data.id;
    out.schedule = (await api.post(`/api/sites/${out.site}/patrol-schedules`, { route_id: out.route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
    out.tag = (await api.get(`/api/sites/${out.site}/qr-sheet`).expect(200)).body.data.tags[0].payload;
    return { t, api };
  }

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await company('iso6-a', A);
    await company('iso6-b', B);
    apiA = a.api;
    await app.get(RoundsScheduler).generate(new Date());
    const pick = async (site: string) =>
      (await ds.query(`SELECT id FROM patrol_rounds WHERE site_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [site]))[0].id;
    A.round = await pick(A.site);
    B.round = await pick(B.site);
    const e = (await apiA.post('/api/employees', { code: 'G', full_name: 'G' }).expect(201)).body.data.id;
    await apiA.post('/api/deployments', { employee_id: e, client_id: A.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    await apiA.post('/api/roster', { site_id: A.site, employee_id: e, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
    const u = await createUserWithRoles(app, a.t.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    guardA = client(app, (await loginOnDevice(app, u.phone, u.password, 'iso6-phone')).token!);
  });
  afterAll(async () => app.close());

  it("answers every read or change of B's schedules and rounds with 404", async () => {
    await apiA.get(`/api/sites/${B.site}/patrol-schedules`).expect(404);
    await apiA.patch(`/api/patrol-schedules/${B.schedule}`, { name: 'x' }).expect(404);
    await apiA.delete(`/api/patrol-schedules/${B.schedule}`).expect(404);
    await apiA.post(`/api/sites/${A.site}/patrol-schedules`, { route_id: B.route, name: 'x', start_time: '08:00', end_time: '18:00', interval_minutes: 60 }).expect(404);
    await apiA.get(`/api/patrol/rounds?site_id=${B.site}&date=${todayLocal()}`).expect(404);
    await apiA.get(`/api/patrol/rounds/${B.round}`).expect(404);
    await guardA.post(`/api/patrol/rounds/${B.round}/start`, { device_time: new Date().toISOString() }).expect(404);
    expect((await apiA.get('/api/patrol/today').expect(200)).body.data.map((s: { site_id: string }) => s.site_id)).not.toContain(B.site);
  });

  it("refuses B's QR tag on A's round", async () => {
    const res = await guardA.post(`/api/patrol/rounds/${A.round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: B.tag }).expect(400);
    expect(res.body.error.code).toBe('QR_INVALID');
    await guardA.post(`/api/patrol/rounds/${A.round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: A.tag }).expect(201);
  });
});
