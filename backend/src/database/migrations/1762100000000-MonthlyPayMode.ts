import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A monthly salary is one pay type with two ways of counting it: by attendance (the công worked against the
 * standard) or fixed (the whole month whatever the shifts). Replaces the separate fixed_monthly type, which
 * read as a second kind of monthly salary.
 */
export class MonthlyPayMode1762100000000 implements MigrationInterface {
  name = 'MonthlyPayMode1762100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE employee_pay ADD COLUMN monthly_mode varchar(12) NOT NULL DEFAULT 'attendance'
        CONSTRAINT employee_pay_monthly_mode_check CHECK (monthly_mode IN ('attendance', 'fixed'))`);
    await q.query(`UPDATE employee_pay SET pay_type = 'monthly', monthly_mode = 'fixed' WHERE pay_type = 'fixed_monthly'`);
    await q.query(`UPDATE payroll_lines SET pay_type = 'monthly' WHERE pay_type = 'fixed_monthly'`);
    await q.query(`ALTER TABLE employee_pay DROP CONSTRAINT IF EXISTS employee_pay_pay_type_check`);
    await q.query(`
      ALTER TABLE employee_pay ADD CONSTRAINT employee_pay_pay_type_check
        CHECK (pay_type IN ('monthly', 'per_shift', 'per_hour'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE employee_pay DROP CONSTRAINT IF EXISTS employee_pay_pay_type_check`);
    await q.query(`
      ALTER TABLE employee_pay ADD CONSTRAINT employee_pay_pay_type_check
        CHECK (pay_type IN ('monthly', 'fixed_monthly', 'per_shift', 'per_hour'))`);
    await q.query(`UPDATE employee_pay SET pay_type = 'fixed_monthly' WHERE pay_type = 'monthly' AND monthly_mode = 'fixed'`);
    await q.query(`ALTER TABLE employee_pay DROP COLUMN monthly_mode`);
  }
}
