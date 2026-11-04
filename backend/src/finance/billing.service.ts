import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { ExtraLineDto, PaymentDto, ShortfallDto, StatementPatchDto } from './dto';
import { FinanceSettingsService } from './finance-settings.service';
import { daysInclusive, monthBounds } from './month';

interface Statement {
  id: string;
  tenant_id: string;
  client_id: string;
  contract_id: string;
  month: string;
  status: 'draft' | 'issued';
  vat_rate: string;
}

interface ContractLine {
  id: string;
  position: string;
  headcount: number;
  unit: 'per_guard_month' | 'per_shift' | 'per_hour';
  unit_price: string;
  effective_from: string;
  effective_to: string | null;
}

interface ShiftRow {
  shift_date: string;
  position: string;
  status: 'planned' | 'cancelled';
  on_leave: boolean;
  attended: boolean;
  covered: boolean;
  over: boolean;
  planned_minutes: number;
  worked_minutes: number | null;
  employee_name: string;
  site_name: string;
}

const POSITION: Record<string, string> = { guard: 'Bảo vệ', team_leader: 'Đội trưởng', supervisor: 'Giám sát' };
const UNIT: Record<string, string> = { per_guard_month: 'người·tháng', per_shift: 'ca', per_hour: 'giờ' };
const two = (n: number) => Math.round(n * 100) / 100;

const STATEMENT_ROWS = `
  SELECT b.id, b.code, to_char(b.month, 'YYYY-MM') AS month, b.status, b.client_id, c.name AS client_name, b.contract_id, k.contract_no,
         b.vat_rate::float AS vat_rate, b.subtotal::float AS subtotal, b.vat_amount::float AS vat_amount, b.total::float AS total,
         b.issued_on::text AS issued_on, iu.full_name AS issued_by_name, b.due_date::text AS due_date, b.note, b.computed_at,
         COALESCE(p.paid, 0)::float AS paid, (b.total - COALESCE(p.paid, 0))::float AS balance,
         CASE WHEN b.status = 'issued' AND b.due_date < $2::date AND b.total > COALESCE(p.paid, 0) THEN ($2::date - b.due_date) ELSE 0 END AS overdue_days
    FROM billing_statements b
    JOIN clients c ON c.id = b.client_id
    JOIN contracts k ON k.id = b.contract_id
    LEFT JOIN users iu ON iu.id = b.issued_by
    LEFT JOIN (SELECT statement_id, sum(amount) AS paid FROM billing_payments WHERE deleted_at IS NULL GROUP BY statement_id) p ON p.statement_id = b.id
   WHERE b.tenant_id = $1`;

@Injectable()
export class BillingService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly settings: FinanceSettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: { month?: string; client_id?: string }) {
    await this.scopes.assertTenantScope(actor);
    const params: unknown[] = [tenantOf(actor), todayLocal()];
    let sql = STATEMENT_ROWS;
    if (filter.month) {
      params.push(`${filter.month}-01`);
      sql += ` AND b.month = $${params.length}`;
    }
    if (filter.client_id) {
      params.push(filter.client_id);
      sql += ` AND b.client_id = $${params.length}`;
    }
    return this.ds.query(`${sql} ORDER BY b.month DESC, c.name, k.contract_no`, params);
  }

  /** What each client owes on issued requests: in total, and past the due date. */
  async debts(actor: AuthUser) {
    await this.scopes.assertTenantScope(actor);
    return this.ds.query(
      `WITH s AS (${STATEMENT_ROWS} AND b.status = 'issued')
       SELECT client_id, client_name, count(*)::int AS statements, sum(total)::float AS billed, sum(paid)::float AS paid, sum(balance)::float AS balance,
              sum(CASE WHEN overdue_days > 0 THEN balance ELSE 0 END)::float AS overdue, max(overdue_days)::int AS max_overdue_days
         FROM s GROUP BY client_id, client_name HAVING sum(balance) <> 0 OR count(*) > 0
        ORDER BY sum(CASE WHEN overdue_days > 0 THEN balance ELSE 0 END) DESC, sum(balance) DESC`,
      [tenantOf(actor), todayLocal()],
    );
  }

  async get(actor: AuthUser, id: string) {
    await this.scopes.assertTenantScope(actor);
    const tenantId = tenantOf(actor);
    const [row] = await this.ds.query(`${STATEMENT_ROWS} AND b.id = $3`, [tenantId, todayLocal(), id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const [lines, payments, [client], [company], rules] = await Promise.all([
      this.ds.query(
        `SELECT id, kind, description, quantity::float AS quantity, unit, unit_price::float AS unit_price, amount::float AS amount, applied, note, detail
           FROM billing_lines WHERE statement_id = $1 ORDER BY sort, created_at`,
        [id],
      ),
      this.ds.query(
        `SELECT p.id, p.paid_on::text AS paid_on, p.amount::float AS amount, p.method, p.reference, p.note, u.full_name AS created_by_name, p.created_at
           FROM billing_payments p JOIN users u ON u.id = p.created_by WHERE p.statement_id = $1 AND p.deleted_at IS NULL ORDER BY p.paid_on, p.created_at`,
        [id],
      ),
      this.ds.query(`SELECT name, tax_code, address, contact_name, contact_phone, contact_email FROM clients WHERE id = $1`, [row.client_id]),
      this.ds.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]),
      this.settings.rules(tenantId),
    ]);
    return { ...row, lines, payments, client, company_name: company.name, payment_info: rules.payment_info };
  }

  /** The month's statements: one draft per contract in force, the ones already there left as they are. */
  async generate(actor: AuthUser, month: string) {
    await this.scopes.assertTenantScope(actor);
    const tenantId = tenantOf(actor);
    const [from, to] = monthBounds(month);
    if (from > todayLocal()) throw new BusinessException('PAYROLL_FUTURE');
    const rules = await this.settings.rules(tenantId);
    const created: string[] = [];
    await this.ds.transaction(async (m) => {
      const contracts: { id: string; client_id: string }[] = await m.query(
        `SELECT k.id, k.client_id FROM contracts k
          WHERE k.tenant_id = $1 AND k.deleted_at IS NULL AND k.state IN ('signed', 'terminated')
            AND k.start_date <= $3 AND LEAST(k.end_date, COALESCE(k.terminated_on, k.end_date)) >= $2
            AND NOT EXISTS (SELECT 1 FROM billing_statements b WHERE b.contract_id = k.id AND b.month = $2)`,
        [tenantId, from, to],
      );
      for (const k of contracts) {
        const [row] = await m.query(
          `INSERT INTO billing_statements (tenant_id, client_id, contract_id, month, vat_rate, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenantId, k.client_id, k.id, from, rules.vat_rate, actor.id],
        );
        await this.compute(m, await this.one(m, tenantId, row.id));
        created.push(row.id);
      }
      await this.log(m, actor, 'billing.generate', tenantId, { month, created });
    });
    return { created: created.length, statements: await this.list(actor, { month }) };
  }

  async recompute(actor: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      await this.compute(m, await this.draft(m, actor, id));
      await this.log(m, actor, 'billing.recompute', id, {});
    });
    return this.get(actor, id);
  }

  async patch(actor: AuthUser, id: string, dto: StatementPatchDto) {
    await this.ds.transaction(async (m) => {
      await this.draft(m, actor, id);
      if (dto.vat_rate !== undefined) await m.query(`UPDATE billing_statements SET vat_rate = $2 WHERE id = $1`, [id, dto.vat_rate]);
      if (dto.note !== undefined) await m.query(`UPDATE billing_statements SET note = $2 WHERE id = $1`, [id, dto.note?.trim() || null]);
      await this.totals(m, id);
      await this.log(m, actor, 'billing.update', id, { ...dto });
    });
    return this.get(actor, id);
  }

  async setShortfall(actor: AuthUser, lineId: string, dto: ShortfallDto) {
    const id = await this.ds.transaction(async (m) => {
      const line = await this.line(m, actor, lineId);
      if (line.kind !== 'shortfall') throw new BusinessException('BILLING_LINE_LOCKED');
      await m.query(`UPDATE billing_lines SET applied = $2, note = $3 WHERE id = $1`, [lineId, dto.applied, dto.note?.trim() || null]);
      await this.totals(m, line.statement_id);
      await this.log(m, actor, 'billing.shortfall', line.statement_id, { line_id: lineId, applied: dto.applied, note: dto.note ?? null });
      return line.statement_id;
    });
    return this.get(actor, id);
  }

  async addExtra(actor: AuthUser, id: string, dto: ExtraLineDto) {
    await this.ds.transaction(async (m) => {
      await this.draft(m, actor, id);
      await m.query(
        `INSERT INTO billing_lines (tenant_id, statement_id, kind, description, amount, sort) VALUES ($1, $2, 'extra', $3, $4, 1000)`,
        [tenantOf(actor), id, dto.description.trim(), dto.amount],
      );
      await this.totals(m, id);
      await this.log(m, actor, 'billing.extra.add', id, { ...dto });
    });
    return this.get(actor, id);
  }

  async removeExtra(actor: AuthUser, lineId: string) {
    const id = await this.ds.transaction(async (m) => {
      const line = await this.line(m, actor, lineId);
      if (line.kind !== 'extra') throw new BusinessException('BILLING_LINE_LOCKED');
      await m.query(`DELETE FROM billing_lines WHERE id = $1`, [lineId]);
      await this.totals(m, line.statement_id);
      await this.log(m, actor, 'billing.extra.remove', line.statement_id, { description: line.description, amount: line.amount });
      return line.statement_id;
    });
    return this.get(actor, id);
  }

  /** "Chốt": the statement becomes a numbered payment request, due after the company's payment terms. */
  async issue(actor: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const s = await this.draft(m, actor, id);
      // One numbering per company: taken under the company row's lock.
      await m.query(`SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE`, [s.tenant_id]);
      const prefix = `DNTT-${s.month.replace('-', '')}-`;
      const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM billing_statements WHERE tenant_id = $1 AND code LIKE $2`, [s.tenant_id, `${prefix}%`]);
      const today = todayLocal();
      const { payment_terms_days } = await this.settings.rules(s.tenant_id, m);
      await m.query(
        `UPDATE billing_statements SET status = 'issued', code = COALESCE(code, $2), issued_on = $3, issued_by = $4, due_date = $5, updated_at = now() WHERE id = $1`,
        [id, `${prefix}${String(n + 1).padStart(3, '0')}`, today, actor.id, addDays(today, payment_terms_days)],
      );
      await this.log(m, actor, 'billing.issue', id, {});
    });
    return this.get(actor, id);
  }

  async reopen(actor: AuthUser, id: string, reason: string) {
    await this.ds.transaction(async (m) => {
      const s = await this.lock(m, actor, id);
      if (s.status !== 'issued') throw new BusinessException('BILLING_NOT_ISSUED');
      const [paid] = await m.query(`SELECT 1 FROM billing_payments WHERE statement_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
      if (paid) throw new BusinessException('BILLING_HAS_PAYMENTS');
      // The number stays with the statement: a re-issued request keeps the number the client already saw.
      await m.query(`UPDATE billing_statements SET status = 'draft', issued_on = NULL, issued_by = NULL, due_date = NULL, updated_at = now() WHERE id = $1`, [id]);
      await this.log(m, actor, 'billing.reopen', id, { reason: reason.trim() });
    });
    return this.get(actor, id);
  }

  async addPayment(actor: AuthUser, id: string, dto: PaymentDto) {
    await this.ds.transaction(async (m) => {
      const s = await this.lock(m, actor, id);
      if (s.status !== 'issued') throw new BusinessException('BILLING_NOT_ISSUED');
      const [{ balance }] = await m.query(
        `SELECT (b.total - COALESCE((SELECT sum(amount) FROM billing_payments WHERE statement_id = b.id AND deleted_at IS NULL), 0))::float AS balance
           FROM billing_statements b WHERE b.id = $1`,
        [id],
      );
      if (dto.amount > balance) throw new BusinessException('BILLING_OVERPAID');
      await m.query(
        `INSERT INTO billing_payments (tenant_id, statement_id, paid_on, amount, method, reference, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [s.tenant_id, id, dto.paid_on, dto.amount, dto.method, dto.reference?.trim() || null, dto.note?.trim() || null, actor.id],
      );
      await this.log(m, actor, 'billing.payment.add', id, { ...dto });
    });
    return this.get(actor, id);
  }

  /** A payment entered by mistake: kept, marked as removed, with why. */
  async removePayment(actor: AuthUser, paymentId: string, reason: string) {
    const id = await this.ds.transaction(async (m) => {
      const [p] = await m.query(
        `SELECT statement_id, amount::float AS amount, paid_on::text AS paid_on FROM billing_payments WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [paymentId, tenantOf(actor)],
      );
      if (!p) throw new BusinessException('NOT_FOUND');
      await this.lock(m, actor, p.statement_id);
      await m.query(`UPDATE billing_payments SET deleted_at = now(), deleted_by = $2, delete_reason = $3 WHERE id = $1`, [paymentId, actor.id, reason.trim()]);
      await this.log(m, actor, 'billing.payment.remove', p.statement_id, { payment_id: paymentId, amount: p.amount, paid_on: p.paid_on, reason: reason.trim() });
      return p.statement_id as string;
    });
    return this.get(actor, id);
  }

  /**
   * The statement worked out from the contract: each price line in force this month, by what it is priced on
   * (people a month, shifts worked, hours worked), and for people-a-month lines a suggested deduction for the
   * shifts nobody guarded — off until the accountant applies it. The accountant's own lines stay.
   */
  private async compute(m: EntityManager, s: Statement) {
    const [mStart, mEnd] = monthBounds(s.month);
    const monthDays = daysInclusive(mStart, mEnd);
    const rules = await this.settings.rules(s.tenant_id, m);
    const [k] = await m.query(
      `SELECT start_date::text AS start_date, end_date::text AS end_date, terminated_on::text AS terminated_on FROM contracts WHERE id = $1`,
      [s.contract_id],
    );
    const priceLines: ContractLine[] = await m.query(
      `SELECT id, position, headcount, unit, unit_price, effective_from::text AS effective_from, effective_to::text AS effective_to
         FROM contract_lines WHERE contract_id = $1 AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $2) ORDER BY position, effective_from`,
      [s.contract_id, mStart, mEnd],
    );
    const shifts: ShiftRow[] = await m.query(
      `SELECT a.shift_date::text AS shift_date, COALESCE(st.position, 'guard') AS position, a.status, a.leave_request_id IS NOT NULL AS on_leave,
              t.check_in_at IS NOT NULL AS attended, a.planned_end < now() AS over,
              (EXTRACT(EPOCH FROM (a.planned_end - a.planned_start)) / 60)::int AS planned_minutes, t.worked_minutes,
              e.full_name AS employee_name, s.name AS site_name,
              EXISTS (SELECT 1 FROM shift_assignments sub JOIN attendances sa ON sa.assignment_id = sub.id AND sa.check_in_at IS NOT NULL
                       WHERE sub.substitute_for_id = a.id) AS covered
         FROM shift_assignments a
         JOIN sites s ON s.id = a.site_id AND s.client_id = $2
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN shift_templates st ON st.id = a.template_id
         LEFT JOIN attendances t ON t.assignment_id = a.id
        WHERE a.tenant_id = $1 AND a.shift_date BETWEEN $3 AND $4
        ORDER BY a.shift_date, a.planned_start`,
      [s.tenant_id, s.client_id, mStart, mEnd],
    );

    const before: { kind: string; applied: boolean; note: string | null; detail: { contract_line_id?: string } }[] = await m.query(
      `SELECT kind, applied, note, detail FROM billing_lines WHERE statement_id = $1 AND kind = 'shortfall'`,
      [s.id],
    );
    await m.query(`DELETE FROM billing_lines WHERE statement_id = $1 AND kind IN ('contract', 'shortfall')`, [s.id]);

    const insert = (row: { kind: string; description: string; quantity: number | null; unit: string | null; unit_price: number | null; amount: number; applied: boolean; note?: string | null; detail: object; sort: number }) =>
      m.query(
        `INSERT INTO billing_lines (tenant_id, statement_id, kind, description, quantity, unit, unit_price, amount, applied, note, detail, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [s.tenant_id, s.id, row.kind, row.description, row.quantity, row.unit, row.unit_price, row.amount, row.applied, row.note ?? null, JSON.stringify(row.detail), row.sort],
      );

    for (const [i, l] of priceLines.entries()) {
      const from = [mStart, k.start_date, l.effective_from].sort().reverse()[0];
      const to = [mEnd, k.end_date, k.terminated_on, l.effective_to].filter(Boolean).sort()[0]!;
      if (from > to) continue;
      const price = Number(l.unit_price);
      const position = POSITION[l.position] ?? l.position;
      const mine = shifts.filter((x) => x.position === l.position && x.shift_date >= from && x.shift_date <= to);
      const days = daysInclusive(from, to);
      const span = days < monthDays ? ` (${from.slice(8)}–${to.slice(8)}/${s.month.slice(5)})` : '';
      if (l.unit === 'per_guard_month') {
        await insert({
          kind: 'contract', description: `${position} — ${l.headcount} người${span}`, quantity: two((l.headcount * days) / monthDays), unit: UNIT[l.unit],
          unit_price: price, amount: Math.round((price * l.headcount * days) / monthDays), applied: true, detail: { contract_line_id: l.id, days, month_days: monthDays }, sort: i * 10,
        });
        // Shifts over that nobody guarded: a no-show, or a day off with nobody covering — unless a substitute worked it.
        const missed = mine.filter((x) => !x.covered && x.over && ((x.status === 'planned' && !x.attended) || (x.status === 'cancelled' && x.on_leave)));
        if (missed.length) {
          const perShift = Math.round(price / rules.standard_shifts);
          const kept = before.find((b) => b.detail.contract_line_id === l.id);
          await insert({
            kind: 'shortfall', description: `Giảm trừ thiếu người — ${position}: ${missed.length} ca không có người trực`, quantity: missed.length, unit: 'ca',
            unit_price: -perShift, amount: -perShift * missed.length, applied: kept?.applied ?? false, note: kept?.note ?? null, sort: i * 10 + 1,
            detail: {
              contract_line_id: l.id,
              shifts: missed.map((x) => ({ date: x.shift_date, site: x.site_name, employee: x.employee_name, reason: x.status === 'cancelled' ? 'leave' : 'absent' })),
            },
          });
        }
      } else {
        const worked = mine.filter((x) => x.status === 'planned' && x.attended);
        const quantity = l.unit === 'per_shift'
          ? worked.length
          : two(worked.reduce((sum, x) => sum + Math.min(x.worked_minutes ?? 0, x.planned_minutes), 0) / 60);
        await insert({
          kind: 'contract', description: `${position} — ${l.unit === 'per_shift' ? 'ca trực thực tế' : 'giờ trực thực tế'}${span}`, quantity, unit: UNIT[l.unit],
          unit_price: price, amount: Math.round(price * quantity), applied: true, detail: { contract_line_id: l.id }, sort: i * 10,
        });
      }
    }
    await m.query(`UPDATE billing_statements SET computed_at = now() WHERE id = $1`, [s.id]);
    await this.totals(m, s.id);
  }

  /** Subtotal of the lines on the bill, VAT on it, and the total. */
  private async totals(m: EntityManager, id: string) {
    await m.query(
      `UPDATE billing_statements b SET
         subtotal = x.subtotal, vat_amount = round(x.subtotal * b.vat_rate / 100), total = x.subtotal + round(x.subtotal * b.vat_rate / 100), updated_at = now()
         FROM (SELECT COALESCE(sum(amount) FILTER (WHERE applied), 0) AS subtotal FROM billing_lines WHERE statement_id = $1) x
        WHERE b.id = $1`,
      [id],
    );
  }

  private async one(m: EntityManager, tenantId: string, id: string): Promise<Statement> {
    const [row] = await m.query(
      `SELECT id, tenant_id, client_id, contract_id, to_char(month, 'YYYY-MM') AS month, status, vat_rate FROM billing_statements WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, tenantId],
    );
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private async lock(m: EntityManager, actor: AuthUser, id: string): Promise<Statement> {
    await this.scopes.assertTenantScope(actor);
    return this.one(m, tenantOf(actor), id);
  }

  private async draft(m: EntityManager, actor: AuthUser, id: string): Promise<Statement> {
    const s = await this.lock(m, actor, id);
    if (s.status !== 'draft') throw new BusinessException('BILLING_ISSUED');
    return s;
  }

  private async line(m: EntityManager, actor: AuthUser, lineId: string) {
    const [line] = await m.query(
      `SELECT statement_id, kind, description, amount::float AS amount FROM billing_lines WHERE id = $1 AND tenant_id = $2`,
      [lineId, tenantOf(actor)],
    );
    if (!line) throw new BusinessException('NOT_FOUND');
    await this.draft(m, actor, line.statement_id);
    return line;
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'billing_statement', entity_id: id, data });
  }
}
