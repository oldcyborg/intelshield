import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { VIOLATION_TYPES, ViolationType } from '../violations/violation.entity';
import { FinanceSettingsDto } from './dto';
import { PayRules } from './payroll-engine';

export interface FinanceSettings extends PayRules {
  vat_rate: number;
  payment_terms_days: number;
  /** Bank account and how to pay, printed on payment requests. */
  payment_info: string | null;
}

export const FINANCE_DEFAULTS: FinanceSettings = {
  standard_shifts: 26, holiday_coefficient: 3, overtime_coefficient: 1.5, holidays: [], penalties: {}, vat_rate: 10, payment_terms_days: 15, payment_info: null,
};

/** Who may change which rule: pay rules with payroll.manage, billing terms with billing.manage. */
const PAY_KEYS = ['standard_shifts', 'holiday_coefficient', 'overtime_coefficient', 'holidays', 'penalties'] as const;
const BILLING_KEYS = ['vat_rate', 'payment_terms_days', 'payment_info'] as const;


@Injectable()
export class FinanceSettingsService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  /** The company's rules, the defaults where nothing was saved yet. */
  async rules(tenantId: string, m: EntityManager = this.ds.manager): Promise<FinanceSettings> {
    // Dates as text: a JS Date would shift with the server time zone.
    const [row] = await m.query(
      `SELECT standard_shifts, holiday_coefficient, overtime_coefficient, holidays::text[] AS holidays, penalties, vat_rate, payment_terms_days, payment_info
         FROM finance_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!row) return { ...FINANCE_DEFAULTS };
    return {
      standard_shifts: Number(row.standard_shifts), holiday_coefficient: Number(row.holiday_coefficient),
      overtime_coefficient: Number(row.overtime_coefficient), holidays: [...(row.holidays ?? [])].sort(),
      penalties: row.penalties ?? {}, vat_rate: Number(row.vat_rate), payment_terms_days: row.payment_terms_days, payment_info: row.payment_info,
    };
  }

  async get(actor: AuthUser) {
    return { values: await this.rules(tenantOf(actor)), defaults: FINANCE_DEFAULTS };
  }

  async update(actor: AuthUser, dto: FinanceSettingsDto) {
    const tenantId = tenantOf(actor);
    const held = await this.permissions.permissionsOf(actor.id);
    const touches = (keys: readonly string[]) => keys.some((k) => (dto as Record<string, unknown>)[k] !== undefined);
    if ((touches(PAY_KEYS) && !held.has('payroll.manage')) || (touches(BILLING_KEYS) && !held.has('billing.manage'))) {
      throw new BusinessException('AUTH_FORBIDDEN');
    }
    if (dto.penalties) {
      for (const [type, amount] of Object.entries(dto.penalties)) {
        if (!VIOLATION_TYPES.includes(type as ViolationType) || !Number.isInteger(amount) || amount < 0 || amount > 1_000_000_000) {
          throw new BusinessException('VALIDATION_FAILED', [`penalties.${type}: loại vi phạm hoặc số tiền không hợp lệ`]);
        }
      }
    }
    await this.ds.transaction(async (m) => {
      const before = await this.rules(tenantId, m);
      const next = { ...before, ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) } as FinanceSettings;
      next.holidays = [...new Set(next.holidays)].sort();
      await m.query(
        `INSERT INTO finance_settings (tenant_id, standard_shifts, holiday_coefficient, overtime_coefficient, holidays, penalties, vat_rate,
                                      payment_terms_days, updated_by, payment_info, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (tenant_id) DO UPDATE SET standard_shifts = $2, holiday_coefficient = $3, overtime_coefficient = $4, holidays = $5,
           penalties = $6, vat_rate = $7, payment_terms_days = $8, updated_by = $9, payment_info = $10, updated_at = now()`,
        [tenantId, next.standard_shifts, next.holiday_coefficient, next.overtime_coefficient, next.holidays, JSON.stringify(next.penalties),
          next.vat_rate, next.payment_terms_days, actor.id, next.payment_info?.trim() || null],
      );
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'finance.settings', entity_type: 'tenant', entity_id: tenantId, data: { before, after: next },
      });
    });
    return this.get(actor);
  }
}
