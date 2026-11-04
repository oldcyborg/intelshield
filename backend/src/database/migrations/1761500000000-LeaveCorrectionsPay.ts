import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'employee.pay.view'], ['admin', 'employee.pay.manage'], ['admin', 'leave.review'],
  ['admin', 'attendance.correct.propose'], ['admin', 'attendance.correct.review'],
  ['manager', 'leave.review'], ['manager', 'attendance.correct.propose'], ['manager', 'attendance.correct.review'],
  ['team_leader', 'leave.review'], ['team_leader', 'attendance.correct.propose'],
  ['hr', 'employee.pay.view'], ['hr', 'employee.pay.manage'],
  ['accountant', 'employee.pay.view'], ['accountant', 'employee.pay.manage'],
];

/** Leave requests, attendance corrections, and the pay & leave part of a person's file (spec §4.3a). */
export class LeaveCorrectionsPay1761500000000 implements MigrationInterface {
  name = 'LeaveCorrectionsPay1761500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE employee_pay (
        employee_id uuid PRIMARY KEY REFERENCES employees(id),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        pay_type varchar(20) NOT NULL CHECK (pay_type IN ('monthly', 'per_shift', 'per_hour')),
        base_pay numeric(14, 0) CHECK (base_pay >= 0),
        allowance numeric(14, 0) CHECK (allowance >= 0),
        bank_name varchar(100),
        bank_account varchar(40),
        tax_code varchar(20),
        social_insurance_no varchar(20),
        annual_leave_days int CHECK (annual_leave_days BETWEEN 0 AND 365),
        note text,
        updated_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE leave_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        type varchar(20) NOT NULL CHECK (type IN ('annual', 'sick', 'personal', 'unpaid')),
        from_date date NOT NULL,
        to_date date NOT NULL,
        days int NOT NULL,
        reason text,
        status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        urgent boolean NOT NULL DEFAULT false,
        created_by uuid NOT NULL REFERENCES users(id),
        decided_by uuid REFERENCES users(id),
        decided_at timestamptz,
        decision_note text,
        client_uuid uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT leave_dates CHECK (to_date >= from_date),
        CONSTRAINT leave_client_uq UNIQUE (tenant_id, client_uuid)
      )`);
    await q.query(`CREATE INDEX leave_person_dates ON leave_requests (tenant_id, employee_id, from_date)`);
    await q.query(`CREATE INDEX leave_pending ON leave_requests (tenant_id) WHERE status = 'pending'`);
    await q.query(`
      CREATE TABLE attendance_corrections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        assignment_id uuid NOT NULL REFERENCES shift_assignments(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        check_in_at timestamptz,
        check_out_at timestamptz,
        reason_code varchar(20) NOT NULL CHECK (reason_code IN ('phone_dead', 'phone_broken', 'forgot', 'no_signal', 'app_error', 'other')),
        reason text,
        before jsonb,
        status varchar(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'proposed_approve', 'proposed_reject', 'approved', 'rejected', 'cancelled')),
        created_by uuid NOT NULL REFERENCES users(id),
        proposed_by uuid REFERENCES users(id),
        proposed_note text,
        proposed_at timestamptz,
        reviewed_by uuid REFERENCES users(id),
        review_note text,
        reviewed_at timestamptz,
        client_uuid uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT correction_some_time CHECK (check_in_at IS NOT NULL OR check_out_at IS NOT NULL),
        CONSTRAINT correction_client_uq UNIQUE (tenant_id, client_uuid)
      )`);
    await q.query(`CREATE UNIQUE INDEX correction_one_open ON attendance_corrections (assignment_id) WHERE status IN ('pending', 'proposed_approve', 'proposed_reject')`);
    await q.query(`CREATE INDEX correction_site ON attendance_corrections (tenant_id, site_id, created_at DESC)`);
    await q.query(`ALTER TABLE shift_assignments ADD COLUMN leave_request_id uuid REFERENCES leave_requests(id)`);
    await q.query(`ALTER TABLE attendances ADD COLUMN corrected_at timestamptz, ADD COLUMN missing_out_alerted_at timestamptz`);
    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'employee.pay.%' OR permission = 'leave.review' OR permission LIKE 'attendance.correct.%'`);
    await q.query(`ALTER TABLE attendances DROP COLUMN IF EXISTS corrected_at, DROP COLUMN IF EXISTS missing_out_alerted_at`);
    await q.query(`ALTER TABLE shift_assignments DROP COLUMN IF EXISTS leave_request_id`);
    await q.query(`DROP TABLE IF EXISTS attendance_corrections`);
    await q.query(`DROP TABLE IF EXISTS leave_requests`);
    await q.query(`DROP TABLE IF EXISTS employee_pay`);
  }
}
