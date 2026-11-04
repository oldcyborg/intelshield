import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { leaderAndManager } from './site-people';

const TICK_MS = 60_000;

/** A guard 15 minutes into their shift while the shift before theirs has no accepted handover: tell the leader and manager, once. */
@Injectable()
export class HandoverWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Handover');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (getEnv('HANDOVER_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => void this.tick().catch((e: Error) => this.logger.error(`Nhắc giao ca lỗi: ${e.message}`, e.stack)), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    const due: { id: string; tenant_id: string; site_id: string; employee_name: string; site_name: string }[] = await this.ds.query(
      `SELECT x.id, x.tenant_id, x.site_id, e.full_name AS employee_name, s.name AS site_name
         FROM shift_assignments x
         JOIN attendances t ON t.assignment_id = x.id
         JOIN employees e ON e.id = x.employee_id
         JOIN sites s ON s.id = x.site_id AND s.deleted_at IS NULL
         JOIN clients c ON c.id = s.client_id AND c.management_mode = 'managed'
        WHERE x.status = 'planned' AND x.handover_alerted_at IS NULL
          AND t.check_in_at <= $1::timestamptz - interval '15 minutes' AND t.check_in_at > $1::timestamptz - interval '12 hours'
          AND EXISTS (
                SELECT 1 FROM shift_assignments p
                 WHERE p.site_id = x.site_id AND p.status = 'planned' AND p.employee_id <> x.employee_id AND p.planned_start < x.planned_start
                   AND p.planned_end BETWEEN x.planned_start - interval '2 hours' AND x.planned_start + interval '2 hours'
                   -- answered (accepted, or disputed and already reported) or handed to someone else: not this guard's alert
                   AND NOT EXISTS (SELECT 1 FROM handovers h WHERE h.from_assignment_id = p.id
                                     AND (h.status IN ('accepted', 'disputed') OR (h.to_employee_id IS NOT NULL AND h.to_employee_id <> x.employee_id))))`,
      [now],
    );
    for (const a of due) {
      try {
        // Claimed and announced together: a failed alert leaves the shift unclaimed for the next pass.
        await this.ds.transaction(async (m) => {
          const claimed = await m.query(`UPDATE shift_assignments SET handover_alerted_at = $2 WHERE id = $1 AND handover_alerted_at IS NULL RETURNING id`, [a.id, now]);
          const rows = Array.isArray(claimed[0]) ? claimed[0] : claimed;
          if (!rows.length) return;
          await this.notifications.notify(a.tenant_id, await leaderAndManager(m, a.site_id), {
            type: 'handover.unconfirmed', title: `Chưa nhận bàn giao ca · ${a.site_name}`,
            body: `${a.employee_name} đã vào ca 15 phút nhưng chưa có biên bản giao ca được xác nhận`,
            data: { assignment_id: a.id }, priority: 'high', push: true,
          }, m);
        });
      } catch (error) {
        this.logger.error(`Nhắc giao ca ${a.id} lỗi: ${(error as Error).message}`);
      }
    }
  }
}
