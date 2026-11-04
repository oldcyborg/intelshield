import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Settings (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let siteId: string;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'set');
    api = client(app, admin.token);
    const c = (await api.post('/api/clients', { code: 'SK', name: 'Khách' }).expect(201)).body.data;
    siteId = (await api.post('/api/sites', { client_id: c.id, code: 'SS', name: 'Toà' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('starts from the system defaults', async () => {
    const res = (await api.get('/api/settings').expect(200)).body.data;
    expect(res.values).toMatchObject({ late_after_minutes: 10, absent_after_minutes: 30, incident_escalate_critical_minutes: 3, incident_close_by_leader_up_to: 'none' });
  });

  it('lets a site override the company, and fall back when the override is removed', async () => {
    await api.patch('/api/settings', { late_after_minutes: 15 }).expect(200);
    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: 5, incident_escalate_high_minutes: 5 }).expect(200);
    let site = (await api.get(`/api/sites/${siteId}/settings`).expect(200)).body.data;
    expect(site.values.late_after_minutes).toBe(5);
    expect(site.source).toMatchObject({ late_after_minutes: 'site', absent_after_minutes: 'default', incident_escalate_high_minutes: 'site' });

    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: null }).expect(200);
    site = (await api.get(`/api/sites/${siteId}/settings`).expect(200)).body.data;
    expect(site.values.late_after_minutes).toBe(15);
    expect(site.source.late_after_minutes).toBe('company');
    expect(site.overrides).toEqual({ incident_escalate_high_minutes: 5 });
  });

  it('refuses an absent threshold at or below the late threshold, wherever it comes from', async () => {
    const res = await api.patch(`/api/sites/${siteId}/settings`, { absent_after_minutes: 10 }).expect(400);
    expect(res.body.error.code).toBe('SETTINGS_INVALID');
    await api.patch('/api/settings', { absent_after_minutes: 12, late_after_minutes: 12 }).expect(400);
    await api.patch('/api/settings', { late_after_minutes: 300 }).expect(400);
  });

  it('records each change with its old and new values', async () => {
    await api.patch('/api/settings', { early_checkout_minutes: 20 }).expect(200);
    const [row] = await ds.query(
      `SELECT data FROM audit_logs WHERE tenant_id = $1 AND action = 'settings.company' ORDER BY created_at DESC LIMIT 1`,
      [admin.tenant.id],
    );
    expect(row.data).toMatchObject({ before: { early_checkout_minutes: null }, after: { early_checkout_minutes: 20 } });
  });

  it('keeps company defaults for the director and site overrides for those who configure the site', async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).patch('/api/settings', { late_after_minutes: 1 }).expect(403);
    await client(app, manager.token).patch(`/api/sites/${siteId}/settings`, { round_tolerance_minutes: 20 }).expect(200);
    const guard = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    await client(app, guard.token).get('/api/settings').expect(200);
    await client(app, guard.token).patch(`/api/sites/${siteId}/settings`, { round_tolerance_minutes: 1 }).expect(403);
  });
});
