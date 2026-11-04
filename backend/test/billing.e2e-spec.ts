import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

type Api = ReturnType<typeof client>;
interface Line { id: string; kind: string; description: string; quantity: number; amount: number; applied: boolean; detail: { shifts?: { employee: string }[] } }

const today = todayLocal();
const MONTH = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
const [y, m] = MONTH.split('-').map(Number);
const DAYS = new Date(Date.UTC(y, m, 0)).getUTCDate();
const day = (n: number) => `${MONTH}-${String(n).padStart(2, '0')}`;

describe('Billing (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: Api;
  let accountant: Api;
  let manager: Api;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'bil');
    api = client(app, admin.token);
    accountant = client(app, (await createUserWithRoles(app, admin.tenant.id, ['accountant'])).token);
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    for (const c of ['1', '2']) {
      ids[`client${c}`] = (await api.post('/api/clients', { code: `BC${c}`, name: `Khách ${c}` }).expect(201)).body.data.id;
      ids[`site${c}`] = (await api.post('/api/sites', { client_id: ids[`client${c}`], code: `BS${c}`, name: `Toà ${c}` }).expect(201)).body.data.id;
    }
    ids.k1 = await contract(ids.client1, 'HD-1', addDays(day(1), -30), [{ position: 'guard', headcount: 2, unit: 'per_guard_month', unit_price: 9_000_000 }]);
    ids.k2 = await contract(ids.client2, 'HD-2', day(11), [{ position: 'guard', headcount: 1, unit: 'per_shift', unit_price: 400_000 }]);
    ids.k3 = await contract(ids.client2, 'HD-3', day(11), [{ position: 'team_leader', headcount: 1, unit: 'per_guard_month', unit_price: 6_000_000 }]);
    for (const n of ['A', 'B', 'C']) ids[n] = (await api.post('/api/employees', { code: `BE${n}`, full_name: `Bảo vệ ${n}` }).expect(201)).body.data.id;

    for (const d of [2, 3, 4]) await shift(ids.site1, ids.A, day(d), true);
    await shift(ids.site1, ids.A, day(6), false);
    const noShow = await shift(ids.site1, ids.A, day(7), false);
    await shift(ids.site1, ids.B, day(7), true, noShow);
    await onLeave(ids.A, day(9), '06:00');
    await shift(ids.site2, ids.C, day(5), true);
    await shift(ids.site2, ids.C, day(12), true);
    await shift(ids.site2, ids.C, day(13), true);
    await shift(ids.site2, ids.C, day(14), false);
  });
  afterAll(async () => app.close());

  async function contract(clientId: string, no: string, start: string, lines: object[]) {
    const id = (await api.post('/api/contracts', { client_id: clientId, contract_no: no, start_date: start, end_date: addDays(today, 300), lines }).expect(201)).body.data.id;
    await api.patch(`/api/contracts/${id}`, { state: 'signed' }).expect(200);
    return id as string;
  }

  /** A day shift, worked or not; `cover` makes it the substitute of a no-show. */
  async function shift(siteId: string, employeeId: string, date: string, worked: boolean, cover?: string) {
    const [a] = await ds.query(
      `INSERT INTO shift_assignments (tenant_id, site_id, employee_id, shift_date, planned_start, planned_end, substitute_for_id)
       VALUES ($1, $2, $3, $4, ($4::date + time '06:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', ($4::date + time '18:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', $5)
       RETURNING id, planned_start`,
      [admin.tenant.id, siteId, employeeId, date, cover ?? null],
    );
    if (worked) {
      await ds.query(
        `INSERT INTO attendances (tenant_id, assignment_id, employee_id, check_in_at, check_out_at, worked_minutes) VALUES ($1, $2, $3, $4, $4::timestamptz + interval '12 hours', 720)`,
        [admin.tenant.id, a.id, employeeId, a.planned_start],
      );
    }
    return a.id as string;
  }

  /** A shift cancelled for an approved day off, nobody covering; `at` its start that day (local time). */
  async function onLeave(employeeId: string, date: string, at: string) {
    const [leave] = await ds.query(
      `INSERT INTO leave_requests (tenant_id, employee_id, type, from_date, to_date, days, created_by, client_uuid, status)
       VALUES ($1, $2, 'personal', $3, $3, 1, $4, gen_random_uuid(), 'approved') RETURNING id`,
      [admin.tenant.id, employeeId, date, admin.adminUserId],
    );
    await ds.query(
      `INSERT INTO shift_assignments (tenant_id, site_id, employee_id, shift_date, planned_start, planned_end, status, leave_request_id)
       VALUES ($1, $2, $3, $4, ($4::date + $5::time) AT TIME ZONE 'Asia/Ho_Chi_Minh', ($4::date + $5::time) AT TIME ZONE 'Asia/Ho_Chi_Minh' + interval '30 minutes',
               'cancelled', $6)`,
      [admin.tenant.id, ids.site1, employeeId, date, at, leave.id],
    );
  }

  const statement = async (contractId: string) => {
    const list = (await accountant.get(`/api/billing?month=${MONTH}`).expect(200)).body.data;
    return (await accountant.get(`/api/billing/${list.find((s: { contract_id: string }) => s.contract_id === contractId).id}`).expect(200)).body.data;
  };

  it('drafts one statement per contract in force, once', async () => {
    await manager.get('/api/billing').expect(403);
    await accountant.post('/api/billing', { month: addDays(today, 40).slice(0, 7) }).expect(400);
    expect((await accountant.post('/api/billing', { month: MONTH }).expect(201)).body.data.created).toBe(3);
    expect((await accountant.post('/api/billing', { month: MONTH }).expect(201)).body.data.created).toBe(0);
  });

  it('bills people-a-month by the contract and suggests, but does not apply, a deduction for unguarded shifts', async () => {
    const s = await statement(ids.k1);
    const [main, short] = s.lines as Line[];
    expect(main).toMatchObject({ kind: 'contract', quantity: 2, amount: 18_000_000, applied: true });
    // Two no-shows and a day off nobody covered; the no-show a substitute covered is not a gap.
    expect(short).toMatchObject({ kind: 'shortfall', quantity: 2, amount: -692_308, applied: false });
    expect(short.detail.shifts).toEqual([expect.objectContaining({ employee: 'Bảo vệ A', reason: 'absent' }), expect.objectContaining({ employee: 'Bảo vệ A', reason: 'leave' })]);
    expect(s).toMatchObject({ status: 'draft', vat_rate: 10, subtotal: 18_000_000, vat_amount: 1_800_000, total: 19_800_000 });
  });

  it('bills shifts worked from the day the contract starts, and a part month pro rata', async () => {
    const k2 = await statement(ids.k2);
    expect(k2.lines).toEqual([expect.objectContaining({ quantity: 2, amount: 800_000 })]);
    const k3 = await statement(ids.k3);
    expect(k3.lines[0]).toMatchObject({ quantity: Math.round(((DAYS - 10) / DAYS) * 100) / 100, amount: Math.round((6_000_000 * (DAYS - 10)) / DAYS) });
  });

  it('lets the accountant apply the deduction, add extras and change VAT — kept through a recompute', async () => {
    const s = await statement(ids.k1);
    const short = (s.lines as Line[]).find((l) => l.kind === 'shortfall')!;
    await accountant.patch(`/api/billing-lines/${short.id}/shortfall`, { applied: true, note: 'Khách đồng ý trừ' }).expect(200);
    await accountant.post(`/api/billing/${s.id}/lines`, { description: 'Tăng cường 2 bảo vệ dịp lễ', amount: 500_000 }).expect(201);
    await accountant.patch(`/api/billing/${s.id}`, { vat_rate: 8 }).expect(200);
    const after = (await accountant.post(`/api/billing/${s.id}/recompute`).expect(201)).body.data;
    expect(after).toMatchObject({ subtotal: 17_807_692, vat_amount: 1_424_615, total: 19_232_307 });
    expect((after.lines as Line[]).find((l) => l.kind === 'shortfall')).toMatchObject({ applied: true });
    const main = (after.lines as Line[]).find((l) => l.kind === 'contract')!;
    expect((await accountant.delete(`/api/billing-lines/${main.id}`).expect(400)).body.error.code).toBe('BILLING_LINE_LOCKED');
  });

  it('issues a numbered request, takes payments up to the total, and reopens only without payments', async () => {
    const s = await statement(ids.k1);
    expect((await accountant.post(`/api/billing/${s.id}/payments`, { paid_on: today, amount: 1, method: 'cash' }).expect(409)).body.error.code).toBe('BILLING_NOT_ISSUED');
    const issued = (await accountant.post(`/api/billing/${s.id}/issue`).expect(201)).body.data;
    expect(issued).toMatchObject({ status: 'issued', code: `DNTT-${MONTH.replace('-', '')}-001`, issued_on: today, due_date: addDays(today, 15), company_name: expect.any(String) });
    expect((await accountant.patch(`/api/billing/${s.id}`, { vat_rate: 10 }).expect(409)).body.error.code).toBe('BILLING_ISSUED');

    const paid = (await accountant.post(`/api/billing/${s.id}/payments`, { paid_on: today, amount: 10_000_000, method: 'transfer', reference: 'UNC 123' }).expect(201)).body.data;
    expect(paid).toMatchObject({ paid: 10_000_000, balance: 9_232_307 });
    expect((await accountant.post(`/api/billing/${s.id}/payments`, { paid_on: today, amount: 9_232_308, method: 'cash' }).expect(400)).body.error.code).toBe('BILLING_OVERPAID');
    expect((await accountant.get('/api/billing/debts').expect(200)).body.data).toEqual([expect.objectContaining({ client_name: 'Khách 1', balance: 9_232_307, overdue: 0 })]);

    expect((await accountant.post(`/api/billing/${s.id}/reopen`, { reason: 'Sửa' }).expect(409)).body.error.code).toBe('BILLING_HAS_PAYMENTS');
    await accountant.post(`/api/billing-payments/${paid.payments[0].id}/remove`, { reason: 'Nhập nhầm' }).expect(201);
    const reopened = (await accountant.post(`/api/billing/${s.id}/reopen`, { reason: 'Sửa VAT' }).expect(201)).body.data;
    expect(reopened).toMatchObject({ status: 'draft', code: issued.code, paid: 0 });
    expect((await accountant.post(`/api/billing/${s.id}/issue`).expect(201)).body.data.code).toBe(issued.code);
    const second = (await accountant.post(`/api/billing/${(await statement(ids.k2)).id}/issue`).expect(201)).body.data;
    expect(second.code).toBe(`DNTT-${MONTH.replace('-', '')}-002`);
  });

  it('does not count a day off still ahead as unguarded', async () => {
    const soon = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + 3_600_000));
    // An hour from now, today — unless that is already tomorrow.
    if (soon < '01:00') return;
    await onLeave(ids.B, today, soon);
    const thisMonth = today.slice(0, 7);
    await accountant.post('/api/billing', { month: thisMonth }).expect(201);
    const list = (await accountant.get(`/api/billing?month=${thisMonth}`).expect(200)).body.data;
    const s = (await accountant.get(`/api/billing/${list.find((x: { contract_id: string }) => x.contract_id === ids.k1).id}`).expect(200)).body.data;
    expect((s.lines as Line[]).some((l) => l.kind === 'shortfall')).toBe(false);
  });
});
