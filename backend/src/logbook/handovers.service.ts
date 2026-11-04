import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SitesService } from '../sites/sites.service';
import { HandoverDto, HandoverItemsDto, ReceiverDto } from './dto';
import { Handover } from './handover.entity';
import { Presence } from './presence';
import { leaderAndManager } from './site-people';

const WINDOW_MS = 2 * 60 * 60_000;

const ROWS = `
  SELECT h.id, h.site_id, s.name AS site_name, h.from_assignment_id, h.from_employee_id, fe.full_name AS from_name,
         h.to_assignment_id, h.to_employee_id, te.full_name AS to_name, h.items, h.notes, h.status, h.submitted_at,
         h.receiver_note, h.answered_at, h.reviewed_at, h.review_note, ru.full_name AS reviewed_by_name,
         COALESCE((SELECT json_agg(f.id ORDER BY f.created_at) FROM files f WHERE f.owner_type = 'handover' AND f.owner_id = h.id AND f.deleted_at IS NULL), '[]') AS file_ids
    FROM handovers h
    JOIN sites s ON s.id = h.site_id
    JOIN employees fe ON fe.id = h.from_employee_id
    LEFT JOIN employees te ON te.id = h.to_employee_id
    LEFT JOIN users ru ON ru.id = h.reviewed_by
   WHERE h.tenant_id = $1`;

@Injectable()
export class HandoversService {
  constructor(
    private readonly ds: DataSource,
    private readonly presence: Presence,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly sites: SitesService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async items(actor: AuthUser, siteId: string): Promise<string[]> {
    if (!(await this.presence.canRead(this.ds.manager, actor, siteId)) && !(await this.scopes.canSeeSite(actor, siteId))) {
      throw new BusinessException('NOT_FOUND');
    }
    const [row] = await this.ds.query(`SELECT handover_items FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return row.handover_items;
  }

  async setItems(actor: AuthUser, siteId: string, dto: HandoverItemsDto): Promise<string[]> {
    await this.sites.writable(actor, siteId);
    const items = [...new Set(dto.items.map((i) => i.trim()).filter(Boolean))];
    await this.ds.query(`UPDATE sites SET handover_items = $2, updated_at = now() WHERE id = $1`, [siteId, JSON.stringify(items)]);
    return items;
  }

  async submit(actor: AuthUser, dto: HandoverDto) {
    const tenantId = tenantOf(actor);
    const id = await this.ds.transaction(async (m) => {
      const [from] = await m.query(
        `SELECT id, site_id, employee_id, planned_end, status FROM shift_assignments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [dto.from_assignment_id, tenantId],
      );
      if (!from || from.status !== 'planned') throw new BusinessException('NOT_FOUND');
      if (!actor.employee_id || from.employee_id !== actor.employee_id) throw new BusinessException('HANDOVER_NOT_YOURS');
      const end = new Date(from.planned_end).getTime();
      if (Math.abs(Date.now() - end) > WINDOW_MS) throw new BusinessException('HANDOVER_TOO_EARLY');
      if ((await m.query(`SELECT 1 FROM handovers WHERE from_assignment_id = $1`, [from.id])).length) throw new BusinessException('HANDOVER_ALREADY');

      const [site] = await m.query(`SELECT name, handover_items FROM sites WHERE id = $1`, [from.site_id]);
      // Exactly the site's checklist: each item once, nothing invented (free text goes in the notes).
      const template = site.handover_items as string[];
      const labels = dto.items.map((i) => i.label.trim());
      if (new Set(labels).size !== labels.length || labels.some((l) => !template.includes(l))) throw new BusinessException('HANDOVER_ITEMS_INVALID');
      if (template.some((label) => !labels.includes(label))) throw new BusinessException('HANDOVER_ITEMS_INCOMPLETE');

      const candidates = await this.candidates(m, from);
      let to: { id: string; employee_id: string } | null = null;
      if (dto.to_assignment_id) {
        to = candidates.find((c) => c.id === dto.to_assignment_id) ?? null;
        if (!to) throw new BusinessException('NOT_FOUND');
      } else if (candidates.length === 1) {
        to = candidates[0];
      } else if (candidates.length > 1) {
        throw new BusinessException('HANDOVER_RECEIVER_REQUIRED', candidates.map((c) => ({ assignment_id: c.id, name: c.full_name, planned_start: c.planned_start })));
      }

      for (const fileId of dto.file_ids ?? []) await this.assertOwnPhoto(m, actor, fileId);
      const saved = await m.save(
        m.create(Handover, {
          tenant_id: tenantId, site_id: from.site_id, from_assignment_id: from.id, from_employee_id: from.employee_id,
          to_assignment_id: to?.id ?? null, to_employee_id: to?.employee_id ?? null,
          items: dto.items.map((i) => ({ label: i.label.trim(), status: i.status, ...(i.note?.trim() ? { note: i.note.trim() } : {}) })),
          notes: dto.notes?.trim() || null,
        }),
      );
      for (const fileId of dto.file_ids ?? []) await this.files.claim(m, tenantId, fileId, { type: 'handover', id: saved.id });

      const problems = saved.items.filter((i) => i.status !== 'ok');
      if (problems.length) {
        await this.notifications.notify(tenantId, await leaderAndManager(m, from.site_id), {
          type: 'handover.problem', title: `Giao ca có vấn đề · ${site.name}`,
          body: problems.map((p) => `${p.label}: ${p.status === 'missing' ? 'thiếu' : 'có vấn đề'}${p.note ? ` (${p.note})` : ''}`).join('; '),
          data: { handover_id: saved.id }, priority: 'high', push: true,
        }, m);
      }
      if (to) {
        const receivers: { id: string }[] = await m.query(`SELECT id FROM users WHERE employee_id = $1 AND status = 'active' AND deleted_at IS NULL`, [to.employee_id]);
        await this.notifications.notify(tenantId, receivers.map((r) => r.id), {
          type: 'handover.incoming', title: `Nhận bàn giao ca · ${site.name}`, body: 'Kiểm tra và xác nhận biên bản giao ca',
          data: { handover_id: saved.id }, priority: 'normal', push: true,
        }, m);
      }
      return saved.id;
    });
    return this.one(tenantId, id);
  }

  /** Shifts that can take over from `from`: another person's, at the site, starting within 2 hours of its end. */
  private candidates(m: EntityManager, from: { site_id: string; employee_id: string; planned_end: Date }): Promise<{ id: string; employee_id: string; full_name: string; planned_start: Date }[]> {
    return m.query(
      `SELECT a.id, a.employee_id, e.full_name, a.planned_start FROM shift_assignments a JOIN employees e ON e.id = a.employee_id
        WHERE a.site_id = $1 AND a.status = 'planned' AND a.employee_id <> $2
          AND a.planned_start BETWEEN $3::timestamptz - interval '2 hours' AND $3::timestamptz + interval '2 hours'
        ORDER BY a.planned_start`,
      [from.site_id, from.employee_id, from.planned_end],
    );
  }

  /**
   * The receiver as of now: if their shift was handed to someone else, the stand-in takes over the answer.
   * Updates the handover when it follows a substitution.
   */
  private async receiver(m: EntityManager, h: Handover): Promise<{ id: string; employee_id: string } | null> {
    let current = h.to_assignment_id;
    for (let hop = 0; current && hop < 5; hop++) {
      const [a] = await m.query(`SELECT id, employee_id, status FROM shift_assignments WHERE id = $1`, [current]);
      if (!a) return null;
      if (a.status === 'planned') {
        if (a.id !== h.to_assignment_id) await m.update(Handover, { id: h.id }, { to_assignment_id: a.id, to_employee_id: a.employee_id });
        return a;
      }
      const [next] = await m.query(`SELECT id FROM shift_assignments WHERE substitute_for_id = $1 ORDER BY created_at DESC LIMIT 1`, [a.id]);
      current = next?.id ?? null;
    }
    return null;
  }

  /** While nobody has answered, the giver or a reviewer names the receiver (none existed, or theirs was cancelled). */
  async setReceiver(actor: AuthUser, id: string, dto: ReceiverDto) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const h = await this.lock(m, tenantId, id);
      if (h.status !== 'submitted') throw new BusinessException('HANDOVER_CLOSED');
      const giver = Boolean(actor.employee_id) && actor.employee_id === h.from_employee_id;
      const reviewer = (await this.permissions.has(actor.id, ['handover.review'])) && (await this.scopes.canSeeSite(actor, h.site_id));
      if (!giver && !reviewer) throw new BusinessException('HANDOVER_NOT_YOURS');
      const [from] = await m.query(`SELECT site_id, employee_id, planned_end FROM shift_assignments WHERE id = $1`, [h.from_assignment_id]);
      const to = (await this.candidates(m, from)).find((c) => c.id === dto.to_assignment_id);
      if (!to) throw new BusinessException('NOT_FOUND');
      await m.update(Handover, { id }, { to_assignment_id: to.id, to_employee_id: to.employee_id });
      const receivers: { id: string }[] = await m.query(`SELECT id FROM users WHERE employee_id = $1 AND status = 'active' AND deleted_at IS NULL`, [to.employee_id]);
      await this.notifications.notify(tenantId, receivers.map((r) => r.id), {
        type: 'handover.incoming', title: 'Nhận bàn giao ca', body: 'Kiểm tra và xác nhận biên bản giao ca',
        data: { handover_id: id }, priority: 'normal', push: true,
      }, m);
    });
    return this.one(tenantId, id);
  }

  /** Only the receiver of the moment answers, once. Disagreeing needs a reason and alerts the leader and manager. */
  async answer(actor: AuthUser, id: string, accept: boolean, note?: string) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const h = await this.lock(m, tenantId, id);
      if (h.status !== 'submitted') throw new BusinessException('HANDOVER_CLOSED');
      const to = await this.receiver(m, h);
      if (!to) {
        if (actor.employee_id && h.to_employee_id === actor.employee_id) throw new BusinessException('HANDOVER_NOT_YOURS');
        throw new BusinessException(h.to_assignment_id ? 'HANDOVER_NOT_YOURS' : 'HANDOVER_NO_RECEIVER');
      }
      if (!actor.employee_id || to.employee_id !== actor.employee_id) throw new BusinessException('HANDOVER_NOT_YOURS');
      const reason = note?.trim() || null;
      if (!accept && !reason) throw new BusinessException('HANDOVER_NOTE_REQUIRED');
      await m.update(Handover, { id }, { status: accept ? 'accepted' : 'disputed', receiver_note: reason, answered_at: new Date() });
      if (!accept) {
        const [site] = await m.query(`SELECT name FROM sites WHERE id = $1`, [h.site_id]);
        await this.notifications.notify(tenantId, await leaderAndManager(m, h.site_id), {
          type: 'handover.disputed', title: `Không đồng ý nhận bàn giao · ${site.name}`, body: reason!,
          data: { handover_id: id }, priority: 'high', push: true,
        }, m);
      }
    });
    return this.one(tenantId, id);
  }

  async review(actor: AuthUser, id: string, note?: string) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const h = await this.lock(m, tenantId, id);
      if (!(await this.scopes.canSeeSite(actor, h.site_id))) throw new BusinessException('NOT_FOUND');
      if (actor.employee_id && (actor.employee_id === h.from_employee_id || actor.employee_id === h.to_employee_id)) throw new BusinessException('HANDOVER_OWN');
      if (h.reviewed_at) throw new BusinessException('HANDOVER_REVIEWED');
      if (h.status === 'submitted' && h.to_assignment_id) throw new BusinessException('HANDOVER_NOT_ANSWERED');
      await m.update(Handover, { id }, { reviewed_by: actor.id, reviewed_at: new Date(), review_note: note?.trim() || null });
    });
    return this.one(tenantId, id);
  }

  async list(actor: AuthUser, siteId: string, date: string) {
    const access = await this.presence.canRead(this.ds.manager, actor, siteId);
    if (!access || (access === 'shift' && !Presence.recentDay(date))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `${ROWS} AND h.site_id = $2
          AND h.submitted_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND h.submitted_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        ORDER BY h.submitted_at DESC`,
      [tenantOf(actor), siteId, date],
    );
  }

  /** Handovers waiting for the caller's answer. */
  async mine(actor: AuthUser) {
    if (!actor.employee_id) return [];
    return this.ds.query(`${ROWS} AND h.to_employee_id = $2 AND h.status = 'submitted' ORDER BY h.submitted_at DESC`, [tenantOf(actor), actor.employee_id]);
  }

  private async lock(m: EntityManager, tenantId: string, id: string): Promise<Handover> {
    const [row] = await m.query(`SELECT id FROM handovers WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return m.findOneByOrFail(Handover, { id });
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
    const [row] = await this.ds.query(`${ROWS} AND h.id = $2`, [tenantId, id]);
    return row;
  }
}
