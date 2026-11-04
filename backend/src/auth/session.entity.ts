import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  user_id: string;

  @Column({ length: 64 })
  token_hash: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  device_label: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz' })
  last_used_at: Date;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  device_id: string | null;

  /** The hash this session had before its last rotation, accepted for ROTATION_GRACE_SECONDS. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  prev_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rotated_at: Date | null;
}
