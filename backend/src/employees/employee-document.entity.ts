import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const DOCUMENT_KINDS = [
  'national_id', 'security_certificate', 'health_check', 'criminal_record', 'labor_contract', 'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

@Entity('employee_documents')
export class EmployeeDocument extends TenantEntity {
  @Column('uuid')
  employee_id: string;

  @Column({ type: 'varchar', length: 30 })
  kind: DocumentKind;

  @Column({ type: 'varchar', length: 50, nullable: true })
  number: string | null;

  @Column({ type: 'date', nullable: true })
  issued_on: string | null;

  @Column({ type: 'date', nullable: true })
  expires_on: string | null;

  @Column({ type: 'uuid', nullable: true })
  file_id: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
