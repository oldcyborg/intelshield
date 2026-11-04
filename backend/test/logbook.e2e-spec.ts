import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Logbook (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let g: { token: string; api: ReturnType<typeof client> };
  let idle: { token: string; api: ReturnType<typeof client> };
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'lbk');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'LK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'LS', name: 'Toà' }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'LS2', name: 'Kho' }).expect(201)).body.data.id;
    g = await guard(true);
    idle = await guard(false);
  });
  afterAll(async () => app.close());

  async function guard(withShift: boolean) {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `LG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    if (withShift) await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-60), end_at: minutes(240) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const token = (await loginOnDevice(app, u.phone, u.password, `lbk-${seq}`)).token!;
    return { token, api: client(app, token) };
  }
  const write = (who: { api: ReturnType<typeof client> }, site: string, body: object) =>
    who.api.post(`/api/sites/${site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), ...body });
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;

  it('keeps a visitor in the book until they leave, with an optional photo', async () => {
    const pic = await photo(g.token);
    const v = (await write(g, ids.site, { type: 'visitor', visitor_name: 'Anh Hùng', visitor_org: 'Điện lực', meet_whom: 'BQL', purpose: 'Kiểm tra công tơ', file_ids: [pic] }).expect(201)).body.data;
    expect(v).toMatchObject({ type: 'visitor', data: { visitor_name: 'Anh Hùng', visitor_org: 'Điện lực', meet_whom: 'BQL', purpose: 'Kiểm tra công tơ' }, exited_at: null, author_name: 'Bảo vệ 1' });
    expect(v.files.map((f: { id: string }) => f.id)).toEqual([pic]);
    const car = (await write(g, ids.site, { type: 'vehicle', plate: '30A-123.45', vehicle_kind: 'Xe tải', cargo: 'Thiết bị điện' }).expect(201)).body.data;
    const inside = (await g.api.get(`/api/sites/${ids.site}/logbook/inside`).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(inside).toEqual(expect.arrayContaining([v.id, car.id]));
    const out = (await g.api.post(`/api/logbook/${v.id}/exit`, { device_time: new Date().toISOString() }).expect(201)).body.data;
    expect(out.exited_at).toBeTruthy();
    expect((await g.api.post(`/api/logbook/${v.id}/exit`, { device_time: new Date().toISOString() }).expect(409)).body.error.code).toBe('LOGBOOK_ALREADY_EXITED');
    expect((await g.api.get(`/api/sites/${ids.site}/logbook/inside`).expect(200)).body.data.map((x: { id: string }) => x.id)).not.toContain(v.id);
    await api.get(`/api/files/${pic}`).expect(200);
  });

  it('asks for what each kind of line needs', async () => {
    expect((await write(g, ids.site, { type: 'note' }).expect(400)).body.error.code).toBe('LOGBOOK_FIELD_REQUIRED');
    await write(g, ids.site, { type: 'visitor' }).expect(400);
    await write(g, ids.site, { type: 'vehicle', cargo: 'x' }).expect(400);
    await write(g, ids.site, { type: 'asset', item: 'Chìa khoá kho' }).expect(400);
    await write(g, ids.site, { type: 'asset', item: 'Chìa khoá kho', quantity: 1, asset_action: 'lent', counterpart: 'Anh Nam kỹ thuật' }).expect(201);
    const note = (await write(g, ids.site, { type: 'note', body: 'Mất điện tầng hầm 10 phút' }).expect(201)).body.data;
    expect((await g.api.post(`/api/logbook/${note.id}/exit`, { device_time: new Date().toISOString() }).expect(400)).body.error.code).toBe('LOGBOOK_NO_EXIT');
  });

  it('lets only people on shift write, or the office with the right to', async () => {
    expect((await write(idle, ids.site, { type: 'note', body: 'x' }).expect(403)).body.error.code).toBe('LOGBOOK_NOT_ON_SHIFT');
    await write(g, ids.site2, { type: 'note', body: 'x' }).expect(403);
    await write({ api }, ids.site2, { type: 'note', body: 'Văn phòng ghi: khách báo đổi giờ giao hàng' }).expect(201);
    const theirs = await photo(idle.token);
    expect((await write(g, ids.site, { type: 'note', body: 'x', file_ids: [theirs] }).expect(400)).body.error.code).toBe('LOGBOOK_PHOTO_INVALID');
  });

  it("lets the leader of the team that runs a site write its book with no shift, and only there", async () => {
    const team = (await api.post('/api/org/teams', { name: 'Đội sổ' }).expect(201)).body.data.id;
    await api.patch(`/api/sites/${ids.site2}`, { responsible_team_id: team }).expect(200);
    const e = (await api.post('/api/employees', { code: 'LGL', full_name: 'Đội trưởng sổ' }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e }).expect(201);
    await api.put(`/api/org/teams/${team}/leader`, { employee_id: e }).expect(200);
    const u = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: e });
    const lead = { api: client(app, (await loginOnDevice(app, u.phone, u.password, 'lbk-lead')).token!) };
    const line = (await write(lead, ids.site2, { type: 'note', body: 'Đội trưởng kiểm tra, cổng sau đã khoá' }).expect(201)).body.data;
    expect(line.author_name).toBe('Đội trưởng sổ');
    expect((await write(lead, ids.site, { type: 'note', body: 'x' }).expect(403)).body.error.code).toBe('LOGBOOK_NOT_ON_SHIFT');
  });

  it('answers a resent line with the first one', async () => {
    const body = { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'note', body: 'Gửi lại' };
    const a = (await g.api.post(`/api/sites/${ids.site}/logbook`, body).expect(201)).body.data;
    const b = (await g.api.post(`/api/sites/${ids.site}/logbook`, body).expect(201)).body.data;
    expect(b.id).toBe(a.id);
    await idle.api.post(`/api/sites/${ids.site}/logbook`, body).expect(409);
  });

  it('shows and searches a day of the book to those who may see it', async () => {
    const day = (await api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(200)).body.data;
    expect(day.length).toBeGreaterThanOrEqual(4);
    const found = (await api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}&q=${encodeURIComponent('30A-123')}`).expect(200)).body.data;
    expect(found.map((x: { type: string }) => x.type)).toEqual(['vehicle']);
    expect((await api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}&type=asset`).expect(200)).body.data).toHaveLength(1);
    await g.api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(200);
    await idle.api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(404);
    const leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [{ scope_type: 'site', scope_id: ids.site2 }])).token);
    await leader.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(404);
  });
});
