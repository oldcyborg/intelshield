import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Patrol — schedules (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'psc');
    api = client(app, admin.token);
    const clientId = (await api.post('/api/clients', { code: 'SK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: clientId, code: 'S1', name: 'Toà 1' }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: clientId, code: 'S2', name: 'Toà 2' }).expect(201)).body.data.id;
    const cp = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng đêm', checkpoints: [{ checkpoint_id: cp }] }).expect(201)).body.data.id;
    const cp2 = (await api.post(`/api/sites/${ids.site2}/checkpoints`, { code: 'B', name: 'Kho' }).expect(201)).body.data.id;
    ids.route2 = (await api.post(`/api/sites/${ids.site2}/routes`, { name: 'Kho', checkpoints: [{ checkpoint_id: cp2 }] }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('sets up a night schedule across midnight and tells how many rounds a day it makes', async () => {
    const s = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, {
      route_id: ids.route, name: 'Tuần đêm', start_time: '22:00', end_time: '06:00', interval_minutes: 120,
    }).expect(201)).body.data;
    expect(s).toMatchObject({ route_name: 'Vòng đêm', start_time: '22:00', end_time: '06:00', interval_minutes: 120, days: [1, 2, 3, 4, 5, 6, 7], status: 'active', rounds_per_day: 4 });
    const day = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, {
      route_id: ids.route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60, days: [1, 2, 3, 4, 5],
    }).expect(201)).body.data;
    expect(day).toMatchObject({ rounds_per_day: 24, days: [1, 2, 3, 4, 5] });
    const list = (await api.get(`/api/sites/${ids.site}/patrol-schedules`).expect(200)).body.data;
    expect(list.map((x: { name: string }) => x.name).sort()).toEqual(['Cả ngày', 'Tuần đêm']);
  });

  it('refuses a gap longer than the window, a route of another site, and bad days', async () => {
    const res = await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '08:00', end_time: '09:00', interval_minutes: 120 }).expect(400);
    expect(res.body.error.code).toBe('PATROL_INTERVAL_TOO_LONG');
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route2, name: 'X', start_time: '08:00', end_time: '18:00', interval_minutes: 60 }).expect(404);
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '08:00', end_time: '18:00', interval_minutes: 60, days: [0] }).expect(400);
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '8h', end_time: '18:00', interval_minutes: 60 }).expect(400);
  });

  it('drops the untouched future rounds of a schedule when it changes', async () => {
    const s = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'Ngày', start_time: '06:00', end_time: '18:00', interval_minutes: 60 }).expect(201)).body.data;
    await ds.query(
      `INSERT INTO patrol_rounds (tenant_id, site_id, schedule_id, route_id, expected_start, expected_end)
       VALUES ($1, $2, $3, $4, now() + interval '2 hours', now() + interval '3 hours'),
              ($1, $2, $3, $4, now() - interval '2 hours', now() - interval '1 hour')`,
      [admin.tenant.id, ids.site, s.id, ids.route],
    );
    const patched = (await api.patch(`/api/patrol-schedules/${s.id}`, { interval_minutes: 30, status: 'inactive' }).expect(200)).body.data;
    expect(patched).toMatchObject({ interval_minutes: 30, status: 'inactive', rounds_per_day: 24 });
    const left = await ds.query(`SELECT expected_start < now() AS past FROM patrol_rounds WHERE schedule_id = $1`, [s.id]);
    expect(left).toEqual([{ past: true }]);
    await api.patch(`/api/patrol-schedules/${s.id}`, { start_time: '18:00', end_time: '18:30', interval_minutes: 60 }).expect(400);
    await api.delete(`/api/patrol-schedules/${s.id}`).expect(200);
    expect((await api.get(`/api/sites/${ids.site}/patrol-schedules`).expect(200)).body.data.map((x: { id: string }) => x.id)).not.toContain(s.id);
  });

  it('lets leaders read but not change schedules', async () => {
    const viewer = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [{ scope_type: 'site', scope_id: ids.site }]);
    const as = client(app, viewer.token);
    await as.get(`/api/sites/${ids.site}/patrol-schedules`).expect(200);
    await as.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '08:00', end_time: '18:00', interval_minutes: 60 }).expect(403);
    await as.get(`/api/sites/${ids.site2}/patrol-schedules`).expect(404);
  });
});
