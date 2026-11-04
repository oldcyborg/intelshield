import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const MONTH = addDays(`${todayLocal().slice(0, 7)}-01`, -1).slice(0, 7);

describe('Payroll — a monthly salary counted fixed or by attendance (e2e)', () => {
  let app: NestExpressApplication;
  let accountant: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'pmm');
    const api = client(app, admin.token);
    accountant = client(app, (await createUserWithRoles(app, admin.tenant.id, ['accountant'])).token);
    ids.lead = (await api.post('/api/employees', { code: 'MM1', full_name: 'Đội trưởng cố định' }).expect(201)).body.data.id;
    ids.guard = (await api.post('/api/employees', { code: 'MM2', full_name: 'Bảo vệ theo công' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('keeps one monthly pay type and records how it is counted', async () => {
    expect((await accountant.put(`/api/employees/${ids.lead}/pay`, { pay_type: 'fixed_monthly', base_pay: 9_100_000 }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const saved = (await accountant.put(`/api/employees/${ids.lead}/pay`, { pay_type: 'monthly', monthly_mode: 'fixed', base_pay: 9_100_000, allowance: 1_000_000 }).expect(200)).body.data;
    expect(saved.pay).toMatchObject({ pay_type: 'monthly', monthly_mode: 'fixed' });
    const plain = (await accountant.put(`/api/employees/${ids.guard}/pay`, { pay_type: 'monthly', base_pay: 7_800_000 }).expect(200)).body.data;
    expect(plain.pay.monthly_mode).toBe('attendance');
  });

  it('pays the fixed one in full with no shift, and the attendance one nothing', async () => {
    const period = (await accountant.post('/api/payroll', { month: MONTH }).expect(201)).body.data;
    const line = (id: string) => period.lines.find((l: { employee_id: string }) => l.employee_id === id);
    expect(line(ids.lead)).toMatchObject({ pay_type: 'monthly', shifts: 0, base_amount: 9_100_000, allowance_amount: 1_000_000, net: 10_100_000 });
    expect(line(ids.lead).detail.fixed).toEqual({ unpaid_days: 0, employed_fraction: 1 });
    expect(line(ids.guard)).toMatchObject({ pay_type: 'monthly', shifts: 0, base_amount: 0 });
    expect(line(ids.guard).detail.fixed).toBeUndefined();
  });
});
