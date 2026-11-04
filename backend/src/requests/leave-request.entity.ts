import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const LEAVE_TYPES = ['annual', 'sick', 'personal', 'unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** A person asks for days off; a leader or manager who rosters them decides. Dates are Vietnam dates, both ends included. */
@Entity('leave_requests')
export class LeaveRequest extends TenantEntity {
  @Column('uuid')
  employee_id: string;

  @Column({ type: 'varchar', length: 20 })
  type: LeaveType;

  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date' })
  to_date: string;

  @Column('int')
  days: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: LeaveStatus;

  /** A shift it touches starts within 12 hours of asking (or already has): the manager hears too. */
  @Column({ default: false })
  urgent: boolean;

  @Column('uuid')
  created_by: string;

  @Column({ type: 'uuid', nullable: true })
  decided_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'text', nullable: true })
  decision_note: string | null;

  @Column('uuid')
  client_uuid: string;
}
