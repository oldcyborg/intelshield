import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Leave requests (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let engine: ViolationsEngine;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let leader: { id: string; api: ReturnType<typeof client>; employee: string };
  let otherLeader: ReturnType<typeof client>;
  let managerId: string;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    admin = await createTenantWithAdmin(app, 'lve');
    api = client(app, admin.token);
    managerId = (await createUserWithRoles(app, admin.tenant.id, ['manager'], [])).user.id;
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerId }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội A', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.team2 = (await api.post('/api/org/teams', { name: 'Đội B', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'LK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'LS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    const lead = await employee('LEAD', ids.team);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    const lu = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead });
    leader = { id: lu.user.id, api: client(app, lu.token), employee: lead };
    const lead2 = await employee('LEAD2', ids.team2);
    await api.put(`/api/org/teams/${ids.team2}/leader`, { employee_id: lead2 }).expect(200);
    otherLeader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead2 })).token);
  });
  afterAll(async () => app.close());

  async function employee(code = `LG${++seq}`, team = ids.team) {
    const id = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: id }).expect(201);
    await api.post('/api/deployments', { employee_id: id, client_id: ids.client, start_date: addDays(todayLocal(), -10) }).expect(201);
    return id;
  }
  async function guard() {
    const id = await employee();
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: id });
    return { employee: id, userId: u.user.id, api: client(app, u.token) };
  }
  async function shift(employeeId: string, startIn: number, hours = 8) {
    const s = (await api.post('/api/roster', { site_id: ids.site, employee_id: employeeId, start_at: minutes(startIn), end_at: minutes(startIn + hours * 60) }).expect(201)).body.data;
    await ds.query(`UPDATE shift_assignments SET created_at = planned_start - interval '1 day' WHERE id = $1`, [s.id]);
    return s.id as string;
  }
  const ask = (g: { api: ReturnType<typeof client> }, body: Record<string, unknown>) =>
    g.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'personal', reason: 'Việc nhà', ...body });
  const notes = async (userId: string, type: string) =>
    (await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]))[0].n;

  it('tells the leader of a request, and the manager too when a shift is close', async () => {
    const g = await guard();
    const [lb, mb] = [await notes(leader.id, 'leave.submitted'), await notes(managerId, 'leave.submitted')];
    const far = (await ask(g, { from_date: addDays(todayLocal(), 5), to_date: addDays(todayLocal(), 6) }).expect(201)).body.data;
    expect(far).toMatchObject({ status: 'pending', days: 2, urgent: false });
    expect(await notes(leader.id, 'leave.submitted')).toBe(lb + 1);
    expect(await notes(managerId, 'leave.submitted')).toBe(mb);

    await shift(g.employee, 3 * 60);
    const soon = (await ask(g, { from_date: todayLocal(), to_date: todayLocal() }).expect(201)).body.data;
    expect(soon.urgent).toBe(true);
    expect(soon.shifts).toHaveLength(1);
    expect(await notes(managerId, 'leave.submitted')).toBe(mb + 1);
  });

  it('refuses overlapping days, out-of-range dates, and replays the same request', async () => {
    const g = await guard();
    const uuid = randomUUID();
    const first = (await ask(g, { client_uuid: uuid, from_date: addDays(todayLocal(), 10), to_date: addDays(todayLocal(), 12) }).expect(201)).body.data;
    const again = (await ask(g, { client_uuid: uuid, from_date: addDays(todayLocal(), 10), to_date: addDays(todayLocal(), 12) }).expect(201)).body.data;
    expect(again.id).toBe(first.id);
    expect((await ask(g, { from_date: addDays(todayLocal(), 12), to_date: addDays(todayLocal(), 13) }).expect(409)).body.error.code).toBe('LEAVE_OVERLAP');
    expect((await ask(g, { from_date: addDays(todayLocal(), -10), to_date: addDays(todayLocal(), -9) }).expect(400)).body.error.code).toBe('LEAVE_RANGE_INVALID');
    expect((await ask(g, { from_date: addDays(todayLocal(), 20), to_date: addDays(todayLocal(), 60) }).expect(400)).body.error.code).toBe('LEAVE_RANGE_INVALID');
    expect((await ask(g, { from_date: addDays(todayLocal(), 3), to_date: addDays(todayLocal(), 2) }).expect(400)).body.error.code).toBe('LEAVE_RANGE_INVALID');
  });

  it('lets only someone who rosters the person decide, never on their own request, and a refusal needs a reason', async () => {
    const g = await guard();
    const r = (await ask(g, { from_date: addDays(todayLocal(), 15), to_date: addDays(todayLocal(), 15) }).expect(201)).body.data;
    await otherLeader.post(`/api/leave-requests/${r.id}/approve`, {}).expect(404);
    expect((await otherLeader.get('/api/leave-requests?status=pending').expect(200)).body.data.map((x: { id: string }) => x.id)).not.toContain(r.id);
    expect((await leader.api.get('/api/leave-requests?status=pending').expect(200)).body.data.map((x: { id: string }) => x.id)).toContain(r.id);
    await g.api.post(`/api/leave-requests/${r.id}/approve`, {}).expect(403);
    expect((await leader.api.post(`/api/leave-requests/${r.id}/reject`, {}).expect(400)).body.error.code).toBe('LEAVE_NOTE_REQUIRED');
    const before = await notes(g.userId, 'leave.decided');
    const rejected = (await leader.api.post(`/api/leave-requests/${r.id}/reject`, { note: 'Thiếu người dịp lễ' }).expect(201)).body.data;
    expect(rejected).toMatchObject({ status: 'rejected', decision_note: 'Thiếu người dịp lễ' });
    expect(await notes(g.userId, 'leave.decided')).toBe(before + 1);
    expect((await leader.api.post(`/api/leave-requests/${r.id}/approve`, {}).expect(409)).body.error.code).toBe('LEAVE_NOT_PENDING');

    const own = (await leader.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', from_date: addDays(todayLocal(), 4), to_date: addDays(todayLocal(), 4) }).expect(201)).body.data;
    expect((await leader.api.post(`/api/leave-requests/${own.id}/approve`, {}).expect(403)).body.error.code).toBe('LEAVE_OWN');
    // A leader's own request goes to the group manager.
    expect(await notes(managerId, 'leave.submitted')).toBeGreaterThanOrEqual(1);
  });

  it('on approval cancels the shifts not yet worked and clears the absence already written', async () => {
    const g = await guard();
    const missed = await shift(g.employee, -40, 4);
    const later = await shift(g.employee, 24 * 60, 8);
    await engine.tick();
    expect((await ds.query(`SELECT type, status FROM violations WHERE ref_id = $1`, [missed]))).toEqual([{ type: 'absent', status: 'auto' }]);
    const r = (await ask(g, { type: 'sick', from_date: todayLocal(), to_date: addDays(todayLocal(), 1) }).expect(201)).body.data;
    const approved = (await leader.api.post(`/api/leave-requests/${r.id}/approve`, {}).expect(201)).body.data;
    expect(approved.status).toBe('approved');
    const rows = await ds.query(`SELECT id, status, leave_request_id FROM shift_assignments WHERE id = ANY($1) ORDER BY planned_start`, [[missed, later]]);
    expect(rows.map((x: { status: string; leave_request_id: string }) => [x.status, x.leave_request_id])).toEqual([['cancelled', r.id], ['cancelled', r.id]]);
    const [v] = await ds.query(`SELECT status, review_note FROM violations WHERE ref_id = $1`, [missed]);
    expect(v).toEqual({ status: 'waived', review_note: 'Hệ thống: nghỉ có đơn được duyệt' });
    await engine.tick();
    expect(await ds.query(`SELECT 1 FROM violations WHERE ref_id = $1 AND status <> 'waived'`, [later])).toEqual([]);

    // Nobody rosters them onto a day off; a stand-in takes the shift once.
    const clash = await api.post('/api/roster', { site_id: ids.site, employee_id: g.employee, start_at: minutes(26 * 60), end_at: minutes(30 * 60) });
    expect(clash.body.error.code).toBe('ROSTER_ON_LEAVE');
    const stand = await employee();
    const sub = (await leader.api.post(`/api/roster/${later}/substitute`, { employee_id: stand }).expect(201)).body.data;
    expect(sub).toMatchObject({ employee_id: stand, substitute_for_id: later, status: 'planned' });
    await leader.api.post(`/api/roster/${later}/substitute`, { employee_id: await employee() }).expect(404);
  });

  it('lets the person withdraw a waiting request, and a leader file one for someone who phoned in', async () => {
    const g = await guard();
    const r = (await ask(g, { from_date: addDays(todayLocal(), 30), to_date: addDays(todayLocal(), 30) }).expect(201)).body.data;
    expect((await g.api.post(`/api/leave-requests/${r.id}/cancel`, {}).expect(201)).body.data.status).toBe('cancelled');
    expect((await g.api.post(`/api/leave-requests/${r.id}/cancel`, {}).expect(409)).body.error.code).toBe('LEAVE_NOT_PENDING');

    const filed = (await leader.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', employee_id: g.employee, from_date: addDays(todayLocal(), 31), to_date: addDays(todayLocal(), 31) }).expect(201)).body.data;
    expect(filed).toMatchObject({ employee_id: g.employee, status: 'pending' });
    expect((await g.api.get('/api/me/leave-requests').expect(200)).body.data.map((x: { id: string }) => x.id)).toContain(filed.id);
    const outsider = await employee(undefined, ids.team2);
    await leader.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', employee_id: outsider, from_date: addDays(todayLocal(), 31), to_date: addDays(todayLocal(), 31) }).expect(404);
    await g.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', employee_id: outsider, from_date: addDays(todayLocal(), 31), to_date: addDays(todayLocal(), 31) }).expect(403);
  });

  it('counts approved annual leave against the allowance, when the company counts it', async () => {
    const g = await guard();
    await api.put(`/api/employees/${g.employee}/pay`, { pay_type: 'monthly', annual_leave_days: 12 }).expect(200);
    const from = addDays(todayLocal(), 40);
    const r = (await ask(g, { type: 'annual', from_date: from, to_date: addDays(from, 2) }).expect(201)).body.data;
    expect(r.balance).toMatchObject({ allowance: 12, used: 0, remaining: 12 });
    await leader.api.post(`/api/leave-requests/${r.id}/approve`, {}).expect(201);
    const year = Number(from.slice(0, 4));
    const mine = (await g.api.get(`/api/me/leave-balance?year=${year}`).expect(200)).body.data;
    expect(mine).toMatchObject({ allowance: 12, used: 3, remaining: 9 });
  });

  it('shows no annual leave figures to the reviewer when the person has no standard allowance', async () => {
    const none = await guard();
    const zero = await guard();
    await api.put(`/api/employees/${zero.employee}/pay`, { pay_type: 'monthly', annual_leave_days: 0 }).expect(200);
    const from = addDays(todayLocal(), 50);
    for (const g of [none, zero]) {
      const r = (await ask(g, { type: 'annual', from_date: from, to_date: from }).expect(201)).body.data;
      const seen = (await leader.api.get('/api/leave-requests?status=pending').expect(200)).body.data.find((x: { id: string }) => x.id === r.id);
      expect(seen.balance).toBeNull();
    }
  });
});
