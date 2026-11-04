import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Patrol — checkpoint photo rule and settings (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let siteId: string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'pts');
    api = client(app, admin.token);
    const clientId = (await api.post('/api/clients', { code: 'PK', name: 'Khách' }).expect(201)).body.data.id;
    siteId = (await api.post('/api/sites', { client_id: clientId, code: 'PS', name: 'Toà' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('gives each checkpoint a photo rule: never by default, always or random on request', async () => {
    const plain = (await api.post(`/api/sites/${siteId}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data;
    expect(plain.photo_rule).toBe('never');
    const gps = (await api.post(`/api/sites/${siteId}/checkpoints`, {
      code: 'B', name: 'Bãi xe', lat: 21.03, lng: 105.78, allowed_methods: ['gps'], photo_rule: 'random',
    }).expect(201)).body.data;
    expect(gps).toMatchObject({ allowed_methods: ['gps'], photo_rule: 'random' });
    const changed = (await api.patch(`/api/checkpoints/${plain.id}`, { photo_rule: 'always' }).expect(200)).body.data;
    expect(changed.photo_rule).toBe('always');
    await api.patch(`/api/checkpoints/${plain.id}`, { photo_rule: 'sometimes' }).expect(400);
    await api.post(`/api/sites/${siteId}/checkpoints`, { code: 'C', name: 'X', require_photo: true }).expect(400);
  });

  it('lets the company and each site set how often random photos are asked for', async () => {
    const company = (await api.get('/api/settings').expect(200)).body.data;
    expect(company.defaults.patrol_photo_random_percent).toBe(20);
    await api.patch(`/api/sites/${siteId}/settings`, { patrol_photo_random_percent: 50 }).expect(200);
    expect((await api.get(`/api/sites/${siteId}/settings`).expect(200)).body.data.values.patrol_photo_random_percent).toBe(50);
    await api.patch(`/api/sites/${siteId}/settings`, { patrol_photo_random_percent: 101 }).expect(400);
  });

  it('gives guards and leaders the right to patrol, managers the right to watch', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'patrol.%'`,
      [admin.tenant.id],
    );
    const of = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission).sort();
    expect(of('guard')).toEqual(['patrol.perform']);
    expect(of('team_leader')).toEqual(['patrol.perform', 'patrol.view']);
    expect(of('manager')).toEqual(['patrol.view']);
    expect(of('admin')).toEqual(['patrol.perform', 'patrol.view']);
  });
});
