import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Clients (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'cli');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newClient = async (code: string, extra: object = {}) =>
    (await api.post('/api/clients', { code, name: `Khách ${code}`, ...extra }).expect(201)).body.data;

  it('creates a client with contact details and an account manager', async () => {
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant']);
    const res = await api
      .post('/api/clients', {
        code: 'CT1', name: 'Toà nhà CT1', management_mode: 'self_managed', tax_code: '0101234567',
        contact_name: 'Chị Lan', contact_phone: '+84 912 000 111', account_manager_id: accountant.user.id,
      })
      .expect(201);
    expect(res.body.data).toMatchObject({
      code: 'CT1', management_mode: 'self_managed', contact_phone: '0912000111',
      account_manager_id: accountant.user.id, guards_today: 0, active_contracts: 0,
    });
    const dup = await api.post('/api/clients', { code: 'ct1', name: 'Trùng' }).expect(409);
    expect(dup.body.error.code).toBe('CLIENT_CODE_TAKEN');
  });

  it('updates a client and can mark it inactive', async () => {
    const c = await newClient('UPD');
    const res = await api.patch(`/api/clients/${c.id}`, { name: 'Đổi tên', status: 'inactive' }).expect(200);
    expect(res.body.data).toMatchObject({ name: 'Đổi tên', status: 'inactive' });
  });

  it('shows a client-scoped user only that client, and only company-wide users write', async () => {
    const mine = await newClient('MINE');
    const other = await newClient('OTHER');
    const scoped = await createUserWithRoles(app, admin.tenant.id, ['accountant'], [{ scope_type: 'client', scope_id: mine.id }]);
    const asScoped = client(app, scoped.token);
    const list = (await asScoped.get('/api/clients').expect(200)).body.data;
    expect(list.map((c: { id: string }) => c.id)).toEqual([mine.id]);
    await asScoped.get(`/api/clients/${other.id}`).expect(404);
    await asScoped.patch(`/api/clients/${mine.id}`, { name: 'X' }).expect(403);
  });

  it('lets an account manager see the clients they look after', async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const c = await newClient('AM', { account_manager_id: manager.user.id });
    const list = (await client(app, manager.token).get('/api/clients').expect(200)).body.data;
    expect(list.map((x: { id: string }) => x.id)).toEqual([c.id]);
  });

  it('refuses an account manager who is not an active office user of the company', async () => {
    const guard = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    await api.post('/api/clients', { code: 'BADAM', name: 'X', account_manager_id: guard.user.id }).expect(404);
  });
});
