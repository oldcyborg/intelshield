import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { normalizePhone } from '../common/identifiers';
import { TenantRepository } from '../common/tenant-repository';
import { FilesService, FileView } from '../files/files.service';
import { CreateDocumentDto, CreateEmployeeDto, UpdateDocumentDto, UpdateEmployeeDto } from './dto';
import { DocumentKind, EmployeeDocument } from './employee-document.entity';
import { Employee } from './employee.entity';

export interface EmployeeView {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  position: string;
  status: 'active' | 'inactive';
  team: { id: string; name: string } | null;
}

export interface DocumentView {
  id: string;
  kind: DocumentKind;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  days_left: number | null;
  file: FileView | null;
  note: string | null;
}

export interface EmployeeProfile extends EmployeeView {
  date_of_birth: string | null;
  national_id: string | null;
  address: string | null;
  hire_date: string | null;
  emergency_contact: string | null;
  note: string | null;
  documents: DocumentView[];
}

const DOCUMENT_ROWS = `
  SELECT d.id, d.kind, d.number, d.issued_on, d.expires_on,
         CASE WHEN d.expires_on IS NULL THEN NULL ELSE (d.expires_on - $3::date) END AS days_left,
         CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object(
           'id', f.id, 'original_name', f.original_name, 'mime', f.mime, 'size', f.size, 'created_at', f.created_at) END AS file,
         d.note
    FROM employee_documents d
    LEFT JOIN files f ON f.id = d.file_id AND f.deleted_at IS NULL
   WHERE d.tenant_id = $1 AND d.deleted_at IS NULL`;

/**
 * Someone who leaves stops counting at every client from today: open postings end
 * yesterday, postings that had not started yet are dropped.
 */
async function endPostingsOnLeave(m: EntityManager, employeeId: string): Promise<void> {
  const today = todayLocal();
  await m.query(`DELETE FROM deployments WHERE employee_id = $1 AND start_date >= $2`, [employeeId, today]);
  await m.query(
    `UPDATE deployments SET end_date = $2, end_reason = 'Nghỉ việc', updated_at = now()
      WHERE employee_id = $1 AND (end_date IS NULL OR end_date >= $3)`,
    [employeeId, addDays(today, -1), today],
  );
}

function assertDocumentDates(issued: string | null, expires: string | null): void {
  if (issued && expires && expires < issued) {
    throw new BusinessException('VALIDATION_FAILED', ['expires_on: ngày hết hạn phải sau ngày cấp']);
  }
}

/** "Currently a member of one of these teams", as a filter on alias `e`. */
const IN_VISIBLE_TEAMS = `EXISTS (
  SELECT 1 FROM team_members tm
   WHERE tm.employee_id = e.id AND tm.team_id IN (:...teamIds)
     AND tm.start_date <= :today AND (tm.end_date IS NULL OR tm.end_date >= :today))`;

@Injectable()
export class EmployeesService {
  private readonly repo: TenantRepository<Employee>;

  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {
    this.repo = new TenantRepository(ds.getRepository(Employee));
  }

  async list(actor: AuthUser): Promise<EmployeeView[]> {
    const qb = await this.visibleQuery(actor);
    if (!qb) return [];
    return this.withTeams(await qb.orderBy('e.full_name', 'ASC').getMany());
  }

  /** 404 both for another company's employee and for one outside the caller's teams. */
  async get(actor: AuthUser, id: string): Promise<EmployeeView> {
    const qb = await this.visibleQuery(actor);
    const employee = qb ? await qb.andWhere('e.id = :id', { id }).getOne() : null;
    if (!employee) throw new BusinessException('NOT_FOUND');
    return (await this.withTeams([employee]))[0];
  }

  async create(actor: AuthUser, dto: CreateEmployeeDto): Promise<EmployeeView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.assertCodeFree(tenantId, dto.code, null);
    const employee = await this.repo.create(tenantId, {
      code: dto.code,
      full_name: dto.full_name,
      phone: dto.phone ? normalizePhone(dto.phone) : null,
      position: dto.position ?? 'guard',
      date_of_birth: dto.date_of_birth ?? null,
      national_id: dto.national_id ?? null,
      address: dto.address ?? null,
      hire_date: dto.hire_date ?? null,
      emergency_contact: dto.emergency_contact ?? null,
      note: dto.note ?? null,
    });
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.create', entity_type: 'employee',
      entity_id: employee.id, data: { code: dto.code },
    });
    return this.get(actor, employee.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateEmployeeDto): Promise<EmployeeView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.repo.get(tenantId, id);
    if (dto.code !== undefined) await this.assertCodeFree(tenantId, dto.code, id);
    const patch: DeepPartial<Employee> = {};
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.full_name !== undefined) patch.full_name = dto.full_name;
    if (dto.phone !== undefined) patch.phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.date_of_birth !== undefined) patch.date_of_birth = dto.date_of_birth;
    if (dto.national_id !== undefined) patch.national_id = dto.national_id;
    if (dto.address !== undefined) patch.address = dto.address;
    if (dto.hire_date !== undefined) patch.hire_date = dto.hire_date;
    if (dto.emergency_contact !== undefined) patch.emergency_contact = dto.emergency_contact;
    if (dto.note !== undefined) patch.note = dto.note;
    await this.ds.transaction(async (m) => {
      await new TenantRepository(m.getRepository(Employee)).update(tenantId, id, patch);
      if (dto.status === 'inactive') await endPostingsOnLeave(m, id);
    });
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.update', entity_type: 'employee',
      entity_id: id, data: { ...dto },
    });
    return this.get(actor, id);
  }

  /** Everything HR keeps on one person. Personal details only reach people who see the whole company. */
  async profile(actor: AuthUser, id: string): Promise<EmployeeProfile> {
    const base = await this.get(actor, id);
    const full = await this.repo.get(tenantOf(actor), id);
    const personal = await this.scopes.hasTenantScope(actor);
    // Document numbers and scans are as personal as the ID number itself: a team's leader learns
    // which papers exist and when they expire, not what is on them.
    const documents = (await this.documents(tenantOf(actor), id)).map((d) =>
      personal ? d : { ...d, number: null, file: null },
    );
    return {
      ...base,
      date_of_birth: personal ? full.date_of_birth : null,
      national_id: personal ? full.national_id : null,
      address: personal ? full.address : null,
      emergency_contact: personal ? full.emergency_contact : null,
      hire_date: full.hire_date,
      note: full.note,
      documents,
    };
  }

  async addDocument(actor: AuthUser, employeeId: string, dto: CreateDocumentDto): Promise<DocumentView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.repo.get(tenantId, employeeId);
    assertDocumentDates(dto.issued_on ?? null, dto.expires_on ?? null);
    const id = await this.ds.transaction(async (m) => {
      const doc = await new TenantRepository(m.getRepository(EmployeeDocument)).create(tenantId, {
        employee_id: employeeId, kind: dto.kind, number: dto.number ?? null, issued_on: dto.issued_on ?? null,
        expires_on: dto.expires_on ?? null, file_id: dto.file_id ?? null, note: dto.note ?? null,
      });
      if (dto.file_id) await this.files.claim(m, tenantId, dto.file_id, { type: 'employee_document', id: doc.id });
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.document.add', entity_type: 'employee',
        entity_id: employeeId, data: { kind: dto.kind, document_id: doc.id },
      });
      return doc.id;
    });
    return this.document(tenantId, employeeId, id);
  }

  async updateDocument(actor: AuthUser, employeeId: string, docId: string, dto: UpdateDocumentDto): Promise<DocumentView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const docs = new TenantRepository(this.ds.getRepository(EmployeeDocument));
    const doc = await docs.get(tenantId, docId);
    if (doc.employee_id !== employeeId) throw new BusinessException('NOT_FOUND');
    assertDocumentDates(
      dto.issued_on !== undefined ? dto.issued_on : doc.issued_on,
      dto.expires_on !== undefined ? dto.expires_on : doc.expires_on,
    );
    await this.ds.transaction(async (m) => {
      await new TenantRepository(m.getRepository(EmployeeDocument)).update(tenantId, docId, { ...dto });
      if (dto.file_id) await this.files.claim(m, tenantId, dto.file_id, { type: 'employee_document', id: docId });
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.document.update', entity_type: 'employee',
        entity_id: employeeId, data: { document_id: docId, ...dto },
      });
    });
    return this.document(tenantId, employeeId, docId);
  }

  async removeDocument(actor: AuthUser, employeeId: string, docId: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const docs = new TenantRepository(this.ds.getRepository(EmployeeDocument));
    const doc = await docs.get(tenantId, docId);
    if (doc.employee_id !== employeeId) throw new BusinessException('NOT_FOUND');
    await docs.softDelete(tenantId, docId);
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.document.remove', entity_type: 'employee',
      entity_id: employeeId, data: { document_id: docId },
    });
    return { ok: true };
  }

  /**
   * A person's own papers — above all their labour contract. Theirs to read in full, number and scan included:
   * what the profile hides from a team leader is hidden from other people, not from the person it describes.
   */
  async myDocuments(actor: AuthUser): Promise<DocumentView[]> {
    if (!actor.employee_id) return [];
    return this.documents(tenantOf(actor), actor.employee_id);
  }

  private async documents(tenantId: string, employeeId: string): Promise<DocumentView[]> {
    return this.ds.query(`${DOCUMENT_ROWS} AND d.employee_id = $2 ORDER BY d.expires_on NULLS LAST, d.created_at`, [
      tenantId, employeeId, todayLocal(),
    ]);
  }

  private async document(tenantId: string, employeeId: string, id: string): Promise<DocumentView> {
    const [row] = await this.ds.query(`${DOCUMENT_ROWS} AND d.employee_id = $2 AND d.id = $4`, [tenantId, employeeId, todayLocal(), id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private async visibleQuery(actor: AuthUser) {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.teamVisibility(actor);
    const qb = this.ds.getRepository(Employee).createQueryBuilder('e').where('e.tenant_id = :tenantId', { tenantId });
    if (visibility.all) return qb;
    if (!visibility.teamIds.length) return null;
    return qb.andWhere(IN_VISIBLE_TEAMS, { teamIds: visibility.teamIds, today: todayLocal() });
  }

  private async assertCodeFree(tenantId: string, code: string, exceptId: string | null): Promise<void> {
    const qb = this.ds
      .getRepository(Employee)
      .createQueryBuilder('e')
      .where('e.tenant_id = :tenantId AND lower(e.code) = lower(:code)', { tenantId, code });
    if (exceptId) qb.andWhere('e.id <> :exceptId', { exceptId });
    if (await qb.getExists()) throw new BusinessException('EMPLOYEE_CODE_TAKEN');
  }

  private async withTeams(employees: Employee[]): Promise<EmployeeView[]> {
    if (!employees.length) return [];
    const rows: { employee_id: string; id: string; name: string }[] = await this.ds.query(
      `SELECT tm.employee_id, t.id, t.name
         FROM team_members tm JOIN teams t ON t.id = tm.team_id
        WHERE tm.employee_id = ANY($1::uuid[]) AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)`,
      [employees.map((e) => e.id), todayLocal()],
    );
    const teamOf = new Map(rows.map((r) => [r.employee_id, { id: r.id, name: r.name }]));
    return employees.map((e) => ({
      id: e.id,
      code: e.code,
      full_name: e.full_name,
      phone: e.phone,
      position: e.position,
      status: e.status,
      team: teamOf.get(e.id) ?? null,
    }));
  }
}
