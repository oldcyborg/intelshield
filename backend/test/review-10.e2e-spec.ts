import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const plus = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 60_000).toISOString();

describe('Plan 10 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let engine: ViolationsEngine;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let leader: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    admin = await createTenantWithAdmin(app, 'r10');
    api = client(app, admin.token);
    const m = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    manager = client(app, m.token);
    ids.group = (await api.post('/api/org/groups', { name: 'N', manager_user_id: m.user.id }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đ', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.team2 = (await api.post('/api/org/teams', { name: 'Đ2' }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'K', name: 'K' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'S', name: 'S', responsible_team_id: ids.team }).expect(201)).body.data.id;
    const lead = await employee('L');
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).token);
  });
  afterAll(async () => app.close());

  async function employee(code = `G${++seq}`, team = ids.team) {
    const id = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: id }).expect(201);
    await api.post('/api/deployments', { employee_id: id, client_id: ids.client, start_date: addDays(todayLocal(), -10) }).expect(201);
    return id;
  }
  async function guard(team = ids.team) {
    const id = await employee(undefined, team);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: id });
    return { employee: id, token: u.token, api: client(app, u.token) };
  }
  async function shift(employeeId: string, startIn: number, hours: number) {
    const s = (await api.post('/api/roster', { site_id: ids.site, employee_id: employeeId, start_at: minutes(startIn), end_at: minutes(startIn + hours * 60) }).expect(201)).body.data;
    await ds.query(`UPDATE shift_assignments SET created_at = planned_start - interval '1 day' WHERE id = $1`, [s.id]);
    return s as { id: string; planned_start: string; planned_end: string };
  }
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'a.jpg').expect(201)).body.data.id as string;
  const violations = (assignment: string) => ds.query(`SELECT type, minutes, status FROM violations WHERE ref_id = $1 ORDER BY type`, [assignment]);

  it('brings lateness back when a later correction shows the guard was late after all', async () => {
    const g = await guard();
    const s = await shift(g.employee, -9 * 60, 6);
    await engine.tick();
    const first = (await g.api.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'phone_dead', assignment_id: s.id, check_in_at: s.planned_start, check_out_at: s.planned_end }).expect(201)).body.data;
    await manager.post(`/api/attendance-corrections/${first.id}/review`, { decision: 'approve' }).expect(201);
    expect(await violations(s.id)).toEqual([{ type: 'absent', minutes: null, status: 'waived' }]);
    await manager.post('/api/attendance-corrections', {
      client_uuid: randomUUID(), reason_code: 'other', reason: 'Camera cho thấy vào lúc +60, về sớm 45 phút', assignment_id: s.id,
      check_in_at: plus(s.planned_start, 60), check_out_at: plus(s.planned_end, -45),
    }).expect(201);
    expect(await violations(s.id)).toEqual([
      { type: 'early_check_out', minutes: 45, status: 'auto' },
      { type: 'late_check_in', minutes: 60, status: 'auto' },
    ]);
    await engine.tick();
    expect(await violations(s.id)).toHaveLength(2);
  });

  it('clears the absence of a shift already handed to a stand-in when leave is approved afterwards', async () => {
    const g = await guard();
    const s = await shift(g.employee, -40, 6);
    await leader.post(`/api/roster/${s.id}/substitute`, { employee_id: await employee() }).expect(201);
    expect(await violations(s.id)).toEqual([{ type: 'absent', minutes: null, status: 'auto' }]);
    const r = (await g.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', from_date: todayLocal(), to_date: todayLocal() }).expect(201)).body.data;
    await leader.post(`/api/leave-requests/${r.id}/approve`, {}).expect(201);
    expect(await violations(s.id)).toEqual([{ type: 'absent', minutes: null, status: 'waived' }]);
  });

  it('lets the person, their leader and the manager open the photos of requests, and nobody else', async () => {
    const g = await guard();
    const leaveFile = await photo(g.token);
    await g.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', from_date: addDays(todayLocal(), 20), to_date: addDays(todayLocal(), 20), file_ids: [leaveFile] }).expect(201);
    const s = await shift(g.employee, -9 * 60, 6);
    const corrFile = await photo(g.token);
    await g.api.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'phone_dead', assignment_id: s.id, check_in_at: s.planned_start, file_ids: [corrFile] }).expect(201);
    const stranger = await guard(ids.team2);
    for (const f of [leaveFile, corrFile]) {
      await g.api.get(`/api/files/${f}`).expect(200);
      await leader.get(`/api/files/${f}`).expect(200);
      await manager.get(`/api/files/${f}`).expect(200);
      await stranger.api.get(`/api/files/${f}`).expect(404);
    }
  });

  it('withdraws an open correction on a shift that approved leave cancels', async () => {
    const g = await guard();
    const s = await shift(g.employee, -9 * 60, 6);
    const c = (await g.api.post('/api/attendance-corrections', { client_uuid: randomUUID(), reason_code: 'forgot', assignment_id: s.id, check_in_at: s.planned_start }).expect(201)).body.data;
    const r = (await g.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', from_date: todayLocal(), to_date: todayLocal() }).expect(201)).body.data;
    await leader.post(`/api/leave-requests/${r.id}/approve`, {}).expect(201);
    const [row] = await ds.query(`SELECT status FROM attendance_corrections WHERE id = $1`, [c.id]);
    expect(row.status).toBe('cancelled');
  });

  it('refuses a date that does not exist', async () => {
    const g = await guard();
    await g.api.post('/api/leave-requests', { client_uuid: randomUUID(), type: 'sick', from_date: '2026-02-31', to_date: '2026-03-01' }).expect(400);
  });
});
