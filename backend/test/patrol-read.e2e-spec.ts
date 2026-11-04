import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Patrol — what managers see (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let guard: { token: string; api: ReturnType<typeof client> };
  let other: { token: string };

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'prd');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'DK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'DS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'DS2', name: 'Kho' }).expect(201)).body.data.id;
    ids.cp = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng', allowed_methods: ['photo'] }).expect(201)).body.data.id;
    const route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: ids.cp }] }).expect(201)).body.data.id;
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201);
    await app.get(RoundsScheduler).generate(new Date());
    const [r] = await ds.query(`SELECT id FROM patrol_rounds WHERE site_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [ids.site]);
    ids.round = r.id;
    const onShift = async (code: string) => {
      const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
      await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
      await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
      const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
      const phone = await loginOnDevice(app, u.phone, u.password, `prd-${code}`);
      await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
      return { token: phone.token!, api: client(app, phone.token!) };
    };
    guard = await onShift('DG1');
    other = await onShift('DG2');
    const photo = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${guard.token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;
    ids.photo = photo;
    await guard.api.post(`/api/patrol/rounds/${ids.round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'photo', checkpoint_id: ids.cp, photo_file_id: photo, lat: 21.5, lng: 105.5, mock_location: true }).expect(201);
  });
  afterAll(async () => app.close());

  it("shows a manager the site's rounds for the day with a summary", async () => {
    const manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    const day = (await manager.get(`/api/patrol/rounds?site_id=${ids.site}&date=${todayLocal()}`).expect(200)).body.data;
    expect(day.summary).toMatchObject({ completed: 1, suspicious: 1 });
    expect(day.summary.total).toBe(day.rounds.length);
    const row = day.rounds.find((r: { id: string }) => r.id === ids.round);
    expect(row).toMatchObject({ status: 'completed', route_name: 'Vòng', employee_name: 'DG1', done_required: 1, required_count: 1, suspicious_count: 1 });
    const detail = (await manager.get(`/api/patrol/rounds/${ids.round}`).expect(200)).body.data;
    expect(detail.scans).toHaveLength(1);
    expect(detail.scans[0]).toMatchObject({ checkpoint_name: 'Cổng', method: 'photo', photo_id: ids.photo, validity: 'suspicious', captured_offline: false });
    await manager.get(`/api/files/${ids.photo}`).expect(200);
    const today = (await manager.get('/api/patrol/today').expect(200)).body.data;
    expect(today.find((s: { site_id: string }) => s.site_id === ids.site)).toMatchObject({ site_name: 'Toà', completed: 1 });
  });

  it('lets guards open their own round and photo, nobody else’s', async () => {
    await guard.api.get(`/api/patrol/rounds/${ids.round}`).expect(200);
    await client(app, other.token).get(`/api/patrol/rounds/${ids.round}`).expect(404);
    await client(app, other.token).get(`/api/files/${ids.photo}`).expect(404);
    await client(app, other.token).get(`/api/patrol/rounds?site_id=${ids.site}&date=${todayLocal()}`).expect(403);
  });

  it('keeps leaders to the sites they can see', async () => {
    const leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [{ scope_type: 'site', scope_id: ids.site2 }])).token);
    await leader.get(`/api/patrol/rounds?site_id=${ids.site}&date=${todayLocal()}`).expect(404);
    await leader.get(`/api/patrol/rounds/${ids.round}`).expect(404);
    expect((await leader.get('/api/patrol/today').expect(200)).body.data.map((s: { site_id: string }) => s.site_id)).not.toContain(ids.site);
  });
});
