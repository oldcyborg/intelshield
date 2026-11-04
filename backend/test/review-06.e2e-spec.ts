import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();

describe('Plan 06 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  const tags: Record<string, string> = {};
  let g: { token: string; api: ReturnType<typeof client>; employee: string };
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'rv6');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'VK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'VS', name: 'Toà', ...SITE }).expect(201)).body.data.id;
    ids.A = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng', allowed_methods: ['qr'], ...SITE }).expect(201)).body.data.id;
    ids.B = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'B', name: 'Kho', allowed_methods: ['qr'], photo_rule: 'always' }).expect(201)).body.data.id;
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: ids.A }, { checkpoint_id: ids.B }] }).expect(201)).body.data.id;
    for (const t of (await api.get(`/api/sites/${ids.site}/qr-sheet`).expect(200)).body.data.tags) tags[t.id] = t.payload;
    const e = (await api.post('/api/employees', { code: 'VG', full_name: 'Bảo vệ' }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: at(Date.now() - 8 * HOUR), end_at: at(Date.now() + HOUR) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const phone = await loginOnDevice(app, u.phone, u.password, 'rv6-phone');
    g = { token: phone.token!, api: client(app, phone.token!), employee: e };
  });
  afterAll(async () => app.close());

  async function schedule(): Promise<string> {
    seq += 1;
    return (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: `L${seq}`, start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
  }
  /** A round of a new schedule whose window ended hours ago. */
  async function pastRound() {
    const s = await schedule();
    await app.get(RoundsScheduler).generate(new Date(Date.now() - 7 * HOUR));
    const [r] = await ds.query(
      `SELECT id, expected_start, expected_end FROM patrol_rounds WHERE schedule_id = $1 AND expected_start >= now() - interval '7 hours' AND expected_end < now() - interval '3 hours' ORDER BY expected_start LIMIT 1`,
      [s],
    );
    return r as { id: string; expected_start: Date; expected_end: Date };
  }
  async function currentRound() {
    const s = await schedule();
    await app.get(RoundsScheduler).generate(new Date());
    const [r] = await ds.query(
      `SELECT id FROM patrol_rounds WHERE schedule_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`,
      [s],
    );
    return { scheduleId: s, roundId: r.id as string };
  }
  const photo = async () =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${g.token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;
  const scan = (round: string, body: object) =>
    g.api.post(`/api/patrol/rounds/${round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), ...body });

  it('flags a scan sent long after the moment it claims, and the round it revived', async () => {
    const r = await pastRound();
    await ds.query(`UPDATE patrol_rounds SET status = 'missed' WHERE id = $1`, [r.id]);
    const res = (await scan(r.id, { method: 'qr', qr_payload: tags[ids.A], ...SITE, device_time: at(r.expected_start.getTime() + 5 * 60_000), captured_offline: true }).expect(201)).body.data;
    const a = res.stops.find((s: { code: string }) => s.code === 'A');
    expect(a).toMatchObject({ validity: 'suspicious', flags: expect.arrayContaining(['backdated']) });
    const [row] = await ds.query(`SELECT backdated FROM patrol_rounds WHERE id = $1`, [r.id]);
    expect(row.backdated).toBe(true);
  });

  it('refuses a photo uploaded before the moment of the scan', async () => {
    const { roundId } = await currentRound();
    const old = await photo();
    await ds.query(`UPDATE files SET created_at = now() - interval '1 day' WHERE id = $1`, [old]);
    const res = await scan(roundId, { method: 'qr', qr_payload: tags[ids.B], device_time: at(Date.now() - 60_000), captured_offline: true, photo_file_id: old }).expect(400);
    expect(res.body.error.code).toBe('PATROL_PHOTO_INVALID');
  });

  it('flags a QR scan without a GPS fix at a checkpoint that has a location', async () => {
    const { roundId } = await currentRound();
    const res = (await scan(roundId, { method: 'qr', qr_payload: tags[ids.A] }).expect(201)).body.data;
    expect(res.stops.find((s: { code: string }) => s.code === 'A')).toMatchObject({ validity: 'suspicious', flags: ['no_location'] });
  });

  it('answers simultaneous resends of one scan with the same result', async () => {
    const { roundId } = await currentRound();
    const body = { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: tags[ids.A], ...SITE };
    const results = await Promise.all([1, 2, 3].map(() => g.api.post(`/api/patrol/rounds/${roundId}/scans`, body)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect((await ds.query(`SELECT count(*)::int AS n FROM patrol_scans WHERE round_id = $1`, [roundId]))[0].n).toBe(1);
  });

  it("still lists tonight's rounds after midnight for a shift that began yesterday", async () => {
    const { roundId } = await currentRound();
    await ds.query(`UPDATE shift_assignments SET shift_date = $2 WHERE employee_id = $1`, [g.employee, addDays(todayLocal(), -1)]);
    const mine = (await g.api.get('/api/me/rounds').expect(200)).body.data.map((r: { id: string }) => r.id);
    await ds.query(`UPDATE shift_assignments SET shift_date = $2 WHERE employee_id = $1`, [g.employee, todayLocal()]);
    expect(mine).toContain(roundId);
  });

  it('drops the current untouched round when its schedule is paused', async () => {
    const { scheduleId, roundId } = await currentRound();
    await api.patch(`/api/patrol-schedules/${scheduleId}`, { status: 'inactive' }).expect(200);
    expect(await ds.query(`SELECT id FROM patrol_rounds WHERE id = $1`, [roundId])).toEqual([]);
  });

  it('caps a late finish at the deadline', async () => {
    const r = await pastRound();
    await g.api.post(`/api/patrol/rounds/${r.id}/start`, { device_time: at(r.expected_start.getTime() + 60_000), captured_offline: true }).expect(201);
    const done = (await g.api.post(`/api/patrol/rounds/${r.id}/finish`, { device_time: new Date().toISOString() }).expect(201)).body.data;
    expect(new Date(done.ended_at).getTime()).toBeLessThanOrEqual(r.expected_end.getTime() + 15 * 60_000);
  });

  it('makes no rounds for a route with no active checkpoint', async () => {
    const empty = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'Z', name: 'Tạm' }).expect(201)).body.data.id;
    const route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Trống', checkpoints: [{ checkpoint_id: empty }] }).expect(201)).body.data.id;
    await api.patch(`/api/checkpoints/${empty}`, { status: 'inactive' }).expect(200);
    const s = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: route, name: 'Trống', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
    await app.get(RoundsScheduler).generate(new Date());
    expect(await ds.query(`SELECT id FROM patrol_rounds WHERE schedule_id = $1`, [s])).toEqual([]);
  });
});
