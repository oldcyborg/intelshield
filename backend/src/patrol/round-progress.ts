import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { CheckMethod, PhotoRule } from '../sites/checkpoint.entity';
import { PatrolRound, RoundStatus, RoundStop } from './patrol-round.entity';

export interface StopView {
  checkpoint_id: string;
  seq: number;
  required: boolean;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  photo_required: boolean;
  scanned_at: Date | null;
  method: string | null;
  validity: 'valid' | 'suspicious' | null;
  flags: string[];
}

export interface RoundView {
  id: string;
  site_id: string;
  site_name: string;
  route_name: string;
  schedule_name: string;
  expected_start: Date;
  expected_end: Date;
  status: RoundStatus;
  late: boolean;
  backdated: boolean;
  started_at: Date | null;
  ended_at: Date | null;
  ended_by: 'guard' | 'system' | null;
  employee_id: string | null;
  employee_name: string | null;
  mine: boolean;
  required_count: number;
  done_required: number;
  stops: StopView[];
}

interface CheckpointRow {
  id: string;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  photo_rule: PhotoRule;
}

/** Whether confirming this checkpoint in this round needs a photo (spec §4.2). */
export function photoRequired(k: Pick<CheckpointRow, 'id' | 'allowed_methods' | 'photo_rule'>, round: Pick<PatrolRound, 'photo_checkpoint_ids'>): boolean {
  if (k.allowed_methods.length === 1 && k.allowed_methods[0] === 'photo') return true;
  return k.photo_rule === 'always' || (k.photo_rule === 'random' && round.photo_checkpoint_ids.includes(k.id));
}

@Injectable()
export class RoundProgress {
  constructor(private readonly settings: SettingsService) {}

  /** Last moment a scan still counts: the end of the window plus the site's tolerance. */
  async deadline(round: Pick<PatrolRound, 'tenant_id' | 'site_id' | 'expected_end'>): Promise<Date> {
    const s = await this.settings.effective(round.tenant_id, round.site_id);
    return new Date(new Date(round.expected_end).getTime() + s.round_tolerance_minutes * 60_000);
  }

  /** The route as it stands, without retired checkpoints. A started round keeps its own frozen copy. */
  async liveStops(m: EntityManager, routeId: string): Promise<RoundStop[]> {
    return m.query(
      `SELECT rc.checkpoint_id, rc.seq, rc.required FROM route_checkpoints rc
         JOIN checkpoints k ON k.id = rc.checkpoint_id AND k.status = 'active' AND k.deleted_at IS NULL
        WHERE rc.route_id = $1 ORDER BY rc.seq`,
      [routeId],
    );
  }

  /** Recount and set the status. The caller holds the round's row lock. */
  async settle(m: EntityManager, roundId: string, now: Date): Promise<void> {
    const round = await m.findOneByOrFail(PatrolRound, { id: roundId });
    if (!round.started_at) return;
    const stops = round.stops ?? [];
    const scans: { checkpoint_id: string; scanned_at: Date }[] = await m.query(
      `SELECT checkpoint_id, scanned_at FROM patrol_scans WHERE round_id = $1 ORDER BY scanned_at`,
      [roundId],
    );
    const seen = new Set(scans.map((s) => s.checkpoint_id));
    const required = stops.filter((s) => s.required);
    const done = required.filter((s) => seen.has(s.checkpoint_id)).length;
    let endedAt = round.ended_at;
    let endedBy = round.ended_by;
    if (!endedAt && stops.length && stops.every((s) => seen.has(s.checkpoint_id))) {
      endedAt = new Date(scans[scans.length - 1].scanned_at);
      endedBy = 'guard';
    }
    const deadline = await this.deadline(round);
    if (!endedAt && now.getTime() >= deadline.getTime()) {
      endedAt = deadline;
      endedBy = 'system';
    }
    const status: RoundStatus = endedAt ? (done >= required.length ? 'completed' : 'partial') : 'in_progress';
    await m.update(PatrolRound, { id: roundId }, { required_count: required.length, done_required: done, ended_at: endedAt, ended_by: endedBy, status });
  }

  async view(m: EntityManager, roundId: string, employeeId: string | null): Promise<RoundView> {
    const [one] = await this.viewMany(m, [roundId], employeeId);
    return one;
  }

  /**
   * Rounds with each stop and how it was confirmed, in a fixed handful of queries however many rounds there are.
   * `employeeId` marks which are the caller's. Order follows `roundIds`.
   */
  async viewMany(m: EntityManager, roundIds: string[], employeeId: string | null): Promise<RoundView[]> {
    if (!roundIds.length) return [];
    type Row = PatrolRound & { site_name: string; route_name: string; schedule_name: string; employee_name: string | null };
    const rows: Row[] = await m.query(
      `SELECT r.*, r.photo_checkpoint_ids::text[] AS photo_checkpoint_ids, s.name AS site_name, ro.name AS route_name,
              p.name AS schedule_name, e.full_name AS employee_name
         FROM patrol_rounds r
         JOIN sites s ON s.id = r.site_id
         JOIN routes ro ON ro.id = r.route_id
         JOIN patrol_schedules p ON p.id = r.schedule_id
         LEFT JOIN employees e ON e.id = r.employee_id
        WHERE r.id = ANY($1::uuid[])`,
      [roundIds],
    );
    const unstarted = [...new Set(rows.filter((r) => !r.stops).map((r) => r.route_id))];
    const live: (RoundStop & { route_id: string })[] = unstarted.length
      ? await m.query(
          `SELECT rc.route_id, rc.checkpoint_id, rc.seq, rc.required FROM route_checkpoints rc
             JOIN checkpoints k ON k.id = rc.checkpoint_id AND k.status = 'active' AND k.deleted_at IS NULL
            WHERE rc.route_id = ANY($1::uuid[]) ORDER BY rc.seq`,
          [unstarted],
        )
      : [];
    const stopsOf = (r: Row): RoundStop[] => r.stops ?? live.filter((x) => x.route_id === r.route_id);
    const ids = [...new Set(rows.flatMap((r) => stopsOf(r).map((x) => x.checkpoint_id)))];
    const checkpoints: CheckpointRow[] = ids.length
      ? await m.query(`SELECT id, code, name, lat, lng, radius_m, allowed_methods, photo_rule FROM checkpoints WHERE id = ANY($1::uuid[])`, [ids])
      : [];
    const scans: { round_id: string; checkpoint_id: string; scanned_at: Date; method: string; validity: 'valid' | 'suspicious'; flags: string[] }[] =
      await m.query(`SELECT round_id, checkpoint_id, scanned_at, method, validity, flags FROM patrol_scans WHERE round_id = ANY($1::uuid[])`, [roundIds]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return roundIds.flatMap((id) => {
      const round = byId.get(id);
      if (!round) return [];
      return [{
        id: round.id, site_id: round.site_id, site_name: round.site_name, route_name: round.route_name, schedule_name: round.schedule_name,
        expected_start: round.expected_start, expected_end: round.expected_end, status: round.status, late: round.late,
        backdated: round.backdated, started_at: round.started_at, ended_at: round.ended_at, ended_by: round.ended_by,
        employee_id: round.employee_id, employee_name: round.employee_name, mine: Boolean(employeeId) && round.employee_id === employeeId,
        required_count: round.required_count, done_required: round.done_required,
        stops: stopsOf(round).flatMap((stop) => {
          const k = checkpoints.find((c) => c.id === stop.checkpoint_id);
          if (!k) return [];
          const scan = scans.find((x) => x.round_id === round.id && x.checkpoint_id === stop.checkpoint_id);
          return [{
            checkpoint_id: k.id, seq: stop.seq, required: stop.required, code: k.code, name: k.name, lat: k.lat, lng: k.lng,
            radius_m: k.radius_m, allowed_methods: k.allowed_methods, photo_required: photoRequired(k, round),
            scanned_at: scan?.scanned_at ?? null, method: scan?.method ?? null, validity: scan?.validity ?? null, flags: scan?.flags ?? [],
          }];
        }),
      }];
    });
  }
}
