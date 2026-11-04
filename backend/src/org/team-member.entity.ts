import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** One row per stay in a team. The database refuses overlapping stays for one employee. */
@Entity('team_members')
export class TeamMember extends TenantEntity {
  @Column('uuid')
  team_id: string;

  @Column('uuid')
  employee_id: string;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;
}
