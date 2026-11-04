import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Violations — attendance rules (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let engine: ViolationsEngine;
  const ids: Record<string, string> = {};
  let leaderId: string;
  let managerId: string;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    admin = await createTenantWithAdmin(app, 'vat');
    api = client(app, admin.token);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    managerId = manager.user.id;
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerId }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'VK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'VS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
    const lead = (await guard('LEAD')).employee;
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    leaderId = (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).user.id;
  });
  afterAll(async () => app.close());

  async function guard(code = `VG${++seq}`, clientId = ids.client) {
    const employee = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: employee }).expect(201);
    await api.post('/api/deployments', { employee_id: employee, client_id: clientId, start_date: addDays(todayLocal(), -10) }).expect(201);
    return { employee };
  }
  async function onShift(startIn: number, hours = 4, site = ids.site, clientId = ids.client) {
    const g = await guard(undefined, clientId);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: g.employee });
    const phone = await loginOnDevice(app, u.phone, u.password, `vat-${seq}`);
    const shift = (await api.post('/api/roster', { site_id: site, employee_id: g.employee, start_at: minutes(startIn), end_at: minutes(startIn + hours * 60) }).expect(201)).body.data;
    // Rostered the day before: the clock runs from the planned start.
    await ds.query(`UPDATE shift_assignments SET created_at = planned_start - interval '1 day' WHERE id = $1`, [shift.id]);
    return { ...g, token: phone.token!, shift };
  }
  const selfie = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 's.jpg').expect(201)).body.data.id;
  const clock = async (token: string, assignment: string, way: 'check-in' | 'check-out') =>
    client(app, token).post(`/api/attendance/${way}`, { assignment_id: assignment, lat: 21.0286, lng: 105.7768, accuracy_m: 10, device_time: new Date().toISOString(), selfie_file_id: await selfie(token) }).expect(201);
  const violations = (employee: string) =>
    ds.query(`SELECT type, minutes, status, detail FROM violations WHERE employee_id = $1 ORDER BY created_at`, [employee]);
  async function await_count(d: DataSource, userId: string, type: string) {
    return (await d.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]))[0].n;
  }

  it('nudges the leader once when a guard is late, and records nothing yet', async () => {
    const g = await onShift(-12);
    const before = await await_count(ds, leaderId, 'attendance.late');
    await engine.tick();
    await engine.tick();
    expect(await await_count(ds, leaderId, 'attendance.late')).toBe(before + 1);
    expect(await violations(g.employee)).toEqual([]);
  });

  it('records an absence at the site threshold and tells the leader and the manager', async () => {
    const g = await onShift(-35);
    await engine.tick();
    expect(await violations(g.employee)).toEqual([{ type: 'absent', minutes: null, status: 'auto', detail: {} }]);
    expect(await await_count(ds, managerId, 'violation.absent')).toBeGreaterThanOrEqual(1);
    await engine.tick();
    expect(await violations(g.employee)).toHaveLength(1);
  });

  it('turns an absence into lateness when the guard finally arrives', async () => {
    const g = await onShift(-40);
    await engine.tick();
    await clock(g.token, g.shift.id, 'check-in');
    await engine.tick();
    const [v] = await violations(g.employee);
    expect(v).toMatchObject({ type: 'late_check_in', status: 'auto', detail: { converted_from: 'absent' } });
    expect(v.minutes).toBeGreaterThanOrEqual(39);
  });

  it('records late arrivals past the threshold and early departures', async () => {
    const late = await onShift(-20);
    await clock(late.token, late.shift.id, 'check-in');
    const fine = await onShift(-5);
    await clock(fine.token, fine.shift.id, 'check-in');
    await clock(fine.token, fine.shift.id, 'check-out');
    await engine.tick();
    expect((await violations(late.employee)).map((v: { type: string }) => v.type)).toEqual(['late_check_in']);
    const early = await violations(fine.employee);
    expect(early.map((v: { type: string }) => v.type)).toEqual(['early_check_out']);
    expect(early[0].minutes).toBeGreaterThan(200);
  });

  it('keeps the absence when the shift is cancelled or handed to someone else afterwards', async () => {
    const a = await onShift(-45);
    await api.post(`/api/roster/${a.shift.id}/cancel`).expect(201);
    expect((await violations(a.employee)).map((v: { type: string }) => v.type)).toEqual(['absent']);
    const b = await onShift(-45);
    const stand = await guard();
    await api.post(`/api/roster/${b.shift.id}/substitute`, { employee_id: stand.employee }).expect(201);
    expect((await violations(b.employee)).map((v: { type: string }) => v.type)).toEqual(['absent']);
    const early = await onShift(-5);
    await api.post(`/api/roster/${early.shift.id}/cancel`).expect(201);
    expect(await violations(early.employee)).toEqual([]);
  });

  it('leaves reviewed absences alone and ignores clients who run their own guards', async () => {
    const g = await onShift(-40);
    await engine.tick();
    await ds.query(`UPDATE violations SET status = 'confirmed' WHERE employee_id = $1`, [g.employee]);
    await clock(g.token, g.shift.id, 'check-in');
    await engine.tick();
    expect((await violations(g.employee)).map((v: { type: string; status: string }) => `${v.type}:${v.status}`)).toEqual(['absent:confirmed']);

    const other = (await api.post('/api/clients', { code: 'TQ', name: 'Tự quản' }).expect(201)).body.data.id;
    const site = (await api.post('/api/sites', { client_id: other, code: 'TS', name: 'Kho' }).expect(201)).body.data.id;
    const h = await onShift(-40, 4, site, other);
    await api.patch(`/api/clients/${other}`, { management_mode: 'self_managed' }).expect(200);
    await engine.tick();
    expect(await violations(h.employee)).toEqual([]);
  });
});
