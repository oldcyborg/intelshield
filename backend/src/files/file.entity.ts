import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type FileOwnerType = 'contract' | 'employee_document' | 'attendance' | 'incident' | 'patrol_scan' | 'logbook_entry' | 'handover' | 'leave_request' | 'attendance_correction';

@Entity('files')
export class FileRecord extends TenantEntity {
  /** null until a contract or document claims the file. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  owner_type: FileOwnerType | null;

  @Column({ type: 'uuid', nullable: true })
  owner_id: string | null;

  @Column({ length: 255 })
  original_name: string;

  @Column({ length: 500, select: false })
  path: string;

  @Column({ length: 100 })
  mime: string;

  @Column('int')
  size: number;

  @Column({ length: 64 })
  sha256: string;

  @Column({ type: 'uuid', nullable: true })
  uploaded_by: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
