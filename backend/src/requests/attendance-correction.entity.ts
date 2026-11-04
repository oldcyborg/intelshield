import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const CORRECTION_REASONS = ['phone_dead', 'phone_broken', 'forgot', 'no_signal', 'app_error', 'other'] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];
export const OPEN_CORRECTION = ['pending', 'proposed_approve', 'proposed_reject'] as const;
export type CorrectionStatus = (typeof OPEN_CORRECTION)[number] | 'approved' | 'rejected' | 'cancelled';

/** A clock-in or clock-out added or changed after the fact: the leader proposes, a manager decides. */
@Entity('attendance_corrections')
export class AttendanceCorrection extends TenantEntity {
  @Column('uuid')
  assignment_id: string;

  @Column('uuid')
  employee_id: string;

  @Column('uuid')
  site_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  check_in_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @Column({ type: 'varchar', length: 20 })
  reason_code: CorrectionReason;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /** The clock-in and clock-out as they were before this was applied. */
  @Column({ type: 'jsonb', nullable: true })
  before: { check_in_at: string | null; check_out_at: string | null } | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: CorrectionStatus;

  @Column('uuid')
  created_by: string;

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

  @Column('uuid')
  client_uuid: string;
}
