import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const HOUR = 3_600_000;

describe('Patrol — round generation and the clock (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let scheduler: RoundsScheduler;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    scheduler = app.get(RoundsScheduler);
    admin = await createTenantWithAdmin(app, 'prs');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.patch(`/api/sites/${ids.site}/settings`, { patrol_photo_random_percent: 100 }).expect(200);
    const a = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    ids.random = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'B', name: 'Kho', photo_rule: 'random' }).expect(201)).body.data.id;
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: a }, { checkpoint_id: ids.random }] }).expect(201)).body.data.id;
    ids.schedule = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;

    // A client that later takes over its own guards keeps its sites, but the company stops patrolling them.
    const self = (await api.post('/api/clients', { code: 'SM', name: 'Khách tự quản' }).expect(201)).body.data.id;
    ids.selfSite = (await api.post('/api/sites', { client_id: self, code: 'SS', name: 'Kho tự quản' }).expect(201)).body.data.id;
    const sc = (await api.post(`/api/sites/${ids.selfSite}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    const sr = (await api.post(`/api/sites/${ids.selfSite}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: sc }] }).expect(201)).body.data.id;
    await api.post(`/api/sites/${ids.selfSite}/patrol-schedules`, { route_id: sr, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201);
    await api.patch(`/api/clients/${self}`, { management_mode: 'self_managed' }).expect(200);
  });
  afterAll(async () => app.close());

  async function member(code: string) {
    const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    return e;
  }
  const rounds = (siteId: string) =>
    ds.query(`SELECT id, expected_start, expected_end, status, photo_checkpoint_ids::text[] AS photo_checkpoint_ids FROM patrol_rounds WHERE site_id = $1 ORDER BY expected_start`, [siteId]);
  const notes = (userId: string, type: string) =>
    ds.query(`SELECT data->>'round_id' AS round_id FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]);

  it('lays out the next 24 hours of rounds once, with the random photo points drawn', async () => {
    const now = Date.now();
    expect(await scheduler.generate(new Date(now))).toBeGreaterThan(0);
    const made = await rounds(ids.site);
    let expected = 0;
    for (let t = Math.floor(now / HOUR) * HOUR; t < now + 24 * HOUR; t += HOUR) expected += 1;
    expect(made).toHaveLength(expected);
    expect(made.filter((r: { expected_start: Date; expected_end: Date }) => r.expected_start.getTime() <= now && r.expected_end.getTime() > now)).toHaveLength(1);
    for (const r of made) {
      expect(r.expected_end.getTime() - r.expected_start.getTime()).toBe(HOUR);
      expect(r.photo_checkpoint_ids).toEqual([ids.random]);
    }
    expect(await scheduler.generate(new Date(now))).toBe(0);
    expect(await rounds(ids.selfSite)).toEqual([]);
  });

  it('reminds whoever is on shift five minutes before a round, once', async () => {
    const e = await member('NHAC');
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const nextHour = Math.ceil(Date.now() / HOUR) * HOUR;
    await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: new Date(nextHour - HOUR).toISOString(), end_at: new Date(nextHour + 3 * HOUR).toISOString() }).expect(201);
    await scheduler.tick(new Date(nextHour - 3 * 60_000));
    await scheduler.tick(new Date(nextHour - 2 * 60_000));
    const [round] = await ds.query(`SELECT id FROM patrol_rounds WHERE site_id = $1 AND expected_start = $2`, [ids.site, new Date(nextHour)]);
    expect(await notes(g.user.id, 'patrol.reminder')).toEqual([{ round_id: round.id }]);
  });

  it('marks a round nobody started as missed when its window ends, and tells the team leader', async () => {
    const lead = await member('TRUONG');
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead });
    const now = Date.now();
    const [current] = await ds.query(`SELECT id, expected_end FROM patrol_rounds WHERE site_id = $1 AND expected_start <= $2 AND expected_end > $2`, [ids.site, new Date(now)]);
    await scheduler.tick(new Date(current.expected_end.getTime() + 1000));
    const after = await rounds(ids.site);
    expect(after.find((r: { id: string }) => r.id === current.id).status).toBe('missed');
    expect(after.filter((r: { expected_start: Date; status: string }) => r.expected_start.getTime() >= current.expected_end.getTime() && r.status !== 'pending')).toEqual([]);
    expect((await notes(leader.user.id, 'patrol.missed')).map((n: { round_id: string }) => n.round_id)).toContain(current.id);
  });

  it('stops making rounds for a paused schedule', async () => {
    await api.patch(`/api/patrol-schedules/${ids.schedule}`, { status: 'inactive' }).expect(200);
    await scheduler.generate(new Date());
    const future = (await rounds(ids.site)).filter((r: { expected_start: Date }) => r.expected_start.getTime() > Date.now());
    expect(future).toEqual([]);
  });
});
