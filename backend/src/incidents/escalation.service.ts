import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { todayLocal } from '../common/date';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { Settings } from '../settings/settings';
import { SettingsService } from '../settings/settings.service';
import { Severity } from './categories';
import { Incident } from './incident.entity';

const FIRST_LEVELS: Record<Severity, number[]> = { low: [1], medium: [1], high: [1, 2], critical: [1, 2, 3] };
const PRIORITY: Record<Severity, 'normal' | 'high' | 'critical'> = { low: 'normal', medium: 'high', high: 'high', critical: 'critical' };
const LABEL: Record<Severity, string> = { low: 'Sự cố mức thấp', medium: 'Sự cố', high: 'Sự cố mức cao', critical: 'KHẨN CẤP' };
const TICK_MS = 60_000;

type Chain = [string[], string[], string[]];

@Injectable()
export class EscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Escalation');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    if (getEnv('ESCALATION_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => {
      this.tick().catch((error: Error) => this.logger.error(`Vòng leo thang lỗi: ${error.message}`, error.stack));
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Who answers for this incident, level by level. The reporter is never on their own chain. */
  async chain(m: EntityManager, incident: Incident): Promise<Chain> {
    const today = todayLocal();
    let teamId: string | null = null;
    // A guard's report goes to their own leader; what the office logs belongs to the team that runs the site (§6.2).
    if (incident.source === 'guard_app' && incident.reporter_employee_id) {
      const [row] = await m.query(
        `SELECT team_id FROM team_members WHERE employee_id = $1 AND start_date <= $2 AND (end_date IS NULL OR end_date >= $2)`,
        [incident.reporter_employee_id, today],
      );
      teamId = row?.team_id ?? null;
    }
    if (!teamId && incident.site_id) {
      const [site] = await m.query(`SELECT responsible_team_id FROM sites WHERE id = $1`, [incident.site_id]);
      teamId = site?.responsible_team_id ?? null;
    }
    const leaders: string[] = teamId
      ? (await m.query(
          `SELECT u.id FROM teams t JOIN users u ON u.employee_id = t.leader_employee_id
            WHERE t.id = $1 AND t.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL`,
          [teamId],
        )).map((r: { id: string }) => r.id)
      : [];
    const [group] = teamId
      ? await m.query(
          `SELECT g.manager_user_id FROM teams t JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
             JOIN users u ON u.id = g.manager_user_id AND u.status = 'active' AND u.deleted_at IS NULL
            WHERE t.id = $1`,
          [teamId],
        )
      : [];
    const final = await this.holders(m, incident.tenant_id, 'incident.final_escalation');
    const managers = group?.manager_user_id
      ? [group.manager_user_id as string]
      : (await this.holders(m, incident.tenant_id, 'incident.manage')).filter((id) => !final.includes(id));
    const without = (list: string[]) => list.filter((id) => id !== incident.reported_by);
    return [without(leaders), without(managers), without(final)];
  }

  /** First notifications, inside the transaction that creates the incident. */
  async start(m: EntityManager, incident: Incident): Promise<void> {
    const chain = await this.chain(m, incident);
    let levels = FIRST_LEVELS[incident.severity];
    let top = Math.max(...levels);
    let recipients = union(chain, levels);
    while (!recipients.length && top < 3) {
      top += 1;
      levels = [top];
      recipients = chain[top - 1];
    }
    if (!recipients.length) this.logger.warn(`Sự cố ${incident.id}: không có ai trong chuỗi nhận thông báo`);
    const s = await this.settings.effective(incident.tenant_id, incident.site_id);
    const next = this.nextAt(incident.severity, top, new Date(), s);
    await m.update(Incident, { id: incident.id }, { escalation_level: top, next_escalation_at: next });

    const where = await this.where(m, incident);
    await this.notifications.notify(incident.tenant_id, recipients, {
      type: 'incident.new',
      title: `${LABEL[incident.severity]} · ${incident.title}`,
      body: `${where}${incident.description ? ` — ${incident.description.slice(0, 140)}` : ''}`,
      data: { incident_id: incident.id, severity: incident.severity },
      priority: PRIORITY[incident.severity],
      push: incident.severity !== 'low',
    }, m);

    if (incident.source === 'client_report') {
      const [c] = await m.query(`SELECT account_manager_id FROM clients WHERE id = $1`, [incident.client_id]);
      if (c?.account_manager_id && !recipients.includes(c.account_manager_id)) {
        await this.notifications.notify(incident.tenant_id, [c.account_manager_id], {
          type: 'incident.client_report', title: `Khách báo sự cố · ${incident.title}`, body: where,
          data: { incident_id: incident.id, severity: incident.severity }, priority: 'high', push: true,
        }, m);
      }
    }
  }

  /** One pass: every incident nobody took in time goes one level up. Returns how many moved. */
  async tick(now: Date = new Date()): Promise<number> {
    const due: { id: string }[] = await this.ds.query(
      `SELECT id FROM incidents WHERE status = 'new' AND next_escalation_at <= $1 ORDER BY next_escalation_at LIMIT 100`,
      [now],
    );
    let moved = 0;
    for (const { id } of due) {
      try {
        if (await this.escalateOne(id, now)) moved += 1;
      } catch (error) {
        // Logged and retried later; the incidents behind it in the queue still move.
        this.logger.error(`Leo thang sự cố ${id} lỗi: ${(error as Error).message}`, (error as Error).stack);
        await this.ds.query(`UPDATE incidents SET next_escalation_at = $2 WHERE id = $1 AND status = 'new'`, [id, new Date(now.getTime() + 5 * 60_000)]);
      }
    }
    return moved;
  }

  /** One incident up one level, in its own transaction. False when someone took it meanwhile. */
  private escalateOne(id: string, now: Date): Promise<boolean> {
    return this.ds.transaction(async (m) => {
      const [locked] = await m.query(
        `SELECT id FROM incidents WHERE id = $1 AND status = 'new' AND next_escalation_at <= $2 FOR UPDATE SKIP LOCKED`,
        [id, now],
      );
      if (!locked) return false;
      const incident = await m.findOneByOrFail(Incident, { id });
      const chain = await this.chain(m, incident);
      const critical = incident.severity === 'critical';
      let level = Math.min(incident.escalation_level + 1, 3);
      let recipients = critical ? union(chain, [1, 2, 3].slice(0, level)) : chain[level - 1];
      while (!recipients.length && level < 3) {
        level += 1;
        recipients = critical ? union(chain, [1, 2, 3].slice(0, level)) : chain[level - 1];
      }
      const s = await this.settings.effective(incident.tenant_id, incident.site_id);
      await this.notifications.notify(incident.tenant_id, recipients, {
        type: 'incident.escalated',
        title: `Chưa ai tiếp nhận · ${LABEL[incident.severity]} · ${incident.title}`,
        body: await this.where(m, incident),
        data: { incident_id: incident.id, severity: incident.severity },
        priority: critical ? 'critical' : 'high',
        push: true,
      }, m);
      await m.query(
        `INSERT INTO incident_events (tenant_id, incident_id, type, to_status, data) VALUES ($1, $2, 'escalated', NULL, $3)`,
        [incident.tenant_id, incident.id, JSON.stringify({ level, notified: recipients })],
      );
      await m.update(Incident, { id }, { escalation_level: level, next_escalation_at: this.nextAt(incident.severity, level, now, s) });
      return true;
    });
  }

  /** Low never escalates; critical reminds forever; the others climb until the last level. */
  private nextAt(severity: Severity, level: number, from: Date, s: Settings): Date | null {
    if (severity === 'low') return null;
    if (severity !== 'critical' && level >= 3) return null;
    const minutes =
      severity === 'medium' ? s.incident_escalate_medium_minutes
        : severity === 'high' ? s.incident_escalate_high_minutes
          : s.incident_escalate_critical_minutes;
    return new Date(from.getTime() + minutes * 60_000);
  }

  private async where(m: EntityManager, incident: Incident): Promise<string> {
    const [row] = await m.query(
      `SELECT c.name AS client_name, s.name AS site_name FROM clients c LEFT JOIN sites s ON s.id = $2 WHERE c.id = $1`,
      [incident.client_id, incident.site_id],
    );
    return row?.site_name ? `${row.site_name} (${row.client_name})` : row?.client_name ?? '';
  }

  private async holders(m: EntityManager, tenantId: string, permission: string): Promise<string[]> {
    const rows: { id: string }[] = await m.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
         JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = $2
         JOIN user_scopes us ON us.user_id = u.id AND us.scope_type = 'tenant'
        WHERE u.tenant_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL`,
      [tenantId, permission],
    );
    return rows.map((r) => r.id);
  }
}

function union(chain: Chain, levels: number[]): string[] {
  return [...new Set(levels.flatMap((l) => chain[l - 1]))];
}
