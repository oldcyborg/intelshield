import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** A guard working at a client from start_date to end_date (inclusive; null = open). No overlaps per guard. */
@Entity('deployments')
export class Deployment extends TenantEntity {
  @Column('uuid')
  employee_id: string;

  @Column('uuid')
  client_id: string;

  @Column({ type: 'uuid', nullable: true })
  contract_id: string | null;

  @Column({ length: 50, default: 'guard' })
  position: string;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  end_reason: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;
}
