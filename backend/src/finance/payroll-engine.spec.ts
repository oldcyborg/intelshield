import { computePay, PayRules, ShiftWork } from './payroll-engine';

const RULES: PayRules = { standard_shifts: 26, holiday_coefficient: 3, overtime_coefficient: 1.5, holidays: ['2026-09-02'], penalties: { late_check_in: 50_000, absent: 200_000 } };
const shift = (shift_date: string, worked: number | null, planned = 720): ShiftWork => ({ shift_date, planned_minutes: planned, worked_minutes: worked });
const days = (n: number, from = 1) => Array.from({ length: n }, (_, i) => shift(`2026-10-${String(from + i).padStart(2, '0')}`, 720));

describe('computePay', () => {
  it('pays a monthly salary by công against the standard, with the allowance in proportion', () => {
    const r = computePay({ pay_type: 'monthly', base_pay: 7_800_000, allowance: 520_000, social_insurance: 0 }, RULES, days(13), {}, []);
    expect(r).toMatchObject({ unit: 'cong', shifts: 13, normal_units: 13, overtime_units: 0, base_amount: 3_900_000, allowance_amount: 260_000, gross: 4_160_000, net: 4_160_000 });
  });

  it('counts a short shift as part of a công and never more than one for a long one', () => {
    const r = computePay({ pay_type: 'per_shift', base_pay: 300_000, allowance: 0, social_insurance: 0 }, RULES, [shift('2026-10-01', 360), shift('2026-10-02', 900)], {}, []);
    expect(r.normal_units).toBe(1.5);
    expect(r.base_amount).toBe(450_000);
  });

  it('pays công past the standard as overtime, and holiday công at the holiday rate', () => {
    const r = computePay(
      { pay_type: 'monthly', base_pay: 7_800_000, allowance: 0, social_insurance: 0 },
      { ...RULES, holidays: ['2026-10-01'] },
      [...days(28, 2), shift('2026-10-01', 720)],
      {},
      [],
    );
    expect(r).toMatchObject({ normal_units: 28, holiday_units: 1, overtime_units: 2, base_amount: 7_800_000, overtime_amount: 900_000, holiday_amount: 900_000 });
  });

  it('has no ceiling for shift or hourly pay, and pays hours for hourly pay', () => {
    expect(computePay({ pay_type: 'per_shift', base_pay: 300_000, allowance: 100_000, social_insurance: 0 }, RULES, days(30), {}, []))
      .toMatchObject({ normal_units: 30, overtime_units: 0, base_amount: 9_000_000, allowance_amount: 100_000 });
    expect(computePay({ pay_type: 'per_hour', base_pay: 25_000, allowance: 0, social_insurance: 0 }, RULES, [shift('2026-10-01', 600), shift('2026-09-02', 720)], {}, []))
      .toMatchObject({ unit: 'gio', normal_units: 10, holiday_units: 12, base_amount: 250_000, holiday_amount: 900_000 });
  });

  it('takes confirmed violations, insurance, advances and tax away; adds bonuses; others by their sign', () => {
    const r = computePay(
      { pay_type: 'per_shift', base_pay: 300_000, allowance: 0, social_insurance: 400_000 },
      RULES,
      days(10),
      { late_check_in: 2, absent: 1, early_check_out: 3 },
      [{ kind: 'bonus', amount: 500_000 }, { kind: 'advance', amount: 1_000_000 }, { kind: 'tax', amount: 50_000 }, { kind: 'other', amount: 70_000 }, { kind: 'other', amount: -20_000 }],
    );
    expect(r).toMatchObject({ violation_amount: 300_000, gross: 3_570_000, deductions: 1_770_000, net: 1_800_000 });
  });

  it('does not count a shift with no clock-out, and says so; nor pays anyone without a pay record', () => {
    const r = computePay(null, RULES, [shift('2026-10-01', null), shift('2026-10-02', 720)], { absent: 1 }, []);
    expect(r).toMatchObject({ shifts: 2, normal_units: 1, base_amount: 0, violation_amount: 200_000, net: -200_000 });
    expect(r.warnings).toEqual(['1 ca chưa có giờ ra — chưa tính công', 'Chưa có hồ sơ lương — chưa tính được lương', 'Thực lĩnh âm — kiểm tra các khoản trừ']);
  });

  it('pays a monthly salary counted as fixed in full with no shift at all, and the same with a full month of them', () => {
    const pay = { pay_type: 'monthly' as const, monthly_mode: 'fixed' as const, base_pay: 9_100_000, allowance: 1_000_000, social_insurance: 0 };
    expect(computePay(pay, RULES, [], {}, [])).toMatchObject({ shifts: 0, base_amount: 9_100_000, allowance_amount: 1_000_000, overtime_amount: 0, net: 10_100_000 });
    expect(computePay(pay, RULES, days(30), {}, [])).toMatchObject({ shifts: 30, base_amount: 9_100_000, overtime_amount: 0, net: 10_100_000 });
  });

  it('takes a standard công for each unpaid leave day off a fixed salary, and pays a mid-month start in proportion', () => {
    const pay = { pay_type: 'monthly' as const, monthly_mode: 'fixed' as const, base_pay: 9_100_000, allowance: 1_000_000, social_insurance: 0 };
    expect(computePay(pay, RULES, [], {}, [], { unpaid_days: 2, employed_fraction: 1 }).base_amount).toBe(8_400_000);
    expect(computePay(pay, RULES, [], {}, [], { unpaid_days: 0, employed_fraction: 0.5 })).toMatchObject({ base_amount: 4_550_000, allowance_amount: 500_000 });
  });
});
