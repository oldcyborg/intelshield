import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const HOUR = 3_600_000;
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const at = (ms: number) => new Date(ms).toISOString();

describe('Plan 07 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let engine: ViolationsEngine;
  const ids: Record<string, string> = {};
  let managerId: string;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    admin = await createTenantWithAdmin(app, 'rv7');
    api = client(app, admin.token);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    managerId = manager.user.id;
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerId }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  async function person() {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `R7${seq}`, full_name: `R7${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: employee }).expect(201);
    await api.post('/api/deployments', { employee_id: employee, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee });
    const token = (await loginOnDevice(app, u.phone, u.password, `rv7-${seq}`)).token!;
    return { employee, token, api: client(app, token) };
  }
  /** `ahead` true: as if rostered the day before, so the clock runs from the planned start. */
  const shift = async (employee: string, startIn: number, hours = 4, ahead = true) => {
    const s = (await api.post('/api/roster', { site_id: ids.site, employee_id: employee, start_at: minutes(startIn), end_at: minutes(startIn + hours * 60) }).expect(201)).body.data;
    if (ahead) await ds.query(`UPDATE shift_assignments SET created_at = planned_start - interval '1 day' WHERE id = $1`, [s.id]);
    return s;
  };
  const checkIn = async (p: { token: string }, assignment: string) => {
    const selfie = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${p.token}`).attach('file', JPEG, 's.jpg').expect(201)).body.data.id;
    await client(app, p.token).post('/api/attendance/check-in', { assignment_id: assignment, lat: 21.0286, lng: 105.7768, accuracy_m: 10, device_time: new Date().toISOString(), selfie_file_id: selfie }).expect(201);
  };
  const of = (employee: string) => ds.query(`SELECT type, status, minutes, detail, review_note FROM violations WHERE employee_id = $1 ORDER BY created_at`, [employee]);

  it('gives a stand-in called after the start their own clock', async () => {
    const a = await person();
    const b = await person();
    const s = await shift(a.employee, -45);
    const sub = (await api.post(`/api/roster/${s.id}/substitute`, { employee_id: b.employee }).expect(201)).body.data;
    await engine.tick();
    expect(await of(b.employee)).toEqual([]);
    await checkIn(b, sub.id);
    await engine.tick();
    expect(await of(b.employee)).toEqual([]);
    expect((await of(a.employee)).map((v: { type: string }) => v.type)).toEqual(['absent']);
  });

  it('does not call a shift added after its start an absence straight away', async () => {
    const c = await person();
    await shift(c.employee, -120, 4, false);
    await engine.tick();
    expect(await of(c.employee)).toEqual([]);
  });

  it('tells the manager about an absence written during a roster change', async () => {
    const d = await person();
    const s = await shift(d.employee, -45);
    const before = (await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'violation.absent'`, [managerId]))[0].n;
    await api.post(`/api/roster/${s.id}/cancel`).expect(201);
    const after = (await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'violation.absent'`, [managerId]))[0].n;
    expect(after).toBe(before + 1);
  });

  it('turns a proposed absence into lateness when the guard turns up, and says so', async () => {
    const e = await person();
    const s = await shift(e.employee, -40);
    await engine.tick();
    await ds.query(`UPDATE violations SET status = 'proposed_confirm', proposed_note = 'không báo' WHERE employee_id = $1`, [e.employee]);
    await checkIn(e, s.id);
    await engine.tick();
    const [v] = await of(e.employee);
    expect(v).toMatchObject({ type: 'late_check_in', status: 'auto', detail: { converted_from: 'absent', previous_status: 'proposed_confirm' } });
  });

  it('forgives a missed round only once the report has closed it, keeping what is still missing', async () => {
    const g = await person();
    await shift(g.employee, -5 * 60, 6);
    const A = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: `A${seq}`, name: 'Cổng' }).expect(201)).body.data.id;
    const B = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: `B${seq}`, name: 'Kho' }).expect(201)).body.data.id;
    const route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: A }, { checkpoint_id: B }] }).expect(201)).body.data.id;
    const sched = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: route, name: 'L', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
    await app.get(RoundsScheduler).generate(new Date(Date.now() - 4 * HOUR));
    const [r] = await ds.query(`SELECT id, expected_start FROM patrol_rounds WHERE schedule_id = $1 AND expected_end < now() - interval '2 hours' ORDER BY expected_start LIMIT 1`, [sched]);
    await app.get(RoundsScheduler).markMissed(new Date());
    await engine.tick();
    const tags: Record<string, string> = {};
    for (const t of (await api.get(`/api/sites/${ids.site}/qr-sheet`).expect(200)).body.data.tags) tags[t.id] = t.payload;
    const when = at(r.expected_start.getTime() + 5 * 60_000);
    const scan = (k: string) => g.api.post(`/api/patrol/rounds/${r.id}/scans`, { client_uuid: randomUUID(), device_time: when, captured_offline: true, method: 'qr', qr_payload: tags[k] }).expect(201);
    await scan(A);
    await engine.tick();
    const mine = () => ds.query(`SELECT type, status, detail FROM violations WHERE ref_id = $1 AND employee_id = $2 ORDER BY type`, [r.id, g.employee]);
    // The window is long over, so the report closes the round at once — short: the walker answers for what is missing.
    expect((await mine()).map((v: { type: string; status: string }) => `${v.type}:${v.status}`)).toEqual(['missed_checkpoint:auto', 'missed_round:waived']);
    await scan(B);
    await engine.tick();
    expect((await mine()).map((v: { type: string; status: string }) => `${v.type}:${v.status}`)).toEqual(['missed_checkpoint:waived', 'missed_round:waived']);
  });

  it('keeps the earlier note when a decision is repeated without one', async () => {
    const h = await person();
    const [{ id }] = await ds.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at) VALUES ($1, $2, $3, 'absent', 'assignment', gen_random_uuid(), now()) RETURNING id`,
      [admin.tenant.id, h.employee, ids.site],
    );
    await api.post(`/api/violations/${id}/review`, { decision: 'confirm', note: 'Không báo trước' }).expect(201);
    const again = (await api.post(`/api/violations/${id}/review`, { decision: 'confirm' }).expect(201)).body.data;
    expect(again.review_note).toBe('Không báo trước');
  });
});
