import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { NotificationsService } from '../notifications/notifications.service';
import type { MonthlyMode, PayType } from '../requests/employee-pay.entity';
import type { ViolationType } from '../violations/violation.entity';
import { AdjustmentDto } from './dto';
import { FinanceSettingsService } from './finance-settings.service';
import { monthBounds } from './month';
import { Adjustment, computePay, FixedTerms, PayConfig, ShiftWork } from './payroll-engine';

interface Period {
  id: string;
  tenant_id: string;
  month: string;
  status: 'draft' | 'locked' | 'paid';
}

const PERIOD_COLUMNS = `p.id, p.tenant_id, to_char(p.month, 'YYYY-MM') AS month, p.status, p.rules, p.computed_at, p.locked_at, lu.full_name AS locked_by_name,
  p.paid_on::text AS paid_on, pu.full_name AS paid_by_name, p.note, p.created_at`;
const LINE_COLUMNS = `l.id, l.employee_id, e.code AS employee_code, e.full_name AS employee_name, l.pay_type, l.unit, l.shifts,
  l.normal_units::float AS normal_units, l.holiday_units::float AS holiday_units, l.overtime_units::float AS overtime_units,
  l.base_amount::float AS base_amount, l.holiday_amount::float AS holiday_amount, l.overtime_amount::float AS overtime_amount,
  l.allowance_amount::float AS allowance_amount, l.violation_amount::float AS violation_amount, l.social_insurance::float AS social_insurance,
  l.adjustments, l.gross::float AS gross, l.deductions::float AS deductions, l.net::float AS net, l.detail, l.warnings`;


@Injectable()
export class PayrollService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly settings: FinanceSettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser) {
    await this.scopes.assertTenantScope(actor);
    return this.ds.query(
      `SELECT ${PERIOD_COLUMNS},
              (SELECT count(*)::int FROM payroll_lines l WHERE l.period_id = p.id) AS people,
              (SELECT COALESCE(sum(l.net), 0)::float FROM payroll_lines l WHERE l.period_id = p.id) AS total_net
         FROM payroll_periods p LEFT JOIN users lu ON lu.id = p.locked_by LEFT JOIN users pu ON pu.id = p.paid_by
        WHERE p.tenant_id = $1 ORDER BY p.month DESC`,
      [tenantOf(actor)],
    );
  }

  async get(actor: AuthUser, id: string) {
    await this.scopes.assertTenantScope(actor);
    const [period] = await this.ds.query(
      `SELECT ${PERIOD_COLUMNS} FROM payroll_periods p LEFT JOIN users lu ON lu.id = p.locked_by LEFT JOIN users pu ON pu.id = p.paid_by
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [id, tenantOf(actor)],
    );
    if (!period) throw new BusinessException('NOT_FOUND');
    const lines = await this.ds.query(
      `SELECT ${LINE_COLUMNS}, ep.bank_name, ep.bank_account
         FROM payroll_lines l JOIN employees e ON e.id = l.employee_id LEFT JOIN employee_pay ep ON ep.employee_id = l.employee_id
        WHERE l.period_id = $1 ORDER BY e.full_name, e.code`,
      [id],
    );
    return { ...period, lines };
  }

  /** A new month's payroll, worked out at once from attendance, confirmed violations and pay records. */
  async create(actor: AuthUser, month: string) {
    await this.scopes.assertTenantScope(actor);
    const tenantId = tenantOf(actor);
    if (`${month}-01` > todayLocal()) throw new BusinessException('PAYROLL_FUTURE');
    let id: string;
    try {
      id = await this.ds.transaction(async (m) => {
        const [row] = await m.query(
          `INSERT INTO payroll_periods (tenant_id, month, created_by) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, `${month}-01`, actor.id],
        );
        await this.compute(m, { id: row.id, tenant_id: tenantId, month, status: 'draft' });
        await this.log(m, actor, 'payroll.create', row.id, { month });
        return row.id;
      });
    } catch (error) {
      if (error instanceof QueryFailedError && (error as QueryFailedError & { constraint?: string }).constraint === 'payroll_periods_month_uq') {
        throw new BusinessException('PAYROLL_EXISTS');
      }
      throw error;
    }
    return this.get(actor, id);
  }

  /** Worked out again from today's data (late corrections, newly confirmed violations); typed adjustments stay. */
  async recompute(actor: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const period = await this.draft(m, actor, id);
      await this.compute(m, period);
      await this.log(m, actor, 'payroll.recompute', id, {});
    });
    return this.get(actor, id);
  }

  async setAdjustments(actor: AuthUser, lineId: string, items: AdjustmentDto[]) {
    for (const a of items) {
      if (a.kind !== 'other' && a.amount < 0) throw new BusinessException('VALIDATION_FAILED', [`${a.kind}: số tiền không âm (khoản trừ dùng "khác" với số âm)`]);
    }
    const periodId = await this.ds.transaction(async (m) => {
      const [line] = await m.query(`SELECT period_id, employee_id, adjustments FROM payroll_lines WHERE id = $1 AND tenant_id = $2`, [lineId, tenantOf(actor)]);
      if (!line) throw new BusinessException('NOT_FOUND');
      const period = await this.draft(m, actor, line.period_id);
      const clean = items.map((a) => ({ kind: a.kind, amount: a.amount, ...(a.note?.trim() ? { note: a.note.trim() } : {}) }));
      await m.query(`UPDATE payroll_lines SET adjustments = $2 WHERE id = $1`, [lineId, JSON.stringify(clean)]);
      await this.compute(m, period, line.employee_id);
      await this.log(m, actor, 'payroll.adjust', period.id, { employee_id: line.employee_id, before: line.adjustments, after: clean });
      return period.id;
    });
    return this.get(actor, periodId);
  }

  /** "Chốt": nothing changes any more, and each person sees their payslip. */
  async lock(actor: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const period = await this.draft(m, actor, id);
      await m.query(`UPDATE payroll_periods SET status = 'locked', locked_at = now(), locked_by = $2, updated_at = now() WHERE id = $1`, [period.id, actor.id]);
      await this.log(m, actor, 'payroll.lock', id, {});
      const people: { id: string }[] = await m.query(
        `SELECT u.id FROM payroll_lines l JOIN users u ON u.employee_id = l.employee_id AND u.status = 'active' AND u.deleted_at IS NULL
          WHERE l.period_id = $1`,
        [id],
      );
      const [y, mo] = period.month.split('-');
      await this.notifications.notify(period.tenant_id, people.map((p) => p.id), {
        type: 'payslip.ready', title: `Đã có phiếu lương tháng ${Number(mo)}/${y}`, body: 'Xem chi tiết công, thu nhập và khấu trừ trong mục Phiếu lương.',
        data: { period_id: id }, priority: 'normal', push: true,
      }, m);
    });
    return this.get(actor, id);
  }

  async unlock(actor: AuthUser, id: string, reason: string) {
    await this.ds.transaction(async (m) => {
      const period = await this.locked(m, actor, id);
      if (period.status === 'paid') throw new BusinessException('PAYROLL_PAID');
      if (period.status !== 'locked') throw new BusinessException('PAYROLL_NOT_LOCKED');
      await m.query(`UPDATE payroll_periods SET status = 'draft', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1`, [id]);
      await this.log(m, actor, 'payroll.unlock', id, { reason: reason.trim() });
    });
    return this.get(actor, id);
  }

  async paid(actor: AuthUser, id: string, paidOn: string, note?: string) {
    await this.ds.transaction(async (m) => {
      const period = await this.locked(m, actor, id);
      if (period.status !== 'locked') throw new BusinessException(period.status === 'paid' ? 'PAYROLL_PAID' : 'PAYROLL_NOT_LOCKED');
      await m.query(
        `UPDATE payroll_periods SET status = 'paid', paid_on = $2, paid_by = $3, note = COALESCE($4, note), updated_at = now() WHERE id = $1`,
        [id, paidOn, actor.id, note?.trim() || null],
      );
      await this.log(m, actor, 'payroll.paid', id, { paid_on: paidOn });
    });
    return this.get(actor, id);
  }

  /** A guard's own payslips: months that are locked or paid, never a draft. */
  async myPayslips(actor: AuthUser) {
    if (!actor.employee_id) return [];
    return this.ds.query(
      `SELECT p.id AS period_id, to_char(p.month, 'YYYY-MM') AS month, p.status, p.paid_on::text AS paid_on, l.net::float AS net
         FROM payroll_lines l JOIN payroll_periods p ON p.id = l.period_id
        WHERE l.tenant_id = $1 AND l.employee_id = $2 AND p.status IN ('locked', 'paid') ORDER BY p.month DESC`,
      [tenantOf(actor), actor.employee_id],
    );
  }

  async myPayslip(actor: AuthUser, periodId: string) {
    if (!actor.employee_id) throw new BusinessException('NOT_FOUND');
    const [row] = await this.ds.query(
      `SELECT to_char(p.month, 'YYYY-MM') AS month, p.status, p.paid_on::text AS paid_on, p.rules, ${LINE_COLUMNS}
         FROM payroll_lines l JOIN payroll_periods p ON p.id = l.period_id JOIN employees e ON e.id = l.employee_id
        WHERE l.tenant_id = $1 AND l.employee_id = $2 AND p.id = $3 AND p.status IN ('locked', 'paid')`,
      [tenantOf(actor), actor.employee_id, periodId],
    );
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  /**
   * Everyone with a pay record or with work this month gets a line; a person with neither is dropped from a
   * draft. Only `employeeId` when given (after an adjustment).
   */
  private async compute(m: EntityManager, period: Period, employeeId?: string) {
    const rules = await this.settings.rules(period.tenant_id, m);
    const [from, to] = monthBounds(period.month);
    const only = employeeId ? ' AND a.employee_id = $4' : '';
    const params = employeeId ? [period.tenant_id, from, to, employeeId] : [period.tenant_id, from, to];
    const shifts: (ShiftWork & { employee_id: string; site_name: string })[] = await m.query(
      `SELECT a.employee_id, a.shift_date::text AS shift_date, s.name AS site_name,
              (EXTRACT(EPOCH FROM (a.planned_end - a.planned_start)) / 60)::int AS planned_minutes, t.worked_minutes
         FROM shift_assignments a
         JOIN attendances t ON t.assignment_id = a.id AND t.check_in_at IS NOT NULL
         JOIN sites s ON s.id = a.site_id
        WHERE a.tenant_id = $1 AND a.shift_date BETWEEN $2 AND $3 AND a.status = 'planned'${only}
        ORDER BY a.shift_date, a.planned_start`,
      params,
    );
    const violations: { employee_id: string; type: ViolationType; count: number }[] = await m.query(
      `SELECT v.employee_id, v.type, count(*)::int AS count FROM violations v
        WHERE v.tenant_id = $1 AND v.status = 'confirmed' AND (v.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $2 AND $3${only.replace('a.', 'v.')}
        GROUP BY v.employee_id, v.type`,
      params,
    );
    const pays: { employee_id: string; pay_type: PayType; monthly_mode: MonthlyMode; base_pay: string | null; allowance: string | null; social_insurance: string | null }[] = await m.query(
      `SELECT ep.employee_id, ep.pay_type, ep.monthly_mode, ep.base_pay, ep.allowance, ep.social_insurance
         FROM employee_pay ep JOIN employees e ON e.id = ep.employee_id AND e.deleted_at IS NULL
        WHERE ep.tenant_id = $1 AND (e.status = 'active' OR ep.employee_id IN (SELECT employee_id FROM shift_assignments WHERE tenant_id = $1 AND shift_date BETWEEN $2 AND $3))
          ${employeeId ? 'AND ep.employee_id = $4' : ''}`,
      params,
    );
    // For a fixed monthly salary: approved unpaid leave days inside the month, and the hire date.
    const unpaid: { employee_id: string; days: number }[] = await m.query(
      `SELECT l.employee_id, sum(LEAST(l.to_date, $3::date) - GREATEST(l.from_date, $2::date) + 1)::int AS days
         FROM leave_requests l
        WHERE l.tenant_id = $1 AND l.status = 'approved' AND l.type = 'unpaid' AND l.from_date <= $3 AND l.to_date >= $2
              ${employeeId ? 'AND l.employee_id = $4' : ''}
        GROUP BY l.employee_id`,
      params,
    );
    const hired: { id: string; hire_date: string | null }[] = await m.query(
      `SELECT id, hire_date::text AS hire_date FROM employees WHERE tenant_id = $1 AND hire_date BETWEEN $2 AND $3
              ${employeeId ? 'AND id = $4' : ''}`,
      params,
    );
    const monthDays = Number(to.slice(8, 10));
    const fixedTerms = (person: string): FixedTerms => {
      const start = hired.find((h) => h.id === person)?.hire_date;
      return {
        unpaid_days: unpaid.find((u) => u.employee_id === person)?.days ?? 0,
        employed_fraction: start ? (monthDays - Number(start.slice(8, 10)) + 1) / monthDays : 1,
      };
    };
    const existing: { employee_id: string; adjustments: Adjustment[] }[] = await m.query(
      `SELECT employee_id, adjustments FROM payroll_lines WHERE period_id = $1`,
      [period.id],
    );
    const adjustments = new Map(existing.map((l) => [l.employee_id, l.adjustments]));
    const people = new Set([...pays.map((p) => p.employee_id), ...shifts.map((s) => s.employee_id), ...violations.map((v) => v.employee_id)]);
    if (employeeId) people.add(employeeId);
    else await m.query(`DELETE FROM payroll_lines WHERE period_id = $1 AND NOT (employee_id = ANY($2::uuid[]))`, [period.id, [...people]]);

    for (const person of people) {
      const pay = pays.find((p) => p.employee_id === person);
      const config: PayConfig | null = pay && pay.base_pay !== null
        ? { pay_type: pay.pay_type, monthly_mode: pay.monthly_mode, base_pay: Number(pay.base_pay), allowance: Number(pay.allowance ?? 0), social_insurance: Number(pay.social_insurance ?? 0) }
        : null;
      const mine = shifts.filter((s) => s.employee_id === person);
      const counts = Object.fromEntries(violations.filter((v) => v.employee_id === person).map((v) => [v.type, v.count]));
      const adjust = adjustments.get(person) ?? [];
      const terms = fixedTerms(person);
      const r = computePay(config, rules, mine, counts, adjust, terms);
      const detail = {
        pay: config,
        ...(config?.pay_type === 'monthly' && config.monthly_mode === 'fixed' ? { fixed: terms } : {}),
        shifts: mine.map((s) => ({ date: s.shift_date, site: s.site_name, planned_minutes: s.planned_minutes, worked_minutes: s.worked_minutes, holiday: rules.holidays.includes(s.shift_date) })),
        violations: counts,
      };
      await m.query(
        `INSERT INTO payroll_lines (tenant_id, period_id, employee_id, pay_type, unit, shifts, normal_units, holiday_units, overtime_units, base_amount,
                                    holiday_amount, overtime_amount, allowance_amount, violation_amount, social_insurance, adjustments, gross, deductions, net, detail, warnings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         ON CONFLICT (period_id, employee_id) DO UPDATE SET pay_type = $4, unit = $5, shifts = $6, normal_units = $7, holiday_units = $8,
           overtime_units = $9, base_amount = $10, holiday_amount = $11, overtime_amount = $12, allowance_amount = $13, violation_amount = $14,
           social_insurance = $15, adjustments = $16, gross = $17, deductions = $18, net = $19, detail = $20, warnings = $21, updated_at = now()`,
        [period.tenant_id, period.id, person, config?.pay_type ?? null, r.unit, r.shifts, r.normal_units, r.holiday_units, r.overtime_units,
          r.base_amount, r.holiday_amount, r.overtime_amount, r.allowance_amount, r.violation_amount, r.social_insurance, JSON.stringify(adjust),
          r.gross, r.deductions, r.net, JSON.stringify(detail), JSON.stringify(r.warnings)],
      );
    }
    await m.query(`UPDATE payroll_periods SET computed_at = now(), rules = $2, updated_at = now() WHERE id = $1`, [period.id, JSON.stringify(rules)]);
  }

  /** The period locked for change; only a draft may be changed. */
  private async draft(m: EntityManager, actor: AuthUser, id: string): Promise<Period> {
    const period = await this.locked(m, actor, id);
    if (period.status !== 'draft') throw new BusinessException('PAYROLL_LOCKED');
    return period;
  }

  private async locked(m: EntityManager, actor: AuthUser, id: string): Promise<Period> {
    await this.scopes.assertTenantScope(actor);
    const [row] = await m.query(
      `SELECT id, tenant_id, to_char(month, 'YYYY-MM') AS month, status FROM payroll_periods WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, tenantOf(actor)],
    );
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'payroll_period', entity_id: id, data });
  }
}
