import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, login, uniquePhone } from './helpers';

describe('Users (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let roles: Record<string, string>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'usr');
    api = client(app, admin.token);
    const list = (await api.get('/api/roles').expect(200)).body.data as { id: string; code: string }[];
    roles = Object.fromEntries(list.map((r) => [r.code, r.id]));
  });
  afterAll(async () => app.close());

  const tid = () => admin.tenant.id;
  const newEmployee = async (code: string) =>
    (await api.post('/api/employees', { code, full_name: `Bảo vệ ${code}` }).expect(201)).body.data;
  const userBody = (extra: object = {}) => ({
    user_type: 'staff', full_name: 'Người mới', phone: uniquePhone(), password: 'Passw0rd!', role_ids: [], scopes: [], ...extra,
  });

  it('lets HR open a guard account that must change its password', async () => {
    const hr = await createUserWithRoles(app, tid(), ['hr']);
    const team = (await api.post('/api/org/teams', { name: 'Đội U' }).expect(201)).body.data;
    const emp = await newEmployee('U-1');
    const res = await client(app, hr.token)
      .post('/api/users', {
        user_type: 'guard', full_name: 'Bảo vệ U1', phone: '0911 222 333', password: 'Guard@1234',
        employee_id: emp.id, role_ids: [roles.guard], scopes: [{ scope_type: 'team', scope_id: team.id }],
      })
      .expect(201);
    expect(res.body.data).toMatchObject({ phone: '0911222333', user_type: 'guard', employee_id: emp.id, must_change_password: true });
    expect(res.body.data.roles.map((r: { code: string }) => r.code)).toEqual(['guard']);
    expect(res.body.data.scopes).toEqual([{ scope_type: 'team', scope_id: team.id }]);

    const token = await login(app, '0911222333', 'Guard@1234');
    expect((await client(app, token).get('/api/auth/me').expect(200)).body.data.user.must_change_password).toBe(true);
  });

  it('stops HR from handing out the admin role or touching the admin account', async () => {
    const hr = await createUserWithRoles(app, tid(), ['hr']);
    const asHr = client(app, hr.token);
    const esc = await asHr.post('/api/users', userBody({ role_ids: [roles.admin], scopes: [{ scope_type: 'tenant' }] })).expect(403);
    expect(esc.body.error.code).toBe('ROLE_ESCALATION');
    await asHr.post(`/api/users/${admin.adminUserId}/reset-password`, { new_password: 'Hacked@123' }).expect(403);
    await asHr.patch(`/api/users/${admin.adminUserId}`, { status: 'locked' }).expect(403);
  });

  it('stops a team-scoped user from granting company-wide scope', async () => {
    const team = (await api.post('/api/org/teams', { name: 'Đội hẹp' }).expect(201)).body.data;
    const narrowHr = await createUserWithRoles(app, tid(), ['hr'], [{ scope_type: 'team', scope_id: team.id }]);
    const res = await client(app, narrowHr.token).post('/api/users', userBody({ scopes: [{ scope_type: 'tenant' }] })).expect(403);
    expect(res.body.error.code).toBe('ROLE_ESCALATION');
  });

  it("resetting a password ends that user's sessions and forces a change", async () => {
    const guard = await createUserWithRoles(app, tid(), ['guard'], [], { user_type: 'guard' });
    await api.post(`/api/users/${guard.user.id}/reset-password`, { new_password: 'Reset@1234' }).expect(200);
    await client(app, guard.token).get('/api/auth/me').expect(401);
    const fresh = await login(app, guard.phone, 'Reset@1234');
    expect((await client(app, fresh).get('/api/auth/me').expect(200)).body.data.user.must_change_password).toBe(true);
  });

  it('locking a user takes effect on their very next request', async () => {
    const guard = await createUserWithRoles(app, tid(), ['guard'], [], { user_type: 'guard' });
    await api.patch(`/api/users/${guard.user.id}`, { status: 'locked' }).expect(200);
    await client(app, guard.token).get('/api/auth/me').expect(401);
  });

  it('keeps at least one admin in the company and refuses self-locking', async () => {
    const last = await api.patch(`/api/users/${admin.adminUserId}`, { role_ids: [roles.manager] }).expect(400);
    expect(last.body.error.code).toBe('LAST_ADMIN');
    const self = await api.patch(`/api/users/${admin.adminUserId}`, { status: 'locked' }).expect(400);
    expect(self.body.error.code).toBe('USER_CANNOT_LOCK_SELF');

    const second = await createUserWithRoles(app, tid(), ['admin']);
    await client(app, second.token).patch(`/api/users/${second.user.id}`, { role_ids: [roles.manager] }).expect(200);
  });

  it('refuses a phone already used in any company, in any format, and an employee already linked', async () => {
    const other = await createTenantWithAdmin(app, 'usr-other');
    const dup = await api.post('/api/users', userBody({ phone: other.phone.replace(/^0/, '+84') })).expect(409);
    expect(dup.body.error.code).toBe('USER_IDENTIFIER_TAKEN');

    const emp = await newEmployee('U-DUP');
    await api.post('/api/users', userBody({ user_type: 'guard', employee_id: emp.id })).expect(201);
    const taken = await api.post('/api/users', userBody({ user_type: 'guard', employee_id: emp.id })).expect(409);
    expect(taken.body.error.code).toBe('USER_EMPLOYEE_TAKEN');
  });

  it('will not leave an account with neither phone nor email', async () => {
    const guard = await createUserWithRoles(app, tid(), ['guard'], [], { user_type: 'guard' });
    const res = await api.patch(`/api/users/${guard.user.id}`, { phone: null }).expect(400);
    expect(res.body.error.code).toBe('USER_IDENTIFIER_REQUIRED');
  });

  it('lists users with their roles and never their password hash', async () => {
    const res = await api.get('/api/users').expect(200);
    const me = res.body.data.find((u: { id: string }) => u.id === admin.adminUserId);
    expect(me.roles.map((r: { code: string }) => r.code)).toContain('admin');
    expect(me).not.toHaveProperty('password_hash');
  });
  it('keeps a scoped account manager away from accounts outside their teams', async () => {
    const t1 = (await api.post('/api/org/teams', { name: 'Đội S1' }).expect(201)).body.data;
    const t2 = (await api.post('/api/org/teams', { name: 'Đội S2' }).expect(201)).body.data;
    await api.post('/api/roles', {
      code: 'scoped_admin', name: 'Quản lý tài khoản đội',
      permissions: ['user.view', 'user.manage', 'org.view', 'org.member.manage', 'employee.view', 'client.view', 'deployment.view', 'site.view', 'site.manage', 'roster.view', 'roster.manage', 'attendance.view',
        'incident.view', 'incident.report', 'incident.manage', 'incident.close', 'patrol.view', 'violation.view', 'violation.propose', 'violation.review', 'logbook.view', 'logbook.manage', 'handover.review',
        'leave.review', 'attendance.correct.propose', 'attendance.correct.review', 'contact.view.staff', 'contact.view.leader', 'contact.view.guard', 'contact.manage'],
    }).expect(201);
    const actor = await createUserWithRoles(app, tid(), ['scoped_admin'], [{ scope_type: 'team', scope_id: t1.id }]);
    const outside = await createUserWithRoles(app, tid(), ['manager'], [{ scope_type: 'team', scope_id: t2.id }]);
    const inside = await createUserWithRoles(app, tid(), ['manager'], [{ scope_type: 'team', scope_id: t1.id }]);
    const asActor = client(app, actor.token);

    const reset = await asActor.post(`/api/users/${outside.user.id}/reset-password`, { new_password: 'Taken@1234' }).expect(403);
    expect(reset.body.error.code).toBe('ROLE_ESCALATION');
    await asActor.patch(`/api/users/${outside.user.id}`, { scopes: [] }).expect(403);
    await asActor.post(`/api/users/${inside.user.id}/reset-password`, { new_password: 'Fine@12345' }).expect(200);
  });
});
