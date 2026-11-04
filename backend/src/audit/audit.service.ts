import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  data?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly ds: DataSource) {}

  /** Pass the transaction's manager so the log entry commits or rolls back with the change. */
  async record(m: EntityManager | null, entry: AuditEntry): Promise<void> {
    const manager = m ?? this.ds.manager;
    await manager.save(
      manager.create(AuditLog, { ...entry, entity_id: entry.entity_id ?? null, data: entry.data ?? {} }),
    );
  }
}
