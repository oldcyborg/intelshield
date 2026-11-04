import { MigrationInterface, QueryRunner } from 'typeorm';

/** Frozen copy of the defaults at the time of this migration; later edits to the code list do not rewrite history. */
const GRANTS: [string, string][] = [
  ['admin', 'payroll.view'], ['admin', 'payroll.manage'], ['admin', 'billing.view'], ['admin', 'billing.manage'],
  ['accountant', 'payroll.view'], ['accountant', 'payroll.manage'], ['accountant', 'billing.view'], ['accountant', 'billing.manage'],
  ['hr', 'payroll.view'],
];

export class Payroll1761800000000 implements MigrationInterface {
  name = 'Payroll1761800000000';

  async up(q: QueryRunner): Promise<void> {
    // The company's money rules: payroll and client billing. One row per company, created on first save.
    await q.query(`
      CREATE TABLE finance_settings (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
        standard_shifts numeric(5,2) NOT NULL DEFAULT 26 CHECK (standard_shifts > 0 AND standard_shifts <= 31),
        holiday_coefficient numeric(4,2) NOT NULL DEFAULT 3 CHECK (holiday_coefficient >= 1 AND holiday_coefficient <= 10),
        overtime_coefficient numeric(4,2) NOT NULL DEFAULT 1.5 CHECK (overtime_coefficient >= 1 AND overtime_coefficient <= 10),
        holidays date[] NOT NULL DEFAULT '{}',
        penalties jsonb NOT NULL DEFAULT '{}'::jsonb,
        vat_rate numeric(5,2) NOT NULL DEFAULT 10 CHECK (vat_rate >= 0 AND vat_rate <= 100),
        payment_terms_days int NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`ALTER TABLE employee_pay ADD COLUMN social_insurance numeric(14,0) CHECK (social_insurance >= 0)`);

    await q.query(`
      CREATE TABLE payroll_periods (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        month date NOT NULL CHECK (extract(day FROM month) = 1),
        status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked', 'paid')),
        rules jsonb NOT NULL DEFAULT '{}'::jsonb,
        computed_at timestamptz,
        locked_at timestamptz,
        locked_by uuid REFERENCES users(id),
        paid_on date,
        paid_by uuid REFERENCES users(id),
        note text,
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payroll_periods_month_uq UNIQUE (tenant_id, month)
      )`);

    await q.query(`
      CREATE TABLE payroll_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
        employee_id uuid NOT NULL REFERENCES employees(id),
        pay_type varchar(20),
        unit varchar(10) NOT NULL DEFAULT 'cong' CHECK (unit IN ('cong', 'gio')),
        shifts int NOT NULL DEFAULT 0,
        normal_units numeric(8,2) NOT NULL DEFAULT 0,
        holiday_units numeric(8,2) NOT NULL DEFAULT 0,
        overtime_units numeric(8,2) NOT NULL DEFAULT 0,
        base_amount numeric(14,0) NOT NULL DEFAULT 0,
        holiday_amount numeric(14,0) NOT NULL DEFAULT 0,
        overtime_amount numeric(14,0) NOT NULL DEFAULT 0,
        allowance_amount numeric(14,0) NOT NULL DEFAULT 0,
        violation_amount numeric(14,0) NOT NULL DEFAULT 0,
        social_insurance numeric(14,0) NOT NULL DEFAULT 0,
        adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
        gross numeric(14,0) NOT NULL DEFAULT 0,
        deductions numeric(14,0) NOT NULL DEFAULT 0,
        net numeric(14,0) NOT NULL DEFAULT 0,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payroll_lines_person_uq UNIQUE (period_id, employee_id)
      )`);
    await q.query(`CREATE INDEX payroll_lines_employee ON payroll_lines (tenant_id, employee_id)`);

    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission IN ('payroll.view', 'payroll.manage', 'billing.view', 'billing.manage')`);
    await q.query(`DROP TABLE payroll_lines`);
    await q.query(`DROP TABLE payroll_periods`);
    await q.query(`ALTER TABLE employee_pay DROP COLUMN social_insurance`);
    await q.query(`DROP TABLE finance_settings`);
  }
}
