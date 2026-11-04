import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';
import { ScopeType } from './scope.types';

@Entity('roles')
export class Role extends TenantEntity {
  @Column({ length: 50 })
  code: string;

  @Column({ length: 100 })
  name: string;

  @Column({ default: false })
  is_system: boolean;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}

@Entity('role_permissions')
export class RolePermission {
  @PrimaryColumn('uuid')
  role_id: string;

  @PrimaryColumn({ length: 80 })
  permission: string;
}

@Entity('user_roles')
export class UserRole {
  @PrimaryColumn('uuid')
  user_id: string;

  @PrimaryColumn('uuid')
  role_id: string;
}

@Entity('user_scopes')
export class UserScope {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  tenant_id: string;

  @Column('uuid')
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  scope_type: ScopeType;

  @Column({ type: 'uuid', nullable: true })
  scope_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
