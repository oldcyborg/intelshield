import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { normalizeEmail, normalizePhone } from '../common/identifiers';
import { ContactLevel, CreateContactDto, UpdateContactDto } from './dto';
import { SitesService } from './sites.service';

export interface ContactRow {
  id: string;
  site_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  zalo: string | null;
  email: string | null;
  hours: string | null;
  priority: number;
  visibility: ContactLevel;
  note: string | null;
}

/** Narrowest first: who holds a level sees it and every level after it. */
const LEVELS: { level: ContactLevel; permission: string }[] = [
  { level: 'staff', permission: 'contact.view.staff' },
  { level: 'leader', permission: 'contact.view.leader' },
  { level: 'guard', permission: 'contact.view.guard' },
];

const COLUMNS = `id, site_id, full_name, title, phone, zalo, email, hours, priority, visibility, note`;

const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
const phone = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? normalizePhone(v) : null);

@Injectable()
export class SiteContactsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The contact levels this person may see at this site. Within their scope: their level and the wider ones.
   * Outside it, someone on shift there right now still reaches the contacts meant for guards. null: the site
   * is not theirs to see at all.
   */
  async levels(actor: AuthUser, siteId: string): Promise<ContactLevel[] | null> {
    const held = await this.permissions.permissionsOf(actor.id);
    const from = LEVELS.findIndex((l) => held.has(l.permission));
    if (await this.scopes.canSeeSite(actor, siteId)) return from < 0 ? [] : LEVELS.slice(from).map((l) => l.level);
    if (from >= 0 && (await this.onShift(actor, siteId))) return ['guard'];
    return null;
  }

  async list(actor: AuthUser, siteId: string): Promise<ContactRow[]> {
    const levels = await this.levels(actor, siteId);
    if (!levels) throw new BusinessException('NOT_FOUND');
    if (!levels.length) return [];
    return this.ds.query(
      `SELECT ${COLUMNS} FROM site_contacts
        WHERE tenant_id = $1 AND site_id = $2 AND deleted_at IS NULL AND visibility = ANY($3)
        ORDER BY priority, full_name`,
      [tenantOf(actor), siteId, levels],
    );
  }

  /** One contact, if this person may see it — the incident timeline names only contacts the caller could reach. */
  async visible(actor: AuthUser, contactId: string): Promise<ContactRow> {
    const [row]: ContactRow[] = await this.ds.query(
      `SELECT ${COLUMNS} FROM site_contacts WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [contactId, tenantOf(actor)],
    );
    if (!row || !(await this.levels(actor, row.site_id))?.includes(row.visibility)) throw new BusinessException('NOT_FOUND');
    return row;
  }

  async create(actor: AuthUser, siteId: string, dto: CreateContactDto): Promise<ContactRow> {
    await this.sites.writable(actor, siteId);
    const values = this.values(dto);
    assertReachable(values);
    const [row]: ContactRow[] = await this.ds.query(
      `INSERT INTO site_contacts (tenant_id, site_id, full_name, title, phone, zalo, email, hours, priority, visibility, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
      [tenantOf(actor), siteId, values.full_name, values.title ?? null, values.phone ?? null, values.zalo ?? null, values.email ?? null,
        values.hours ?? null, dto.priority ?? 1, dto.visibility ?? 'staff', values.note ?? null],
    );
    await this.log(actor, 'site.contact.add', siteId, { contact_id: row.id, full_name: row.full_name, visibility: row.visibility });
    return row;
  }

  async update(actor: AuthUser, contactId: string, dto: UpdateContactDto): Promise<ContactRow> {
    const current = await this.writable(actor, contactId);
    const patch = Object.fromEntries(Object.entries({ ...this.values(dto), priority: dto.priority, visibility: dto.visibility }).filter(([, v]) => v !== undefined));
    assertReachable({ ...current, ...patch });
    const keys = Object.keys(patch);
    if (!keys.length) return current;
    // An UPDATE answers [rows, count].
    const [[row]]: [ContactRow[], number] = await this.ds.query(
      `UPDATE site_contacts SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 RETURNING ${COLUMNS}`,
      [contactId, tenantOf(actor), ...Object.values(patch)],
    );
    await this.log(actor, 'site.contact.update', row.site_id, { contact_id: contactId, ...patch });
    return row;
  }

  async remove(actor: AuthUser, contactId: string): Promise<{ ok: true }> {
    const current = await this.writable(actor, contactId);
    await this.ds.query(`UPDATE site_contacts SET deleted_at = now() WHERE id = $1`, [contactId]);
    await this.log(actor, 'site.contact.remove', current.site_id, { contact_id: contactId, full_name: current.full_name });
    return { ok: true };
  }

  /** The contact, if the caller may change its site (contact.manage is checked by the guard). */
  private async writable(actor: AuthUser, contactId: string): Promise<ContactRow> {
    const [row]: ContactRow[] = await this.ds.query(
      `SELECT ${COLUMNS} FROM site_contacts WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [contactId, tenantOf(actor)],
    );
    if (!row) throw new BusinessException('NOT_FOUND');
    await this.sites.writable(actor, row.site_id);
    return row;
  }

  /** On a planned shift there: from an hour before it starts to two hours after it ends, as the app shows it. */
  private async onShift(actor: AuthUser, siteId: string): Promise<boolean> {
    if (!actor.employee_id) return false;
    const rows = await this.ds.query(
      `SELECT 1 FROM shift_assignments
        WHERE tenant_id = $1 AND employee_id = $2 AND site_id = $3 AND status = 'planned'
          AND planned_start - interval '1 hour' <= now() AND planned_end + interval '2 hours' >= now() LIMIT 1`,
      [tenantOf(actor), actor.employee_id, siteId],
    );
    return rows.length > 0;
  }

  private values(dto: CreateContactDto | UpdateContactDto) {
    return {
      full_name: dto.full_name?.trim(),
      title: clean(dto.title),
      phone: phone(dto.phone),
      zalo: phone(dto.zalo),
      email: dto.email === undefined ? undefined : dto.email ? normalizeEmail(dto.email) : null,
      hours: clean(dto.hours),
      note: clean(dto.note),
    };
  }

  private log(actor: AuthUser, action: string, siteId: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'site', entity_id: siteId, data });
  }
}

/** A contact nobody can reach is no contact: phone, Zalo or email. */
function assertReachable(c: { phone?: string | null; zalo?: string | null; email?: string | null }): void {
  if (!c.phone && !c.zalo && !c.email) throw new BusinessException('VALIDATION_FAILED', ['phone: cần ít nhất số điện thoại, Zalo hoặc email']);
}
