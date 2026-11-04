import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { distanceMeters } from '../attendance/geo';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { CheckMethod, PhotoRule } from '../sites/checkpoint.entity';
import { parseQr, qrMatches } from '../sites/qr';
import { LED_SITES, leadsSite } from '../sites/team-leader';
import { MyRoundsFilter, ScanDto, StartRoundDto } from './dto';
import { PatrolRound } from './patrol-round.entity';
import { PatrolScan } from './patrol-scan.entity';
import { photoRequired, RoundProgress, RoundView } from './round-progress';

const EARLY_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const LATE_SYNC_MS = 12 * 60 * 60_000;
const LOW_ACCURACY_M = 100;
const MAX_SPEED_KMH = 15;
/** Signs worth a leader's look. Poor GPS alone is noted but not held against anyone. */
const SUSPICIOUS = ['outside_radius', 'mock_location', 'clock_skew', 'late_sync', 'impossible_speed', 'backdated', 'no_location'];
/** An offline report claiming a moment more than this before it reached us is shown to the leader. */
const BACKDATE_MS = 15 * 60_000;

interface When {
  /** The moment that counts for every window check. */
  at: Date;
  server: Date;
  device: Date;
  offline: boolean;
}

@Injectable()
export class PatrolRunService {
  constructor(
    private readonly ds: DataSource,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly progress: RoundProgress,
  ) {}

  /**
   * Rounds overlapping the caller's shifts that touch the local day — so a night shift that began
   * yesterday still shows its rounds after midnight.
   */
  async myRounds(actor: AuthUser, filter: MyRoundsFilter): Promise<RoundView[]> {
    if (!actor.employee_id) return [];
    const rows: { id: string }[] = await this.ds.query(
      `SELECT r.id FROM patrol_rounds r
        WHERE r.tenant_id = $1 AND (EXISTS (
              SELECT 1 FROM shift_assignments a
               WHERE a.site_id = r.site_id AND a.employee_id = $2 AND a.status = 'planned'
                 AND a.planned_start < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                 AND a.planned_end > ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                 AND a.planned_start < r.expected_end AND a.planned_end > r.expected_start)
           -- A team leader's rounds are every round of the team's sites that day, shift or not.
           OR (r.site_id IN (${LED_SITES})
               AND r.expected_start < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
               AND r.expected_end > ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')))
        ORDER BY r.expected_start, r.id`,
      [tenantOf(actor), actor.employee_id, filter.date ?? todayLocal()],
    );
    return this.progress.viewMany(this.ds.manager, rows.map((r) => r.id), actor.employee_id);
  }

  async start(actor: AuthUser, roundId: string, dto: StartRoundDto): Promise<RoundView> {
    this.assertPhone(actor);
    const when = this.when(dto.device_time, dto.captured_offline);
    await this.ds.transaction(async (m) => {
      const round = await this.lock(m, actor, roundId);
      await this.begin(m, actor, round, when);
      await this.progress.settle(m, roundId, when.server);
    });
    return this.progress.view(this.ds.manager, roundId, actor.employee_id);
  }

  async scan(actor: AuthUser, roundId: string, dto: ScanDto): Promise<RoundView> {
    this.assertPhone(actor);
    const tenantId = tenantOf(actor);
    // A resend of a scan already stored answers with the round as it is; someone else's id is a conflict.
    if (await this.replayed(this.ds.manager, actor, roundId, dto.client_uuid)) return this.progress.view(this.ds.manager, roundId, actor.employee_id);
    if (dto.method === 'nfc') throw new BusinessException('PATROL_METHOD_NOT_ALLOWED');
    const method = dto.method;
    const when = this.when(dto.device_time, dto.captured_offline);
    try {
      await this.ds.transaction((m) => this.record(m, actor, roundId, method, dto, when));
    } catch (error) {
      // Two copies of one scan racing: the loser answers like any other resend.
      const duplicate = error instanceof QueryFailedError && (error as QueryFailedError & { constraint?: string }).constraint === 'patrol_scans_client_uq';
      if (!duplicate || !(await this.replayed(this.ds.manager, actor, roundId, dto.client_uuid))) throw error;
    }
    return this.progress.view(this.ds.manager, roundId, actor.employee_id);
  }

  /** A scan already stored under this phone-made id: true for the same person and round, a conflict otherwise. */
  private async replayed(m: EntityManager, actor: AuthUser, roundId: string, clientUuid: string): Promise<boolean> {
    const [prior] = await m.query(`SELECT round_id, user_id FROM patrol_scans WHERE tenant_id = $1 AND client_uuid = $2`, [tenantOf(actor), clientUuid]);
    if (!prior) return false;
    if (prior.user_id !== actor.id || prior.round_id !== roundId) throw new BusinessException('CONFLICT');
    return true;
  }

  private async record(m: EntityManager, actor: AuthUser, roundId: string, method: 'qr' | 'gps' | 'photo', dto: ScanDto, when: When): Promise<void> {
    const tenantId = tenantOf(actor);
    const locked = await this.lock(m, actor, roundId);
    // Re-checked under the round lock: a copy sent at the same moment has committed by now.
    if (await this.replayed(m, actor, roundId, dto.client_uuid)) return;
    await this.begin(m, actor, locked, when);
    const round = await m.findOneByOrFail(PatrolRound, { id: roundId });
    const deadline = await this.progress.deadline(round);
    const tooEarly = when.at.getTime() < round.expected_start.getTime() - EARLY_MS;
    const afterFinish = round.ended_by === 'guard' && round.ended_at && when.at.getTime() > round.ended_at.getTime();
    if (tooEarly || when.at.getTime() > deadline.getTime() || afterFinish) {
      throw new BusinessException('PATROL_ROUND_CLOSED');
    }
    // Nothing in a round happens before it started.
    if (round.started_at && when.at.getTime() < round.started_at.getTime()) when = { ...when, at: new Date(round.started_at) };

    const checkpointId = await this.identify(m, tenantId, method, dto);
    if (!(round.stops ?? []).some((s) => s.checkpoint_id === checkpointId)) throw new BusinessException('PATROL_NOT_ON_ROUTE');
    const [k]: { id: string; lat: string | null; lng: string | null; radius_m: number; allowed_methods: CheckMethod[]; photo_rule: PhotoRule }[] =
      await m.query(`SELECT id, lat, lng, radius_m, allowed_methods, photo_rule FROM checkpoints WHERE id = $1 AND tenant_id = $2`, [checkpointId, tenantId]);
    if (!k.allowed_methods.includes(method)) throw new BusinessException('PATROL_METHOD_NOT_ALLOWED');
    if (await m.exists(PatrolScan, { where: { round_id: roundId, checkpoint_id: checkpointId } })) throw new BusinessException('PATROL_ALREADY_SCANNED');
    const hasFix = dto.lat !== undefined && dto.lng !== undefined;
    if (method === 'gps' && !hasFix) throw new BusinessException('PATROL_LOCATION_REQUIRED');
    if ((method === 'photo' || photoRequired(k, round)) && !dto.photo_file_id) throw new BusinessException('PATROL_PHOTO_REQUIRED');
    if (dto.photo_file_id) await this.assertOwnPhoto(m, actor, dto.photo_file_id, when.at);

    const flags: string[] = [];
    let distance: number | null = null;
    if (hasFix && k.lat !== null && k.lng !== null) {
      distance = distanceMeters({ lat: Number(k.lat), lng: Number(k.lng) }, { lat: dto.lat!, lng: dto.lng! });
      if (distance > k.radius_m) flags.push('outside_radius');
    }
    // A tag can be photographed and scanned from anywhere; where the checkpoint has a place, a scan without one is worth a look.
    if (method === 'qr' && !hasFix && k.lat !== null) flags.push('no_location');
    if (dto.mock_location) flags.push('mock_location');
    if (dto.accuracy_m !== undefined && dto.accuracy_m > LOW_ACCURACY_M) flags.push('low_accuracy');
    if (!dto.captured_offline && Math.abs(when.device.getTime() - when.server.getTime()) > CLOCK_SKEW_MS) flags.push('clock_skew');
    if (dto.captured_offline && when.server.getTime() - when.at.getTime() > LATE_SYNC_MS) flags.push('late_sync');
    if (this.backdated(when)) flags.push('backdated');
    if (dto.captured_offline && dto.last_sync_at && dto.elapsed_since_sync_ms !== undefined) {
      // The phone's monotonic clock since its last contact says when this really was; a reset wall clock disagrees.
      const expected = new Date(dto.last_sync_at).getTime() + dto.elapsed_since_sync_ms;
      if (Math.abs(expected - when.device.getTime()) > CLOCK_SKEW_MS) flags.push('clock_skew');
    }
    if (hasFix && (await this.tooFast(m, roundId, when.at, dto.lat!, dto.lng!))) flags.push('impossible_speed');

    const saved = await m.save(
      m.create(PatrolScan, {
        tenant_id: tenantId, round_id: roundId, checkpoint_id: checkpointId, employee_id: actor.employee_id!, user_id: actor.id,
        client_uuid: dto.client_uuid, method, scanned_at: when.at, device_time: when.device, server_time: when.server,
        captured_offline: Boolean(dto.captured_offline), lat: hasFix ? String(dto.lat) : null, lng: hasFix ? String(dto.lng) : null,
        accuracy_m: dto.accuracy_m ?? null, distance_m: distance, mock_location: Boolean(dto.mock_location),
        photo_id: dto.photo_file_id ?? null, flags, validity: flags.some((f) => SUSPICIOUS.includes(f)) ? 'suspicious' : 'valid',
      }),
    );
    if (dto.photo_file_id) await this.files.claim(m, tenantId, dto.photo_file_id, { type: 'patrol_scan', id: saved.id });
    if (flags.includes('backdated')) await m.update(PatrolRound, { id: roundId }, { backdated: true });
    await this.progress.settle(m, roundId, when.server);
  }

  async finish(actor: AuthUser, roundId: string, dto: StartRoundDto): Promise<RoundView> {
    this.assertPhone(actor);
    const when = this.when(dto.device_time, dto.captured_offline);
    await this.ds.transaction(async (m) => {
      const round = await this.lock(m, actor, roundId);
      if (!round.started_at) throw new BusinessException('PATROL_ROUND_CLOSED');
      if (round.employee_id !== actor.employee_id) throw new BusinessException('PATROL_ROUND_TAKEN');
      if (round.ended_at) return;
      const deadline = await this.progress.deadline(round);
      const endedAt = new Date(Math.min(Math.max(when.at.getTime(), round.started_at.getTime()), deadline.getTime()));
      await m.update(PatrolRound, { id: roundId }, { ended_at: endedAt, ended_by: 'guard' });
      await this.progress.settle(m, roundId, when.server);
    });
    return this.progress.view(this.ds.manager, roundId, actor.employee_id);
  }

  /** Taking the round: the first start or scan claims it for this guard, inside its window, on shift. */
  private async begin(m: EntityManager, actor: AuthUser, round: PatrolRound, when: When): Promise<void> {
    const at = when.at;
    if (round.started_at) {
      if (round.employee_id !== actor.employee_id) throw new BusinessException('PATROL_ROUND_TAKEN');
      return;
    }
    if (at.getTime() < round.expected_start.getTime() - EARLY_MS || at.getTime() > round.expected_end.getTime()) {
      throw new BusinessException('PATROL_ROUND_CLOSED');
    }
    const onShift = await m.query(
      `SELECT 1 FROM shift_assignments
        WHERE tenant_id = $1 AND employee_id = $2 AND site_id = $3 AND status = 'planned'
          AND planned_start - interval '10 minutes' <= $4 AND planned_end >= $4 LIMIT 1`,
      [round.tenant_id, actor.employee_id, round.site_id, at],
    );
    if (!onShift.length && !(await leadsSite(m, round.tenant_id, actor.employee_id, round.site_id))) {
      throw new BusinessException('PATROL_NOT_ON_SHIFT');
    }
    const s = await this.settings.effective(round.tenant_id, round.site_id);
    const stops = await this.progress.liveStops(m, round.route_id);
    await m.update(PatrolRound, { id: round.id }, {
      status: 'in_progress', employee_id: actor.employee_id, user_id: actor.id, started_at: at, stops, backdated: this.backdated(when),
      late: at.getTime() > round.expected_start.getTime() + s.round_tolerance_minutes * 60_000,
      required_count: stops.filter((x) => x.required).length, ended_at: null, ended_by: null,
    });
  }

  /** Which checkpoint: from a QR tag (its signature checked), or named by the phone for GPS and photo. */
  private async identify(m: EntityManager, tenantId: string, method: 'qr' | 'gps' | 'photo', dto: ScanDto): Promise<string> {
    if (method !== 'qr') {
      if (!dto.checkpoint_id) throw new BusinessException('VALIDATION_FAILED', ['checkpoint_id: cần chọn điểm']);
      return dto.checkpoint_id;
    }
    const parsed = dto.qr_payload ? parseQr(dto.qr_payload) : null;
    if (!parsed || (dto.checkpoint_id && dto.checkpoint_id !== parsed.checkpointId)) throw new BusinessException('QR_INVALID');
    const [row]: { qr_secret: string }[] = await m.query(
      `SELECT qr_secret FROM checkpoints WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND status = 'active'`,
      [parsed.checkpointId, tenantId],
    );
    if (!row || !qrMatches(row.qr_secret, parsed.checkpointId, parsed.signature)) throw new BusinessException('QR_INVALID');
    return parsed.checkpointId;
  }

  /** Locked round of the caller's company. Whether they may act on it is decided by `begin`. */
  private async lock(m: EntityManager, actor: AuthUser, roundId: string): Promise<PatrolRound> {
    const [row] = await m.query(`SELECT id FROM patrol_rounds WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [roundId, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return m.findOneByOrFail(PatrolRound, { id: roundId });
  }

  /** Server time online; for a scan sent later, the phone's time — never ahead of the server. */
  /** Offline and arriving long after the moment it claims: it may be true, but someone should look. */
  private backdated(when: When): boolean {
    return when.offline && when.server.getTime() - when.at.getTime() > BACKDATE_MS;
  }

  private when(deviceTime: string, offline?: boolean): When {
    const server = new Date();
    const device = new Date(deviceTime);
    return { at: offline ? new Date(Math.min(device.getTime(), server.getTime())) : server, server, device, offline: Boolean(offline) };
  }

  private assertPhone(actor: AuthUser): void {
    if (!actor.device_id) throw new BusinessException('PATROL_DEVICE_REQUIRED');
    if (!actor.employee_id) throw new BusinessException('PATROL_NOT_ON_SHIFT');
  }

  /**
   * A photo this user uploaded no earlier than ten minutes before the moment of the scan, not attached to anything.
   * Photos taken offline are uploaded after the scan, so a photo made in advance fails.
   */
  private async assertOwnPhoto(m: EntityManager, actor: AuthUser, fileId: string, at: Date): Promise<void> {
    const rows = await m.query(
      `SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
          AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL
          AND created_at >= $4::timestamptz - interval '10 minutes'`,
      [fileId, tenantOf(actor), actor.id, at],
    );
    if (!rows.length) throw new BusinessException('PATROL_PHOTO_INVALID');
  }

  /** Compared with the scan nearest in time in this round: nobody walks a site faster than 15 km/h. */
  private async tooFast(m: EntityManager, roundId: string, at: Date, lat: number, lng: number): Promise<boolean> {
    const [prev]: { lat: string; lng: string; scanned_at: Date }[] = await m.query(
      `SELECT lat, lng, scanned_at FROM patrol_scans WHERE round_id = $1 AND lat IS NOT NULL
        ORDER BY abs(extract(epoch FROM scanned_at - $2::timestamptz)) LIMIT 1`,
      [roundId, at],
    );
    if (!prev) return false;
    const meters = distanceMeters({ lat: Number(prev.lat), lng: Number(prev.lng) }, { lat, lng });
    if (meters <= 50) return false;
    const hours = Math.abs(at.getTime() - new Date(prev.scanned_at).getTime()) / 3_600_000;
    return hours === 0 || meters / 1000 / hours > MAX_SPEED_KMH;
  }
}
