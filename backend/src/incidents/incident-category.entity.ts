import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';
import { Severity } from './categories';

@Entity('incident_categories')
export class IncidentCategory extends TenantEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  default_severity: Severity;

  @Column('int', { default: 0 })
  sort: number;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
