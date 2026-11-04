import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const CHECK_METHODS = ['qr', 'gps', 'photo', 'nfc'] as const;
export type CheckMethod = (typeof CHECK_METHODS)[number];
export const PHOTO_RULES = ['never', 'always', 'random'] as const;
export type PhotoRule = (typeof PHOTO_RULES)[number];

@Entity('checkpoints')
export class Checkpoint extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column('int', { default: 30 })
  radius_m: number;

  @Column({ type: 'text', array: true, default: () => `'{qr}'` })
  allowed_methods: CheckMethod[];

  /** Signs this checkpoint's QR tags. Never leaves the backend. */
  @Column({ length: 64, select: false })
  qr_secret: string;

  /** Photo with the confirmation: never, always, or on the rounds drawn at random (spec §4.2). */
  @Column({ type: 'varchar', length: 10, default: 'never' })
  photo_rule: PhotoRule;

  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
