import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const VIOLATION_TYPES = ['late_check_in', 'absent', 'early_check_out', 'missed_round', 'missed_checkpoint', 'suspicious_scan'] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];
export const VIOLATION_STATUSES = ['auto', 'proposed_confirm', 'proposed_waive', 'confirmed', 'waived'] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

/** One rule broken by one person about one thing (a shift, a round, a scan). Only "confirmed" reaches payroll. */
@Entity('violations')
export class Violation extends TenantEntity {
  @Column('uuid')
  employee_id: string;

  @Column('uuid')
  site_id: string;

  @Column({ type: 'varchar', length: 30 })
  type: ViolationType;

  @Column({ type: 'varchar', length: 20 })
  ref_type: 'assignment' | 'round' | 'scan';

  @Column('uuid')
  ref_id: string;

  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  @Column({ type: 'int', nullable: true })
  minutes: number | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  detail: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'auto' })
  status: ViolationStatus;

  @Column({ type: 'uuid', nullable: true })
  proposed_by: string | null;

  @Column({ type: 'text', nullable: true })
  proposed_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  proposed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string | null;

  @Column({ type: 'text', nullable: true })
  review_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;
}
