import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { leadsSite } from '../sites/team-leader';

/** Being at a site is having a planned shift there: from 10 minutes before it starts to 30 minutes after it ends. */
@Injectable()
export class Presence {
  constructor(
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
  ) {}

  async onShift(m: EntityManager, actor: AuthUser, siteId: string, at: Date): Promise<string | null> {
    if (!actor.employee_id) return null;
    const [row] = await m.query(
      `SELECT id FROM shift_assignments
        WHERE tenant_id = $1 AND employee_id = $2 AND site_id = $3 AND status = 'planned'
          AND planned_start - interval '10 minutes' <= $4 AND planned_end + interval '30 minutes' >= $4
        ORDER BY planned_start DESC LIMIT 1`,
      [tenantOf(actor), actor.employee_id, siteId, at],
    );
    return row?.id ?? null;
  }

  /** Office staff who manage the book and can see the site. */
  async canManage(actor: AuthUser, siteId: string): Promise<boolean> {
    return (await this.permissions.has(actor.id, ['logbook.manage'])) && this.scopes.canSeeSite(actor, siteId);
  }

  /**
   * On shift there (with the right to write), the leader of the team that runs the site (no shift needed), or
   * office staff who manage the book and can see the site.
   */
  async canWrite(m: EntityManager, actor: AuthUser, siteId: string, at: Date): Promise<{ assignmentId: string | null }> {
    const held = await this.permissions.permissionsOf(actor.id);
    if (held.has('logbook.write')) {
      const assignmentId = await this.onShift(m, actor, siteId, at);
      if (assignmentId) return { assignmentId };
      if (await leadsSite(m, tenantOf(actor), actor.employee_id, siteId)) return { assignmentId: null };
    }
    if (held.has('logbook.manage') && (await this.scopes.canSeeSite(actor, siteId))) return { assignmentId: null };
    throw new BusinessException('LOGBOOK_NOT_ON_SHIFT');
  }

  /**
   * "full": watching the site (logbook.view + sight). "shift": on a shift there now or within the last 12 hours —
   * enough for the recent book (today and yesterday), not its history. null: neither.
   */
  async canRead(m: EntityManager, actor: AuthUser, siteId: string): Promise<'full' | 'shift' | null> {
    if ((await this.permissions.has(actor.id, ['logbook.view'])) && (await this.scopes.canSeeSite(actor, siteId))) return 'full';
    if (!actor.employee_id) return null;
    const rows = await m.query(
      `SELECT 1 FROM shift_assignments WHERE tenant_id = $1 AND employee_id = $2 AND site_id = $3 AND status = 'planned'
          AND planned_start - interval '10 minutes' <= now() AND planned_end + interval '12 hours' >= now() LIMIT 1`,
      [tenantOf(actor), actor.employee_id, siteId],
    );
    return rows.length ? 'shift' : null;
  }

  /** The days a shift-only reader may open: today and yesterday, local time. */
  static recentDay(date: string): boolean {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() - 86_400_000));
    return date === today || date === yesterday;
  }
}
