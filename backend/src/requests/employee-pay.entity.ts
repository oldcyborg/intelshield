import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const PAY_TYPES = ['monthly', 'per_shift', 'per_hour'] as const;
export type PayType = (typeof PAY_TYPES)[number];

/**
 * How a monthly salary is counted: by attendance (công worked against the standard, so a missed shift costs a
 * công), or fixed (the whole month whatever the shifts — for a team leader who walks the team's sites).
 */
export const MONTHLY_MODES = ['attendance', 'fixed'] as const;
export type MonthlyMode = (typeof MONTHLY_MODES)[number];

/** The pay & leave part of a person's file — read and written only with the pay permissions. */
@Entity('employee_pay')
export class EmployeePay {
  @PrimaryColumn('uuid')
  employee_id: string;

  @Column('uuid')
  tenant_id: string;

  @Column({ type: 'varchar', length: 20 })
  pay_type: PayType;

  /** Meaningful for a monthly salary only; the other pay types keep the default. */
  @Column({ type: 'varchar', length: 12, default: 'attendance' })
  monthly_mode: MonthlyMode;

  @Column({ type: 'numeric', precision: 14, scale: 0, nullable: true })
  base_pay: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 0, nullable: true })
  allowance: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  bank_name: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  bank_account: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  tax_code: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  social_insurance_no: string | null;

  /** Fixed social insurance taken from each month's pay; empty = none. */
  @Column({ type: 'numeric', precision: 14, scale: 0, nullable: true })
  social_insurance: string | null;

  /** Days of annual leave a year; empty = the company does not count annual leave for this person. */
  @Column({ type: 'int', nullable: true })
  annual_leave_days: number | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
