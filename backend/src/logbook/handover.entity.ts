import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export interface HandoverItem {
  label: string;
  status: 'ok' | 'missing' | 'issue';
  note?: string;
}

/** What one shift hands to the next: the site's checklist, ticked; the receiver answers on their own account. */
@Entity('handovers')
export class Handover extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  from_assignment_id: string;

  @Column('uuid')
  from_employee_id: string;

  @Column({ type: 'uuid', nullable: true })
  to_assignment_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  to_employee_id: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  items: HandoverItem[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 20, default: 'submitted' })
  status: 'submitted' | 'accepted' | 'disputed';

  @Column({ type: 'timestamptz', default: () => 'now()' })
  submitted_at: Date;

  @Column({ type: 'text', nullable: true })
  receiver_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  answered_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;

  @Column({ type: 'text', nullable: true })
  review_note: string | null;
}
