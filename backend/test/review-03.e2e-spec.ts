import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

/** Regressions found by the Plan 03 final review. */
describe('Plan 03 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'rev3');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newClient = async () => (await api.post('/api/clients', { code: `K${++seq}`, name: `Khách ${seq}` }).expect(201)).body.data;
  const newSite = async (clientId: string, extra: object = {}) =>
    (await api.post('/api/sites', { client_id: clientId, code: `S${++seq}`, name: `MT ${seq}`, ...extra }).expect(201)).body.data;

  it("does not let a team-scoped manager reconfigure a site of a client they cannot see", async () => {
    const mine = (await api.post('/api/org/teams', { name: `Đội ${++seq}` }).expect(201)).body.data;
    const secret = (await api.post('/api/org/teams', { name: `Đội kín ${++seq}` }).expect(201)).body.data;
    const hidden = await newClient();
    const site = await newSite(hidden.id, { responsible_team_id: mine.id });
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], [{ scope_type: 'team', scope_id: mine.id }]);
    const asManager = client(app, manager.token);

    await asManager.get(`/api/sites/${site.id}`).expect(200); // looking after it means seeing it
    await asManager.patch(`/api/sites/${site.id}`, { name: 'hacked', responsible_team_id: secret.id }).expect(404);
    await asManager.post(`/api/sites/${site.id}/checkpoints`, { code: 'X', name: 'X' }).expect(404);
    const [row] = await ds.query(`SELECT name, responsible_team_id FROM sites WHERE id = $1`, [site.id]);
    expect(row).toEqual({ name: site.name, responsible_team_id: mine.id });
  });

  it('refuses a responsible team the account manager cannot see', async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const theirs = (await api.post('/api/clients', { code: `AM${++seq}`, name: 'Của QL', account_manager_id: manager.user.id }).expect(201)).body.data;
    const other = (await api.post('/api/org/teams', { name: `Đội khác ${++seq}` }).expect(201)).body.data;
    await client(app, manager.token).post('/api/sites', { client_id: theirs.id, code: `AMS${++seq}`, name: 'X', responsible_team_id: other.id }).expect(404);
  });

  it('answers half a coordinate pair and nulls on required fields with 400', async () => {
    const c = await newClient();
    const site = await newSite(c.id);
    await api.patch(`/api/sites/${site.id}`, { lat: 21 }).expect(400);
    await api.patch(`/api/sites/${site.id}`, { name: null }).expect(400);
    await api.post(`/api/sites/${site.id}/checkpoints`, { code: 'G1', name: 'G', allowed_methods: ['gps'], lat: 21 }).expect(400);
    const cp = (await api.post(`/api/sites/${site.id}/checkpoints`, { code: 'G2', name: 'G', allowed_methods: ['gps'], lat: 21, lng: 105 }).expect(201)).body.data;
    await api.patch(`/api/checkpoints/${cp.id}`, { lng: null }).expect(400);
    await api.patch(`/api/checkpoints/${cp.id}`, { name: null }).expect(400);
    await api.patch(`/api/checkpoints/${cp.id}`, { allowed_methods: null }).expect(400);
  });

  it('stops tags of an inactive site from resolving', async () => {
    const c = await newClient();
    const site = await newSite(c.id);
    await api.post(`/api/sites/${site.id}/checkpoints`, { code: 'Q1', name: 'Q' }).expect(201);
    const tag = (await api.get(`/api/sites/${site.id}/qr-sheet`).expect(200)).body.data.tags[0].payload;
    await api.patch(`/api/sites/${site.id}`, { status: 'inactive' }).expect(200);
    await api.post('/api/checkpoints/resolve-qr', { payload: tag }).expect(400);
  });
});
