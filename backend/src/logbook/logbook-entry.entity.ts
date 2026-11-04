import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const LOGBOOK_TYPES = ['note', 'visitor', 'vehicle', 'asset', 'other'] as const;
export type LogbookType = (typeof LOGBOOK_TYPES)[number];

/** One line of the site's book. Never edited — only a visitor's or vehicle's exit time is added, once. */
@Entity('logbook_entries')
export class LogbookEntry extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ type: 'uuid', nullable: true })
  assignment_id: string | null;

  @Column('uuid')
  author_user_id: string;

  @Column({ type: 'uuid', nullable: true })
  author_employee_id: string | null;

  @Column({ type: 'varchar', length: 20 })
  type: LogbookType;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  data: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  exited_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  exited_by: string | null;

  @Column('uuid')
  client_uuid: string;

  @Column({ default: false })
  captured_offline: boolean;
}
