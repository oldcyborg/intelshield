import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
type Api = ReturnType<typeof client>;
const names = (res: { body: { data: { full_name: string }[] } }) => res.body.data.map((c) => c.full_name).sort();

describe('Site contacts (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: Api;
  let manager: Api;
  let leader: Api;
  let hr: Api;
  let guardOn: Api;
  let guardOff: Api;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'sct');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'CT', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'CS', name: 'Toà' }).expect(201)).body.data.id;
    ids.other = (await api.post('/api/sites', { client_id: ids.client, code: 'CS2', name: 'Kho' }).expect(201)).body.data.id;
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    hr = client(app, (await createUserWithRoles(app, admin.tenant.id, ['hr'])).token);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [{ scope_type: 'site', scope_id: ids.site }])).token);
    guardOn = await guard(true);
    guardOff = await guard(false);

    for (const [full_name, visibility, priority] of [['Trưởng BQL', 'staff', 1], ['Kỹ thuật', 'leader', 2], ['Lễ tân', 'guard', 3]] as const) {
      ids[visibility] = (await manager.post(`/api/sites/${ids.site}/contacts`, { full_name, visibility, priority, phone: '0912 000 111' }).expect(201)).body.data.id;
    }
    ids.otherGuard = (await manager.post(`/api/sites/${ids.other}/contacts`, { full_name: 'Thủ kho', visibility: 'guard', phone: '0912000222' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  async function guard(withShift: boolean): Promise<Api> {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `CG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    if (withShift) await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-60), end_at: minutes(240) }).expect(201);
    return client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e })).token);
  }

  it('shows each person only the contacts their level allows, closest first', async () => {
    const all = (await manager.get(`/api/sites/${ids.site}/contacts`).expect(200)).body.data;
    expect(all.map((c: { full_name: string }) => c.full_name)).toEqual(['Trưởng BQL', 'Kỹ thuật', 'Lễ tân']);
    expect(all[0]).toMatchObject({ phone: '0912000111', visibility: 'staff' });
    expect(names(await hr.get(`/api/sites/${ids.site}/contacts`).expect(200))).toEqual(['Kỹ thuật', 'Lễ tân', 'Trưởng BQL']);
    expect(names(await leader.get(`/api/sites/${ids.site}/contacts`).expect(200))).toEqual(['Kỹ thuật', 'Lễ tân']);
    expect(names(await guardOn.get(`/api/sites/${ids.site}/contacts`).expect(200))).toEqual(['Lễ tân']);
  });

  it('keeps contacts from people with no business at the site', async () => {
    await guardOff.get(`/api/sites/${ids.site}/contacts`).expect(404);
    // On shift at one site says nothing about the next one; nor does a leader's scope.
    await guardOn.get(`/api/sites/${ids.other}/contacts`).expect(404);
    await leader.get(`/api/sites/${ids.other}/contacts`).expect(404);
    const stranger = await createTenantWithAdmin(app, 'sct2');
    await client(app, stranger.token).get(`/api/sites/${ids.site}/contacts`).expect(404);
  });

  it('lets only managers add, change and remove contacts, which must be reachable', async () => {
    await leader.post(`/api/sites/${ids.site}/contacts`, { full_name: 'X', phone: '0912000999' }).expect(403);
    await hr.patch(`/api/site-contacts/${ids.guard}`, { visibility: 'staff' }).expect(403);
    expect((await manager.post(`/api/sites/${ids.site}/contacts`, { full_name: 'Không số' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    await manager.post(`/api/sites/${ids.site}/contacts`, { full_name: 'Sai cấp', phone: '0912000999', visibility: 'boss' }).expect(400);

    const tmp = (await manager.post(`/api/sites/${ids.site}/contacts`, { full_name: 'Bảo trì', email: 'BaoTri@Toa.vn', hours: '24/7' }).expect(201)).body.data;
    expect(tmp).toMatchObject({ email: 'baotri@toa.vn', visibility: 'staff', priority: 1 });
    await manager.patch(`/api/site-contacts/${tmp.id}`, { email: null }).expect(400);
    const moved = (await manager.patch(`/api/site-contacts/${tmp.id}`, { visibility: 'guard', zalo: '0912 000 555' }).expect(200)).body.data;
    expect(moved).toMatchObject({ visibility: 'guard', zalo: '0912000555' });
    expect(names(await guardOn.get(`/api/sites/${ids.site}/contacts`).expect(200))).toContain('Bảo trì');
    await manager.delete(`/api/site-contacts/${tmp.id}`).expect(200);
    expect(names(await guardOn.get(`/api/sites/${ids.site}/contacts`).expect(200))).not.toContain('Bảo trì');
    await manager.patch(`/api/site-contacts/${tmp.id}`, { full_name: 'Lại' }).expect(404);
  });

  it('writes a call to a contact into the incident timeline, for contacts of that site the caller can see', async () => {
    const [category] = (await api.get('/api/incident-categories').expect(200)).body.data;
    const incident = (await guardOn.post('/api/incidents', { category_id: category.id, description: 'Rò nước tầng 1', site_id: ids.site }).expect(201)).body.data;
    const called = (await leader.post(`/api/incidents/${incident.id}/contact-calls`, { contact_id: ids.leader, channel: 'phone' }).expect(201)).body.data;
    const event = called.events.find((e: { type: string }) => e.type === 'contact_called');
    expect(event).toMatchObject({ body: 'Gọi điện cho Kỹ thuật', data: { contact_id: ids.leader, channel: 'phone' } });
    expect(event.body).not.toContain('0912');

    await guardOn.post(`/api/incidents/${incident.id}/contact-calls`, { contact_id: ids.guard, channel: 'zalo' }).expect(201);
    // Above their level, or of another site: as if it did not exist.
    await leader.post(`/api/incidents/${incident.id}/contact-calls`, { contact_id: ids.staff, channel: 'phone' }).expect(404);
    await manager.post(`/api/incidents/${incident.id}/contact-calls`, { contact_id: ids.otherGuard, channel: 'phone' }).expect(404);
    await manager.post(`/api/incidents/${incident.id}/contact-calls`, { contact_id: ids.staff, channel: 'fax' }).expect(400);
  });
});
