import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('attendances')
export class Attendance extends TenantEntity {
  @Column('uuid')
  assignment_id: string;

  @Column('uuid')
  employee_id: string;

  @Column({ type: 'timestamptz' })
  check_in_at: Date;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_in_lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_in_lng: string | null;

  @Column('int', { nullable: true })
  check_in_accuracy_m: number | null;

  @Column('int', { nullable: true })
  check_in_distance_m: number | null;

  @Column({ type: 'uuid', nullable: true })
  check_in_selfie_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_in_device_time: Date | null;

  @Column({ type: 'text', array: true, default: () => `'{}'` })
  check_in_flags: string[];

  @Column('int', { default: 0 })
  late_minutes: number;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_out_lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_out_lng: string | null;

  @Column('int', { nullable: true })
  check_out_accuracy_m: number | null;

  @Column('int', { nullable: true })
  check_out_distance_m: number | null;

  @Column({ type: 'uuid', nullable: true })
  check_out_selfie_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_device_time: Date | null;

  @Column({ type: 'text', array: true, default: () => `'{}'` })
  check_out_flags: string[];

  @Column('int', { nullable: true })
  early_minutes: number | null;

  @Column('int', { nullable: true })
  worked_minutes: number | null;

  /** Last time a clock-in or clock-out was set by an approved correction (flags say which side). */
  @Column({ type: 'timestamptz', nullable: true })
  corrected_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  missing_out_alerted_at: Date | null;
}
