import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Pay and leave allowance (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let employee: string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'pay');
    employee = (await client(app, admin.token).post('/api/employees', { code: 'P1', full_name: 'Bảo vệ P' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('grants the new permissions to the right roles', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND (rp.permission LIKE 'employee.pay.%' OR rp.permission LIKE 'leave.%' OR rp.permission LIKE 'attendance.correct.%')`,
      [admin.tenant.id],
    );
    const of = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission).sort();
    expect(of('admin')).toEqual(['attendance.correct.propose', 'attendance.correct.review', 'employee.pay.manage', 'employee.pay.view', 'leave.review']);
    expect(of('manager')).toEqual(['attendance.correct.propose', 'attendance.correct.review', 'leave.review']);
    expect(of('team_leader')).toEqual(['attendance.correct.propose', 'leave.review']);
    expect(of('hr')).toEqual(['employee.pay.manage', 'employee.pay.view']);
    expect(of('accountant')).toEqual(['employee.pay.manage', 'employee.pay.view']);
    expect(of('guard')).toEqual([]);
  });

  it('keeps pay apart: HR sets and reads it, a manager cannot, the profile never shows it', async () => {
    const hr = client(app, (await createUserWithRoles(app, admin.tenant.id, ['hr'], [{ scope_type: 'tenant' }])).token);
    const empty = (await hr.get(`/api/employees/${employee}/pay`).expect(200)).body.data;
    expect(empty.pay).toBeNull();
    expect(empty.leave).toMatchObject({ allowance: null, used: 0, remaining: null });

    const saved = (await hr.put(`/api/employees/${employee}/pay`, {
      pay_type: 'monthly', base_pay: 6500000, allowance: 500000, bank_name: 'VCB', bank_account: '0011223344', annual_leave_days: 12,
    }).expect(200)).body.data;
    expect(saved.pay).toMatchObject({ pay_type: 'monthly', base_pay: 6500000, allowance: 500000, bank_account: '0011223344', annual_leave_days: 12 });
    expect(saved.leave).toMatchObject({ allowance: 12, used: 0, remaining: 12 });

    const manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'], [])).token);
    await manager.get(`/api/employees/${employee}/pay`).expect(403);
    const profile = (await client(app, admin.token).get(`/api/employees/${employee}/profile`).expect(200)).body.data;
    expect(JSON.stringify(profile)).not.toContain('0011223344');

    const [audit] = await ds.query(`SELECT data FROM audit_logs WHERE action = 'employee.pay.update' AND entity_id = $1`, [employee]);
    expect(audit.data.after.annual_leave_days).toBe(12);
  });

  it('clears the allowance back to "not tracked" and refuses nonsense', async () => {
    const api = client(app, admin.token);
    const r = (await api.put(`/api/employees/${employee}/pay`, { pay_type: 'per_shift', base_pay: 250000, annual_leave_days: null }).expect(200)).body.data;
    expect(r.leave.allowance).toBeNull();
    await api.put(`/api/employees/${employee}/pay`, { pay_type: 'weekly' }).expect(400);
    await api.put(`/api/employees/${employee}/pay`, { pay_type: 'monthly', annual_leave_days: 400 }).expect(400);
  });

  it('shows a guard their own leave balance', async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee });
    const r = (await client(app, g.token).get('/api/me/leave-balance').expect(200)).body.data;
    expect(r).toMatchObject({ allowance: null, used: 0 });
    await client(app, g.token).get(`/api/employees/${employee}/pay`).expect(403);
  });
});
