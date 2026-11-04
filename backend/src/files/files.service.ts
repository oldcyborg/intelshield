import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { MAX_UPLOAD_BYTES, uploadDir } from '../config/env';
import { detectFileType } from './file-type';
import { FileOwnerType, FileRecord } from './file.entity';

export interface FileView {
  id: string;
  original_name: string;
  mime: string;
  size: number;
  created_at: Date;
}

export const toFileView = (f: FileRecord): FileView => ({
  id: f.id, original_name: f.original_name, mime: f.mime, size: f.size, created_at: f.created_at,
});

@Injectable()
export class FilesService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async store(actor: AuthUser, upload: { originalname: string; buffer: Buffer; size: number }): Promise<FileView> {
    const tenantId = tenantOf(actor);
    if (upload.size > MAX_UPLOAD_BYTES) throw new BusinessException('FILE_TOO_LARGE');
    const type = detectFileType(upload.buffer);
    if (!type) throw new BusinessException('FILE_TYPE_NOT_ALLOWED');

    const now = new Date();
    const relative = join(tenantId, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), `${randomUUID()}.${type.ext}`);
    const absolute = resolve(uploadDir(), relative);
    await mkdir(resolve(absolute, '..'), { recursive: true });
    await writeFile(absolute, upload.buffer, { flag: 'wx' });

    const repo = this.ds.getRepository(FileRecord);
    const saved = await repo.save(
      repo.create({
        tenant_id: tenantId,
        owner_type: null,
        owner_id: null,
        original_name: upload.originalname.slice(0, 255),
        path: relative,
        mime: type.mime,
        size: upload.size,
        sha256: createHash('sha256').update(upload.buffer).digest('hex'),
        uploaded_by: actor.id,
      }),
    );
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'file.upload', entity_type: 'file', entity_id: saved.id,
      data: { name: saved.original_name, size: saved.size },
    });
    return toFileView(saved);
  }

  /** Attach an uploaded file to its owner inside the owner's transaction. A file belongs to one owner, once. */
  async claim(m: EntityManager, tenantId: string, fileId: string, owner: { type: FileOwnerType; id: string }): Promise<void> {
    // One statement decides: of two owners claiming the same file at once, exactly one gets it.
    const result = await m.query(
      `UPDATE files SET owner_type = $3, owner_id = $4, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          AND (owner_id IS NULL OR (owner_type = $3 AND owner_id = $4))
       RETURNING id`,
      [fileId, tenantId, owner.type, owner.id],
    );
    const claimed: unknown[] = Array.isArray(result[0]) ? result[0] : result;
    if (claimed.length) return;
    const exists = await m.query(`SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [fileId, tenantId]);
    throw new BusinessException(exists.length ? 'FILE_IN_USE' : 'NOT_FOUND');
  }

  /** The file and where it lies on disk, or 404 for anyone who may not see what it is attached to. */
  async open(actor: AuthUser, id: string): Promise<{ file: FileRecord; absolutePath: string }> {
    const tenantId = tenantOf(actor);
    const file = await this.ds
      .getRepository(FileRecord)
      .createQueryBuilder('f')
      .addSelect('f.path')
      .where('f.id = :id AND f.tenant_id = :tenantId', { id, tenantId })
      .getOne();
    if (!file || !(await this.maySee(actor, file))) throw new BusinessException('NOT_FOUND');
    return { file, absolutePath: resolve(uploadDir(), file.path) };
  }

  private async maySee(actor: AuthUser, file: FileRecord): Promise<boolean> {
    if (!file.owner_type || !file.owner_id) return file.uploaded_by === actor.id;
    if (file.owner_type === 'contract') {
      if (!(await this.permissions.has(actor.id, ['contract.view']))) return false;
      const [row] = await this.ds.query(`SELECT client_id FROM contracts WHERE id = $1 AND deleted_at IS NULL`, [file.owner_id]);
      return Boolean(row) && (await this.scopes.canSeeClient(actor, row.client_id));
    }
    if (file.owner_type === 'employee_document') {
      // Scans of IDs and records are personal: the person they describe, then HR and the directors only,
      // like the profile's personal fields.
      const [row] = await this.ds.query(`SELECT employee_id FROM employee_documents WHERE id = $1 AND deleted_at IS NULL`, [
        file.owner_id,
      ]);
      if (!row) return false;
      if (actor.employee_id && row.employee_id === actor.employee_id) return true;
      if (!(await this.permissions.has(actor.id, ['employee.view']))) return false;
      if (!(await this.scopes.hasTenantScope(actor))) return false;
      return this.canSeeEmployee(actor, row.employee_id);
    }
    if (file.owner_type === 'attendance') {
      const [row] = await this.ds.query(
        `SELECT at.employee_id, a.site_id FROM attendances at JOIN shift_assignments a ON a.id = at.assignment_id WHERE at.id = $1`,
        [file.owner_id],
      );
      if (!row) return false;
      if (row.employee_id === actor.employee_id) return true;
      return (await this.permissions.has(actor.id, ['attendance.view'])) && (await this.scopes.canSeeSite(actor, row.site_id));
    }
    if (file.owner_type === 'incident') {
      const [row] = await this.ds.query(`SELECT reported_by, assignee_user_id, site_id, client_id FROM incidents WHERE id = $1`, [file.owner_id]);
      if (!row) return false;
      if (row.reported_by === actor.id || row.assignee_user_id === actor.id) return true;
      if (!(await this.permissions.has(actor.id, ['incident.view']))) return false;
      return row.site_id ? this.scopes.canSeeSite(actor, row.site_id) : this.scopes.canSeeClient(actor, row.client_id);
    }
    if (file.owner_type === 'patrol_scan') {
      const [row] = await this.ds.query(
        `SELECT sc.employee_id, r.site_id FROM patrol_scans sc JOIN patrol_rounds r ON r.id = sc.round_id WHERE sc.id = $1`,
        [file.owner_id],
      );
      if (!row) return false;
      if (row.employee_id === actor.employee_id) return true;
      return (await this.permissions.has(actor.id, ['patrol.view'])) && (await this.scopes.canSeeSite(actor, row.site_id));
    }
    if (file.owner_type === 'logbook_entry' || file.owner_type === 'handover') {
      const table = file.owner_type === 'logbook_entry' ? 'logbook_entries' : 'handovers';
      const extra = file.owner_type === 'handover' ? ', from_employee_id, to_employee_id' : '';
      const [row] = await this.ds.query(`SELECT site_id${extra} FROM ${table} WHERE id = $1`, [file.owner_id]);
      if (!row) return false;
      if (file.uploaded_by === actor.id) return true;
      // The two guards of a handover see its photos; a guard on shift at the site sees the book's.
      if (actor.employee_id && (row.from_employee_id === actor.employee_id || row.to_employee_id === actor.employee_id)) return true;
      if ((await this.permissions.has(actor.id, ['logbook.view'])) && (await this.scopes.canSeeSite(actor, row.site_id))) return true;
      if (file.owner_type === 'logbook_entry' && actor.employee_id) {
        const onShift = await this.ds.query(
          `SELECT 1 FROM shift_assignments WHERE employee_id = $1 AND site_id = $2 AND status = 'planned'
              AND planned_start - interval '10 minutes' <= now() AND planned_end + interval '12 hours' >= now() LIMIT 1`,
          [actor.employee_id, row.site_id],
        );
        return onShift.length > 0;
      }
      return false;
    }
    if (file.owner_type === 'leave_request') {
      const [row] = await this.ds.query(`SELECT employee_id FROM leave_requests WHERE id = $1`, [file.owner_id]);
      if (!row) return false;
      if (file.uploaded_by === actor.id || row.employee_id === actor.employee_id) return true;
      return (await this.permissions.has(actor.id, ['leave.review'])) && (await this.canSeeEmployee(actor, row.employee_id));
    }
    if (file.owner_type === 'attendance_correction') {
      const [row] = await this.ds.query(`SELECT employee_id, site_id FROM attendance_corrections WHERE id = $1`, [file.owner_id]);
      if (!row) return false;
      if (file.uploaded_by === actor.id || row.employee_id === actor.employee_id) return true;
      return (await this.permissions.has(actor.id, ['attendance.correct.propose'])) && (await this.scopes.canSeeSite(actor, row.site_id));
    }
    return false;
  }

  private async canSeeEmployee(actor: AuthUser, employeeId: string): Promise<boolean> {
    const visibility = await this.scopes.teamVisibility(actor);
    if (visibility.all) return true;
    if (!visibility.teamIds.length) return false;
    const rows = await this.ds.query(
      `SELECT 1 FROM team_members WHERE employee_id = $1 AND team_id = ANY($2::uuid[])
          AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3) LIMIT 1`,
      [employeeId, visibility.teamIds, todayLocal()],
    );
    return rows.length > 0;
  }
}
