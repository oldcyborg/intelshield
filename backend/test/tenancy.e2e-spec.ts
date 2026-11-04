import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, uniquePhone } from './helpers';

/** Company A must not be able to read, change or wire in anything of company B. */
describe('Tenant isolation (e2e)', () => {
  let app: NestExpressApplication;
  let a: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let b: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let apiA: ReturnType<typeof client>;
  const B: Record<'employee' | 'group' | 'team' | 'role', string> = { employee: '', group: '', team: '', role: '' };
  let aTeam: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    a = await createTenantWithAdmin(app, 'iso-a');
    b = await createTenantWithAdmin(app, 'iso-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    B.employee = (await apiB.post('/api/employees', { code: 'B-1', full_name: 'Nhân viên B' }).expect(201)).body.data.id;
    B.group = (await apiB.post('/api/org/groups', { name: 'Nhóm B' }).expect(201)).body.data.id;
    B.team = (await apiB.post('/api/org/teams', { name: 'Đội B', team_group_id: B.group }).expect(201)).body.data.id;
    await apiB.post(`/api/org/teams/${B.team}/members`, { employee_id: B.employee }).expect(201);
    B.role = (await apiB.post('/api/roles', { code: 'b_role', name: 'B', permissions: [] }).expect(201)).body.data.id;
    aTeam = (await apiA.post('/api/org/teams', { name: 'Đội A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const newUser = (extra: object) => ({
    user_type: 'staff', full_name: 'X', phone: uniquePhone(), password: 'Passw0rd!', role_ids: [], scopes: [], ...extra,
  });

  it('answers every read or write of a B record with 404', async () => {
    for (const url of [`/api/employees/${B.employee}`, `/api/users/${b.adminUserId}`, `/api/org/teams/${B.team}/members`]) {
      expect((await apiA.get(url).expect(404)).body.error.code).toBe('NOT_FOUND');
    }
    await apiA.patch(`/api/employees/${B.employee}`, { full_name: 'Hack' }).expect(404);
    await apiA.patch(`/api/org/teams/${B.team}`, { name: 'Hack' }).expect(404);
    await apiA.patch(`/api/org/groups/${B.group}`, { name: 'Hack' }).expect(404);
    await apiA.delete(`/api/org/teams/${B.team}`).expect(404);
    await apiA.post(`/api/org/teams/${B.team}/members/${B.employee}/leave`).expect(404);
    await apiA.put(`/api/roles/${B.role}/permissions`, { permissions: [] }).expect(404);
    await apiA.patch(`/api/users/${b.adminUserId}`, { full_name: 'Hack' }).expect(404);
    await apiA.post(`/api/users/${b.adminUserId}/reset-password`, { new_password: 'Hacked@123' }).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post(`/api/org/teams/${aTeam}/members`, { employee_id: B.employee }).expect(404);
    await apiA.post('/api/org/teams', { name: 'X', team_group_id: B.group }).expect(404);
    await apiA.post('/api/org/groups', { name: 'X', manager_user_id: b.adminUserId }).expect(404);
    await apiA.post('/api/users', newUser({ role_ids: [B.role] })).expect(404);
    await apiA.post('/api/users', newUser({ user_type: 'guard', employee_id: B.employee })).expect(404);
    const scope = await apiA.post('/api/users', newUser({ scopes: [{ scope_type: 'team', scope_id: B.team }] })).expect(400);
    expect(scope.body.error.code).toBe('SCOPE_INVALID');
  });

  it("keeps B out of A's lists", async () => {
    const ids = async (url: string): Promise<string[]> =>
      (await apiA.get(url).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(await ids('/api/employees')).not.toContain(B.employee);
    expect(await ids('/api/users')).not.toContain(b.adminUserId);
    expect(await ids('/api/org/teams')).not.toContain(B.team);
    expect(await ids('/api/roles')).not.toContain(B.role);
  });

  it('rejects a tenant_id smuggled into a request body', async () => {
    const res = await apiA.post('/api/employees', { code: 'SMUG', full_name: 'X', tenant_id: b.tenant.id }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
