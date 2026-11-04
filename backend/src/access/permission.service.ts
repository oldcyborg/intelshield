import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Permissions come from the database on every call — never from the token, never cached. */
@Injectable()
export class PermissionService {
  constructor(private readonly ds: DataSource) {}

  async permissionsOf(userId: string): Promise<Set<string>> {
    const rows: { permission: string }[] = await this.ds.query(
      `SELECT DISTINCT rp.permission
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
         JOIN role_permissions rp ON rp.role_id = r.id
        WHERE ur.user_id = $1`,
      [userId],
    );
    return new Set(rows.map((r) => r.permission));
  }

  async has(userId: string, permissions: string[]): Promise<boolean> {
    const held = await this.permissionsOf(userId);
    return permissions.every((p) => held.has(p));
  }
}
