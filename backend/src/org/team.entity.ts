import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('teams')
export class Team extends TenantEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  team_group_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  leader_employee_id: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
