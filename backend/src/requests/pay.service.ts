import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { EmployeesService } from '../employees/employees.service';
import { PayDto } from './dto';
import { EmployeePay } from './employee-pay.entity';

export interface LeaveBalance {
  year: number;
  /** Null: annual leave is not counted for this person. */
  allowance: number | null;
  used: number;
  remaining: number | null;
}

export interface PayView {
  employee_id: string;
  pay_type: string;
  monthly_mode: string;
  base_pay: number | null;
  allowance: number | null;
  bank_name: string | null;
  bank_account: string | null;
  tax_code: string | null;
  social_insurance_no: string | null;
  social_insurance: number | null;
  annual_leave_days: number | null;
  note: string | null;
  updated_at: Date;
}

const money = (v: string | null) => (v === null ? null : Number(v));

function view(p: EmployeePay): PayView {
  return {
    employee_id: p.employee_id, pay_type: p.pay_type, monthly_mode: p.monthly_mode, base_pay: money(p.base_pay), allowance: money(p.allowance),
    bank_name: p.bank_name, bank_account: p.bank_account, tax_code: p.tax_code, social_insurance_no: p.social_insurance_no, social_insurance: money(p.social_insurance),
    annual_leave_days: p.annual_leave_days, note: p.note, updated_at: p.updated_at,
  };
}

@Injectable()
export class PayService {
  constructor(
    private readonly ds: DataSource,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}

  async get(actor: AuthUser, employeeId: string, year?: number): Promise<{ pay: PayView | null; leave: LeaveBalance }> {
    await this.employees.get(actor, employeeId);
    const pay = await this.ds.getRepository(EmployeePay).findOneBy({ employee_id: employeeId, tenant_id: tenantOf(actor) });
    return { pay: pay ? view(pay) : null, leave: await this.balance(this.ds.manager, tenantOf(actor), employeeId, year) };
  }

  async set(actor: AuthUser, employeeId: string, dto: PayDto, year?: number) {
    const tenantId = tenantOf(actor);
    await this.employees.get(actor, employeeId);
    await this.ds.transaction(async (m) => {
      const prior = await m.findOneBy(EmployeePay, { employee_id: employeeId, tenant_id: tenantId });
      const next = {
        pay_type: dto.pay_type, monthly_mode: dto.pay_type === 'monthly' ? (dto.monthly_mode ?? 'attendance') : 'attendance',
        base_pay: dto.base_pay == null ? null : String(dto.base_pay),
        allowance: dto.allowance == null ? null : String(dto.allowance), bank_name: dto.bank_name?.trim() || null,
        bank_account: dto.bank_account?.trim() || null, tax_code: dto.tax_code?.trim() || null,
        social_insurance_no: dto.social_insurance_no?.trim() || null, social_insurance: dto.social_insurance == null ? null : String(dto.social_insurance),
        annual_leave_days: dto.annual_leave_days ?? null,
        note: dto.note?.trim() || null, updated_by: actor.id,
      };
      await m.save(m.create(EmployeePay, { ...(prior ?? {}), employee_id: employeeId, tenant_id: tenantId, ...next }));
      const after = await m.findOneByOrFail(EmployeePay, { employee_id: employeeId });
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.pay.update', entity_type: 'employee', entity_id: employeeId,
        data: { before: prior ? view(prior) : null, after: view(after) },
      });
    });
    return this.get(actor, employeeId, year);
  }

  /** The caller's own allowance and what they have used this year. */
  async mine(actor: AuthUser, year?: number): Promise<LeaveBalance> {
    if (!actor.employee_id) throw new BusinessException('LEAVE_NO_EMPLOYEE');
    return this.balance(this.ds.manager, tenantOf(actor), actor.employee_id, year);
  }

  /** Approved annual leave days falling in the year, against the person's allowance. */
  async balance(m: EntityManager, tenantId: string, employeeId: string, year?: number): Promise<LeaveBalance> {
    const y = year ?? Number(todayLocal().slice(0, 4));
    const [row] = await m.query(
      `SELECT (SELECT annual_leave_days FROM employee_pay WHERE employee_id = $1 AND tenant_id = $2) AS allowance,
              COALESCE((SELECT sum(LEAST(to_date, make_date($3, 12, 31)) - GREATEST(from_date, make_date($3, 1, 1)) + 1)
                          FROM leave_requests
                         WHERE employee_id = $1 AND tenant_id = $2 AND type = 'annual' AND status = 'approved'
                           AND from_date <= make_date($3, 12, 31) AND to_date >= make_date($3, 1, 1)), 0)::int AS used`,
      [employeeId, tenantId, y],
    );
    const allowance = row.allowance === null ? null : Number(row.allowance);
    return { year: y, allowance, used: row.used, remaining: allowance === null ? null : allowance - row.used };
  }
}
