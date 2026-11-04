import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type RoundStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'missed';
export interface RoundStop {
  checkpoint_id: string;
  seq: number;
  required: boolean;
}

/** One window of a schedule. Its stops are frozen when someone starts it. */
@Entity('patrol_rounds')
export class PatrolRound extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  schedule_id: string;

  @Column('uuid')
  route_id: string;

  @Column({ type: 'timestamptz' })
  expected_start: Date;

  @Column({ type: 'timestamptz' })
  expected_end: Date;

  /** Checkpoints with photo_rule "random" drawn for this round. */
  @Column({ type: 'uuid', array: true, default: () => `'{}'` })
  photo_checkpoint_ids: string[];

  @Column({ type: 'jsonb', nullable: true })
  stops: RoundStop[] | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: RoundStatus;

  @Column({ type: 'uuid', nullable: true })
  employee_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  ended_at: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  ended_by: 'guard' | 'system' | null;

  @Column({ default: false })
  late: boolean;

  /** Started or completed from offline reports sent well after the moment they claim. */
  @Column({ default: false })
  backdated: boolean;

  @Column('int', { default: 0 })
  required_count: number;

  @Column('int', { default: 0 })
  done_required: number;

  @Column({ type: 'timestamptz', nullable: true })
  reminder_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  missed_notified_at: Date | null;

  /** When the violations engine charged this missed round to whoever was on shift. */
  @Column({ type: 'timestamptz', nullable: true })
  missed_charged_at: Date | null;
}
