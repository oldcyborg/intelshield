import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

type Api = ReturnType<typeof client>;
interface Line { employee_name: string; id: string; [k: string]: unknown }

/** Last month, as YYYY-MM, and a day of it. */
const today = todayLocal();
const firstOfThis = `${today.slice(0, 7)}-01`;
const MONTH = addDays(firstOfThis, -1).slice(0, 7);
const day = (n: number) => `${MONTH}-${String(n).padStart(2, '0')}`;

describe('Payroll (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: Api;
  let accountant: Api;
  let hr: Api;
  let manager: Api;
  const ids: Record<string, string> = {};
  const guards: Record<string, Api> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'pay');
    api = client(app, admin.token);
    accountant = client(app, (await createUserWithRoles(app, admin.tenant.id, ['accountant'])).token);
    hr = client(app, (await createUserWithRoles(app, admin.tenant.id, ['hr'])).token);
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    ids.client = (await api.post('/api/clients', { code: 'PK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'PS', name: 'Toà' }).expect(201)).body.data.id;
    for (const [code, name] of [['A', 'An Lương Tháng'], ['B', 'Bình Lương Ca'], ['C', 'Cường Chưa Hồ Sơ']]) {
      ids[code] = (await api.post('/api/employees', { code: `P${code}`, full_name: name }).expect(201)).body.data.id;
      guards[code] = client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: ids[code] })).token);
    }
    await accountant.put(`/api/employees/${ids.A}/pay`, { pay_type: 'monthly', base_pay: 7_800_000, allowance: 520_000, social_insurance: 400_000 }).expect(200);
    await accountant.put(`/api/employees/${ids.B}/pay`, { pay_type: 'per_shift', base_pay: 300_000 }).expect(200);

    for (let d = 1; d <= 13; d += 1) await work(ids.A, day(d), 720);
    await work(ids.A, day(14), null);
    await work(ids.B, day(2), 720);
    await work(ids.B, day(3), 360);
    await work(ids.C, day(5), 720);
    await violation(ids.A, day(20), 'late_check_in', 'confirmed');
    await violation(ids.A, day(21), 'late_check_in', 'auto');
  });
  afterAll(async () => app.close());

  /** A 12-hour day shift already worked: straight into the tables, as attendance from the past cannot be made today. */
  async function work(employeeId: string, date: string, worked: number | null) {
    const [a] = await ds.query(
      `INSERT INTO shift_assignments (tenant_id, site_id, employee_id, shift_date, planned_start, planned_end)
       VALUES ($1, $2, $3, $4, ($4::date + time '06:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', ($4::date + time '18:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') RETURNING id, planned_start`,
      [admin.tenant.id, ids.site, employeeId, date],
    );
    await ds.query(
      `INSERT INTO attendances (tenant_id, assignment_id, employee_id, check_in_at, check_out_at, worked_minutes)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE $4::timestamptz + make_interval(mins => $5::int) END, $5::int)`,
      [admin.tenant.id, a.id, employeeId, a.planned_start, worked],
    );
    return a.id as string;
  }

  async function violation(employeeId: string, date: string, type: string, status: string) {
    const ref = await work(employeeId, date, 720);
    await ds.query(
      `INSERT INTO violations (tenant_id, site_id, employee_id, type, ref_type, ref_id, occurred_at, status)
       VALUES ($1, $2, $3, $4, 'assignment', $5, ($6::date + time '06:20') AT TIME ZONE 'Asia/Ho_Chi_Minh', $7)`,
      [admin.tenant.id, ids.site, employeeId, type, ref, date, status],
    );
  }

  const line = (period: { lines: Line[] }, name: string) => period.lines.find((l) => l.employee_name === name)!;

  it('keeps pay rules to payroll managers, billing terms to billing managers', async () => {
    const got = (await hr.get('/api/finance/settings').expect(200)).body.data;
    expect(got.values).toMatchObject({ standard_shifts: 26, holiday_coefficient: 3, overtime_coefficient: 1.5, vat_rate: 10, payment_terms_days: 15 });
    await hr.put('/api/finance/settings', { standard_shifts: 30 }).expect(403);
    await manager.get('/api/finance/settings').expect(403);
    await accountant.put('/api/finance/settings', { penalties: { teleport: 1 } }).expect(400);
    const saved = (await accountant.put('/api/finance/settings', { penalties: { late_check_in: 50_000 }, holidays: [day(3), day(3)], vat_rate: 8 }).expect(200)).body.data;
    expect(saved.values).toMatchObject({ penalties: { late_check_in: 50_000 }, holidays: [day(3)], vat_rate: 8 });
  });

  it('works out a month from attendance, confirmed violations and pay records', async () => {
    await accountant.post('/api/payroll', { month: addDays(today, 40).slice(0, 7) }).expect(400);
    const period = (await accountant.post('/api/payroll', { month: MONTH }).expect(201)).body.data;
    ids.period = period.id;
    expect(period).toMatchObject({ month: MONTH, status: 'draft' });
    expect((await accountant.post('/api/payroll', { month: MONTH }).expect(409)).body.error.code).toBe('PAYROLL_EXISTS');

    // An: 15 full shifts out of 26 (one on the holiday), one without a clock-out; one confirmed late of two.
    const a = line(period, 'An Lương Tháng');
    expect(a).toMatchObject({
      shifts: 16, normal_units: 14, holiday_units: 1, base_amount: 4_200_000, holiday_amount: 900_000, allowance_amount: 300_000,
      violation_amount: 50_000, social_insurance: 400_000, gross: 5_400_000, net: 4_950_000,
    });
    expect(a.warnings).toEqual(['1 ca chưa có giờ ra — chưa tính công']);
    // Bình: half a shift on a holiday.
    expect(line(period, 'Bình Lương Ca')).toMatchObject({ normal_units: 1, holiday_units: 0.5, base_amount: 300_000, holiday_amount: 450_000, net: 750_000 });
    expect(line(period, 'Cường Chưa Hồ Sơ')).toMatchObject({ shifts: 1, net: 0, warnings: ['Chưa có hồ sơ lương — chưa tính được lương'] });

    expect((await hr.get('/api/payroll').expect(200)).body.data[0]).toMatchObject({ month: MONTH, people: 3, total_net: 5_700_000 });
    await manager.get('/api/payroll').expect(403);
    await hr.post(`/api/payroll/${ids.period}/lock`).expect(403);
  });

  it('keeps typed adjustments through a recompute', async () => {
    const b = line((await accountant.get(`/api/payroll/${ids.period}`).expect(200)).body.data, 'Bình Lương Ca');
    await accountant.put(`/api/payroll-lines/${b.id}/adjustments`, { items: [{ kind: 'advance', amount: -5 }] }).expect(400);
    const after = (await accountant.put(`/api/payroll-lines/${b.id}/adjustments`, {
      items: [{ kind: 'bonus', amount: 200_000, note: 'Thưởng chuyên cần' }, { kind: 'advance', amount: 100_000 }, { kind: 'other', amount: -50_000, note: 'Mất bộ đàm' }],
    }).expect(200)).body.data;
    expect(line(after, 'Bình Lương Ca')).toMatchObject({ gross: 950_000, deductions: 150_000, net: 800_000 });

    await accountant.put(`/api/employees/${ids.B}/pay`, { pay_type: 'per_shift', base_pay: 320_000 }).expect(200);
    const again = (await accountant.post(`/api/payroll/${ids.period}/recompute`).expect(201)).body.data;
    expect(line(again, 'Bình Lương Ca')).toMatchObject({ base_amount: 320_000, holiday_amount: 480_000, net: 850_000 });
    expect(line(again, 'Bình Lương Ca').adjustments).toHaveLength(3);
  });

  it('shows each guard their own payslip once locked, and nothing changes after', async () => {
    expect((await guards.B.get('/api/me/payslips').expect(200)).body.data).toEqual([]);
    await guards.B.get(`/api/me/payslips/${ids.period}`).expect(404);

    await accountant.post(`/api/payroll/${ids.period}/lock`).expect(201);
    const b = line((await accountant.get(`/api/payroll/${ids.period}`).expect(200)).body.data, 'Bình Lương Ca');
    expect((await accountant.put(`/api/payroll-lines/${b.id}/adjustments`, { items: [] }).expect(409)).body.error.code).toBe('PAYROLL_LOCKED');
    await accountant.post(`/api/payroll/${ids.period}/recompute`).expect(409);

    expect((await guards.B.get('/api/me/payslips').expect(200)).body.data).toEqual([expect.objectContaining({ month: MONTH, status: 'locked', net: 850_000 })]);
    const told = (await guards.B.get('/api/me/notifications').expect(200)).body.data;
    expect(JSON.stringify(told)).toContain('payslip.ready');
    const slip = (await guards.B.get(`/api/me/payslips/${ids.period}`).expect(200)).body.data;
    expect(slip).toMatchObject({ employee_name: 'Bình Lương Ca', net: 850_000 });
    expect(slip.adjustments).toHaveLength(3);
    // Nobody sees another person's pay through their own payslips.
    expect((await guards.A.get(`/api/me/payslips/${ids.period}`).expect(200)).body.data.employee_name).toBe('An Lương Tháng');
  });

  it('reopens with a reason until paid, then never', async () => {
    await accountant.post(`/api/payroll/${ids.period}/unlock`, {}).expect(400);
    await accountant.post(`/api/payroll/${ids.period}/unlock`, { reason: 'Sửa thưởng' }).expect(201);
    expect((await guards.B.get('/api/me/payslips').expect(200)).body.data).toEqual([]);
    await accountant.post(`/api/payroll/${ids.period}/paid`, { paid_on: today }).expect(409);
    await accountant.post(`/api/payroll/${ids.period}/lock`).expect(201);
    const paid = (await accountant.post(`/api/payroll/${ids.period}/paid`, { paid_on: today, note: 'Chuyển khoản' }).expect(201)).body.data;
    expect(paid).toMatchObject({ status: 'paid', paid_on: today, note: 'Chuyển khoản' });
    expect((await accountant.post(`/api/payroll/${ids.period}/unlock`, { reason: 'x' }).expect(409)).body.error.code).toBe('PAYROLL_PAID');
  });
});
