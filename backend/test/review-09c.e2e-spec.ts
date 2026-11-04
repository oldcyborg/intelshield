import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Plan 09c review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let g: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'r9c');
    const api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'K', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'S', name: 'Toà' }).expect(201)).body.data.id;
    ids.category = (await api.get('/api/incident-categories').expect(200)).body.data[0].id;
    const e = (await api.post('/api/employees', { code: 'G', full_name: 'G' }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    // A night shift that ended two hours ago.
    await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-10 * 60), end_at: minutes(-120) }).expect(201);
    g = client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e })).token);
  });
  afterAll(async () => app.close());

  it('keeps when an SOS sent late really happened, and the site of the shift at that moment', async () => {
    const when = minutes(-180);
    const sos = (await g.post('/api/incidents/sos', { client_uuid: randomUUID(), device_time: when, captured_offline: true }).expect(201)).body.data;
    expect(sos.site_id).toBe(ids.site);
    expect(new Date(sos.occurred_at).toISOString()).toBe(when);
    expect(sos.sent_late).toBe(true);
  });

  it('dates a report sent at once by the server, not late', async () => {
    const i = (await g.post('/api/incidents', { client_uuid: randomUUID(), category_id: ids.category, description: 'x', device_time: minutes(-30) }).expect(201)).body.data;
    expect(i.sent_late).toBe(false);
    expect(Date.now() - new Date(i.occurred_at).getTime()).toBeLessThan(60_000);
  });

  it('never dates an offline SOS more than a day back, and still accepts it', async () => {
    const sos = (await g.post('/api/incidents/sos', { client_uuid: randomUUID(), device_time: minutes(-3 * 24 * 60), captured_offline: true }).expect(201)).body.data;
    expect(Date.now() - new Date(sos.occurred_at).getTime()).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);
  });
});
