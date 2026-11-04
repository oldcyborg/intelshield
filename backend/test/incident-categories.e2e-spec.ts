import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Incident categories (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'cat');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  it('gives every new company the default categories', async () => {
    const list = (await api.get('/api/incident-categories').expect(200)).body.data;
    expect(list.map((c: { name: string; default_severity: string }) => [c.name, c.default_severity])).toEqual([
      ['Cháy nổ', 'critical'], ['Trộm cắp', 'high'], ['Xâm nhập', 'high'],
      ['Hư hỏng thiết bị', 'medium'], ['Vệ sinh / an toàn', 'low'], ['Khác', 'medium'],
    ]);
  });

  it('grants the incident permissions to the system roles', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'incident.%' ORDER BY r.code, rp.permission`,
      [admin.tenant.id],
    );
    const by = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission);
    expect(by('guard')).toEqual(['incident.report']);
    expect(by('team_leader')).toEqual(['incident.manage', 'incident.report', 'incident.view']);
    expect(by('manager')).toEqual(['incident.close', 'incident.manage', 'incident.report', 'incident.view']);
    expect(by('admin')).toContain('incident.final_escalation');
  });

  it('lets the director add and retire categories, and everyone read them', async () => {
    const created = (await api.post('/api/incident-categories', { name: 'Ngập nước', default_severity: 'high' }).expect(201)).body.data;
    expect((await api.post('/api/incident-categories', { name: 'ngập nước', default_severity: 'low' }).expect(409)).body.error.code).toBe('INCIDENT_CATEGORY_TAKEN');
    await api.patch(`/api/incident-categories/${created.id}`, { status: 'inactive' }).expect(200);
    const guard = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const seen = (await client(app, guard.token).get('/api/incident-categories').expect(200)).body.data;
    expect(seen.map((c: { name: string }) => c.name)).not.toContain('Ngập nước');
    await client(app, guard.token).post('/api/incident-categories', { name: 'X', default_severity: 'low' }).expect(403);
  });
});
