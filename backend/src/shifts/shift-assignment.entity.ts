import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** One person on one shift. Planned shifts of one person never overlap (database exclusion). */
@Entity('shift_assignments')
export class ShiftAssignment extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  employee_id: string;

  @Column({ type: 'uuid', nullable: true })
  template_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  post_id: string | null;

  /** Local (Vietnam) date the shift starts on. */
  @Column({ type: 'date' })
  shift_date: string;

  @Column({ type: 'timestamptz' })
  planned_start: Date;

  @Column({ type: 'timestamptz' })
  planned_end: Date;

  @Column({ type: 'varchar', length: 20, default: 'planned' })
  status: 'planned' | 'cancelled';

  @Column({ type: 'uuid', nullable: true })
  substitute_for_id: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;
}
