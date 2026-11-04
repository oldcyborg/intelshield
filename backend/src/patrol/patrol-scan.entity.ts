import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type ScanMethod = 'qr' | 'gps' | 'photo';

/** One checkpoint confirmed in one round. Never edited after it is written. */
@Entity('patrol_scans')
export class PatrolScan extends TenantEntity {
  @Column('uuid')
  round_id: string;

  @Column('uuid')
  checkpoint_id: string;

  @Column('uuid')
  employee_id: string;

  @Column('uuid')
  user_id: string;

  /** Made on the phone; sending the same scan twice returns the first. */
  @Column('uuid')
  client_uuid: string;

  @Column({ type: 'varchar', length: 10 })
  method: ScanMethod;

  /** The time that counts: server time online, the phone's time for scans sent later. */
  @Column({ type: 'timestamptz' })
  scanned_at: Date;

  @Column({ type: 'timestamptz' })
  device_time: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  server_time: Date;

  @Column({ default: false })
  captured_offline: boolean;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column({ type: 'int', nullable: true })
  accuracy_m: number | null;

  @Column({ type: 'int', nullable: true })
  distance_m: number | null;

  @Column({ default: false })
  mock_location: boolean;

  @Column({ type: 'uuid', nullable: true })
  photo_id: string | null;

  @Column({ type: 'text', array: true, default: () => `'{}'` })
  flags: string[];

  @Column({ type: 'varchar', length: 12, default: 'valid' })
  validity: 'valid' | 'suspicious';
}
