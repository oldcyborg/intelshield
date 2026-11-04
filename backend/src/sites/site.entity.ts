import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('sites')
export class Site extends TenantEntity {
  @Column('uuid')
  client_id: string;

  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  /** numeric(9,6) — a string from pg, a number on the way in. */
  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column('int', { default: 150 })
  geofence_radius_m: number;

  @Column({ type: 'uuid', nullable: true })
  responsible_team_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}

@Entity('posts')
export class Post extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
