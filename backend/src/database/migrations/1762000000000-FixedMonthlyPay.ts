import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A fourth pay type: a fixed monthly salary paid in full whatever the shifts — for a team leader who walks every
 * site of the team rather than standing one post. Only approved unpaid leave and a mid-month start reduce it.
 */
export class FixedMonthlyPay1762000000000 implements MigrationInterface {
  name = 'FixedMonthlyPay1762000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE employee_pay DROP CONSTRAINT IF EXISTS employee_pay_pay_type_check`);
    await q.query(`
      ALTER TABLE employee_pay ADD CONSTRAINT employee_pay_pay_type_check
        CHECK (pay_type IN ('monthly', 'fixed_monthly', 'per_shift', 'per_hour'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE employee_pay SET pay_type = 'monthly' WHERE pay_type = 'fixed_monthly'`);
    await q.query(`ALTER TABLE employee_pay DROP CONSTRAINT IF EXISTS employee_pay_pay_type_check`);
    await q.query(`
      ALTER TABLE employee_pay ADD CONSTRAINT employee_pay_pay_type_check
        CHECK (pay_type IN ('monthly', 'per_shift', 'per_hour'))`);
  }
}
