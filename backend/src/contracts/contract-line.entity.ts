import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type PriceUnit = 'per_guard_month' | 'per_shift' | 'per_hour';

/** One price for one position over one period. A price change closes this row and opens another. */
@Entity('contract_lines')
export class ContractLine extends TenantEntity {
  @Column('uuid')
  contract_id: string;

  @Column({ length: 50 })
  position: string;

  @Column('int')
  headcount: number;

  @Column({ type: 'varchar', length: 20 })
  unit: PriceUnit;

  /** numeric comes back from pg as a string; keep it that way — money never goes through float. */
  @Column({ type: 'numeric', precision: 14, scale: 0 })
  unit_price: string;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  shift_hours: string | null;

  @Column({ type: 'date' })
  effective_from: string;

  @Column({ type: 'date', nullable: true })
  effective_to: string | null;
}
