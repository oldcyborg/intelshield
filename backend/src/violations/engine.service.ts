import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { Settings } from '../settings/settings';
import { SettingsService } from '../settings/settings.service';
import { ViolationType } from './violation.entity';

const TICK_MS = 60_000;
/** Rules look this far back; older data is settled. */
const LOOKBACK = `interval '2 days'`;
const MANAGED = `JOIN sites s ON s.id = x.site_id JOIN clients c ON c.id = s.client_id AND c.management_mode = 'managed' AND c.deleted_at IS NULL`;
/**
 * The moment a person's clock starts: the planned start, or when the shift was handed to them if that was later
 * — a stand-in called at 09:45 for a 09:00 shift is not 45 minutes late (spec §7.1).
 */
const ANCHOR = `GREATEST(x.planned_start, x.created_at)`;
const OPEN = `('auto', 'proposed_confirm', 'proposed_waive')`;

interface NewViolation {
  tenant_id: string;
  employee_id: string;
  site_id: string;
  type: ViolationType;
  ref_type: 'assignment' | 'round' | 'scan';
  ref_id: string;
  occurred_at: Date;
  minutes?: number | null;
  detail?: Record<string, unknown>;
}

type SettingsLookup = (tenantId: string, siteId: string) => Promise<Settings>;

@Injectable()
export class ViolationsEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Violations');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    if (getEnv('VIOLATION_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Each rule is its own step and each row its own try: one bad row never holds up the rest. */
  async tick(now: Date = new Date()): Promise<void> {
    const settingsOf = this.cache();
    const steps: [string, () => Promise<void>][] = [
      ['chưa vào ca', () => this.notYetIn(now, settingsOf)],
      ['vào trễ', () => this.lateArrivals(now, settingsOf)],
      ['ra sớm', () => this.earlyLeaves(now, settingsOf)],
      ['miễn khi báo bù', () => this.forgiveReported(now)],
      ['bỏ vòng', () => this.missedRounds(now)],
      ['thiếu điểm', () => this.shortRounds(now)],
      ['quét nghi vấn', () => this.suspiciousScans(now)],
      ['thiếu giờ ra', () => this.missingOut(now)],
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (error) {
        this.logger.error(`Vi phạm — ${name} lỗi: ${(error as Error).message}`, (error as Error).stack);
      }
    }
  }

  /**
   * Inside a roster change: if the person never clocked in and the absence mark has passed,
   * the absence is written — and announced — before the shift is cancelled or handed over.
   */
  async recordAbsenceIfDue(m: EntityManager, assignmentId: string, now: Date = new Date()): Promise<void> {
    const [a] = await m.query(
      `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, x.planned_start, ${ANCHOR} AS anchor, e.full_name AS employee_name, s.name AS site_name
         FROM shift_assignments x ${MANAGED} JOIN employees e ON e.id = x.employee_id
        WHERE x.id = $1 AND NOT EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = x.id)`,
      [assignmentId],
    );
    if (!a) return;
    const s = await this.settings.effective(a.tenant_id, a.site_id);
    const late = Math.floor((now.getTime() - new Date(a.anchor).getTime()) / 60_000);
    if (late < s.absent_after_minutes) return;
    if (await this.insert(m, { tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'absent', ref_type: 'assignment', ref_id: a.id, occurred_at: a.planned_start })) {
      await this.announceAbsence(m, a, late);
    }
  }

  /**
   * After a clock-in or clock-out was added or changed by hand: this shift's open lateness, absence and early leave
   * are brought in line with the new times, under the site's thresholds. What a manager already decided stays.
   */
  async reconcileAttendance(m: EntityManager, assignmentId: string): Promise<void> {
    const [a] = await m.query(
      `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, t.check_in_at, t.check_out_at, t.early_minutes,
              GREATEST(0, floor(extract(epoch FROM t.check_in_at - ${ANCHOR}) / 60))::int AS late
         FROM shift_assignments x ${MANAGED} JOIN attendances t ON t.assignment_id = x.id
        WHERE x.id = $1`,
      [assignmentId],
    );
    if (!a) return;
    const s = await this.settings.effective(a.tenant_id, a.site_id);
    const existing: { id: string; type: string; status: string; reviewed_by: string | null }[] = await m.query(
      `SELECT id, type, status, reviewed_by FROM violations
        WHERE ref_type = 'assignment' AND ref_id = $1 AND employee_id = $2 AND type IN ('absent', 'late_check_in', 'early_check_out')`,
      [a.id, a.employee_id],
    );
    const isOpen = (v: { status: string }) => ['auto', 'proposed_confirm', 'proposed_waive'].includes(v.status);
    const of = (type: string) => existing.find((v) => v.type === type);
    // A person's decision stands; what the system waived on its own is not a decision and comes back if the times say so.
    const human = (v: { status: string; reviewed_by: string | null } | undefined) => Boolean(v && !isOpen(v) && v.reviewed_by);
    const waive = async (rows: ({ id: string; status: string } | undefined)[]) => {
      const ids = rows.filter((v): v is { id: string; status: string; reviewed_by: string | null } => Boolean(v && isOpen(v))).map((v) => v.id);
      if (!ids.length) return;
      await m.query(
        `UPDATE violations SET status = 'waived', review_note = 'Hệ thống: chấm công được bổ sung', reviewed_at = now(), updated_at = now()
          WHERE id = ANY($1::uuid[]) AND status IN ${OPEN}`,
        [ids],
      );
    };
    /** Sets the type and minutes of a row not decided by a person; one the system had waived is open again. */
    const restate = (id: string, type: string, minutes: number, at: Date) =>
      m.query(
        `UPDATE violations SET type = $2, minutes = $3, occurred_at = $4, updated_at = now(),
                status = CASE WHEN status = 'waived' THEN 'auto' ELSE status END,
                review_note = CASE WHEN status = 'waived' THEN NULL ELSE review_note END,
                reviewed_at = CASE WHEN status = 'waived' THEN NULL ELSE reviewed_at END
          WHERE id = $1 AND reviewed_by IS NULL`,
        [id, type, minutes, at],
      );
    const absent = of('absent');
    const late = of('late_check_in');
    if (!human(absent) && !human(late)) {
      if (a.late <= s.late_after_minutes) {
        await waive([absent, late]);
      } else if (late) {
        await restate(late.id, 'late_check_in', a.late, a.check_in_at);
        await waive([absent]);
      } else if (absent) {
        await m.query(
          `UPDATE violations SET type = 'late_check_in', minutes = $2, occurred_at = $3, status = 'auto', review_note = NULL, reviewed_at = NULL,
                  detail = detail || jsonb_build_object('converted_from', 'absent', 'previous_status', status::text, 'previous_note', proposed_note),
                  proposed_by = NULL, proposed_note = NULL, proposed_at = NULL, updated_at = now()
            WHERE id = $1`,
          [absent.id, a.late, a.check_in_at],
        );
      } else {
        await this.insert(m, {
          tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'late_check_in', ref_type: 'assignment', ref_id: a.id,
          occurred_at: a.check_in_at, minutes: a.late,
        });
      }
    }
    const early = of('early_check_out');
    if (a.check_out_at && !human(early)) {
      if (a.early_minutes <= s.early_checkout_minutes) {
        await waive([early]);
      } else if (early) {
        await restate(early.id, 'early_check_out', a.early_minutes, a.check_out_at);
      } else {
        await this.insert(m, {
          tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'early_check_out', ref_type: 'assignment', ref_id: a.id,
          occurred_at: a.check_out_at, minutes: a.early_minutes,
        });
      }
    }
  }

  /** Clocked in, never out, six hours past the end: the guard is reminded once to ask for a correction. */
  private async missingOut(now: Date): Promise<void> {
    const rows: { tenant_id: string; employee_id: string; assignment_id: string; site_name: string; planned_end: Date }[] = rowsOf(await this.ds.query(
      `UPDATE attendances t SET missing_out_alerted_at = $1
         FROM shift_assignments x, sites s, clients c
        WHERE x.id = t.assignment_id AND s.id = x.site_id AND c.id = s.client_id AND c.management_mode = 'managed' AND c.deleted_at IS NULL
          AND t.check_out_at IS NULL AND t.missing_out_alerted_at IS NULL AND x.status = 'planned'
          AND x.planned_end + interval '6 hours' <= $1 AND x.planned_end > $1::timestamptz - ${LOOKBACK}
       RETURNING t.tenant_id, t.employee_id, t.assignment_id, s.name AS site_name, x.planned_end`,
      [now],
    ));
    await this.each(rows, 'thiếu giờ ra', async (r) => {
      const users: { id: string }[] = await this.ds.query(`SELECT id FROM users WHERE employee_id = $1 AND status = 'active' AND deleted_at IS NULL`, [r.employee_id]);
      const end = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(r.planned_end));
      await this.notifications.notify(r.tenant_id, users.map((u) => u.id), {
        type: 'attendance.missing_out', title: 'Bạn chưa ra ca',
        body: `${r.site_name} — ca kết thúc ${end}. Gửi đơn bổ sung chấm công trong 48 giờ.`,
        data: { assignment_id: r.assignment_id }, priority: 'normal', push: true,
      });
    });
  }

  /** Shifts begun without a clock-in: a nudge at the late mark, an absence at the absent mark. */
  private async notYetIn(now: Date, settingsOf: SettingsLookup): Promise<void> {
    const rows: { id: string; tenant_id: string; site_id: string; employee_id: string; planned_start: Date; anchor: Date; late_alerted_at: Date | null; employee_name: string; site_name: string }[] =
      await this.ds.query(
        `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, x.planned_start, ${ANCHOR} AS anchor, x.late_alerted_at,
                e.full_name AS employee_name, s.name AS site_name
           FROM shift_assignments x ${MANAGED} JOIN employees e ON e.id = x.employee_id
          WHERE x.status = 'planned' AND x.planned_start <= $1 AND x.planned_start > $1::timestamptz - ${LOOKBACK}
            AND NOT EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = x.id)
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.type IN ('absent', 'late_check_in'))`,
        [now],
      );
    await this.each(rows, 'chưa vào ca', async (a) => {
      const s = await settingsOf(a.tenant_id, a.site_id);
      const late = Math.floor((now.getTime() - new Date(a.anchor).getTime()) / 60_000);
      if (late >= s.absent_after_minutes) {
        // Locked and re-checked: a cancel or hand-over committed since the read above wins.
        await this.ds.transaction(async (m) => {
          const [still] = await m.query(
            `SELECT x.id FROM shift_assignments x WHERE x.id = $1 AND x.status = 'planned'
                AND NOT EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = x.id) FOR UPDATE`,
            [a.id],
          );
          if (!still) return;
          const made = await this.insert(m, {
            tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'absent', ref_type: 'assignment', ref_id: a.id, occurred_at: a.planned_start,
          });
          if (made) await this.announceAbsence(m, a, late);
        });
      } else if (late >= s.late_after_minutes && !a.late_alerted_at) {
        const claimed = await this.ds.query(`UPDATE shift_assignments SET late_alerted_at = $2 WHERE id = $1 AND late_alerted_at IS NULL AND status = 'planned' RETURNING id`, [a.id, now]);
        if (rowsOf(claimed).length) {
          await this.notifications.notify(a.tenant_id, await this.leadersOf(a.site_id), {
            type: 'attendance.late', title: `Chưa vào ca · ${a.employee_name}`, body: `${a.site_name} — trễ ${late} phút`,
            data: { assignment_id: a.id }, priority: 'normal', push: true,
          });
        }
      }
    });
  }

  /**
   * Clock-ins past the late mark, counted from the person's own start. An absence not yet decided by a manager
   * becomes this lateness (back to "new", saying what it was); one within the mark after all is waived by the system.
   */
  private async lateArrivals(now: Date, settingsOf: SettingsLookup): Promise<void> {
    const rows: { id: string; tenant_id: string; site_id: string; employee_id: string; check_in_at: Date; late: number; absent_id: string | null; absent_status: string | null }[] =
      await this.ds.query(
        `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, t.check_in_at,
                GREATEST(0, floor(extract(epoch FROM t.check_in_at - ${ANCHOR}) / 60))::int AS late,
                a.id AS absent_id, a.status AS absent_status
           FROM attendances t JOIN shift_assignments x ON x.id = t.assignment_id ${MANAGED}
           LEFT JOIN violations a ON a.ref_type = 'assignment' AND a.ref_id = x.id AND a.employee_id = x.employee_id AND a.type = 'absent'
          WHERE t.check_in_at > $1::timestamptz - ${LOOKBACK} AND t.corrected_at IS NULL
            AND (a.id IS NULL OR a.status IN ${OPEN})
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.type = 'late_check_in')
            AND (a.id IS NOT NULL OR t.check_in_at > ${ANCHOR})`,
        [now],
      );
    await this.each(rows, 'vào trễ', (a) => this.ds.transaction(async (m) => {
      // A correction approved since the read above owns this shift now.
      if (!(await this.uncorrected(m, a.id))) return;
      const s = await settingsOf(a.tenant_id, a.site_id);
      if (a.late <= s.late_after_minutes) {
        if (a.absent_id) {
          await m.query(
            `UPDATE violations SET status = 'waived', review_note = 'Hệ thống: đã vào ca trong mốc trễ', reviewed_at = now(), updated_at = now()
              WHERE id = $1 AND status IN ${OPEN}`,
            [a.absent_id],
          );
        }
        return;
      }
      if (a.absent_id) {
        await m.query(
          `UPDATE violations SET type = 'late_check_in', minutes = $2, occurred_at = $3, status = 'auto',
                  detail = detail || jsonb_build_object('converted_from', 'absent', 'previous_status', status::text, 'previous_note', proposed_note),
                  proposed_by = NULL, proposed_note = NULL, proposed_at = NULL, updated_at = now()
            WHERE id = $1 AND type = 'absent' AND status IN ${OPEN}`,
          [a.absent_id, a.late, a.check_in_at],
        );
      } else {
        await this.insert(m, {
          tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'late_check_in', ref_type: 'assignment', ref_id: a.id,
          occurred_at: a.check_in_at, minutes: a.late,
        });
      }
    }));
  }

  /** Locks the shift (a correction holds the same lock while it applies) and says whether its times are still the clocked ones. */
  private async uncorrected(m: EntityManager, assignmentId: string): Promise<boolean> {
    await m.query(`SELECT 1 FROM shift_assignments WHERE id = $1 FOR UPDATE`, [assignmentId]);
    const [t] = await m.query(`SELECT corrected_at FROM attendances WHERE assignment_id = $1`, [assignmentId]);
    return Boolean(t) && t.corrected_at === null;
  }

  private async earlyLeaves(now: Date, settingsOf: SettingsLookup): Promise<void> {
    const rows: { id: string; tenant_id: string; site_id: string; employee_id: string; check_out_at: Date; early_minutes: number }[] = await this.ds.query(
      `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, t.check_out_at, t.early_minutes
         FROM attendances t JOIN shift_assignments x ON x.id = t.assignment_id ${MANAGED}
        WHERE t.check_out_at > $1::timestamptz - ${LOOKBACK} AND t.early_minutes > 0 AND t.corrected_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.type = 'early_check_out')`,
      [now],
    );
    await this.each(rows, 'ra sớm', (a) => this.ds.transaction(async (m) => {
      if (!(await this.uncorrected(m, a.id))) return;
      const s = await settingsOf(a.tenant_id, a.site_id);
      if (a.early_minutes <= s.early_checkout_minutes) return;
      await this.insert(m, {
        tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'early_check_out', ref_type: 'assignment', ref_id: a.id,
        occurred_at: a.check_out_at, minutes: a.early_minutes,
      });
    }));
  }

  /** Nobody walked the round: everyone rostered across the middle of its window answers for it. Each round is charged once. */
  private async missedRounds(now: Date): Promise<void> {
    const rounds: { id: string; tenant_id: string; site_id: string; expected_start: Date; expected_end: Date; route_name: string }[] = rowsOf(await this.ds.query(
      `UPDATE patrol_rounds x SET missed_charged_at = $1
         FROM sites s, clients c, routes ro
        WHERE s.id = x.site_id AND c.id = s.client_id AND c.management_mode = 'managed' AND c.deleted_at IS NULL AND ro.id = x.route_id
          AND x.status = 'missed' AND x.missed_charged_at IS NULL AND x.expected_start > $1::timestamptz - ${LOOKBACK}
       RETURNING x.id, x.tenant_id, x.site_id, x.expected_start, x.expected_end, ro.name AS route_name`,
      [now],
    ));
    await this.each(rounds, 'bỏ vòng', async (r) => {
      const middle = new Date((new Date(r.expected_start).getTime() + new Date(r.expected_end).getTime()) / 2);
      const people: { employee_id: string }[] = await this.ds.query(
        `SELECT DISTINCT employee_id FROM shift_assignments
          WHERE site_id = $1 AND status = 'planned' AND planned_start <= $2 AND planned_end > $2`,
        [r.site_id, middle],
      );
      for (const p of people) {
        await this.insert(this.ds.manager, {
          tenant_id: r.tenant_id, employee_id: p.employee_id, site_id: r.site_id, type: 'missed_round', ref_type: 'round', ref_id: r.id,
          occurred_at: r.expected_start, detail: { route_name: r.route_name },
        });
      }
    });
  }

  /** A round closed with required checkpoints left: the guard who walked it, with what is still left (kept current while undecided). */
  private async shortRounds(now: Date): Promise<void> {
    const rounds: { id: string; tenant_id: string; site_id: string; employee_id: string; ended_at: Date; stops: { checkpoint_id: string; required: boolean }[] | null }[] =
      await this.ds.query(
        `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, x.ended_at, x.stops FROM patrol_rounds x ${MANAGED}
          WHERE x.status = 'partial' AND x.employee_id IS NOT NULL AND x.expected_start > $1::timestamptz - ${LOOKBACK}
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'round' AND v.ref_id = x.id AND v.type = 'missed_checkpoint' AND v.status NOT IN ${OPEN})`,
        [now],
      );
    await this.each(rounds, 'thiếu điểm', async (r) => {
      const required = (r.stops ?? []).filter((s) => s.required).map((s) => s.checkpoint_id);
      const missing: { code: string; name: string }[] = required.length
        ? await this.ds.query(
            `SELECT k.code, k.name FROM checkpoints k
              WHERE k.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM patrol_scans sc WHERE sc.round_id = $2 AND sc.checkpoint_id = k.id)
              ORDER BY k.code`,
            [required, r.id],
          )
        : [];
      await this.ds.query(
        `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at, detail)
         VALUES ($1, $2, $3, 'missed_checkpoint', 'round', $4, $5, $6)
         ON CONFLICT ON CONSTRAINT violations_once DO UPDATE SET detail = EXCLUDED.detail, updated_at = now()
          WHERE violations.status IN ${OPEN} AND violations.detail IS DISTINCT FROM EXCLUDED.detail`,
        [r.tenant_id, r.employee_id, r.site_id, r.id, r.ended_at, JSON.stringify({ missing })],
      );
    });
  }

  private async suspiciousScans(now: Date): Promise<void> {
    const scans: { id: string; tenant_id: string; site_id: string; employee_id: string; scanned_at: Date; flags: string[]; code: string; name: string; round_id: string }[] =
      await this.ds.query(
        `SELECT sc.id, sc.tenant_id, x.site_id, sc.employee_id, sc.scanned_at, sc.flags, k.code, k.name, sc.round_id
           FROM patrol_scans sc JOIN patrol_rounds x ON x.id = sc.round_id ${MANAGED} JOIN checkpoints k ON k.id = sc.checkpoint_id
          WHERE sc.validity = 'suspicious' AND sc.created_at > $1::timestamptz - ${LOOKBACK}
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'scan' AND v.ref_id = sc.id)`,
        [now],
      );
    await this.each(scans, 'quét nghi vấn', async (s) => {
      await this.insert(this.ds.manager, {
        tenant_id: s.tenant_id, employee_id: s.employee_id, site_id: s.site_id, type: 'suspicious_scan', ref_type: 'scan', ref_id: s.id,
        occurred_at: s.scanned_at, detail: { flags: s.flags, checkpoint_code: s.code, checkpoint_name: s.name, round_id: s.round_id },
      });
    });
  }

  /**
   * A missed round reported afterwards and finished clears the "missed round" still undecided: in full, the round is
   * simply done; short, the walker answers for the missing checkpoints instead. Fully reported, missing checkpoints clear too.
   * A round still open waits. Decided violations stay as the manager decided.
   */
  private async forgiveReported(now: Date): Promise<void> {
    await this.ds.query(
      `UPDATE violations v SET status = 'waived', review_note = 'Hệ thống: vòng đã được báo bù', reviewed_at = now(), updated_at = now()
         FROM patrol_rounds r
        WHERE v.ref_type = 'round' AND v.ref_id = r.id AND v.status IN ${OPEN} AND v.occurred_at > $1::timestamptz - interval '7 days'
          AND ((v.type = 'missed_round' AND r.status IN ('completed', 'partial')) OR (v.type = 'missed_checkpoint' AND r.status = 'completed'))`,
      [now],
    );
  }

  private async announceAbsence(m: EntityManager, a: { id: string; tenant_id: string; site_id: string; employee_name: string; site_name: string }, late: number) {
    const people = [...(await this.leadersOf(a.site_id)), ...(await this.managersOf(a.site_id))];
    await this.notifications.notify(a.tenant_id, people, {
      type: 'violation.absent', title: `Vắng ca · ${a.employee_name}`, body: `${a.site_name} — chưa vào ca sau ${late} phút`,
      data: { assignment_id: a.id }, priority: 'high', push: true,
    }, m);
  }

  private async each<T>(rows: T[], rule: string, work: (row: T) => Promise<void>): Promise<void> {
    for (const row of rows) {
      try {
        await work(row);
      } catch (error) {
        this.logger.error(`Vi phạm — ${rule}: lỗi một dòng: ${(error as Error).message}`, (error as Error).stack);
      }
    }
  }

  /** Written once per (thing, person, rule): a second run of the same rule changes nothing. */
  protected async insert(m: EntityManager, v: NewViolation): Promise<boolean> {
    const rows = await m.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at, minutes, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ON CONSTRAINT violations_once DO NOTHING RETURNING id`,
      [v.tenant_id, v.employee_id, v.site_id, v.type, v.ref_type, v.ref_id, v.occurred_at, v.minutes ?? null, JSON.stringify(v.detail ?? {})],
    );
    return rows.length > 0;
  }

  protected async leadersOf(siteId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM sites s JOIN teams t ON t.id = s.responsible_team_id AND t.deleted_at IS NULL
         JOIN users u ON u.employee_id = t.leader_employee_id AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE s.id = $1`,
      [siteId],
    );
    return rows.map((r) => r.id);
  }

  protected async managersOf(siteId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT g.manager_user_id AS id FROM sites s JOIN teams t ON t.id = s.responsible_team_id
         JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
         JOIN users u ON u.id = g.manager_user_id AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE s.id = $1`,
      [siteId],
    );
    return rows.map((r) => r.id);
  }

  /** Effective settings per site, looked up once per tick. */
  protected cache(): SettingsLookup {
    const seen = new Map<string, Settings>();
    return async (tenantId, siteId) => {
      if (!seen.has(siteId)) seen.set(siteId, await this.settings.effective(tenantId, siteId));
      return seen.get(siteId)!;
    };
  }
}

/** TypeORM answers an UPDATE … RETURNING with [rows, count]. */
export const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];
