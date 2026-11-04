import { Column, DeleteDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('routes')
export class Route extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}

/** Checkpoint `seq` of a route. Replaced as a whole when the route is edited. */
@Entity('route_checkpoints')
export class RouteCheckpoint {
  @PrimaryColumn('uuid')
  route_id: string;

  @PrimaryColumn('int')
  seq: number;

  @Column('uuid')
  checkpoint_id: string;

  @Column({ default: true })
  required: boolean;
}
