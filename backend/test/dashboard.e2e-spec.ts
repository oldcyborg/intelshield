import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Company dashboard (e2e)', () => {
  let app: NestExpressApplication;
  const today = todayLocal();
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(async () => app.close());

  it('counts posted and idle guards, flags expiring contracts, shortfalls and expiring papers', async () => {
    const admin = await createTenantWithAdmin(app, 'dash');
    const api = client(app, admin.token);
    const emp = async (code: string) => (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data;
    const [a, b, c] = [await emp('A'), await emp('B'), await emp('C')];
    const k1 = (await api.post('/api/clients', { code: 'K1', name: 'Toà K1' }).expect(201)).body.data;

    const contract = (
      await api
        .post('/api/contracts', {
          client_id: k1.id, contract_no: 'HD-DASH', start_date: addDays(today, -300), end_date: addDays(today, 12),
          lines: [{ position: 'guard', headcount: 3, unit: 'per_guard_month', unit_price: 8000000 }],
        })
        .expect(201)
    ).body.data;
    await api.patch(`/api/contracts/${contract.id}`, { state: 'signed' }).expect(200);
    await api.post('/api/deployments', { employee_id: a.id, client_id: k1.id, contract_id: contract.id }).expect(201);
    await api.post('/api/deployments', { employee_id: b.id, client_id: k1.id, contract_id: contract.id }).expect(201);
    await api.post(`/api/employees/${c.id}/documents`, { kind: 'security_certificate', expires_on: addDays(today, 5) }).expect(201);

    const d = (await api.get('/api/dashboard/company').expect(200)).body.data;
    expect(d.guards).toEqual({ active: 3, deployed: 2, idle: 1 });
    expect(d.expiring_contracts).toEqual([
      expect.objectContaining({ id: contract.id, client_name: 'Toà K1', days_left: 12, status: 'expiring' }),
    ]);
    expect(d.shortfalls).toEqual([
      expect.objectContaining({ contract_id: contract.id, position: 'guard', headcount: 3, deployed: 2 }),
    ]);
    expect(d.expiring_documents).toEqual([expect.objectContaining({ employee_id: c.id, kind: 'security_certificate', days_left: 5 })]);

    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const seen = (await client(app, manager.token).get('/api/dashboard/company').expect(200)).body.data;
    expect(seen.expiring_documents).toEqual([]);
    expect(seen.expiring_contracts).toEqual([]);
  });
});
