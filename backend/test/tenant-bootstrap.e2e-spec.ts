import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { ALL_PERMISSIONS } from '../src/access/permissions';
import { PermissionService } from '../src/access/permission.service';
import { ScopeService } from '../src/access/scope.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { createTestApp } from './helpers';

describe('Tenant bootstrap (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let tenants: TenantsService;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    tenants = app.get(TenantsService);
  });
  afterAll(async () => app.close());

  const admin = (phone: string) => ({ full_name: 'Giám đốc', phone, password: 'Admin@12345' });

  it('creates the company with its six system roles and an all-powerful admin', async () => {
    const { tenant, admin_user_id } = await tenants.createTenant(
      { code: 'alpha', name: 'Alpha', admin: admin('+84 901 000 001') },
      null,
    );

    const roles: { code: string }[] = await ds.query(`SELECT code FROM roles WHERE tenant_id = $1 ORDER BY code`, [tenant.id]);
    expect(roles.map((r) => r.code)).toEqual(['accountant', 'admin', 'guard', 'hr', 'manager', 'team_leader']);

    const [user] = await ds.query(`SELECT phone, user_type FROM users WHERE id = $1`, [admin_user_id]);
    expect(user).toEqual({ phone: '0901000001', user_type: 'staff' });

    const permissions = await app.get(PermissionService).permissionsOf(admin_user_id);
    expect([...permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());

    const visibility = await app.get(ScopeService).teamVisibility({
      id: admin_user_id, tenant_id: tenant.id, user_type: 'staff', employee_id: null, session_id: 'n/a',
    });
    expect(visibility).toEqual({ all: true });

    const audit = await ds.query(`SELECT action FROM audit_logs WHERE tenant_id = $1`, [tenant.id]);
    expect(audit).toEqual([{ action: 'tenant.create' }]);
  });

  it('refuses a duplicate company code', async () => {
    await expect(
      tenants.createTenant({ code: 'alpha', name: 'Alpha 2', admin: admin('0901000002') }, null),
    ).rejects.toMatchObject({ code: 'TENANT_CODE_TAKEN' });
  });

  it('rolls the whole company back when the admin phone is already used', async () => {
    await expect(
      tenants.createTenant({ code: 'beta', name: 'Beta', admin: admin('0901.000.001') }, null),
    ).rejects.toMatchObject({ code: 'USER_IDENTIFIER_TAKEN' });
    expect(await ds.query(`SELECT 1 FROM tenants WHERE code = 'beta'`)).toHaveLength(0);
  });

  it('rejects a malformed phone number', async () => {
    await expect(
      tenants.createTenant({ code: 'gamma', name: 'Gamma', admin: admin('12345') }, null),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
