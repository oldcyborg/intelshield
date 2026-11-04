import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Violations — proposing and reviewing (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let leader: ReturnType<typeof client>;
  let otherLeader: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;
  let guard: ReturnType<typeof client>;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'vrv');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội 1' }).expect(201)).body.data.id;
    ids.team2 = (await api.post('/api/org/teams', { name: 'Đội 2' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    const lead = await employee(ids.team);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).token);
    const lead2 = await employee(ids.team2, false);
    await api.put(`/api/org/teams/${ids.team2}/leader`, { employee_id: lead2 }).expect(200);
    otherLeader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead2 })).token);
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    ids.guard = await employee(ids.team);
    guard = client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: ids.guard })).token);
    ids.lead = lead;
  });
  afterAll(async () => app.close());

  /** `posted` false: in the team but not deployed to this client, so the client stays out of their sight. */
  async function employee(team: string, posted = true) {
    const e = (await api.post('/api/employees', { code: `RV${++seq}`, full_name: `NV ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e }).expect(201);
    if (posted) await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    return e;
  }
  async function violation(employeeId: string, type = 'absent') {
    const [row] = await ds.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at)
       VALUES ($1, $2, $3, $4, 'assignment', gen_random_uuid(), now()) RETURNING id`,
      [admin.tenant.id, employeeId, ids.site, type],
    );
    return row.id as string;
  }

  it('goes from leader proposal to manager decision', async () => {
    const id = await violation(ids.guard);
    expect((await leader.post(`/api/violations/${id}/propose`, { decision: 'waive' }).expect(400)).body.error.code).toBe('VIOLATION_NOTE_REQUIRED');
    const proposed = (await leader.post(`/api/violations/${id}/propose`, { decision: 'waive', note: 'Xe hỏng giữa đường, có báo trước' }).expect(201)).body.data;
    expect(proposed).toMatchObject({ status: 'proposed_waive', proposed_note: 'Xe hỏng giữa đường, có báo trước' });
    await leader.post(`/api/violations/${id}/review`, { decision: 'confirm' }).expect(403);
    const done = (await manager.post(`/api/violations/${id}/review`, { decision: 'confirm', note: 'Không báo trước' }).expect(201)).body.data;
    expect(done).toMatchObject({ status: 'confirmed', review_note: 'Không báo trước' });
    expect(done.proposed_by_name).toBeTruthy();
    expect(done.reviewed_by_name).toBeTruthy();
    expect((await leader.post(`/api/violations/${id}/propose`, { decision: 'confirm' }).expect(409)).body.error.code).toBe('VIOLATION_ALREADY_REVIEWED');
    await manager.post(`/api/violations/${id}/review`, { decision: 'waive' }).expect(400);
    expect((await manager.post(`/api/violations/${id}/review`, { decision: 'waive', note: 'Có giấy xác nhận' }).expect(201)).body.data.status).toBe('waived');
  });

  it('never lets anyone judge their own violation', async () => {
    const own = await violation(ids.lead);
    expect((await leader.post(`/api/violations/${own}/propose`, { decision: 'waive', note: 'x' }).expect(403)).body.error.code).toBe('VIOLATION_OWN');
    await manager.post(`/api/violations/${own}/review`, { decision: 'confirm' }).expect(201);
  });

  it('shows each person what is theirs to see', async () => {
    const id = await violation(ids.guard, 'late_check_in');
    const open = (await leader.get('/api/violations?status=open').expect(200)).body.data.map((v: { id: string }) => v.id);
    expect(open).toContain(id);
    expect((await otherLeader.get('/api/violations').expect(200)).body.data.map((v: { id: string }) => v.id)).not.toContain(id);
    await otherLeader.post(`/api/violations/${id}/propose`, { decision: 'confirm' }).expect(404);
    const mine = (await guard.get('/api/me/violations').expect(200)).body.data;
    expect(mine.map((v: { id: string }) => v.id)).toContain(id);
    expect(mine.every((v: { employee_id: string }) => v.employee_id === ids.guard)).toBe(true);
    await guard.get('/api/violations').expect(403);
    const summary = (await manager.get('/api/violations/summary').expect(200)).body.data;
    expect(summary.auto).toBeGreaterThanOrEqual(1);
    expect(Object.keys(summary).sort()).toEqual(['auto', 'confirmed_30d', 'proposed_confirm', 'proposed_waive', 'waived_30d']);
  });
});
