import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { mayEnd } from './close-rule';
import { IncidentFilter, ReportIncidentDto, SosDto } from './dto';
import { EscalationService } from './escalation.service';
import { Incident } from './incident.entity';

const SHIFT_EARLY_MS = 60 * 60_000;
const OFFLINE_LIMIT_MS = 24 * 60 * 60_000;
/** Reports kept on a phone and sent this much later are marked as sent late. */
const LATE_MS = 15 * 60_000;

/** Online: now. Sent later from a phone: its moment — never ahead of now, never more than a day back (an SOS is never refused). */
function momentOf(dto: { device_time?: string; captured_offline?: boolean }): Date {
  const now = Date.now();
  if (!dto.captured_offline || !dto.device_time) return new Date(now);
  const device = Date.parse(dto.device_time);
  return new Date(Math.max(Math.min(device, now), now - OFFLINE_LIMIT_MS));
}

export const INCIDENT_ROWS = `
  SELECT i.id, i.seq, 'SC-' || lpad(i.seq::text, 6, '0') AS code, i.client_id, c.name AS client_name, i.site_id, s.name AS site_name,
         i.category_id, k.name AS category_name, i.severity, i.is_sos, i.title, i.description, i.lat, i.lng, i.source,
         i.client_reporter_name, i.client_channel, i.reported_by, ru.full_name AS reporter_name, i.assignee_user_id,
         au.full_name AS assignee_name, i.status, i.acknowledged_at, i.acknowledged_by, i.resolved_at, i.resolution_note,
         i.closed_at, i.rejected_reason, i.escalation_level, i.created_at, i.updated_at, i.occurred_at,
         (i.created_at - i.occurred_at > make_interval(secs => ${LATE_MS / 1000})) AS sent_late
    FROM incidents i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN sites s ON s.id = i.site_id
    LEFT JOIN incident_categories k ON k.id = i.category_id
    LEFT JOIN users ru ON ru.id = i.reported_by
    LEFT JOIN users au ON au.id = i.assignee_user_id
   WHERE i.tenant_id = $1`;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly files: FilesService,
    private readonly escalation: EscalationService,
    private readonly settings: SettingsService,
  ) {}

  /** A report from the field (guards) or from the office on a client's behalf. */
  async report(actor: AuthUser, dto: ReportIncidentDto) {
    const tenantId = tenantOf(actor);
    const replay = await this.replayed(actor, dto.client_uuid);
    if (replay) return this.get(actor, replay);
    const [category] = await this.ds.query(
      `SELECT id, name, default_severity FROM incident_categories WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
      [dto.category_id, tenantId],
    );
    if (!category) throw new BusinessException('NOT_FOUND');
    const at = dto.source ? new Date() : momentOf(dto);
    const place = dto.source ? await this.officePlace(actor, dto) : await this.fieldPlace(actor, dto.site_id ?? null, at);
    return this.create(actor, {
      ...place,
      category_id: category.id,
      severity: dto.severity ?? category.default_severity,
      is_sos: false,
      title: dto.title?.trim() || category.name,
      description: dto.description,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      source: dto.source ?? 'guard_app',
      client_reporter_name: dto.client_reporter_name ?? null,
      client_channel: dto.client_channel ?? null,
      file_ids: dto.file_ids ?? [],
      client_uuid: dto.client_uuid ?? null,
      occurred_at: at,
    });
  }

  /** One press: critical, located when the phone could tell, sent. Photos can follow as comments. */
  async sos(actor: AuthUser, dto: SosDto) {
    const replay = await this.replayed(actor, dto.client_uuid);
    if (replay) return this.get(actor, replay);
    const at = momentOf(dto);
    const place = await this.fieldPlace(actor, null, at);
    return this.create(actor, {
      ...place, category_id: null, severity: 'critical', is_sos: true, title: 'SOS — cần hỗ trợ khẩn cấp',
      description: dto.note ?? null, lat: dto.lat ?? null, lng: dto.lng ?? null, source: 'guard_app',
      client_reporter_name: null, client_channel: null, file_ids: [], client_uuid: dto.client_uuid ?? null, occurred_at: at,
    });
  }


  async list(actor: AuthUser, filter: IncidentFilter) {
    const tenantId = tenantOf(actor);
    const params: unknown[] = [tenantId];
    let sql = INCIDENT_ROWS + (await this.visibility(actor, params));
    if (filter.status === 'open') sql += ` AND i.status IN ('new', 'acknowledged', 'in_progress', 'resolved')`;
    else if (filter.status) {
      params.push(filter.status);
      sql += ` AND i.status = $${params.length}`;
    }
    for (const key of ['severity', 'site_id', 'client_id'] as const) {
      if (filter[key]) {
        params.push(filter[key]);
        sql += ` AND i.${key} = $${params.length}`;
      }
    }
    return this.ds.query(`${sql} ORDER BY (i.status = 'new') DESC, i.created_at DESC LIMIT 200`, params);
  }

  async get(actor: AuthUser, id: string) {
    const tenantId = tenantOf(actor);
    const params: unknown[] = [tenantId];
    const sql = INCIDENT_ROWS + (await this.visibility(actor, params));
    params.push(id);
    const [row] = await this.ds.query(`${sql} AND i.id = $${params.length}`, params);
    if (!row) throw new BusinessException('NOT_FOUND');
    const events = await this.ds.query(
      `SELECT e.id, e.type, e.actor_user_id, u.full_name AS actor_name, e.body, e.from_status, e.to_status, e.data, e.created_at
         FROM incident_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.incident_id = $1 ORDER BY e.created_at, e.id`,
      [id],
    );
    const files = await this.ds.query(
      `SELECT id, original_name, mime, size, created_at FROM files WHERE owner_type = 'incident' AND owner_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    );
    // Whether this person may close or dismiss it — the app shows those buttons only when they will work.
    const can_close = mayEnd(await this.permissions.permissionsOf(actor.id), row.severity, await this.settings.effective(tenantId, row.site_id));
    return { ...row, events, files, can_close };
  }

  /**
   * People a manager can hand this incident to: those rostered at the site around now (on shift first),
   * and the members of the team that runs the site — only those with an active account.
   */
  async assignees(actor: AuthUser, id: string) {
    const tenantId = tenantOf(actor);
    const [row] = await this.ds.query(`SELECT id, site_id, client_id, reported_by, assignee_user_id FROM incidents WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!row || !(await this.canSee(actor, row))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `WITH rostered AS (
         SELECT a.employee_id, bool_or(a.planned_start <= now() AND a.planned_end > now()) AS on_shift
           FROM shift_assignments a
           JOIN sites s ON s.id = a.site_id
          WHERE a.tenant_id = $1 AND a.status = 'planned'
            AND (CASE WHEN $2::uuid IS NULL THEN s.client_id = $3 ELSE a.site_id = $2::uuid END)
            AND a.planned_start < now() + interval '12 hours' AND a.planned_end > now() - interval '12 hours'
          GROUP BY a.employee_id),
       team AS (
         SELECT tm.employee_id FROM sites s JOIN team_members tm ON tm.team_id = s.responsible_team_id
          WHERE s.id = $2::uuid AND tm.start_date <= $4::date AND (tm.end_date IS NULL OR tm.end_date >= $4::date)),
       people AS (
         SELECT employee_id, on_shift FROM rostered
         UNION ALL SELECT employee_id, false FROM team)
       SELECT u.id AS user_id, e.full_name, e.phone, bool_or(p.on_shift) AS on_shift
         FROM people p
         JOIN employees e ON e.id = p.employee_id AND e.deleted_at IS NULL AND e.status = 'active'
         JOIN users u ON u.employee_id = e.id AND u.tenant_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL
        GROUP BY u.id, e.full_name, e.phone
        ORDER BY bool_or(p.on_shift) DESC, e.full_name`,
      [tenantId, row.site_id, row.client_id, todayLocal()],
    );
  }

  /** A report already made from this phone-made id: its incident for the same person, a conflict for anyone else. */
  private async replayed(actor: AuthUser, clientUuid: string | undefined): Promise<string | null> {
    if (!clientUuid) return null;
    const [row] = await this.ds.query(`SELECT id, reported_by FROM incidents WHERE tenant_id = $1 AND client_uuid = $2`, [tenantOf(actor), clientUuid]);
    if (!row) return null;
    if (row.reported_by !== actor.id) throw new BusinessException('CONFLICT');
    return row.id;
  }

  /** The incident row locked for change, if the caller can see it. */
  async lockVisible(m: EntityManager, actor: AuthUser, id: string): Promise<Incident> {
    const [row] = await m.query(`SELECT id FROM incidents WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const incident = await m.findOneByOrFail(Incident, { id });
    if (!(await this.canSee(actor, incident))) throw new BusinessException('NOT_FOUND');
    return incident;
  }

  async canSee(actor: AuthUser, incident: Pick<Incident, 'reported_by' | 'assignee_user_id' | 'site_id' | 'client_id'>): Promise<boolean> {
    if (incident.reported_by === actor.id || incident.assignee_user_id === actor.id) return true;
    if (!(await this.permissions.has(actor.id, ['incident.view']))) return false;
    return incident.site_id ? this.scopes.canSeeSite(actor, incident.site_id) : this.scopes.canSeeClient(actor, incident.client_id);
  }

  /** Writes the incident, its first event and its photos. Notifying people is the escalation service's job (Task 5). */
  protected async create(actor: AuthUser, input: NewIncident) {
    const tenantId = tenantOf(actor);
    let id: string;
    try {
      id = await this.ds.transaction(async (m) => {
      const saved = await m.save(
        m.create(Incident, {
          tenant_id: tenantId, client_id: input.client_id, site_id: input.site_id, category_id: input.category_id,
          severity: input.severity, is_sos: input.is_sos, title: input.title, description: input.description,
          lat: input.lat === null ? null : String(input.lat), lng: input.lng === null ? null : String(input.lng),
          source: input.source, client_reporter_name: input.client_reporter_name, client_channel: input.client_channel,
          reported_by: actor.id, reporter_employee_id: actor.employee_id, status: 'new', client_uuid: input.client_uuid,
          occurred_at: input.occurred_at,
        }),
      );
      for (const fileId of input.file_ids) await this.files.claim(m, tenantId, fileId, { type: 'incident', id: saved.id });
      await m.query(
        `INSERT INTO incident_events (tenant_id, incident_id, type, actor_user_id, to_status, data) VALUES ($1, $2, 'created', $3, 'new', $4)`,
        [tenantId, saved.id, actor.id, JSON.stringify({ severity: input.severity, is_sos: input.is_sos, source: input.source })],
      );
      await this.afterCreate(m, saved);
      return saved.id;
      });
    } catch (error) {
      // Two copies of one report racing: the loser answers like a resend.
      const duplicate = error instanceof QueryFailedError && (error as QueryFailedError & { constraint?: string }).constraint === 'incidents_client_uq';
      const again = duplicate ? await this.replayed(actor, input.client_uuid ?? undefined) : null;
      if (!again) throw error;
      id = again;
    }
    return this.get(actor, id);
  }

  /** Routing and first notifications run inside the creating transaction: no incident without its alerts. */
  protected async afterCreate(m: EntityManager, incident: Incident): Promise<void> {
    await this.escalation.start(m, incident);
  }

  /** A guard reports where they work: a site of a client they are posted to today, else their current shift's site. */
  /** Where a guard was at `at`: a site of a client they were posted to, or the site of the shift they were on. */
  private async fieldPlace(actor: AuthUser, siteId: string | null, at: Date): Promise<{ client_id: string; site_id: string | null }> {
    if (!actor.employee_id) throw new BusinessException('INCIDENT_NO_SITE');
    const today = at;
    const posted: { client_id: string }[] = await this.ds.query(
      `SELECT client_id FROM deployments WHERE employee_id = $1 AND tenant_id = $2
          AND start_date <= ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
          AND (end_date IS NULL OR end_date >= ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`,
      [actor.employee_id, tenantOf(actor), at],
    );
    if (siteId) {
      const [site] = await this.ds.query(`SELECT id, client_id FROM sites WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [siteId, tenantOf(actor)]);
      if (!site) throw new BusinessException('NOT_FOUND');
      if (!posted.some((p) => p.client_id === site.client_id)) throw new BusinessException('INCIDENT_SITE_NOT_ALLOWED');
      return { client_id: site.client_id, site_id: site.id };
    }
    const [shift] = await this.ds.query(
      `SELECT a.site_id, s.client_id FROM shift_assignments a JOIN sites s ON s.id = a.site_id
        WHERE a.employee_id = $1 AND a.tenant_id = $2 AND a.status = 'planned'
          AND a.planned_start - make_interval(secs => $3) <= $4 AND a.planned_end >= $4
        ORDER BY a.planned_start LIMIT 1`,
      [actor.employee_id, tenantOf(actor), SHIFT_EARLY_MS / 1000, today],
    );
    if (shift) return { client_id: shift.client_id, site_id: shift.site_id };
    if (posted.length) return { client_id: posted[0].client_id, site_id: null };
    throw new BusinessException('INCIDENT_NO_SITE');
  }

  /** The office records a report: it must see the site, or the client when there is no site. */
  private async officePlace(actor: AuthUser, dto: ReportIncidentDto): Promise<{ client_id: string; site_id: string | null }> {
    if (!(await this.permissions.has(actor.id, ['incident.manage']))) throw new BusinessException('AUTH_FORBIDDEN');
    if (dto.site_id) {
      if (!(await this.scopes.canSeeSite(actor, dto.site_id))) throw new BusinessException('NOT_FOUND');
      const [site] = await this.ds.query(`SELECT client_id FROM sites WHERE id = $1`, [dto.site_id]);
      return { client_id: site.client_id, site_id: dto.site_id };
    }
    if (!dto.client_id) throw new BusinessException('VALIDATION_FAILED', ['site_id hoặc client_id: cần chọn nơi xảy ra']);
    if (!(await this.scopes.canSeeClient(actor, dto.client_id))) throw new BusinessException('NOT_FOUND');
    return { client_id: dto.client_id, site_id: null };
  }

  /** SQL filter for what the caller may see: everything in scope with incident.view, otherwise their own reports. */
  private async visibility(actor: AuthUser, params: unknown[]): Promise<string> {
    // Parameters are added only when the clause uses them: Postgres rejects an unused, untyped one.
    if (!(await this.permissions.has(actor.id, ['incident.view']))) {
      params.push(actor.id);
      return ` AND (i.reported_by = $${params.length} OR i.assignee_user_id = $${params.length})`;
    }
    const [sites, clients] = await Promise.all([this.scopes.siteVisibility(actor), this.scopes.clientVisibility(actor)]);
    if (sites.all) return '';
    params.push(actor.id, sites.siteIds, clients.all ? [] : clients.clientIds);
    const [self, s, c] = [params.length - 2, params.length - 1, params.length].map((n) => `$${n}`);
    return ` AND (i.reported_by = ${self} OR i.assignee_user_id = ${self} OR i.site_id = ANY(${s}::uuid[]) OR (i.site_id IS NULL AND i.client_id = ANY(${c}::uuid[])))`;
  }
}

export interface NewIncident {
  client_id: string;
  site_id: string | null;
  category_id: string | null;
  severity: Incident['severity'];
  is_sos: boolean;
  title: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  source: Incident['source'];
  client_reporter_name: string | null;
  client_channel: string | null;
  file_ids: string[];
  client_uuid: string | null;
  occurred_at: Date;
}
