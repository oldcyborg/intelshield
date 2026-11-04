import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

describe('Devices (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'dev');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  it("binds a guard's first phone, holds a second one for approval, and swaps on approval", async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const first = await loginOnDevice(app, g.phone, g.password, 'phone-A-0001');
    expect(first.status).toBe(200);

    const second = await loginOnDevice(app, g.phone, g.password, 'phone-B-0002');
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe('DEVICE_PENDING');

    const pending = (await api.get('/api/devices?status=pending').expect(200)).body.data;
    const request = pending.find((d: { user_id: string }) => d.user_id === g.user.id);
    expect(request).toMatchObject({ device_id: 'phone-B-0002', platform: 'android', status: 'pending' });

    await api.post(`/api/devices/${request.id}/approve`).expect(201);
    await client(app, first.token!).get('/api/auth/me').expect(401); // the old phone is signed out
    expect((await loginOnDevice(app, g.phone, g.password, 'phone-B-0002')).status).toBe(200);
    expect((await loginOnDevice(app, g.phone, g.password, 'phone-A-0001')).body.error.code).toBe('DEVICE_REVOKED');
  });

  it('lets office staff use several devices freely', async () => {
    const hr = await createUserWithRoles(app, admin.tenant.id, ['hr']);
    expect((await loginOnDevice(app, hr.phone, hr.password, 'laptop-0001')).status).toBe(200);
    expect((await loginOnDevice(app, hr.phone, hr.password, 'phone-0002')).status).toBe(200);
  });

  it('revoking a phone ends its sessions', async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const on = await loginOnDevice(app, g.phone, g.password, 'phone-R-0001');
    const list = (await api.get('/api/devices').expect(200)).body.data;
    const device = list.find((d: { user_id: string }) => d.user_id === g.user.id);
    await api.post(`/api/devices/${device.id}/revoke`).expect(201);
    await client(app, on.token!).get('/api/auth/me').expect(401);
  });

  it('reports the active device on /me and keeps device approval for HR and the director', async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const on = await loginOnDevice(app, g.phone, g.password, 'phone-M-0001');
    const me = (await client(app, on.token!).get('/api/auth/me').expect(200)).body.data;
    expect(me.device).toMatchObject({ device_id: 'phone-M-0001', status: 'active' });
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).get('/api/devices').expect(403);
  });
});
