import type { MonthlyMode, PayType } from '../requests/employee-pay.entity';
import type { ViolationType } from '../violations/violation.entity';

/** One worked shift of the month: what was planned and what the attendance (as corrected) says. */
export interface ShiftWork {
  shift_date: string;
  planned_minutes: number;
  /** Null: checked in but never out — the shift counts nothing until a correction gives it an end. */
  worked_minutes: number | null;
}

export interface PayConfig {
  pay_type: PayType;
  /** Monthly pay only: 'fixed' pays the whole month whatever the shifts. */
  monthly_mode?: MonthlyMode;
  /** Monthly salary, price of one shift, or of one hour — following pay_type. */
  base_pay: number;
  allowance: number;
  social_insurance: number;
}

export interface PayRules {
  /** Shifts a monthly salary pays for; beyond it is overtime. Monthly pay only. */
  standard_shifts: number;
  holiday_coefficient: number;
  overtime_coefficient: number;
  holidays: string[];
  penalties: Partial<Record<ViolationType, number>>;
}

/** What reduces a fixed monthly salary: approved unpaid leave, and starting part-way through the month. */
export interface FixedTerms {
  unpaid_days: number;
  /** Share of the month the person was employed: 1, or less when hired mid-month. */
  employed_fraction: number;
}

export const ADJUSTMENT_KINDS = ['bonus', 'advance', 'tax', 'other'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** Typed by the accountant: bonus adds; advance and tax take away; "other" adds or takes by its sign. */
export interface Adjustment {
  kind: AdjustmentKind;
  amount: number;
  note?: string;
}

export interface PayResult {
  unit: 'cong' | 'gio';
  shifts: number;
  normal_units: number;
  holiday_units: number;
  overtime_units: number;
  base_amount: number;
  holiday_amount: number;
  overtime_amount: number;
  allowance_amount: number;
  violation_amount: number;
  social_insurance: number;
  gross: number;
  deductions: number;
  net: number;
  warnings: string[];
}

const vnd = (n: number) => Math.round(n);
const two = (n: number) => Math.round(n * 100) / 100;

/**
 * One person's pay for a month. A shift counts as much of a "công" as the time worked covers of the time
 * planned, at most one (hours, likewise capped, for hourly pay): time past the planned end needs a correction.
 * Holiday shifts are paid at the holiday coefficient. A monthly salary pays `standard_shifts` công in full;
 * công beyond that are overtime. Shift and hourly pay have no ceiling.
 */
export function computePay(
  config: PayConfig | null,
  rules: PayRules,
  shifts: ShiftWork[],
  violations: Partial<Record<ViolationType, number>>,
  adjustments: Adjustment[],
  fixed: FixedTerms = { unpaid_days: 0, employed_fraction: 1 },
): PayResult {
  const warnings: string[] = [];
  const holidays = new Set(rules.holidays);
  const unit = config?.pay_type === 'per_hour' ? 'gio' : 'cong';
  let normal = 0;
  let holiday = 0;
  let open = 0;
  for (const s of shifts) {
    if (s.worked_minutes === null) {
      open += 1;
      continue;
    }
    const worked = Math.max(0, Math.min(s.worked_minutes, s.planned_minutes));
    const amount = unit === 'gio' ? worked / 60 : s.planned_minutes > 0 ? worked / s.planned_minutes : 0;
    if (holidays.has(s.shift_date)) holiday += amount;
    else normal += amount;
  }
  normal = two(normal);
  holiday = two(holiday);
  if (open) warnings.push(`${open} ca chưa có giờ ra — chưa tính công`);

  const result: PayResult = {
    unit, shifts: shifts.length, normal_units: normal, holiday_units: holiday, overtime_units: 0,
    base_amount: 0, holiday_amount: 0, overtime_amount: 0, allowance_amount: 0, violation_amount: 0,
    social_insurance: 0, gross: 0, deductions: 0, net: 0, warnings,
  };

  if (!config) {
    warnings.push('Chưa có hồ sơ lương — chưa tính được lương');
  } else {
    const worked = normal + holiday;
    if (config.pay_type === 'monthly' && config.monthly_mode === 'fixed') {
      // Paid whatever the shifts: shifts are counted and shown, but neither raise nor lower it. A day of unpaid
      // leave costs one standard công.
      const rate = config.base_pay / rules.standard_shifts;
      result.base_amount = vnd(Math.max(0, config.base_pay * fixed.employed_fraction - rate * fixed.unpaid_days));
      result.allowance_amount = vnd(config.allowance * fixed.employed_fraction);
    } else if (config.pay_type === 'monthly') {
      const rate = config.base_pay / rules.standard_shifts;
      const regular = Math.min(normal, rules.standard_shifts);
      result.overtime_units = two(Math.max(0, normal - rules.standard_shifts));
      result.base_amount = vnd(rate * regular);
      result.overtime_amount = vnd(rate * result.overtime_units * rules.overtime_coefficient);
      result.holiday_amount = vnd(rate * holiday * rules.holiday_coefficient);
      result.allowance_amount = vnd(config.allowance * Math.min(1, worked / rules.standard_shifts));
    } else {
      result.base_amount = vnd(config.base_pay * normal);
      result.holiday_amount = vnd(config.base_pay * holiday * rules.holiday_coefficient);
      // A monthly allowance, for anyone who worked this month.
      result.allowance_amount = worked > 0 ? vnd(config.allowance) : 0;
    }
    result.social_insurance = vnd(config.social_insurance);
  }

  result.violation_amount = vnd(
    Object.entries(violations).reduce((sum, [type, count]) => sum + (rules.penalties[type as ViolationType] ?? 0) * (count ?? 0), 0),
  );
  const sum = (kind: AdjustmentKind) => adjustments.filter((a) => a.kind === kind).reduce((s, a) => s + a.amount, 0);
  const others = adjustments.filter((a) => a.kind === 'other').map((a) => a.amount);
  const otherPlus = others.filter((a) => a > 0).reduce((s, a) => s + a, 0);
  const otherMinus = others.filter((a) => a < 0).reduce((s, a) => s - a, 0);
  result.gross = vnd(result.base_amount + result.holiday_amount + result.overtime_amount + result.allowance_amount + sum('bonus') + otherPlus);
  result.deductions = vnd(result.violation_amount + result.social_insurance + sum('advance') + sum('tax') + otherMinus);
  result.net = result.gross - result.deductions;
  if (result.net < 0) warnings.push('Thực lĩnh âm — kiểm tra các khoản trừ');
  return result;
}
