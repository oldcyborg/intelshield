import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** Stored lifecycle. The date-derived status (upcoming/active/expiring/expired) is computed, see contract-status.ts. */
export type ContractState = 'draft' | 'signed' | 'terminated';

@Entity('contracts')
export class Contract extends TenantEntity {
  @Column('uuid')
  client_id: string;

  @Column({ length: 50 })
  contract_no: string;

  @Column({ type: 'date', nullable: true })
  signed_at: string | null;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column('int', { default: 30 })
  notice_days: number;

  @Column({ default: false })
  auto_renew: boolean;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  state: ContractState;

  @Column({ type: 'date', nullable: true })
  terminated_on: string | null;

  @Column({ type: 'uuid', nullable: true })
  file_id: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
