import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Organisation (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let tenantId: string;
  let api: ReturnType<typeof client>;
  const today = todayLocal();

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'org');
    tenantId = admin.tenant.id;
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newEmployee = async (code: string) =>
    (await api.post('/api/employees', { code, full_name: `Bảo vệ ${code}` }).expect(201)).body.data;
  const newTeam = async (name: string, team_group_id?: string) =>
    (await api.post('/api/org/teams', team_group_id ? { name, team_group_id } : { name }).expect(201)).body.data;
  const join = (teamId: string, employeeId: string, start_date?: string) =>
    api.post(`/api/org/teams/${teamId}/members`, start_date ? { employee_id: employeeId, start_date } : { employee_id: employeeId });
  const memberIds = async (teamId: string): Promise<string[]> =>
    (await api.get(`/api/org/teams/${teamId}/members`).expect(200)).body.data.map((m: { employee_id: string }) => m.employee_id);
  const history = (employeeId: string) =>
    ds.query(`SELECT team_id, start_date, end_date FROM team_members WHERE employee_id = $1 ORDER BY start_date`, [employeeId]);

  it('refuses duplicate employee codes regardless of case', async () => {
    await newEmployee('BV-001');
    const dup = await api.post('/api/employees', { code: 'bv-001', full_name: 'X' }).expect(409);
    expect(dup.body.error.code).toBe('EMPLOYEE_CODE_TAKEN');
  });

  it('names a leader only from the current members', async () => {
    const team = await newTeam('Đội Leader');
    const a = await newEmployee('L-A');
    const b = await newEmployee('L-B');
    await join(team.id, a.id).expect(201);
    const bad = await api.patch(`/api/org/teams/${team.id}`, { leader_employee_id: b.id }).expect(400);
    expect(bad.body.error.code).toBe('ORG_LEADER_NOT_MEMBER');
    const ok = await api.patch(`/api/org/teams/${team.id}`, { leader_employee_id: a.id }).expect(200);
    expect(ok.body.data.leader_employee_id).toBe(a.id);
    const members = (await api.get(`/api/org/teams/${team.id}/members`).expect(200)).body.data;
    expect(members[0]).toMatchObject({ employee_id: a.id, is_leader: true });
  });

  it('moves a guard between teams: the old stay ends the day before and leadership is dropped', async () => {
    const t1 = await newTeam('Đội 1');
    const t2 = await newTeam('Đội 2');
    const e = await newEmployee('MV-1');
    const monthAgo = addDays(today, -30);
    await join(t1.id, e.id, monthAgo).expect(201);
    await api.patch(`/api/org/teams/${t1.id}`, { leader_employee_id: e.id }).expect(200);

    await join(t2.id, e.id).expect(201);
    expect(await history(e.id)).toEqual([
      { team_id: t1.id, start_date: monthAgo, end_date: addDays(today, -1) },
      { team_id: t2.id, start_date: today, end_date: null },
    ]);
    const [team1] = await ds.query(`SELECT leader_employee_id FROM teams WHERE id = $1`, [t1.id]);
    expect(team1.leader_employee_id).toBeNull();
    expect(await memberIds(t1.id)).not.toContain(e.id);
    expect(await memberIds(t2.id)).toContain(e.id);
    const view = (await api.get(`/api/employees/${e.id}`).expect(200)).body.data;
    expect(view.team).toEqual({ id: t2.id, name: 'Đội 2' });
  });

  it('corrects a same-day mistake instead of leaving a zero-length stay', async () => {
    const wrong = await newTeam('Đội nhầm');
    const right = await newTeam('Đội đúng');
    const e = await newEmployee('SD-1');
    await join(wrong.id, e.id).expect(201);
    await join(right.id, e.id).expect(201);
    expect(await history(e.id)).toEqual([{ team_id: right.id, start_date: today, end_date: null }]);
  });

  it('refuses a transfer that would rewrite later history, and dates in the future', async () => {
    const t1 = await newTeam('Đội X');
    const t2 = await newTeam('Đội Y');
    const e = await newEmployee('CF-1');
    await join(t1.id, e.id).expect(201);
    const conflict = await join(t2.id, e.id, addDays(today, -5)).expect(409);
    expect(conflict.body.error.code).toBe('ORG_MEMBERSHIP_CONFLICT');
    const future = await join(t2.id, e.id, addDays(today, 1)).expect(400);
    expect(future.body.error.code).toBe('ORG_DATE_IN_FUTURE');
  });

  it('takes a guard out of a team, and drops a same-day join entirely', async () => {
    const team = await newTeam('Đội Rời');
    const e = await newEmployee('LV-1');
    const f = await newEmployee('LV-2');
    await join(team.id, e.id, addDays(today, -10)).expect(201);
    await api.post(`/api/org/teams/${team.id}/members/${e.id}/leave`).expect(200);
    expect(await history(e.id)).toEqual([
      { team_id: team.id, start_date: addDays(today, -10), end_date: addDays(today, -1) },
    ]);
    await join(team.id, f.id).expect(201);
    await api.post(`/api/org/teams/${team.id}/members/${f.id}/leave`).expect(200);
    expect(await history(f.id)).toEqual([]);
    expect(await memberIds(team.id)).toEqual([]);
  });

  it('limits a team leader to their team and a group manager to their group', async () => {
    const manager = await createUserWithRoles(app, tenantId, ['manager'], []);
    const group = (await api.post('/api/org/groups', { name: 'Nhóm Bắc', manager_user_id: manager.user.id }).expect(201)).body.data;
    const north1 = await newTeam('Bắc 1', group.id);
    const north2 = await newTeam('Bắc 2', group.id);
    const south = await newTeam('Nam 1');
    const lead = await newEmployee('TL-1');
    const g1 = await newEmployee('TL-2');
    const g2 = await newEmployee('TL-3');
    await join(south.id, lead.id).expect(201);
    await join(south.id, g1.id).expect(201);
    await join(north1.id, g2.id).expect(201);
    await api.patch(`/api/org/teams/${south.id}`, { leader_employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, tenantId, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    const asLeader = client(app, leader.token);

    const leaderTeams = (await asLeader.get('/api/org/teams').expect(200)).body.data;
    expect(leaderTeams.map((t: { id: string }) => t.id)).toEqual([south.id]);
    const leaderStaff = (await asLeader.get('/api/employees').expect(200)).body.data;
    expect(leaderStaff.map((x: { id: string }) => x.id).sort()).toEqual([lead.id, g1.id].sort());
    await asLeader.get(`/api/employees/${g2.id}`).expect(404);
    await asLeader.get(`/api/org/teams/${north1.id}/members`).expect(404);

    const asManager = client(app, manager.token);
    const managerTeams = (await asManager.get('/api/org/teams').expect(200)).body.data;
    expect(managerTeams.map((t: { id: string }) => t.id).sort()).toEqual([north1.id, north2.id].sort());
    const chart = (await asManager.get('/api/org/chart').expect(200)).body.data;
    expect(chart).toHaveLength(1);
    expect(chart[0].group.id).toBe(group.id);
  });

  it('keeps organisation changes for org.manage holders with company-wide scope', async () => {
    const lead = await newEmployee('W-1');
    const team = await newTeam('Đội W');
    await join(team.id, lead.id).expect(201);
    await api.patch(`/api/org/teams/${team.id}`, { leader_employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, tenantId, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    await client(app, leader.token).post('/api/org/teams', { name: 'Đội lậu' }).expect(403);

    // HR limited to one team holds org.manage but not company-wide scope.
    const hr = await createUserWithRoles(app, tenantId, ['hr'], [{ scope_type: 'team', scope_id: team.id }]);
    const res = await client(app, hr.token).post('/api/org/teams', { name: 'Đội lậu 2' }).expect(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    await client(app, hr.token).post('/api/employees', { code: 'HR-X', full_name: 'X' }).expect(403);
  });

  it('will not delete a team with members or a group with teams', async () => {
    const group = (await api.post('/api/org/groups', { name: 'Nhóm Xoá' }).expect(201)).body.data;
    const team = await newTeam('Đội Xoá', group.id);
    const e = await newEmployee('DEL-1');
    await join(team.id, e.id, addDays(today, -3)).expect(201);
    expect((await api.delete(`/api/org/teams/${team.id}`).expect(409)).body.error.code).toBe('ORG_TEAM_NOT_EMPTY');
    expect((await api.delete(`/api/org/groups/${group.id}`).expect(409)).body.error.code).toBe('ORG_GROUP_NOT_EMPTY');
    await api.post(`/api/org/teams/${team.id}/members/${e.id}/leave`).expect(200);
    await api.delete(`/api/org/teams/${team.id}`).expect(200);
    await api.delete(`/api/org/groups/${group.id}`).expect(200);
  });

  it('refuses to put an inactive employee in a team', async () => {
    const e = await newEmployee('IN-1');
    const team = await newTeam('Đội IN');
    await api.patch(`/api/employees/${e.id}`, { status: 'inactive' }).expect(200);
    expect((await join(team.id, e.id).expect(400)).body.error.code).toBe('EMPLOYEE_INACTIVE');
  });
  it('lets a group manager move guards between the teams of their group, and only those', async () => {
    const manager = await createUserWithRoles(app, tenantId, ['manager'], []);
    const group = (await api.post('/api/org/groups', { name: 'Nhóm Đông', manager_user_id: manager.user.id }).expect(201)).body.data;
    const east1 = await newTeam('Đông 1', group.id);
    const east2 = await newTeam('Đông 2', group.id);
    const west = await newTeam('Tây 1');
    const a = await newEmployee('MG-1');
    const b = await newEmployee('MG-2');
    const loose = await newEmployee('MG-3');
    await join(east1.id, a.id, addDays(today, -7)).expect(201);
    await join(west.id, b.id, addDays(today, -7)).expect(201);
    const asManager = client(app, manager.token);

    await asManager.post(`/api/org/teams/${east2.id}/members`, { employee_id: a.id }).expect(201);
    expect(await memberIds(east2.id)).toContain(a.id);

    // Neither pulling someone in from outside the group, nor sending someone out of it.
    await asManager.post(`/api/org/teams/${east1.id}/members`, { employee_id: b.id }).expect(404);
    await asManager.post(`/api/org/teams/${west.id}/members`, { employee_id: a.id }).expect(404);
    // People in no team yet are placed by HR or the director.
    const placed = await asManager.post(`/api/org/teams/${east1.id}/members`, { employee_id: loose.id }).expect(403);
    expect(placed.body.error.code).toBe('AUTH_FORBIDDEN');

    await asManager.put(`/api/org/teams/${east2.id}/leader`, { employee_id: a.id }).expect(200);
    await asManager.put(`/api/org/teams/${west.id}/leader`, { employee_id: b.id }).expect(404);
    await asManager.post(`/api/org/teams/${east2.id}/members/${a.id}/leave`).expect(200);
    await asManager.post('/api/org/teams', { name: 'Đội mới' }).expect(403);
  });
  it('never lets a backdated move rewrite a stay that already ended', async () => {
    const manager = await createUserWithRoles(app, tenantId, ['manager'], []);
    const group = (await api.post('/api/org/groups', { name: 'Nhóm Lùi', manager_user_id: manager.user.id }).expect(201)).body.data;
    const x = await newTeam('Lùi X', group.id);
    const y = await newTeam('Lùi Y', group.id);
    const e = await newEmployee('BD-1');
    await join(x.id, e.id, addDays(today, -60)).expect(201);
    await api.post(`/api/org/teams/${x.id}/members/${e.id}/leave`, { left_on: addDays(today, -10) }).expect(200);
    const asManager = client(app, manager.token);

    await asManager.post(`/api/org/teams/${y.id}/members`, { employee_id: e.id }).expect(403);
    await asManager.post(`/api/org/teams/${y.id}/members`, { employee_id: e.id, start_date: addDays(today, -20) }).expect(403);
    // Even company-wide, a backdated join may not overwrite the recorded departure…
    const res = await join(y.id, e.id, addDays(today, -20)).expect(409);
    expect(res.body.error.code).toBe('ORG_MEMBERSHIP_CONFLICT');
    // …nor claim success for a team the employee already left.
    await join(x.id, e.id, addDays(today, -20)).expect(409);
    // A past stay cannot be shortened after the fact.
    await api.post(`/api/org/teams/${x.id}/members/${e.id}/leave`, { left_on: addDays(today, -30) }).expect(404);
    expect(await history(e.id)).toEqual([
      { team_id: x.id, start_date: addDays(today, -60), end_date: addDays(today, -11) },
    ]);
  });
});
