import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Attendance (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let siteId: string;
  let clientId: string;
  let teamId: string;
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'att');
    api = client(app, admin.token);
    clientId = (await api.post('/api/clients', { code: 'AK', name: 'Khách' }).expect(201)).body.data.id;
    teamId = (await api.post('/api/org/teams', { name: 'Đội chấm công' }).expect(201)).body.data.id;
    siteId = (await api.post('/api/sites', { client_id: clientId, code: 'AS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: teamId }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  /** A guard posted to the client, in the team, signed in on their own phone, with one shift. */
  async function guardWithShift(startInMinutes: number, hours = 8) {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `AG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data;
    await api.post(`/api/org/teams/${teamId}/members`, { employee_id: employee.id }).expect(201);
    await api.post('/api/deployments', { employee_id: employee.id, client_id: clientId, start_date: addDays(todayLocal(), -10) }).expect(201);
    const user = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee.id });
    const phone = await loginOnDevice(app, user.phone, user.password, `att-phone-${seq}`);
    const shift = (await api.post('/api/roster', { site_id: siteId, employee_id: employee.id, start_at: minutes(startInMinutes), end_at: minutes(startInMinutes + hours * 60) }).expect(201)).body.data;
    return { employee, user, token: phone.token!, shift };
  }
  const selfie = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'selfie.jpg').expect(201)).body.data.id;
  const checkIn = (token: string, body: object) => client(app, token).post('/api/attendance/check-in', { device_time: new Date().toISOString(), ...body });

  it('clocks a guard in at the site from their approved phone', async () => {
    const g = await guardWithShift(-5);
    const res = await checkIn(g.token, { assignment_id: g.shift.id, lat: 21.0286, lng: 105.7768, accuracy_m: 12, selfie_file_id: await selfie(g.token) }).expect(201);
    expect(res.body.data).toMatchObject({ check_in_flags: [], late_minutes: 5 });
    expect(res.body.data.check_in_distance_m).toBeLessThan(30);
    const mine = (await client(app, g.token).get(`/api/me/shifts?from=${todayLocal()}&to=${todayLocal()}`).expect(200)).body.data;
    expect(mine[0]).toMatchObject({ id: g.shift.id, site_name: 'Toà', attendance: expect.objectContaining({ late_minutes: 5 }) });
  });

  it('flags a clock-in far from the site or with a faked location', async () => {
    const g = await guardWithShift(-1);
    const res = await checkIn(g.token, { assignment_id: g.shift.id, lat: 21.05, lng: 105.80, accuracy_m: 300, mock_location: true, selfie_file_id: await selfie(g.token) }).expect(201);
    expect(res.body.data.check_in_flags.sort()).toEqual(['low_accuracy', 'mock_location', 'outside_geofence']);
  });

  it('refuses clock-ins from the web, for others, with borrowed selfies, too early, or twice', async () => {
    const g = await guardWithShift(-1);
    const other = await guardWithShift(-1);
    const web = (await request(server(app)).post('/api/auth/login').set('X-Client', 'mobile').send({ identifier: g.user.phone, password: g.user.password })).body.data.access_token;
    const mySelfie = await selfie(g.token);
    expect((await checkIn(web, { assignment_id: g.shift.id, ...SITE, selfie_file_id: mySelfie }).expect(403)).body.error.code).toBe('ATTENDANCE_DEVICE_REQUIRED');
    await checkIn(g.token, { assignment_id: other.shift.id, ...SITE, selfie_file_id: mySelfie }).expect(404);
    expect((await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: await selfie(admin.token) }).expect(400)).body.error.code).toBe('ATTENDANCE_SELFIE_INVALID');

    const early = await guardWithShift(180);
    expect((await checkIn(early.token, { assignment_id: early.shift.id, ...SITE, selfie_file_id: await selfie(early.token) }).expect(400)).body.error.code).toBe('ATTENDANCE_OUTSIDE_WINDOW');

    await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: mySelfie }).expect(201);
    expect((await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: await selfie(g.token) }).expect(409)).body.error.code).toBe('ATTENDANCE_ALREADY');
  });

  it('clocks out with early minutes and worked time, and locks the shift against roster changes', async () => {
    const g = await guardWithShift(-1);
    expect((await client(app, g.token).post('/api/attendance/check-out', { assignment_id: g.shift.id, ...SITE, device_time: new Date().toISOString(), selfie_file_id: await selfie(g.token) }).expect(400)).body.error.code).toBe('ATTENDANCE_NOT_CHECKED_IN');
    await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: await selfie(g.token) }).expect(201);
    const res = await client(app, g.token).post('/api/attendance/check-out', { assignment_id: g.shift.id, ...SITE, device_time: new Date().toISOString(), selfie_file_id: await selfie(g.token) }).expect(201);
    expect(res.body.data.early_minutes).toBeGreaterThan(470);
    expect(res.body.data.worked_minutes).toBe(0);
    expect((await api.post(`/api/roster/${g.shift.id}/cancel`).expect(409)).body.error.code).toBe('ROSTER_LOCKED');
  });

  it("shows who is late or absent by the site's own thresholds", async () => {
    const late = await guardWithShift(-15);
    const absent = await guardWithShift(-120);
    const upcoming = await guardWithShift(60);
    const board = async () => (await api.get(`/api/attendance/board?site_id=${siteId}&date=${todayLocal()}`).expect(200)).body.data;
    const statusOf = (rows: { id: string; status: string }[], id: string) => rows.find((r) => r.id === id)?.status;

    let b = await board();
    expect(b.settings).toMatchObject({ late_after_minutes: 10, absent_after_minutes: 30 });
    expect(statusOf(b.rows, late.shift.id)).toBe('late');
    expect(statusOf(b.rows, absent.shift.id)).toBe('absent');
    expect(statusOf(b.rows, upcoming.shift.id)).toBe('upcoming');

    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: 20, absent_after_minutes: 150 }).expect(200);
    b = await board();
    expect(statusOf(b.rows, late.shift.id)).toBe('waiting');
    expect(statusOf(b.rows, absent.shift.id)).toBe('late');
    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: null, absent_after_minutes: null }).expect(200);
  });

  it("lets the team's leader see the selfie, and nobody outside", async () => {
    const g = await guardWithShift(-1);
    const photo = await selfie(g.token);
    await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: photo }).expect(201);
    await client(app, g.token).get(`/api/files/${photo}`).expect(200);
    const lead = (await api.post('/api/employees', { code: `LEAD${++seq}`, full_name: 'Đội trưởng' }).expect(201)).body.data;
    await api.post(`/api/org/teams/${teamId}/members`, { employee_id: lead.id }).expect(201);
    await api.put(`/api/org/teams/${teamId}/leader`, { employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    await client(app, leader.token).get(`/api/files/${photo}`).expect(200);
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant'], [{ scope_type: 'client', scope_id: (await api.post('/api/clients', { code: `OT${seq}`, name: 'Khác' }).expect(201)).body.data.id }]);
    await client(app, accountant.token).get(`/api/files/${photo}`).expect(404);
  });
});
