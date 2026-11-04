import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Incidents — reporting and visibility (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'inc');
    api = client(app, admin.token);
    ids.category = (await api.get('/api/incident-categories').expect(200)).body.data.find((c: { name: string }) => c.name === 'Trộm cắp').id;
    ids.clientA = (await api.post('/api/clients', { code: 'KA', name: 'Khách A' }).expect(201)).body.data.id;
    ids.clientB = (await api.post('/api/clients', { code: 'KB', name: 'Khách B' }).expect(201)).body.data.id;
    ids.self = (await api.post('/api/clients', { code: 'KS', name: 'Khách tự quản', management_mode: 'self_managed' }).expect(201)).body.data.id;
    ids.teamA = (await api.post('/api/org/teams', { name: 'Đội A' }).expect(201)).body.data.id;
    ids.siteA = (await api.post('/api/sites', { client_id: ids.clientA, code: 'SA', name: 'Toà A', responsible_team_id: ids.teamA }).expect(201)).body.data.id;
    ids.siteB = (await api.post('/api/sites', { client_id: ids.clientB, code: 'SB', name: 'Kho B' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  async function guardAt(clientId: string, team = ids.teamA) {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `IG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e.id }).expect(201);
    await api.post('/api/deployments', { employee_id: e.id, client_id: clientId, start_date: addDays(todayLocal(), -5) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e.id });
    return { employee: e, user: u, api: client(app, u.token), token: u.token };
  }
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'anh.jpg').expect(201)).body.data.id;

  it('lets a guard report at a site of the client they are posted to, with photos', async () => {
    const g = await guardAt(ids.clientA);
    const file = await photo(g.token);
    const res = (await g.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'Mất bình cứu hoả tầng 2', lat: 21.03, lng: 105.78, file_ids: [file] }).expect(201)).body.data;
    expect(res).toMatchObject({ status: 'new', severity: 'high', title: 'Trộm cắp', source: 'guard_app', site_name: 'Toà A', client_name: 'Khách A', reporter_name: g.user.user.full_name });
    expect(res.code).toMatch(/^SC-\d{6}$/);
    const detail = (await g.api.get(`/api/incidents/${res.id}`).expect(200)).body.data;
    expect(detail.files.map((f: { id: string }) => f.id)).toEqual([file]);
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(['created']);
    await g.api.get(`/api/files/${file}`).expect(200);
  });

  it("refuses a report at another client's site and the office-only sources", async () => {
    const g = await guardAt(ids.clientA);
    const res = await g.api.post('/api/incidents', { site_id: ids.siteB, category_id: ids.category, description: 'x' }).expect(403);
    expect(res.body.error.code).toBe('INCIDENT_SITE_NOT_ALLOWED');
    await g.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'x', source: 'client_report' }).expect(403);
  });

  it('places an SOS at the site of the current shift, or at the client when off shift', async () => {
    const onShift = await guardAt(ids.clientA);
    await api.post('/api/roster', { site_id: ids.siteA, employee_id: onShift.employee.id, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
    const sos = (await onShift.api.post('/api/incidents/sos', { lat: 21.03, lng: 105.78 }).expect(201)).body.data;
    expect(sos).toMatchObject({ is_sos: true, severity: 'critical', site_id: ids.siteA, client_id: ids.clientA });

    const offShift = await guardAt(ids.clientB, (await api.post('/api/org/teams', { name: `Đội B${++seq}` }).expect(201)).body.data.id);
    const off = (await offShift.api.post('/api/incidents/sos', { lat: 21, lng: 105 }).expect(201)).body.data;
    expect(off).toMatchObject({ site_id: null, client_id: ids.clientB });

    const loose = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    expect((await client(app, loose.token).post('/api/incidents/sos', { lat: 21, lng: 105 }).expect(400)).body.error.code).toBe('INCIDENT_NO_SITE');
  });

  it('records what a client reported by phone, also for self-managed clients', async () => {
    const res = (await api.post('/api/incidents', {
      client_id: ids.self, category_id: ids.category, description: 'Khách báo mất hàng ở kho', source: 'client_report',
      client_reporter_name: 'Anh Tuấn — quản lý kho', client_channel: 'phone',
    }).expect(201)).body.data;
    expect(res).toMatchObject({ source: 'client_report', site_id: null, client_name: 'Khách tự quản', client_channel: 'phone' });
  });

  it("shows guards their own reports, and leaders their team's sites, nothing else", async () => {
    const g1 = await guardAt(ids.clientA);
    const g2 = await guardAt(ids.clientA);
    const mine = (await g1.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'của g1' }).expect(201)).body.data;
    const theirs = (await g2.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'của g2' }).expect(201)).body.data;
    const gB = await guardAt(ids.clientB, (await api.post('/api/org/teams', { name: `Đội B${++seq}` }).expect(201)).body.data.id);
    const atB = (await gB.api.post('/api/incidents', { site_id: ids.siteB, category_id: ids.category, description: 'ở kho B' }).expect(201)).body.data;

    const own = (await g1.api.get('/api/incidents').expect(200)).body.data.map((i: { id: string }) => i.id);
    expect(own).toContain(mine.id);
    expect(own).not.toContain(theirs.id);
    await g1.api.get(`/api/incidents/${theirs.id}`).expect(404);

    const lead = (await api.post('/api/employees', { code: `IL${++seq}`, full_name: 'Đội trưởng A' }).expect(201)).body.data;
    await api.post(`/api/org/teams/${ids.teamA}/members`, { employee_id: lead.id }).expect(201);
    await api.put(`/api/org/teams/${ids.teamA}/leader`, { employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    const seen = (await client(app, leader.token).get('/api/incidents').expect(200)).body.data.map((i: { id: string }) => i.id);
    expect(seen).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    expect(seen).not.toContain(atB.id);
    await client(app, leader.token).get(`/api/incidents/${atB.id}`).expect(404);
  });
});
