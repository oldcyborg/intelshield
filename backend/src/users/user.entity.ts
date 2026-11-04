import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TimestampedEntity } from '../common/entities/base.entity';

export type UserType = 'platform_admin' | 'staff' | 'guard' | 'client_user';

@Entity('users')
export class User extends TimestampedEntity {
  @Column({ type: 'uuid', nullable: true })
  tenant_id: string | null;

  @Column({ type: 'varchar', length: 20 })
  user_type: UserType;

  @Column({ length: 200 })
  full_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  @Column({ length: 100, select: false })
  password_hash: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'locked';

  @Column({ type: 'uuid', nullable: true })
  employee_id: string | null;

  @Column({ default: false })
  must_change_password: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
