import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Plan 09b review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let api: ReturnType<typeof client>;
  let leader: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'r9b');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'K', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'S', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    const lead = (await api.post('/api/employees', { code: 'L', full_name: 'Đội trưởng' }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: lead }).expect(201);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    await api.post('/api/deployments', { employee_id: lead, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).token);
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    ids.medium = (await api.get('/api/incident-categories').expect(200)).body.data.find((c: { name: string }) => c.name === 'Hư hỏng thiết bị').id;
  });
  afterAll(async () => app.close());

  it('tells the app whether this person may close or dismiss the incident, and says "dismiss" when refusing', async () => {
    const i = (await api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'x', source: 'staff' }).expect(201)).body.data;
    expect((await leader.get(`/api/incidents/${i.id}`).expect(200)).body.data.can_close).toBe(false);
    expect((await manager.get(`/api/incidents/${i.id}`).expect(200)).body.data.can_close).toBe(true);
    expect((await leader.post(`/api/incidents/${i.id}/reject`, { reason: 'nhầm' }).expect(403)).body.error.code).toBe('INCIDENT_REJECT_NOT_ALLOWED');
    await api.patch(`/api/sites/${ids.site}/settings`, { incident_close_by_leader_up_to: 'medium' }).expect(200);
    expect((await leader.get(`/api/incidents/${i.id}`).expect(200)).body.data.can_close).toBe(true);
    await leader.post(`/api/incidents/${i.id}/reject`, { reason: 'nhầm' }).expect(201);
  });
});
