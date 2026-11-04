import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

/** Regressions found by the Plan 04 final review. */
describe('Plan 04 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'rev4');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  it('after a phone is revoked, any other phone waits for HR instead of becoming the new one', async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    await loginOnDevice(app, g.phone, g.password, 'rev-phone-0001');
    const device = (await api.get('/api/devices').expect(200)).body.data.find((d: { user_id: string }) => d.user_id === g.user.id);
    await api.post(`/api/devices/${device.id}/revoke`).expect(201);
    const next = await loginOnDevice(app, g.phone, g.password, 'anything-9999');
    expect(next.status).toBe(403);
    expect(next.body.error.code).toBe('DEVICE_PENDING');
  });

  it('refuses a selfie taken long before the clock-in', async () => {
    const c = (await api.post('/api/clients', { code: 'RK', name: 'K' }).expect(201)).body.data.id;
    const site = (await api.post('/api/sites', { client_id: c, code: 'RS', name: 'S' }).expect(201)).body.data.id;
    const e = (await api.post('/api/employees', { code: 'RE', full_name: 'E' }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: e, client_id: c, start_date: addDays(todayLocal(), -1) }).expect(201);
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const phone = await loginOnDevice(app, g.phone, g.password, 'rev-phone-0002');
    const shift = (await api.post('/api/roster', { site_id: site, employee_id: e, start_at: new Date(Date.now() - 60_000).toISOString(), end_at: new Date(Date.now() + 3_600_000).toISOString() }).expect(201)).body.data;
    const file = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${phone.token}`).attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 's.jpg').expect(201)).body.data.id;
    await ds.query(`UPDATE files SET created_at = now() - interval '30 minutes' WHERE id = $1`, [file]);
    const res = await client(app, phone.token!).post('/api/attendance/check-in', { assignment_id: shift.id, lat: 21, lng: 105, selfie_file_id: file, device_time: new Date().toISOString() }).expect(400);
    expect(res.body.error.code).toBe('ATTENDANCE_SELFIE_INVALID');
  });

  it('refuses one-off shift times without a time zone', async () => {
    const c = (await api.post('/api/clients', { code: 'RK2', name: 'K' }).expect(201)).body.data.id;
    const site = (await api.post('/api/sites', { client_id: c, code: 'RS2', name: 'S' }).expect(201)).body.data.id;
    const e = (await api.post('/api/employees', { code: 'RE2', full_name: 'E' }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: e, client_id: c, start_date: todayLocal() }).expect(201);
    const d = addDays(todayLocal(), 5);
    await api.post('/api/roster', { site_id: site, employee_id: e, start_at: `${d}T22:00`, end_at: `${addDays(d, 1)}T06:00` }).expect(400);
    await api.post('/api/roster', { site_id: site, employee_id: e, start_at: `${d}T22:00+07:00`, end_at: `${addDays(d, 1)}T06:00+07:00` }).expect(201);
  });
});
