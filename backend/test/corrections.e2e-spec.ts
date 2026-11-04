import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const plus = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 60_000).toISOString();

describe('Attendance corrections (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let engine: ViolationsEngine;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let leader: ReturnType<typeof client>;
  let leaderEmployee: string;
  let manager: ReturnType<typeof client>;
  let managerId: string;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    admin = await createTenantWithAdmin(app, 'cor');
    api = client(app, admin.token);
    const m = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    managerId = m.user.id;
    manager = client(app, m.token);
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerId }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'CK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'CS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
    leaderEmployee = await employee('CLEAD');
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: leaderEmployee }).expect(200);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: leaderEmployee })).token);
  });
  afterAll(async () => app.close());

  async function employee(code = `CG${++seq}`) {
    const id = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: id }).expect(201);
    await api.post('/api/deployments', { employee_id: id, client_id: ids.client, start_date: addDays(todayLocal(), -10) }).expect(201);
    return id;
  }
  async function guard() {
    const id = await employee();
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: id });
    const phone = await loginOnDevice(app, u.phone, u.password, `cor-${seq}`);
    return { employee: id, userId: u.user.id, token: phone.token!, api: client(app, phone.token!) };
  }
  /** A shift from `startIn` minutes for `hours`, rostered the day before. */
  async function shift(employeeId: string, startIn: number, hours: number) {
    const s = (await api.post('/api/roster', { site_id: ids.site, employee_id: employeeId, start_at: minutes(startIn), end_at: minutes(startIn + hours * 60) }).expect(201)).body.data;
    await ds.query(`UPDATE shift_assignments SET created_at = planned_start - interval '1 day' WHERE id = $1`, [s.id]);
    return s as { id: string; planned_start: string; planned_end: string };
  }
  const ask = (g: { api: ReturnType<typeof client> }, body: Record<string, unknown>) =>
    g.api.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'phone_dead', reason: 'Máy hết pin', ...body });
  const violations = (assignment: string) => ds.query(`SELECT type, minutes, status, detail FROM violations WHERE ref_id = $1 ORDER BY created_at`, [assignment]);
  const attendance = async (assignment: string) => (await ds.query(`SELECT * FROM attendances WHERE assignment_id = $1`, [assignment]))[0];

  it('adds a forgotten shift through the leader and the manager, and clears the absence', async () => {
    const g = await guard();
    const s = await shift(g.employee, -10 * 60, 8);
    await engine.tick();
    expect((await violations(s.id)).map((v: { type: string }) => v.type)).toEqual(['absent']);

    const c = (await ask(g, { assignment_id: s.id, check_in_at: plus(s.planned_start, 5), check_out_at: s.planned_end }).expect(201)).body.data;
    expect(c).toMatchObject({ status: 'pending', current: null });
    await ds.query(
      `INSERT INTO logbook_entries (tenant_id, site_id, assignment_id, author_user_id, author_employee_id, type, body, occurred_at, client_uuid)
       VALUES ($1, $2, $3, $4, $5, 'note', 'Đã trực', $6, gen_random_uuid())`,
      [admin.tenant.id, ids.site, s.id, g.userId, g.employee, plus(s.planned_start, 60)],
    );
    const open = (await leader.get('/api/attendance-corrections?status=open').expect(200)).body.data;
    const seen = open.find((x: { id: string }) => x.id === c.id);
    expect(seen.evidence).toMatchObject({ scans: 0, logbook: 1 });

    expect((await leader.post(`/api/attendance-corrections/${c.id}/propose`, { decision: 'approve' }).expect(201)).body.data.status).toBe('proposed_approve');
    await leader.post(`/api/attendance-corrections/${c.id}/review`, { decision: 'approve' }).expect(403);
    const done = (await manager.post(`/api/attendance-corrections/${c.id}/review`, { decision: 'approve' }).expect(201)).body.data;
    expect(done.status).toBe('approved');
    expect(done.before).toEqual({ check_in_at: null, check_out_at: null });

    const a = await attendance(s.id);
    expect(a.check_in_flags).toEqual(['corrected']);
    expect(a.check_out_flags).toEqual(['corrected']);
    expect(a.late_minutes).toBe(5);
    expect(a.worked_minutes).toBe(8 * 60 - 5);
    expect(a.check_in_selfie_id).toBeNull();
    await engine.tick();
    expect((await violations(s.id)).map((v: { status: string }) => v.status)).toEqual(['waived']);
    const [audit] = await ds.query(`SELECT 1 FROM audit_logs WHERE action = 'attendance.correct' AND entity_id = $1`, [c.id]);
    expect(audit).toBeDefined();
  });

  it('turns an absence into the lateness the correction shows', async () => {
    const g = await guard();
    const s = await shift(g.employee, -6 * 60, 5);
    await engine.tick();
    const c = (await ask(g, { assignment_id: s.id, check_in_at: plus(s.planned_start, 40) }).expect(201)).body.data;
    await manager.post(`/api/attendance-corrections/${c.id}/review`, { decision: 'approve' }).expect(201);
    expect(await violations(s.id)).toEqual([{ type: 'late_check_in', minutes: 40, status: 'auto', detail: expect.objectContaining({ converted_from: 'absent' }) }]);
  });

  it('reminds a guard once who never clocked out, then takes the clock-out by correction', async () => {
    const g = await guard();
    const s = await shift(g.employee, -10, 2);
    const selfie = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${g.token}`).attach('file', JPEG, 's.jpg').expect(201)).body.data.id;
    await g.api.post('/api/attendance/check-in', { assignment_id: s.id, lat: 21.0286, lng: 105.7768, accuracy_m: 10, device_time: new Date().toISOString(), selfie_file_id: selfie }).expect(201);
    // The shift is now long over.
    await ds.query(`UPDATE shift_assignments SET planned_start = planned_start - interval '9 hours', planned_end = planned_end - interval '9 hours' WHERE id = $1`, [s.id]);
    await ds.query(`UPDATE attendances SET check_in_at = check_in_at - interval '9 hours' WHERE assignment_id = $1`, [s.id]);
    await engine.tick();
    await engine.tick();
    const [n] = await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'attendance.missing_out'`, [g.userId]);
    expect(n.n).toBe(1);

    const [shiftRow] = await ds.query(`SELECT planned_end FROM shift_assignments WHERE id = $1`, [s.id]);
    const end = new Date(shiftRow.planned_end).toISOString();
    expect((await ask(g, { assignment_id: s.id, check_out_at: plus(end, 7 * 60) }).expect(400)).body.error.code).toBe('CORRECTION_TIME_INVALID');
    const c = (await ask(g, { assignment_id: s.id, check_out_at: end, reason_code: 'forgot' }).expect(201)).body.data;
    expect(c.current.check_out_at).toBeNull();
    await manager.post(`/api/attendance-corrections/${c.id}/review`, { decision: 'approve' }).expect(201);
    const a = await attendance(s.id);
    expect(new Date(a.check_out_at).toISOString()).toBe(end);
    expect(a.check_in_flags).not.toContain('corrected');
    expect(a.check_out_flags).toEqual(['corrected']);
    expect(a.early_minutes).toBe(0);
  });

  it('refuses late requests, impossible times, a second open request, and nothing to change', async () => {
    const g = await guard();
    const old = await shift(g.employee, -60 * 60, 8);
    expect((await ask(g, { assignment_id: old.id, check_in_at: old.planned_start }).expect(400)).body.error.code).toBe('CORRECTION_TOO_LATE');
    const s = await shift(g.employee, -9 * 60, 6);
    expect((await ask(g, { assignment_id: s.id, check_in_at: plus(s.planned_start, -90) }).expect(400)).body.error.code).toBe('CORRECTION_TIME_INVALID');
    expect((await ask(g, { assignment_id: s.id, check_out_at: s.planned_end }).expect(400)).body.error.code).toBe('CORRECTION_TIME_INVALID');
    expect((await ask(g, { assignment_id: s.id, check_in_at: s.planned_start, check_out_at: plus(s.planned_start, -1) }).expect(400)).body.error.code).toBe('CORRECTION_TIME_INVALID');
    expect((await ask(g, { assignment_id: s.id }).expect(400)).body.error.code).toBe('CORRECTION_NOTHING');
    const uuid = randomUUID();
    const first = (await ask(g, { client_uuid: uuid, assignment_id: s.id, check_in_at: s.planned_start }).expect(201)).body.data;
    expect((await ask(g, { client_uuid: uuid, assignment_id: s.id, check_in_at: s.planned_start }).expect(201)).body.data.id).toBe(first.id);
    expect((await ask(g, { assignment_id: s.id, check_in_at: plus(s.planned_start, 3) }).expect(409)).body.error.code).toBe('CORRECTION_OPEN_EXISTS');
    const other = await guard();
    await other.api.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'forgot', assignment_id: s.id, check_in_at: s.planned_start }).expect(403);
    expect((await g.api.post(`/api/attendance-corrections/${first.id}/cancel`, {}).expect(201)).body.data.status).toBe('cancelled');
  });

  it('keeps people off their own requests, asks a reason to refuse or go against a proposal', async () => {
    const own = await shift(leaderEmployee, -9 * 60, 6);
    const leaderOwn = (await leader.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'app_error', assignment_id: own.id, check_in_at: own.planned_start }).expect(201)).body.data;
    expect((await leader.post(`/api/attendance-corrections/${leaderOwn.id}/propose`, { decision: 'approve' }).expect(403)).body.error.code).toBe('CORRECTION_OWN');

    const g = await guard();
    const s = await shift(g.employee, -9 * 60, 6);
    const c = (await ask(g, { assignment_id: s.id, check_in_at: s.planned_start }).expect(201)).body.data;
    expect((await leader.post(`/api/attendance-corrections/${c.id}/propose`, { decision: 'reject' }).expect(400)).body.error.code).toBe('CORRECTION_NOTE_REQUIRED');
    await leader.post(`/api/attendance-corrections/${c.id}/propose`, { decision: 'reject', note: 'Không thấy quét tuần tra nào' }).expect(201);
    expect((await manager.post(`/api/attendance-corrections/${c.id}/review`, { decision: 'approve' }).expect(400)).body.error.code).toBe('CORRECTION_NOTE_REQUIRED');
    const rejected = (await manager.post(`/api/attendance-corrections/${c.id}/review`, { decision: 'reject', note: 'Đồng ý với đội trưởng' }).expect(201)).body.data;
    expect(rejected.status).toBe('rejected');
    expect(await attendance(s.id)).toBeUndefined();
    expect((await manager.post(`/api/attendance-corrections/${c.id}/review`, { decision: 'approve', note: 'x' }).expect(409)).body.error.code).toBe('CORRECTION_NOT_OPEN');
  });

  it('lets a manager correct a shift directly with a reason, and leaves decided violations alone', async () => {
    const g = await guard();
    const s = await shift(g.employee, -9 * 60, 6);
    await engine.tick();
    await ds.query(`UPDATE violations SET status = 'confirmed', reviewed_at = now() WHERE ref_id = $1`, [s.id]);
    const body = { client_uuid: randomUUID(), reason_code: 'other', assignment_id: s.id, check_in_at: s.planned_start, check_out_at: s.planned_end };
    expect((await manager.post('/api/attendance-corrections', { ...body, reason: undefined }).expect(400)).body.error.code).toBe('CORRECTION_NOTE_REQUIRED');
    await leader.post('/api/attendance-corrections', { ...body, reason: 'Sửa' }).expect(403);
    const c = (await manager.post('/api/attendance-corrections', { ...body, reason: 'Bảo vệ báo qua điện thoại, đội trưởng xác nhận' }).expect(201)).body.data;
    expect(c.status).toBe('approved');
    expect((await attendance(s.id)).check_in_flags).toEqual(['corrected']);
    expect((await violations(s.id)).map((v: { type: string; status: string }) => [v.type, v.status])).toEqual([['absent', 'confirmed']]);
  });
});
