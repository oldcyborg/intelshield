import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('employees')
export class Employee extends TenantEntity {
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  full_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ length: 50, default: 'guard' })
  position: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'date', nullable: true })
  date_of_birth: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  national_id: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'date', nullable: true })
  hire_date: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  emergency_contact: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
