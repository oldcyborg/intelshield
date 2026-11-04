import { MigrationInterface, QueryRunner } from 'typeorm';

/** Remember the previous refresh hash for a few seconds so parallel refreshes are not mistaken for theft. */
export class SessionRotationGrace1760313600000 implements MigrationInterface {
  name = 'SessionRotationGrace1760313600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sessions ADD COLUMN prev_token_hash varchar(64), ADD COLUMN rotated_at timestamptz`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sessions DROP COLUMN prev_token_hash, DROP COLUMN rotated_at`);
  }
}
