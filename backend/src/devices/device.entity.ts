import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('devices')
export class Device extends TenantEntity {
  @Column('uuid')
  user_id: string;

  /** The app's own installation id (Capacitor Device.getId). */
  @Column({ length: 200 })
  device_id: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  platform: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  label: string | null;

  /** Guards and team leaders: one active phone at a time. */
  @Column()
  restricted: boolean;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: 'pending' | 'active' | 'revoked';

  @Column({ type: 'uuid', nullable: true })
  decided_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at: Date | null;

  @Column({ type: 'varchar', length: 4096, nullable: true, select: false })
  push_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  push_token_updated_at: Date | null;
}
