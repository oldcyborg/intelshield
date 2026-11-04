import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { ExitDto, LogbookDto, LogbookFilter } from './dto';
import { LogbookEntry } from './logbook-entry.entity';
import { Presence } from './presence';

const ROWS = `
  SELECT l.id, l.site_id, l.type, l.body, l.data, l.occurred_at, l.exited_at, l.captured_offline, l.created_at,
         COALESCE(ae.full_name, u.full_name) AS author_name, xu.full_name AS exited_by_name,
         COALESCE((SELECT json_agg(json_build_object('id', f.id, 'mime', f.mime) ORDER BY f.created_at)
                     FROM files f WHERE f.owner_type = 'logbook_entry' AND f.owner_id = l.id AND f.deleted_at IS NULL), '[]') AS files
    FROM logbook_entries l
    JOIN users u ON u.id = l.author_user_id
    LEFT JOIN employees ae ON ae.id = l.author_employee_id
    LEFT JOIN users xu ON xu.id = l.exited_by
   WHERE l.tenant_id = $1`;

/** The fields each kind of line keeps, and the one it cannot do without. */
const SHAPES: Record<string, { fields: (keyof LogbookDto)[]; required: (keyof LogbookDto)[] }> = {
  note: { fields: [], required: ['body'] },
  other: { fields: [], required: ['body'] },
  visitor: { fields: ['visitor_name', 'visitor_org', 'meet_whom', 'purpose'], required: ['visitor_name'] },
  vehicle: { fields: ['plate', 'vehicle_kind', 'cargo'], required: ['plate'] },
  asset: { fields: ['item', 'quantity', 'asset_action', 'counterpart'], required: ['item', 'asset_action'] },
};

const OFFLINE_LIMIT_MS = 24 * 60 * 60_000;

/** Online: server time. Sent later from a phone: its time, never ahead of the server; `tooOld` past a day back. */
const when = (deviceTime: string, offline?: boolean) => {
  const server = new Date();
  if (!offline) return { at: server, tooOld: false };
  const at = new Date(Math.min(new Date(deviceTime).getTime(), server.getTime()));
  return { at, tooOld: server.getTime() - at.getTime() > OFFLINE_LIMIT_MS };
};

@Injectable()
export class LogbookService {
  constructor(
    private readonly ds: DataSource,
    private readonly presence: Presence,
    private readonly files: FilesService,
  ) {}

  async write(actor: AuthUser, siteId: string, dto: LogbookDto) {
    const tenantId = tenantOf(actor);
    const replay = await this.replayed(actor, dto.client_uuid);
    if (replay) return this.one(tenantId, replay);
    const shape = SHAPES[dto.type];
    for (const key of shape.required) {
      const value = dto[key];
      if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
        throw new BusinessException('LOGBOOK_FIELD_REQUIRED', [`${key}: bắt buộc với loại này`]);
      }
    }
    const data: Record<string, unknown> = {};
    for (const key of shape.fields) if (dto[key] !== undefined) data[key] = typeof dto[key] === 'string' ? (dto[key] as string).trim() : dto[key];
    let { at, tooOld } = when(dto.device_time, dto.captured_offline);
    let id: string;
    try {
      id = await this.ds.transaction(async (m) => {
        const [site] = await m.query(`SELECT id FROM sites WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [siteId, tenantId]);
        if (!site) throw new BusinessException('NOT_FOUND');
        // A line claiming more than a day back is refused; the office may still write it, as of now.
        if (tooOld) {
          if (!(await this.presence.canManage(actor, siteId))) throw new BusinessException('LOGBOOK_TOO_OLD');
          at = new Date();
        }
        const { assignmentId } = await this.presence.canWrite(m, actor, siteId, at);
        // Office lines are written as of now: only someone who was there may say "this happened earlier".
        if (!assignmentId) at = new Date();
        for (const fileId of dto.file_ids ?? []) await this.assertOwnPhoto(m, actor, fileId);
        const saved = await m.save(
          m.create(LogbookEntry, {
            tenant_id: tenantId, site_id: siteId, assignment_id: assignmentId, author_user_id: actor.id, author_employee_id: actor.employee_id,
            type: dto.type, body: dto.body?.trim() || null, data, occurred_at: at, client_uuid: dto.client_uuid,
            captured_offline: Boolean(dto.captured_offline),
          }),
        );
        for (const fileId of dto.file_ids ?? []) await this.files.claim(m, tenantId, fileId, { type: 'logbook_entry', id: saved.id });
        return saved.id;
      });
    } catch (error) {
      // Two copies of one line racing: the loser answers like a resend.
      const duplicate = error instanceof QueryFailedError && (error as QueryFailedError & { constraint?: string }).constraint === 'logbook_client_uq';
      const again = duplicate ? await this.replayed(actor, dto.client_uuid) : null;
      if (!again) throw error;
      id = again;
    }
    return this.one(tenantId, id);
  }

  /** A visitor or vehicle leaving: once, by anyone who may write in this site's book. */
  async exit(actor: AuthUser, id: string, dto: ExitDto) {
    const tenantId = tenantOf(actor);
    let { at, tooOld } = when(dto.device_time, dto.captured_offline);
    await this.ds.transaction(async (m) => {
      const [row] = await m.query(`SELECT id, site_id, type, exited_at, occurred_at FROM logbook_entries WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
      if (!row) throw new BusinessException('NOT_FOUND');
      if (tooOld) {
        if (!(await this.presence.canManage(actor, row.site_id))) throw new BusinessException('LOGBOOK_TOO_OLD');
        at = new Date();
      }
      const { assignmentId } = await this.presence.canWrite(m, actor, row.site_id, at);
      if (!assignmentId) at = new Date();
      if (row.type !== 'visitor' && row.type !== 'vehicle') throw new BusinessException('LOGBOOK_NO_EXIT');
      if (row.exited_at) throw new BusinessException('LOGBOOK_ALREADY_EXITED');
      const exitAt = new Date(Math.max(at.getTime(), new Date(row.occurred_at).getTime()));
      await m.update(LogbookEntry, { id }, { exited_at: exitAt, exited_by: actor.id });
    });
    return this.one(tenantId, id);
  }

  async list(actor: AuthUser, siteId: string, filter: LogbookFilter) {
    const tenantId = tenantOf(actor);
    const access = await this.presence.canRead(this.ds.manager, actor, siteId);
    if (!access || (access === 'shift' && !Presence.recentDay(filter.date))) throw new BusinessException('NOT_FOUND');
    const params: unknown[] = [tenantId, siteId, filter.date];
    let sql = `${ROWS} AND l.site_id = $2
      AND l.occurred_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND l.occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
    if (filter.type) {
      params.push(filter.type);
      sql += ` AND l.type = $${params.length}`;
    }
    if (filter.q?.trim()) {
      params.push(`%${filter.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      // Values only: searching "plate" must not match every vehicle by its field name.
      sql += ` AND (l.body ILIKE $${params.length} OR EXISTS (SELECT 1 FROM jsonb_each_text(l.data) d WHERE d.value ILIKE $${params.length}))`;
    }
    return this.ds.query(`${sql} ORDER BY l.occurred_at DESC, l.id LIMIT 500`, params);
  }

  /** Visitors and vehicles still in, from the last week. */
  async inside(actor: AuthUser, siteId: string) {
    const tenantId = tenantOf(actor);
    if (!(await this.presence.canRead(this.ds.manager, actor, siteId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `${ROWS} AND l.site_id = $2 AND l.type IN ('visitor', 'vehicle') AND l.exited_at IS NULL AND l.occurred_at > now() - interval '7 days'
        ORDER BY l.occurred_at`,
      [tenantId, siteId],
    );
  }

  private async replayed(actor: AuthUser, clientUuid: string): Promise<string | null> {
    const [prior] = await this.ds.query(`SELECT id, author_user_id FROM logbook_entries WHERE tenant_id = $1 AND client_uuid = $2`, [tenantOf(actor), clientUuid]);
    if (!prior) return null;
    if (prior.author_user_id !== actor.id) throw new BusinessException('CONFLICT');
    return prior.id;
  }

  private async assertOwnPhoto(m: EntityManager, actor: AuthUser, fileId: string): Promise<void> {
    const rows = await m.query(
      `SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
          AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL`,
      [fileId, tenantOf(actor), actor.id],
    );
    if (!rows.length) throw new BusinessException('LOGBOOK_PHOTO_INVALID');
  }

  private async one(tenantId: string, id: string) {
    const [row] = await this.ds.query(`${ROWS} AND l.id = $2`, [tenantId, id]);
    return row;
  }
}
