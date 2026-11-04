import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { EventsService } from '../notifications/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { SiteContactsService } from '../sites/contacts.service';
import { SEVERITY_ORDER } from './categories';
import { mayEnd } from './close-rule';
import { Incident, IncidentStatus } from './incident.entity';
import { IncidentsService } from './incidents.service';

type Who = 'manage' | 'manage_or_assignee' | 'close' | 'dismiss';

interface Move {
  from: IncidentStatus[];
  to: IncidentStatus;
  who: Who;
  /** Checks and extra columns, run with the locked row. */
  prepare?: (m: EntityManager, incident: Incident) => Promise<Partial<Incident>>;
  body?: string | null;
  notifyReporter?: { type: string; title: string };
}


@Injectable()
export class WorkflowService {
  constructor(
    private readonly ds: DataSource,
    private readonly incidents: IncidentsService,
    private readonly permissions: PermissionService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
    private readonly contacts: SiteContactsService,
  ) {}

  /** "Tôi tiếp nhận": the clock stops, nobody else is chased. */
  acknowledge(actor: AuthUser, id: string) {
    return this.move(actor, id, {
      from: ['new'], to: 'acknowledged', who: 'manage',
      prepare: async () => ({ acknowledged_at: new Date(), acknowledged_by: actor.id, next_escalation_at: null }),
      notifyReporter: { type: 'incident.acknowledged', title: 'Sự cố đã được tiếp nhận' },
    }, 'acknowledged');
  }

  async assign(actor: AuthUser, id: string, userId: string) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const incident = await this.incidents.lockVisible(m, actor, id);
      await this.require(actor, incident, 'manage');
      if (incident.status === 'closed' || incident.status === 'rejected') throw new BusinessException('INCIDENT_BAD_TRANSITION');
      const [user] = await m.query(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`, [userId, tenantId]);
      if (!user) throw new BusinessException('NOT_FOUND');
      await m.update(Incident, { id }, { assignee_user_id: userId });
      await this.event(m, incident, actor, 'assigned', null, null, null, { user_id: userId });
      await this.notifications.notify(tenantId, [userId], {
        type: 'incident.assigned', title: `Bạn được giao xử lý · ${incident.title}`, body: incident.description ?? '',
        data: { incident_id: id }, priority: 'high', push: true,
      }, m);
    });
    return this.done(actor, id);
  }

  start(actor: AuthUser, id: string) {
    return this.move(actor, id, { from: ['acknowledged'], to: 'in_progress', who: 'manage_or_assignee' });
  }

  resolve(actor: AuthUser, id: string, input: { note?: string; file_ids?: string[] }) {
    const note = input.note?.trim();
    return this.move(actor, id, {
      from: ['acknowledged', 'in_progress'], to: 'resolved', who: 'manage_or_assignee', body: note ?? null,
      prepare: async (m, incident) => {
        if (!note) throw new BusinessException('INCIDENT_NOTE_REQUIRED');
        for (const fileId of input.file_ids ?? []) await this.files.claim(m, incident.tenant_id, fileId, { type: 'incident', id });
        if (SEVERITY_ORDER[incident.severity] >= SEVERITY_ORDER.high) {
          const [{ count }] = await m.query(`SELECT count(*)::int AS count FROM files WHERE owner_type = 'incident' AND owner_id = $1 AND deleted_at IS NULL`, [id]);
          if (count === 0) throw new BusinessException('INCIDENT_PHOTO_REQUIRED');
        }
        return { resolved_at: new Date(), resolution_note: note };
      },
      notifyReporter: { type: 'incident.resolved', title: 'Sự cố đã được xử lý' },
    });
  }

  close(actor: AuthUser, id: string) {
    return this.move(actor, id, {
      from: ['resolved'], to: 'closed', who: 'close',
      prepare: async () => ({ closed_at: new Date(), closed_by: actor.id }),
      notifyReporter: { type: 'incident.closed', title: 'Sự cố đã đóng' },
    });
  }

  reopen(actor: AuthUser, id: string, reason?: string) {
    return this.move(actor, id, {
      from: ['resolved'], to: 'in_progress', who: 'manage', body: reason?.trim() ?? null,
      prepare: async () => {
        if (!reason?.trim()) throw new BusinessException('INCIDENT_REASON_REQUIRED');
        return { resolved_at: null, resolution_note: null };
      },
    });
  }

  reject(actor: AuthUser, id: string, reason?: string) {
    return this.move(actor, id, {
      // "False alarm" ends the incident and stops escalation, so it carries the same limit as closing.
      from: ['new', 'acknowledged', 'in_progress'], to: 'rejected', who: 'dismiss', body: reason?.trim() ?? null,
      prepare: async () => {
        if (!reason?.trim()) throw new BusinessException('INCIDENT_REASON_REQUIRED');
        return { rejected_reason: reason.trim(), next_escalation_at: null };
      },
      notifyReporter: { type: 'incident.rejected', title: 'Sự cố được đánh dấu báo nhầm' },
    });
  }

  async comment(actor: AuthUser, id: string, input: { body: string; file_ids?: string[] }) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const incident = await this.incidents.lockVisible(m, actor, id);
      for (const fileId of input.file_ids ?? []) await this.files.claim(m, tenantId, fileId, { type: 'incident', id });
      await this.event(m, incident, actor, 'comment', input.body, null, null, { file_ids: input.file_ids ?? [] });
      const others = this.participants(incident).filter((u) => u !== actor.id);
      await this.notifications.notify(tenantId, others, {
        type: 'incident.comment', title: `Bình luận mới · ${incident.title}`, body: input.body.slice(0, 200),
        data: { incident_id: id }, priority: 'normal', push: false,
      }, m);
    });
    return this.done(actor, id);
  }

  /**
   * "Đã gọi đầu mối": the timeline shows who reached which client contact, and how. Only a contact of the
   * incident's own site that this person may see; the number itself stays out of the timeline.
   */
  async contactCalled(actor: AuthUser, id: string, input: { contact_id: string; channel: 'phone' | 'zalo' | 'email' }) {
    const contact = await this.contacts.visible(actor, input.contact_id);
    await this.ds.transaction(async (m) => {
      const incident = await this.incidents.lockVisible(m, actor, id);
      if (incident.site_id !== contact.site_id) throw new BusinessException('NOT_FOUND');
      const how = { phone: 'Gọi điện', zalo: 'Nhắn Zalo', email: 'Gửi email' }[input.channel];
      await this.event(m, incident, actor, 'contact_called', `${how} cho ${contact.full_name}${contact.title ? ` (${contact.title})` : ''}`, null, null, {
        contact_id: contact.id, channel: input.channel,
      });
    });
    return this.done(actor, id);
  }

  /** One status change: lock, check from-state and permission, write, record, tell people. */
  private async move(actor: AuthUser, id: string, step: Move, eventType: 'status_changed' | 'acknowledged' = 'status_changed') {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const incident = await this.incidents.lockVisible(m, actor, id);
      if (!step.from.includes(incident.status)) throw new BusinessException('INCIDENT_BAD_TRANSITION');
      await this.require(actor, incident, step.who);
      const extra = step.prepare ? await step.prepare(m, incident) : {};
      await m.update(Incident, { id }, { ...extra, status: step.to });
      await this.event(m, incident, actor, eventType, step.body ?? null, incident.status, step.to, {});
      if (step.notifyReporter && incident.reported_by !== actor.id) {
        await this.notifications.notify(tenantId, [incident.reported_by], {
          type: step.notifyReporter.type, title: step.notifyReporter.title, body: incident.title,
          data: { incident_id: id }, priority: 'normal', push: true,
        }, m);
      }
    });
    return this.done(actor, id);
  }

  private async require(actor: AuthUser, incident: Incident, who: Who): Promise<void> {
    const held = await this.permissions.permissionsOf(actor.id);
    if (who === 'manage' && held.has('incident.manage')) return;
    if (who === 'manage_or_assignee' && (held.has('incident.manage') || incident.assignee_user_id === actor.id)) return;
    if (who === 'close' || who === 'dismiss') {
      if (mayEnd(held, incident.severity, await this.settings.effective(incident.tenant_id, incident.site_id))) return;
      throw new BusinessException(who === 'close' ? 'INCIDENT_CLOSE_NOT_ALLOWED' : 'INCIDENT_REJECT_NOT_ALLOWED');
    }
    throw new BusinessException('AUTH_FORBIDDEN');
  }

  private async event(
    m: EntityManager, incident: Incident, actor: AuthUser | null, type: string, body: string | null,
    from: string | null, to: string | null, data: Record<string, unknown>,
  ) {
    await m.query(
      `INSERT INTO incident_events (tenant_id, incident_id, type, actor_user_id, body, from_status, to_status, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [incident.tenant_id, incident.id, type, actor?.id ?? null, body, from, to, JSON.stringify(data)],
    );
  }

  private participants(incident: Incident): string[] {
    return [incident.reported_by, incident.assignee_user_id, incident.acknowledged_by].filter((u): u is string => Boolean(u));
  }

  /** After the commit: everyone involved sees the change live, then the caller gets the fresh detail. */
  private async done(actor: AuthUser, id: string) {
    const detail = await this.incidents.get(actor, id);
    const watchers = [detail.reported_by, detail.assignee_user_id, detail.acknowledged_by].filter(Boolean);
    this.events.emit(watchers, { type: 'incident.updated', id, status: detail.status });
    return detail;
  }
}
