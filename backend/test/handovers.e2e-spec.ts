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

describe('Handovers (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let leaderUser: string;
  let managerUser: string;
  let leader: ReturnType<typeof client>;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'hov');
    api = client(app, admin.token);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    managerUser = manager.user.id;
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerUser }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'HK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'HS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.put(`/api/sites/${ids.site}/handover-items`, { items: ['Chìa khoá kho', 'Bộ đàm'] }).expect(200);
    const lead = (await api.post('/api/employees', { code: 'HL', full_name: 'Đội trưởng' }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: lead }).expect(201);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    const l = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead });
    leaderUser = l.user.id;
    leader = client(app, l.token);
  });
  afterAll(async () => app.close());

  /** Each test works at its own site, so shifts of one test are never candidates in another. */
  async function newSite() {
    seq += 1;
    const site = (await api.post('/api/sites', { client_id: ids.client, code: `HS${seq}`, name: `Toà ${seq}`, ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.put(`/api/sites/${site}/handover-items`, { items: ['Chìa khoá kho', 'Bộ đàm'] }).expect(200);
    return site as string;
  }
  async function person(start: number, end: number, site = ids.site): Promise<Person> {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `HG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: employee }).expect(201);
    await api.post('/api/deployments', { employee_id: employee, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    const shift = (await api.post('/api/roster', { site_id: site, employee_id: employee, start_at: minutes(start), end_at: minutes(end) }).expect(201)).body.data;
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee });
    const token = (await loginOnDevice(app, u.phone, u.password, `hov-${seq}`)).token!;
    return { employee, token, api: client(app, token), shift };
  }
  const items = (radio: 'ok' | 'missing') => [{ label: 'Chìa khoá kho', status: 'ok' }, { label: 'Bộ đàm', status: radio, ...(radio === 'missing' ? { note: 'Thiếu 1 cái' } : {}) }];
  const notes = async (userId: string, type: string) =>
    (await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]))[0].n as number;

  it('passes the checklist to the next guard, who answers on their own account', async () => {
    const out = await person(-480, 30);
    const inn = await person(30, 480);
    const other = await person(-300, 100);
    expect((await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: [{ label: 'Chìa khoá kho', status: 'ok' }] }).expect(400)).body.error.code).toBe('HANDOVER_ITEMS_INCOMPLETE');
    const before = await notes(managerUser, 'handover.problem');
    const h = (await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('missing'), notes: 'Phòng 1205 hẹn 7h lấy hàng' }).expect(201)).body.data;
    expect(h).toMatchObject({ status: 'submitted', to_employee_id: inn.employee, to_assignment_id: inn.shift.id });
    expect(await notes(managerUser, 'handover.problem')).toBe(before + 1);
    expect((await inn.api.get('/api/me/handovers').expect(200)).body.data.map((x: { id: string }) => x.id)).toContain(h.id);
    expect((await other.api.post(`/api/handovers/${h.id}/accept`, {}).expect(403)).body.error.code).toBe('HANDOVER_NOT_YOURS');
    expect((await inn.api.post(`/api/handovers/${h.id}/dispute`, {}).expect(400)).body.error.code).toBe('HANDOVER_NOTE_REQUIRED');
    const disputed = (await inn.api.post(`/api/handovers/${h.id}/dispute`, { note: 'Thiếu cả chìa khoá kho' }).expect(201)).body.data;
    expect(disputed).toMatchObject({ status: 'disputed', receiver_note: 'Thiếu cả chìa khoá kho' });
    expect(await notes(leaderUser, 'handover.disputed')).toBe(1);
    expect((await inn.api.post(`/api/handovers/${h.id}/accept`, {}).expect(409)).body.error.code).toBe('HANDOVER_CLOSED');
    const reviewed = (await leader.post(`/api/handovers/${h.id}/review`, { note: 'Đã kiểm, thiếu chìa khoá thật' }).expect(201)).body.data;
    expect(reviewed.reviewed_by_name).toBeTruthy();
    const day = (await api.get(`/api/sites/${ids.site}/handovers?date=${todayLocal()}`).expect(200)).body.data;
    expect(day.find((x: { id: string }) => x.id === h.id)).toMatchObject({ from_name: 'Bảo vệ 1', to_name: 'Bảo vệ 2', status: 'disputed' });
  });

  it("refuses someone else's shift, a handover hours early, and a second one", async () => {
    const site = await newSite();
    const out = await person(-400, 20, site);
    await person(20, 400, site);
    const early = await person(-200, 400, site);
    expect((await early.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(403)).body.error.code).toBe('HANDOVER_NOT_YOURS');
    expect((await early.api.post('/api/handovers', { from_assignment_id: early.shift.id, items: items('ok') }).expect(400)).body.error.code).toBe('HANDOVER_TOO_EARLY');
    await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(201);
    expect((await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(409)).body.error.code).toBe('HANDOVER_ALREADY');
  });

  it('asks which receiver when two guards take over', async () => {
    const site = await newSite();
    const out = await person(-300, 40, site);
    const a = await person(40, 300, site);
    await person(45, 300, site);
    const res = await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(400);
    expect(res.body.error.code).toBe('HANDOVER_RECEIVER_REQUIRED');
    const h = (await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, to_assignment_id: a.shift.id, items: items('ok') }).expect(201)).body.data;
    expect(h.to_employee_id).toBe(a.employee);
  });

  it('tells the leader and the manager, once, when a guard has been on duty 15 minutes with no accepted handover', async () => {
    const site = await newSite();
    const prev = await person(-480, -20, site);
    const now = await person(-20, 400, site);
    const selfie = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${now.token}`).attach('file', JPEG, 's.jpg').expect(201)).body.data.id;
    await now.api.post('/api/attendance/check-in', { assignment_id: now.shift.id, lat: 21.0286, lng: 105.7768, accuracy_m: 10, device_time: new Date().toISOString(), selfie_file_id: selfie }).expect(201);
    const watcher = app.get(HandoverWatcher);
    const before = await notes(managerUser, 'handover.unconfirmed');
    await watcher.tick(new Date(Date.now() + 5 * 60_000));
    expect(await notes(managerUser, 'handover.unconfirmed')).toBe(before);
    await watcher.tick(new Date(Date.now() + 16 * 60_000));
    await watcher.tick(new Date(Date.now() + 17 * 60_000));
    expect(await notes(managerUser, 'handover.unconfirmed')).toBe(before + 1);
    expect(await notes(leaderUser, 'handover.unconfirmed')).toBeGreaterThanOrEqual(1);
    expect(prev.employee).toBeTruthy();
  });

  it('keeps the checklist editable by site managers only', async () => {
    const g = await person(-60, 300);
    expect((await g.api.get(`/api/sites/${ids.site}/handover-items`).expect(200)).body.data).toEqual(['Chìa khoá kho', 'Bộ đàm']);
    await g.api.put(`/api/sites/${ids.site}/handover-items`, { items: [] }).expect(403);
  });
});
