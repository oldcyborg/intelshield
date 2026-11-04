import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Incidents — resend from the app (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let g: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'irp');
    const api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'K', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'S', name: 'Toà' }).expect(201)).body.data.id;
    ids.category = (await api.get('/api/incident-categories').expect(200)).body.data[0].id;
    const guard = async (code: string) => {
      const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
      await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
      return client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e })).token);
    };
    g = await guard('G1');
    other = await guard('G2');
  });
  afterAll(async () => app.close());

  it('answers a resent report with the incident it already made', async () => {
    const body = { client_uuid: randomUUID(), site_id: ids.site, category_id: ids.category, description: 'Cửa kho bị cạy' };
    const a = (await g.post('/api/incidents', body).expect(201)).body.data;
    const b = (await g.post('/api/incidents', body).expect(201)).body.data;
    expect(b.id).toBe(a.id);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM incidents WHERE client_uuid = $1`, [body.client_uuid]);
    expect(n).toBe(1);
    await other.post('/api/incidents', body).expect(409);
  });

  it('makes one incident from two copies sent at once', async () => {
    const body = { client_uuid: randomUUID(), site_id: ids.site, category_id: ids.category, description: 'Gửi đôi' };
    const results = await Promise.all([g.post('/api/incidents', body), g.post('/api/incidents', body)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
  });

  it('sends an SOS without a location, and only once', async () => {
    const uuid = randomUUID();
    const sos = (await g.post('/api/incidents/sos', { client_uuid: uuid }).expect(201)).body.data;
    expect(sos).toMatchObject({ is_sos: true, severity: 'critical', lat: null, lng: null });
    expect((await g.post('/api/incidents/sos', { client_uuid: uuid }).expect(201)).body.data.id).toBe(sos.id);
  });
});
