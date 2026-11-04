import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { HandoverWatcher } from '../src/logbook/handover.watcher';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
type Person = { employee: string; token: string; api: ReturnType<typeof client>; shift: { id: string } };

describe('Plan 08 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let managerUser: string;
  let leader: { api: ReturnType<typeof client>; employee: string };
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'rv8');
    api = client(app, admin.token);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    managerUser = manager.user.id;
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerUser }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'VK', name: 'Khách' }).expect(201)).body.data.id;
    const lead = (await api.post('/api/employees', { code: 'VL', full_name: 'Đội trưởng' }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: lead }).expect(201);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    await api.post('/api/deployments', { employee_id: lead, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    leader = { api: client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).token), employee: lead };
  });
  afterAll(async () => app.close());

  async function newSite() {
    seq += 1;
    const site = (await api.post('/api/sites', { client_id: ids.client, code: `VS${seq}`, name: `Toà ${seq}`, ...SITE, responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.put(`/api/sites/${site}/handover-items`, { items: ['Chìa khoá', 'Bộ đàm'] }).expect(200);
    return site as string;
  }
  async function person(site: string, start: number, end: number): Promise<Person> {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `VG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: employee }).expect(201);
    await api.post('/api/deployments', { employee_id: employee, client_id: ids.client, start_date: addDays(todayLocal(), -40) }).expect(201);
    const shift = (await api.post('/api/roster', { site_id: site, employee_id: employee, start_at: minutes(start), end_at: minutes(end) }).expect(201)).body.data;
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee });
    const token = (await loginOnDevice(app, u.phone, u.password, `rv8-${seq}`)).token!;
    return { employee, token, api: client(app, token), shift };
  }
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;
  const ok = [{ label: 'Chìa khoá', status: 'ok' }, { label: 'Bộ đàm', status: 'ok' }];
  const count = async (userId: string, type: string) =>
    (await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]))[0].n as number;

  it('refuses offline lines claiming a moment more than a day back', async () => {
    const site = await newSite();
    const g = await person(site, -60, 300);
    const old = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    expect((await g.api.post(`/api/sites/${site}/logbook`, { client_uuid: randomUUID(), device_time: old, captured_offline: true, type: 'note', body: 'x' }).expect(400)).body.error.code).toBe('LOGBOOK_TOO_OLD');
    const office = (await api.post(`/api/sites/${site}/logbook`, { client_uuid: randomUUID(), device_time: old, captured_offline: true, type: 'note', body: 'văn phòng' }).expect(201)).body.data;
    expect(Date.now() - new Date(office.occurred_at).getTime()).toBeLessThan(60_000);
  });

  it('follows a substituted receiver, and lets the giver name one when there was none', async () => {
    const site = await newSite();
    const a = await person(site, -400, 30);
    const b = await person(site, 30, 400);
    const h = (await a.api.post('/api/handovers', { from_assignment_id: a.shift.id, items: ok }).expect(201)).body.data;
    const c = await person(site, -700, -600);
    const sub = (await api.post(`/api/roster/${b.shift.id}/substitute`, { employee_id: c.employee }).expect(201)).body.data;
    expect((await b.api.post(`/api/handovers/${h.id}/accept`, {}).expect(403)).body.error.code).toBe('HANDOVER_NOT_YOURS');
    const accepted = (await c.api.post(`/api/handovers/${h.id}/accept`, {}).expect(201)).body.data;
    expect(accepted).toMatchObject({ status: 'accepted', to_employee_id: c.employee, to_assignment_id: sub.id });

    const site2 = await newSite();
    const lone = await person(site2, -400, 30);
    const h2 = (await lone.api.post('/api/handovers', { from_assignment_id: lone.shift.id, items: ok }).expect(201)).body.data;
    expect(h2.to_employee_id).toBeNull();
    const late = await person(site2, 60, 400);
    await lone.api.post(`/api/handovers/${h2.id}/receiver`, { to_assignment_id: late.shift.id }).expect(201);
    await late.api.post(`/api/handovers/${h2.id}/accept`, {}).expect(201);
  });

  it('shows the photos to the guards who need them', async () => {
    const site = await newSite();
    const a = await person(site, -400, 30);
    const b = await person(site, 30, 400);
    const pic = await photo(a.token);
    await a.api.post('/api/handovers', { from_assignment_id: a.shift.id, items: ok, file_ids: [pic] }).expect(201);
    await b.api.get(`/api/files/${pic}`).expect(200);
    const line = await photo(a.token);
    await a.api.post(`/api/sites/${site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'note', body: 'ảnh', file_ids: [line] }).expect(201);
    const mate = await person(site, -60, 200);
    await mate.api.get(`/api/files/${line}`).expect(200);
  });

  it('keeps a guard on shift to the recent days of the book', async () => {
    const site = await newSite();
    const g = await person(site, -60, 300);
    await g.api.get(`/api/sites/${site}/logbook?date=${todayLocal()}`).expect(200);
    await g.api.get(`/api/sites/${site}/logbook?date=${addDays(todayLocal(), -10)}`).expect(404);
    await g.api.get(`/api/sites/${site}/handovers?date=${addDays(todayLocal(), -10)}`).expect(404);
  });

  it('reviews once, after the receiver answered, and never by someone in it', async () => {
    const site = await newSite();
    const a = await person(site, -400, 30);
    const b = await person(site, 30, 400);
    const h = (await a.api.post('/api/handovers', { from_assignment_id: a.shift.id, items: ok }).expect(201)).body.data;
    expect((await leader.api.post(`/api/handovers/${h.id}/review`, {}).expect(409)).body.error.code).toBe('HANDOVER_NOT_ANSWERED');
    await b.api.post(`/api/handovers/${h.id}/accept`, {}).expect(201);
    await leader.api.post(`/api/handovers/${h.id}/review`, { note: 'ok' }).expect(201);
    expect((await leader.api.post(`/api/handovers/${h.id}/review`, {}).expect(409)).body.error.code).toBe('HANDOVER_REVIEWED');

    const site2 = await newSite();
    const own = (await api.post('/api/roster', { site_id: site2, employee_id: leader.employee, start_at: minutes(-400), end_at: minutes(25) }).expect(201)).body.data;
    const r = await person(site2, 25, 400);
    const h2 = (await leader.api.post('/api/handovers', { from_assignment_id: own.id, items: ok }).expect(201)).body.data;
    await r.api.post(`/api/handovers/${h2.id}/accept`, {}).expect(201);
    expect((await leader.api.post(`/api/handovers/${h2.id}/review`, {}).expect(403)).body.error.code).toBe('HANDOVER_OWN');
  });

  it('checks the checklist exactly and searches values only', async () => {
    const site = await newSite();
    const a = await person(site, -400, 30);
    await person(site, 30, 400);
    const dup = [...ok, { label: 'Bộ đàm', status: 'missing' }];
    expect((await a.api.post('/api/handovers', { from_assignment_id: a.shift.id, items: dup }).expect(400)).body.error.code).toBe('HANDOVER_ITEMS_INVALID');
    await a.api.post('/api/handovers', { from_assignment_id: a.shift.id, items: [...ok, { label: 'Bia', status: 'ok' }] }).expect(400);
    await a.api.post(`/api/sites/${site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'visitor', visitor_name: 'Chị Mai' }).expect(201);
    expect((await api.get(`/api/sites/${site}/logbook?date=${todayLocal()}&q=visitor_name`).expect(200)).body.data).toEqual([]);
    expect((await api.get(`/api/sites/${site}/logbook?date=${todayLocal()}&q=Mai`).expect(200)).body.data).toHaveLength(1);
  });

  it('alerts only the guard who should have received, and not again after a dispute', async () => {
    const site = await newSite();
    const prev = await person(site, -480, -20);
    const x1 = await person(site, -20, 400);
    const x2 = await person(site, -15, 400);
    const h = (await prev.api.post('/api/handovers', { from_assignment_id: prev.shift.id, to_assignment_id: x1.shift.id, items: ok }).expect(201)).body.data;
    for (const p of [x1, x2]) {
      const selfie = await photo(p.token);
      await p.api.post('/api/attendance/check-in', { assignment_id: p.shift.id, lat: 21.0286, lng: 105.7768, accuracy_m: 10, device_time: new Date().toISOString(), selfie_file_id: selfie }).expect(201);
    }
    await x1.api.post(`/api/handovers/${h.id}/dispute`, { note: 'Thiếu chìa khoá' }).expect(201);
    const before = await count(managerUser, 'handover.unconfirmed');
    await app.get(HandoverWatcher).tick(new Date(Date.now() + 16 * 60_000));
    expect(await count(managerUser, 'handover.unconfirmed')).toBe(before);
  });
});
