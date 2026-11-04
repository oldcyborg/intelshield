import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('team_groups')
export class TeamGroup extends TenantEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  manager_user_id: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
