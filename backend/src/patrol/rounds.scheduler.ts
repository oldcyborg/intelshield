import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { todayLocal } from '../common/date';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { RoundProgress } from './round-progress';

const TICK_MS = 60_000;
const REMIND_MINUTES = 5;

const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

/** TypeORM answers an UPDATE … RETURNING with [rows, count]; an INSERT with the rows alone. */
const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];

interface RoundRow {
  id: string;
  tenant_id: string;
  site_id: string;
  route_id: string;
  expected_start: Date;
}

@Injectable()
export class RoundsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Patrol');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly progress: RoundProgress,
  ) {}

  onModuleInit(): void {
    if (getEnv('PATROL_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass of the clock. A failing step is logged and the next one still runs. */
  async tick(now: Date = new Date()): Promise<void> {
    const steps: [string, (at: Date) => Promise<unknown>][] = [
      ['sinh vòng', (at) => this.generate(at)],
      ['nhắc vòng', (at) => this.remind(at)],
      ['chốt bỏ lỡ', (at) => this.markMissed(at)],
      ['tự đóng', (at) => this.closeOverdue(at)],
    ];
    for (const [name, step] of steps) {
      try {
        await step(now);
      } catch (error) {
        this.logger.error(`Tuần tra — ${name} lỗi: ${(error as Error).message}`, (error as Error).stack);
      }
    }
  }

  /** Rounds whose window has not ended and starts within 24 hours. Running it again adds nothing. */
  async generate(now: Date): Promise<number> {
    // The photo draw lands with the rounds or not at all: a round is never startable without its draw.
    return this.ds.transaction(async (m) => {
      const made: RoundRow[] = await m.query(
        `WITH s AS (
           SELECT p.id, p.tenant_id, p.site_id, p.route_id, p.start_time, p.end_time, p.interval_minutes, p.days
             FROM patrol_schedules p
             JOIN sites si ON si.id = p.site_id AND si.deleted_at IS NULL AND si.status = 'active'
             JOIN clients c ON c.id = si.client_id AND c.deleted_at IS NULL AND c.management_mode = 'managed'
             JOIN routes r ON r.id = p.route_id AND r.deleted_at IS NULL
            WHERE p.deleted_at IS NULL AND p.status = 'active'
              AND EXISTS (SELECT 1 FROM route_checkpoints rc JOIN checkpoints k ON k.id = rc.checkpoint_id
                           WHERE rc.route_id = p.route_id AND k.status = 'active' AND k.deleted_at IS NULL)),
         w AS (
           SELECT s.*, ((d::date + s.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS w_start,
                  (((d::date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS w_end
             FROM s, generate_series(($2::date - 1)::timestamp, ($2::date + 1)::timestamp, interval '1 day') d
            WHERE extract(isodow FROM d)::smallint = ANY(s.days)),
         slots AS (
           SELECT w.*, slot
             FROM w, generate_series(w.w_start, w.w_end - make_interval(mins => w.interval_minutes), make_interval(mins => w.interval_minutes)) slot)
         INSERT INTO patrol_rounds (tenant_id, site_id, schedule_id, route_id, expected_start, expected_end)
         SELECT tenant_id, site_id, id, route_id, slot, slot + make_interval(mins => interval_minutes)
           FROM slots
          WHERE slot + make_interval(mins => interval_minutes) > $1 AND slot < $1::timestamptz + interval '24 hours'
         ON CONFLICT (schedule_id, expected_start) DO NOTHING
         RETURNING id, tenant_id, site_id, route_id, expected_start`,
        [now, todayLocal(now)],
      );
      if (!made.length) return 0;
      await this.drawPhotos(m, made);
      return made.length;
    });
  }

  /** Each "random" checkpoint is asked for a photo on about the site's share of rounds, decided now so phones know offline. */
  private async drawPhotos(m: EntityManager, rounds: RoundRow[]): Promise<void> {
    const pool: { route_id: string; id: string }[] = await m.query(
      `SELECT rc.route_id, k.id FROM route_checkpoints rc JOIN checkpoints k ON k.id = rc.checkpoint_id
        WHERE rc.route_id = ANY($1::uuid[]) AND k.photo_rule = 'random' AND k.status = 'active' AND k.deleted_at IS NULL`,
      [[...new Set(rounds.map((r) => r.route_id))]],
    );
    if (!pool.length) return;
    const percent = new Map<string, number>();
    for (const round of rounds) {
      const candidates = pool.filter((p) => p.route_id === round.route_id).map((p) => p.id);
      if (!candidates.length) continue;
      if (!percent.has(round.site_id)) {
        percent.set(round.site_id, (await this.settings.effective(round.tenant_id, round.site_id)).patrol_photo_random_percent);
      }
      const share = percent.get(round.site_id)!;
      const picked = candidates.filter(() => randomInt(100) < share);
      if (picked.length) await m.query(`UPDATE patrol_rounds SET photo_checkpoint_ids = $2 WHERE id = $1`, [round.id, picked]);
    }
  }

  async remind(now: Date): Promise<number> {
    const due = rowsOf<RoundRow & { route_name: string; site_name: string }>(await this.ds.query(
      `UPDATE patrol_rounds r SET reminder_sent_at = $1
         FROM routes ro, sites s
        WHERE ro.id = r.route_id AND s.id = r.site_id AND r.status = 'pending' AND r.reminder_sent_at IS NULL
          AND r.expected_start > $1 AND r.expected_start <= $1::timestamptz + make_interval(mins => $2)
       RETURNING r.id, r.tenant_id, r.site_id, r.route_id, r.expected_start, ro.name AS route_name, s.name AS site_name`,
      [now, REMIND_MINUTES],
    ));
    for (const round of due) {
      const onShift: { id: string }[] = await this.ds.query(
        `SELECT DISTINCT u.id FROM shift_assignments a
           JOIN users u ON u.employee_id = a.employee_id AND u.status = 'active' AND u.deleted_at IS NULL
          WHERE a.site_id = $1 AND a.status = 'planned' AND a.planned_start <= $2 AND a.planned_end > $2`,
        [round.site_id, round.expected_start],
      );
      await this.notifications.notify(round.tenant_id, onShift.map((u) => u.id), {
        type: 'patrol.reminder', title: `Sắp đến vòng tuần ${hhmm(round.expected_start)} · ${round.route_name}`,
        body: round.site_name, data: { round_id: round.id }, priority: 'normal', push: true,
      });
    }
    return due.length;
  }

  async markMissed(now: Date): Promise<number> {
    const missed = rowsOf<RoundRow & { route_name: string; site_name: string }>(await this.ds.query(
      `UPDATE patrol_rounds r SET status = 'missed', missed_notified_at = $1, updated_at = now()
         FROM routes ro, sites s
        WHERE ro.id = r.route_id AND s.id = r.site_id AND r.status = 'pending' AND r.expected_end <= $1
       RETURNING r.id, r.tenant_id, r.site_id, r.route_id, r.expected_start, ro.name AS route_name, s.name AS site_name`,
      [now],
    ));
    for (const round of missed) {
      await this.notifications.notify(round.tenant_id, await this.leadersOf(round.site_id), {
        type: 'patrol.missed', title: `Vòng tuần bị bỏ lỡ · ${hhmm(round.expected_start)} · ${round.route_name}`,
        body: round.site_name, data: { round_id: round.id }, priority: 'high', push: true,
      });
    }
    return missed.length;
  }

  /** Rounds still open past their deadline are closed as they stand. */
  async closeOverdue(now: Date): Promise<number> {
    const open: { id: string; tenant_id: string; site_id: string; expected_end: Date }[] = await this.ds.query(
      `SELECT id, tenant_id, site_id, expected_end FROM patrol_rounds WHERE status = 'in_progress' AND expected_end <= $1`,
      [now],
    );
    let closed = 0;
    const tolerance = new Map<string, number>();
    for (const round of open) {
      if (!tolerance.has(round.site_id)) {
        tolerance.set(round.site_id, (await this.settings.effective(round.tenant_id, round.site_id)).round_tolerance_minutes);
      }
      if (new Date(round.expected_end).getTime() + tolerance.get(round.site_id)! * 60_000 > now.getTime()) continue;
      await this.ds.transaction(async (m) => {
        const [locked] = await m.query(`SELECT id FROM patrol_rounds WHERE id = $1 AND status = 'in_progress' FOR UPDATE SKIP LOCKED`, [round.id]);
        if (!locked) return;
        await this.progress.settle(m, round.id, now);
        closed += 1;
      });
    }
    return closed;
  }

  /** The leader of the team that runs the site; failing that, the manager of its group. */
  private async leadersOf(siteId: string): Promise<string[]> {
    const leaders: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM sites s JOIN teams t ON t.id = s.responsible_team_id AND t.deleted_at IS NULL
         JOIN users u ON u.employee_id = t.leader_employee_id AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE s.id = $1`,
      [siteId],
    );
    if (leaders.length) return leaders.map((u) => u.id);
    const managers: { id: string }[] = await this.ds.query(
      `SELECT g.manager_user_id AS id FROM sites s JOIN teams t ON t.id = s.responsible_team_id
         JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
        WHERE s.id = $1 AND g.manager_user_id IS NOT NULL`,
      [siteId],
    );
    return managers.map((u) => u.id);
  }
}
