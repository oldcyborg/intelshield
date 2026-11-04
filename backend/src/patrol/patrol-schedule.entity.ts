import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** "Route R, every N minutes between two times of day, on these weekdays." */
@Entity('patrol_schedules')
export class PatrolSchedule extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  route_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'time' })
  start_time: string;

  @Column({ type: 'time' })
  end_time: string;

  @Column('int')
  interval_minutes: number;

  /** ISO weekdays (1 = Monday) of the local date a window starts on. */
  @Column({ type: 'smallint', array: true, default: () => `'{1,2,3,4,5,6,7}'` })
  days: number[];

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
