import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

type Api = ReturnType<typeof client>;

/**
 * Two buildings of one client, each run by its own team. A leader sees both (their people work for that client)
 * but decides only for their own team's people.
 */
describe('Who decides on a guard’s records (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: Api;
  let leaderB: Api;
  let manager: Api;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'jdg');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'JC', name: 'Khu đô thị' }).expect(201)).body.data.id;
    ids.teamA = (await api.post('/api/org/teams', { name: 'Đội A' }).expect(201)).body.data.id;
    ids.teamB = (await api.post('/api/org/teams', { name: 'Đội B' }).expect(201)).body.data.id;
    ids.siteA = (await api.post('/api/sites', { client_id: ids.client, code: 'JA', name: 'Toà A', responsible_team_id: ids.teamA }).expect(201)).body.data.id;
    ids.siteB = (await api.post('/api/sites', { client_id: ids.client, code: 'JB', name: 'Toà B', responsible_team_id: ids.teamB }).expect(201)).body.data.id;
    const leaderEmployee = await member(ids.teamB);
    await api.put(`/api/org/teams/${ids.teamB}/leader`, { employee_id: leaderEmployee }).expect(200);
    leaderB = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: leaderEmployee })).token);
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    ids.guardA = await member(ids.teamA);
    ids.guardB = await member(ids.teamB);
    ids.violA = await lateAt(ids.siteA, ids.guardA, 1);
    ids.violB = await lateAt(ids.siteB, ids.guardB, 2);
    ids.corrA = await correction(ids.siteA, ids.guardA, 3);
    ids.corrB = await correction(ids.siteB, ids.guardB, 4);
  });
  afterAll(async () => app.close());

  async function member(team: string) {
    const e = (await api.post('/api/employees', { code: `J${Math.random().toString(36).slice(2, 7)}`, full_name: 'Bảo vệ' }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -10) }).expect(201);
    return e as string;
  }

  /** A shift of `daysAgo` days ago, straight into the tables. */
  async function past(siteId: string, employeeId: string, daysAgo: number) {
    const day = addDays(todayLocal(), -daysAgo);
    const [a] = await ds.query(
      `INSERT INTO shift_assignments (tenant_id, site_id, employee_id, shift_date, planned_start, planned_end)
       VALUES ($1, $2, $3, $4, ($4::date + time '06:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', ($4::date + time '18:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') RETURNING id, planned_start`,
      [admin.tenant.id, siteId, employeeId, day],
    );
    return a as { id: string; planned_start: Date };
  }

  async function lateAt(siteId: string, employeeId: string, daysAgo: number) {
    const a = await past(siteId, employeeId, daysAgo);
    const [v] = await ds.query(
      `INSERT INTO violations (tenant_id, site_id, employee_id, type, ref_type, ref_id, occurred_at, minutes) VALUES ($1, $2, $3, 'late_check_in', 'assignment', $4, $5, 20) RETURNING id`,
      [admin.tenant.id, siteId, employeeId, a.id, a.planned_start],
    );
    return v.id as string;
  }

  async function correction(siteId: string, employeeId: string, daysAgo: number) {
    const a = await past(siteId, employeeId, daysAgo);
    const [c] = await ds.query(
      `INSERT INTO attendance_corrections (tenant_id, assignment_id, employee_id, site_id, check_in_at, reason_code, created_by, client_uuid)
       VALUES ($1, $2, $3, $4, $5, 'forgot', $6, gen_random_uuid()) RETURNING id`,
      [admin.tenant.id, a.id, employeeId, siteId, a.planned_start, admin.adminUserId],
    );
    return c.id as string;
  }

  it('lets a leader see the other building but decide only for their own team', async () => {
    const viols = (await leaderB.get('/api/violations?status=open').expect(200)).body.data;
    expect(viols.find((v: { id: string }) => v.id === ids.violA)).toMatchObject({ can_judge: false });
    expect(viols.find((v: { id: string }) => v.id === ids.violB)).toMatchObject({ can_judge: true });
    await leaderB.post(`/api/violations/${ids.violA}/propose`, { decision: 'waive', note: 'x' }).expect(403);
    await leaderB.post(`/api/violations/${ids.violB}/propose`, { decision: 'waive', note: 'Kẹt xe' }).expect(201);

    const corrs = (await leaderB.get('/api/attendance-corrections?status=open').expect(200)).body.data;
    expect(corrs.find((c: { id: string }) => c.id === ids.corrA)).toMatchObject({ can_judge: false });
    await leaderB.post(`/api/attendance-corrections/${ids.corrA}/propose`, { decision: 'approve' }).expect(403);
    await leaderB.post(`/api/attendance-corrections/${ids.corrB}/propose`, { decision: 'approve' }).expect(201);
  });

  it('lets a company-wide manager decide for anyone', async () => {
    const viols = (await manager.get('/api/violations?status=open').expect(200)).body.data;
    expect(viols.every((v: { can_judge: boolean }) => v.can_judge)).toBe(true);
    await manager.post(`/api/violations/${ids.violA}/review`, { decision: 'confirm' }).expect(201);
  });
});
