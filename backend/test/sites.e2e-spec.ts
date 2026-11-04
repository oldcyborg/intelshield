import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Sites (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'site');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newClient = async (extra: object = {}) =>
    (await api.post('/api/clients', { code: `SK${++seq}`, name: `Khách ${seq}`, ...extra }).expect(201)).body.data;
  const newSite = async (clientId: string, extra: object = {}) =>
    (await api.post('/api/sites', { client_id: clientId, code: `MT${++seq}`, name: `Mục tiêu ${seq}`, ...extra }).expect(201)).body.data;

  it('gives every system role of existing companies the new permissions', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'site.%' ORDER BY r.code, rp.permission`,
      [admin.tenant.id],
    );
    expect(rows.filter((r) => r.code === 'manager').map((r) => r.permission)).toEqual(['site.manage', 'site.view']);
    expect(rows.filter((r) => r.code === 'team_leader').map((r) => r.permission)).toEqual(['site.view']);
    expect(rows.filter((r) => r.code === 'guard')).toEqual([]);
  });

  it('creates a site with coordinates, a geofence and posts', async () => {
    const c = await newClient();
    const site = await newSite(c.id, { address: '1 Mễ Trì', lat: 21.012345, lng: 105.78, geofence_radius_m: 200 });
    expect(site).toMatchObject({ client_name: c.name, lat: '21.012345', lng: '105.780000', geofence_radius_m: 200, posts: [] });
    await api.post(`/api/sites/${site.id}/posts`, { name: 'Cổng chính' }).expect(201);
    const post = (await api.post(`/api/sites/${site.id}/posts`, { name: 'Cổng sau' }).expect(201)).body.data;
    await api.delete(`/api/posts/${post.id}`).expect(200);
    const detail = (await api.get(`/api/sites/${site.id}`).expect(200)).body.data;
    expect(detail.posts.map((p: { name: string }) => p.name)).toEqual(['Cổng chính']);
    expect((await api.post('/api/sites', { client_id: c.id, code: site.code.toLowerCase(), name: 'Trùng' }).expect(409)).body.error.code).toBe('SITE_CODE_TAKEN');
  });

  it('refuses sites for clients who run their own operations', async () => {
    const c = await newClient({ management_mode: 'self_managed' });
    const res = await api.post('/api/sites', { client_id: c.id, code: 'SELF', name: 'X' }).expect(400);
    expect(res.body.error.code).toBe('SITE_CLIENT_SELF_MANAGED');
  });

  it('shows a team leader the sites their team looks after, read-only', async () => {
    const team = (await api.post('/api/org/teams', { name: `Đội ${++seq}` }).expect(201)).body.data;
    const lead = (await api.post('/api/employees', { code: `L${++seq}`, full_name: 'Đội trưởng' }).expect(201)).body.data;
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: lead.id }).expect(201);
    await api.put(`/api/org/teams/${team.id}/leader`, { employee_id: lead.id }).expect(200);
    const c = await newClient();
    const mine = await newSite(c.id, { responsible_team_id: team.id });
    const other = await newSite(c.id);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    const asLeader = client(app, leader.token);

    const list = (await asLeader.get('/api/sites').expect(200)).body.data;
    expect(list.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    expect(list[0].responsible_team_name).toBe(team.name);
    await asLeader.get(`/api/sites/${other.id}`).expect(404);
    await asLeader.patch(`/api/sites/${mine.id}`, { name: 'Đổi' }).expect(403);
  });

  it('lets an account manager configure only the sites of their clients', async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const theirs = await newClient({ account_manager_id: manager.user.id });
    const notTheirs = await newClient();
    const asManager = client(app, manager.token);
    const site = (await asManager.post('/api/sites', { client_id: theirs.id, code: `AM${++seq}`, name: 'Của tôi' }).expect(201)).body.data;
    await asManager.patch(`/api/sites/${site.id}`, { geofence_radius_m: 120 }).expect(200);
    await asManager.post('/api/sites', { client_id: notTheirs.id, code: `NO${++seq}`, name: 'Không' }).expect(404);
  });

  it('refuses a responsible team from outside the company and out-of-range values', async () => {
    const c = await newClient();
    await api.post('/api/sites', { client_id: c.id, code: `BAD${++seq}`, name: 'X', responsible_team_id: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await api.post('/api/sites', { client_id: c.id, code: `BAD${++seq}`, name: 'X', lat: 95, lng: 105 }).expect(400);
    await api.post('/api/sites', { client_id: c.id, code: `BAD${++seq}`, name: 'X', geofence_radius_m: 5 }).expect(400);
  });
});
