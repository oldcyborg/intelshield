import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('clients')
export class Client extends TenantEntity {
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'managed' })
  management_mode: 'managed' | 'self_managed';

  @Column({ type: 'varchar', length: 20, nullable: true })
  tax_code: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact_name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  contact_phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact_email: string | null;

  @Column({ type: 'uuid', nullable: true })
  account_manager_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
