import { Column, Entity } from 'typeorm';
import { TimestampedEntity } from '../common/entities/base.entity';

@Entity('tenants')
export class Tenant extends TimestampedEntity {
  @Column({ length: 40, unique: true })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'suspended';

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  settings: Record<string, unknown>;
}
