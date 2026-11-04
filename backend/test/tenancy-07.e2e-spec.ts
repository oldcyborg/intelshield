import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for violations (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let apiA: ReturnType<typeof client>;
  let bViolation: string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso7-a');
    const b = await createTenantWithAdmin(app, 'iso7-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const c = (await apiB.post('/api/clients', { code: 'K', name: 'B' }).expect(201)).body.data.id;
    const site = (await apiB.post('/api/sites', { client_id: c, code: 'S', name: 'B' }).expect(201)).body.data.id;
    const e = (await apiB.post('/api/employees', { code: 'E', full_name: 'B' }).expect(201)).body.data.id;
    [{ id: bViolation }] = await ds.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at)
       VALUES ($1, $2, $3, 'absent', 'assignment', gen_random_uuid(), now()) RETURNING id`,
      [b.tenant.id, e, site],
    );
  });
  afterAll(async () => app.close());

  it("keeps B's violations out of A's lists and actions", async () => {
    expect((await apiA.get('/api/violations').expect(200)).body.data.map((v: { id: string }) => v.id)).not.toContain(bViolation);
    expect((await apiA.get('/api/violations/summary').expect(200)).body.data.auto).toBe(0);
    await apiA.post(`/api/violations/${bViolation}/propose`, { decision: 'confirm' }).expect(404);
    await apiA.post(`/api/violations/${bViolation}/review`, { decision: 'confirm' }).expect(404);
  });
});
