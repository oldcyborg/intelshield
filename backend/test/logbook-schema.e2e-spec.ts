import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTenantWithAdmin, createTestApp } from './helpers';

describe('Logbook — roles (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'lbs');
  });
  afterAll(async () => app.close());

  it('lets guards write, leaders write and review handovers, managers read and manage', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND (rp.permission LIKE 'logbook.%' OR rp.permission LIKE 'handover.%')`,
      [admin.tenant.id],
    );
    const of = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission).sort();
    expect(of('guard')).toEqual(['logbook.write']);
    expect(of('team_leader')).toEqual(['handover.review', 'logbook.view', 'logbook.write']);
    expect(of('manager')).toEqual(['handover.review', 'logbook.manage', 'logbook.view']);
    expect(of('hr')).toEqual(['logbook.view', 'logbook.write']);
    expect(of('accountant')).toEqual([]);
  });
});
