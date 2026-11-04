import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Patrol — doing a round (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  const tags: Record<string, string> = {};
  let g1: Guard;
  let g2: Guard;
  let seq = 0;
  type Guard = { userId: string; token: string; web: string; api: ReturnType<typeof client> };

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'prn');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'NK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'NS', name: 'Toà', ...SITE, responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.patch(`/api/sites/${ids.site}/settings`, { patrol_photo_random_percent: 100 }).expect(200);
    const point = async (code: string, extra: object) => (await api.post(`/api/sites/${ids.site}/checkpoints`, { code, name: `Điểm ${code}`, ...extra }).expect(201)).body.data.id;
    ids.A = await point('A', { allowed_methods: ['qr'] });
    ids.B = await point('B', { allowed_methods: ['gps'], ...SITE, radius_m: 40, photo_rule: 'random' });
    ids.C = await point('C', { allowed_methods: ['qr', 'gps'], ...SITE, photo_rule: 'always' });
    ids.D = await point('D', { allowed_methods: ['photo'] });
    ids.E = await point('E', { allowed_methods: ['gps'], ...SITE });
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, {
      name: 'Vòng chính',
      checkpoints: [{ checkpoint_id: ids.A }, { checkpoint_id: ids.B }, { checkpoint_id: ids.C }, { checkpoint_id: ids.D, required: false }],
    }).expect(201)).body.data.id;
    for (const t of (await api.get(`/api/sites/${ids.site}/qr-sheet`).expect(200)).body.data.tags) tags[t.id] = t.payload;
    g1 = await guardOnShift();
    g2 = await guardOnShift();
  });
  afterAll(async () => app.close());

  async function guardOnShift(withShift = true): Promise<Guard> {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `NG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const phone = await loginOnDevice(app, u.phone, u.password, `prn-phone-${seq}`);
    if (withShift) await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
    return { userId: u.user.id, token: phone.token!, web: u.token, api: client(app, phone.token!) };
  }
  /** A fresh schedule gives a round open right now that nobody has touched. */
  async function freshRound(): Promise<string> {
    seq += 1;
    const s = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: `Lịch ${seq}`, start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
    await app.get(RoundsScheduler).generate(new Date());
    const [r] = await ds.query(
      `SELECT id FROM patrol_rounds WHERE schedule_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes'
        ORDER BY expected_start LIMIT 1`,
      [s],
    );
    return r.id;
  }
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;
  const scan = (g: Guard, round: string, body: object) =>
    g.api.post(`/api/patrol/rounds/${round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), ...body });
  const near = { lat: 21.0286, lng: 105.7768, accuracy_m: 8 };

  it('walks a round by QR, GPS and photo and finishes it complete', async () => {
    const round = await freshRound();
    const mine = (await g1.api.get('/api/me/rounds').expect(200)).body.data;
    const listed = mine.find((r: { id: string }) => r.id === round);
    expect(listed.stops.map((s: { code: string; photo_required: boolean }) => `${s.code}:${s.photo_required}`)).toEqual(['A:false', 'B:true', 'C:true', 'D:true']);

    await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A], ...near }).expect(201);
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.B, ...near }).expect(400)).body.error.code).toBe('PATROL_PHOTO_REQUIRED');
    await scan(g1, round, { method: 'gps', checkpoint_id: ids.B, ...near, photo_file_id: await photo(g1.token) }).expect(201);
    const res = (await scan(g1, round, { method: 'qr', qr_payload: tags[ids.C], ...near, photo_file_id: await photo(g1.token) }).expect(201)).body.data;
    // Late means started more than the site's 15 minutes after the window opened.
    const late = new Date(res.started_at).getTime() > new Date(res.expected_start).getTime() + 15 * 60_000;
    expect(res).toMatchObject({ status: 'in_progress', mine: true, required_count: 3, done_required: 3, late });
    expect(res.stops.find((s: { code: string }) => s.code === 'B')).toMatchObject({ method: 'gps', validity: 'valid', flags: [] });

    const done = (await g1.api.post(`/api/patrol/rounds/${round}/finish`, { device_time: new Date().toISOString() }).expect(201)).body.data;
    expect(done).toMatchObject({ status: 'completed', ended_by: 'guard' });
  });

  it('refuses forged tags, points off the route, wrong methods, repeats and borrowed photos', async () => {
    const round = await freshRound();
    const forged = tags[ids.A].slice(0, -2) + (tags[ids.A].endsWith('AA') ? 'BB' : 'AA');
    expect((await scan(g1, round, { method: 'qr', qr_payload: forged }).expect(400)).body.error.code).toBe('QR_INVALID');
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.E, ...near }).expect(400)).body.error.code).toBe('PATROL_NOT_ON_ROUTE');
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.A, ...near }).expect(400)).body.error.code).toBe('PATROL_METHOD_NOT_ALLOWED');
    expect((await scan(g1, round, { method: 'nfc', checkpoint_id: ids.A }).expect(400)).body.error.code).toBe('PATROL_METHOD_NOT_ALLOWED');
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.B }).expect(400)).body.error.code).toBe('PATROL_LOCATION_REQUIRED');
    await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(201);
    expect((await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(409)).body.error.code).toBe('PATROL_ALREADY_SCANNED');
    const theirs = await photo(g2.token);
    expect((await scan(g1, round, { method: 'photo', checkpoint_id: ids.D, photo_file_id: theirs }).expect(400)).body.error.code).toBe('PATROL_PHOTO_INVALID');
  });

  it('keeps a round to one guard, on shift, on an approved phone', async () => {
    const round = await freshRound();
    await g1.api.post(`/api/patrol/rounds/${round}/start`, { device_time: new Date().toISOString() }).expect(201);
    await g1.api.post(`/api/patrol/rounds/${round}/start`, { device_time: new Date().toISOString() }).expect(201);
    expect((await g2.api.post(`/api/patrol/rounds/${round}/start`, { device_time: new Date().toISOString() }).expect(409)).body.error.code).toBe('PATROL_ROUND_TAKEN');
    expect((await scan(g2, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(409)).body.error.code).toBe('PATROL_ROUND_TAKEN');
    const idle = await guardOnShift(false);
    const other = await freshRound();
    expect((await idle.api.post(`/api/patrol/rounds/${other}/start`, { device_time: new Date().toISOString() }).expect(403)).body.error.code).toBe('PATROL_NOT_ON_SHIFT');
    expect((await client(app, g1.web).post(`/api/patrol/rounds/${other}/start`, { device_time: new Date().toISOString() }).expect(403)).body.error.code).toBe('PATROL_DEVICE_REQUIRED');
  });

  it("lets the team's leader take any round of the team's sites with no shift of their own", async () => {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `NL${seq}`, full_name: 'Đội trưởng' }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: e }).expect(200);
    const u = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: e });
    const lead = client(app, (await loginOnDevice(app, u.phone, u.password, `prn-lead-${seq}`)).token!);
    try {
      const round = await freshRound();
      const mine = (await lead.get('/api/me/rounds').expect(200)).body.data.map((r: { id: string }) => r.id);
      expect(mine).toContain(round);
      await lead.post(`/api/patrol/rounds/${round}/start`, { device_time: new Date().toISOString() }).expect(201);
      await lead.post(`/api/patrol/rounds/${round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: tags[ids.A] }).expect(201);
    } finally {
      await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: null }).expect(200);
    }
  });

  it('answers a resent scan with the first result instead of a second copy', async () => {
    const round = await freshRound();
    const body = { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: tags[ids.A] };
    await g1.api.post(`/api/patrol/rounds/${round}/scans`, body).expect(201);
    await g1.api.post(`/api/patrol/rounds/${round}/scans`, body).expect(201);
    expect((await ds.query(`SELECT count(*)::int AS n FROM patrol_scans WHERE round_id = $1`, [round]))[0].n).toBe(1);
    await g2.api.post(`/api/patrol/rounds/${round}/scans`, body).expect(409);
  });

  it('keeps suspicious scans but marks them', async () => {
    const round = await freshRound();
    const far = (await scan(g1, round, { method: 'gps', checkpoint_id: ids.C, lat: 21.04, lng: 105.79, mock_location: true, photo_file_id: await photo(g1.token) }).expect(201)).body.data;
    expect(far.stops.find((s: { code: string }) => s.code === 'C')).toMatchObject({ validity: 'suspicious', flags: expect.arrayContaining(['outside_radius', 'mock_location']) });
    const skewed = (await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A], device_time: minutes(-20) }).expect(201)).body.data;
    expect(skewed.stops.find((s: { code: string }) => s.code === 'A').flags).toContain('clock_skew');
  });

  it('counts scans sent late from offline when they fall in the window, even on a round marked missed', async () => {
    const round = await freshRound();
    await ds.query(`UPDATE patrol_rounds SET status = 'missed' WHERE id = $1`, [round]);
    const at = new Date(Date.now() - 5_000).toISOString();
    const res = (await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A], device_time: at, captured_offline: true }).expect(201)).body.data;
    expect(res).toMatchObject({ status: 'in_progress', mine: true });
    expect(new Date(res.started_at).toISOString()).toBe(at);
    const [r] = await ds.query(`SELECT expected_start FROM patrol_rounds WHERE id = $1`, [round]);
    const tooEarly = new Date(r.expected_start.getTime() - 20 * 60_000).toISOString();
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.C, ...near, device_time: tooEarly, captured_offline: true, photo_file_id: await photo(g1.token) }).expect(409)).body.error.code).toBe('PATROL_ROUND_CLOSED');
  });

  it('closes a round left open at its deadline as partial', async () => {
    const round = await freshRound();
    await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(201);
    const [r] = await ds.query(`SELECT expected_end FROM patrol_rounds WHERE id = $1`, [round]);
    await app.get(RoundsScheduler).tick(new Date(r.expected_end.getTime() + 16 * 60_000));
    const [after] = await ds.query(`SELECT status, ended_by, done_required, required_count FROM patrol_rounds WHERE id = $1`, [round]);
    expect(after).toEqual({ status: 'partial', ended_by: 'system', done_required: 1, required_count: 3 });
  });
});
