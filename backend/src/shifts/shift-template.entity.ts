import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** A site's own shift: local start and end times. End at or before start means it runs past midnight. */
@Entity('shift_templates')
export class ShiftTemplate extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'time' })
  start_time: string;

  @Column({ type: 'time' })
  end_time: string;

  @Column('int', { default: 1 })
  headcount: number;

  @Column({ length: 50, default: 'guard' })
  position: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
