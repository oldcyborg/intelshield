import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import {
  client, createPlatformAdmin, createTenantWithAdmin, createTestApp, createUserWithRoles, login, uniquePhone,
} from './helpers';

describe('Access control (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  const roleId = async (tenantId: string, code: string): Promise<string> =>
    (await ds.query(`SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`, [tenantId, code]))[0].id;

  it('keeps platform routes for platform admins and tenant routes for tenants', async () => {
    const t = await createTenantWithAdmin(app, 'acc-split');
    const root = await createPlatformAdmin(app);

    expect((await client(app, t.token).get('/api/platform/tenants').expect(403)).body.error.code).toBe('AUTH_FORBIDDEN');
    await client(app, root.token).get('/api/roles').expect(403);
    await client(app, root.token).get('/api/auth/me').expect(200);
  });

  it('lets the platform admin open a company whose admin can sign in at once', async () => {
    const root = await createPlatformAdmin(app);
    const phone = uniquePhone();
    const res = await client(app, root.token)
      .post('/api/platform/tenants', {
        code: 'acc-new',
        name: 'Công ty Mới',
        admin: { full_name: 'GĐ Mới', phone, password: 'Admin@12345' },
      })
      .expect(201);
    expect(res.body.data.tenant.code).toBe('acc-new');

    const token = await login(app, phone, 'Admin@12345');
    const roles = await client(app, token).get('/api/roles').expect(200);
    expect(roles.body.data).toHaveLength(6);
    const list = await client(app, root.token).get('/api/platform/tenants').expect(200);
    expect(list.body.data.map((x: { code: string }) => x.code)).toContain('acc-new');
  });

  it('suspends a company from the platform', async () => {
    const t = await createTenantWithAdmin(app, 'acc-susp');
    const root = await createPlatformAdmin(app);
    await client(app, root.token).patch(`/api/platform/tenants/${t.tenant.id}`, { status: 'suspended' }).expect(200);
    await client(app, t.token).get('/api/auth/me').expect(401);
  });

  it('closes a route to a signed-in user without the permission', async () => {
    const t = await createTenantWithAdmin(app, 'acc-guard');
    const guard = await createUserWithRoles(app, t.tenant.id, ['guard'], [], { user_type: 'guard' });
    expect((await client(app, guard.token).get('/api/roles').expect(403)).body.error.code).toBe('AUTH_FORBIDDEN');
    await client(app, guard.token).get('/api/auth/me').expect(200);
  });

  it('never lets a role editor grant or strip permissions they do not hold', async () => {
    const t = await createTenantWithAdmin(app, 'acc-esc');
    await client(app, t.token)
      .post('/api/roles', { code: 'role_editor', name: 'Biên tập vai trò', permissions: ['role.view', 'role.manage', 'org.view', 'incident.report', 'patrol.perform', 'logbook.write', 'contact.view.guard'] })
      .expect(201);
    const editor = await createUserWithRoles(app, t.tenant.id, ['role_editor']);
    const guardRole = await roleId(t.tenant.id, 'guard');
    const managerRole = await roleId(t.tenant.id, 'manager');

    const ok = await client(app, editor.token).put(`/api/roles/${guardRole}/permissions`, { permissions: ['org.view'] }).expect(200);
    expect(ok.body.data.permissions).toEqual(['org.view']);

    const grant = await client(app, editor.token)
      .put(`/api/roles/${guardRole}/permissions`, { permissions: ['employee.manage'] })
      .expect(403);
    expect(grant.body.error.code).toBe('ROLE_ESCALATION');

    // The manager role holds user.view, which the editor lacks: they may not touch it at all.
    await client(app, editor.token).put(`/api/roles/${managerRole}/permissions`, { permissions: ['org.view'] }).expect(403);

    await client(app, editor.token)
      .post('/api/roles', { code: 'too_strong', name: 'X', permissions: ['user.manage'] })
      .expect(403);
  });

  it('protects the admin role and validates permission codes', async () => {
    const t = await createTenantWithAdmin(app, 'acc-admin');
    const adminRole = await roleId(t.tenant.id, 'admin');
    const locked = await client(app, t.token).put(`/api/roles/${adminRole}/permissions`, { permissions: [] }).expect(400);
    expect(locked.body.error.code).toBe('ROLE_ADMIN_LOCKED');

    const bad = await client(app, t.token)
      .post('/api/roles', { code: 'x_role', name: 'X', permissions: ['foo.bar'] })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');

    await client(app, t.token).post('/api/roles', { code: 'dup_role', name: 'A', permissions: [] }).expect(201);
    const dup = await client(app, t.token).post('/api/roles', { code: 'dup_role', name: 'B', permissions: [] }).expect(409);
    expect(dup.body.error.code).toBe('ROLE_CODE_TAKEN');
  });

  it('lists the permission catalog with Vietnamese labels', async () => {
    const t = await createTenantWithAdmin(app, 'acc-cat');
    const res = await client(app, t.token).get('/api/permissions').expect(200);
    expect(res.body.data).toContainEqual({ code: 'org.manage', label: 'Quản lý nhóm, đội, thành viên' });
  });
});
