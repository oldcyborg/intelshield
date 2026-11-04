import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { ClientsService } from '../clients/clients.service';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { FilesService, FileView } from '../files/files.service';
import { ContractLine } from './contract-line.entity';
import { ContractStatus, statusSql } from './contract-status';
import { Contract } from './contract.entity';
import { ChangePriceDto, CreateContractDto, EndPositionDto, LineInputDto, TerminateContractDto, UpdateContractDto } from './dto';

export interface LineView {
  id: string;
  position: string;
  headcount: number;
  unit: string;
  unit_price: string;
  shift_hours: string | null;
  effective_from: string;
  effective_to: string | null;
}

export interface ContractView {
  id: string;
  client_id: string;
  client_name: string;
  contract_no: string;
  signed_at: string | null;
  start_date: string;
  end_date: string;
  notice_days: number;
  auto_renew: boolean;
  state: string;
  terminated_on: string | null;
  status: ContractStatus;
  days_left: number;
  file: FileView | null;
  note: string | null;
  lines?: LineView[];
}

const CONTRACT_ROWS = `
  SELECT k.id, k.client_id, c.name AS client_name, k.contract_no, k.signed_at, k.start_date, k.end_date,
         k.notice_days, k.auto_renew, k.state, k.terminated_on, ${statusSql('k', '$2')} AS status,
         (k.end_date - $2::date) AS days_left,
         CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object(
           'id', f.id, 'original_name', f.original_name, 'mime', f.mime, 'size', f.size, 'created_at', f.created_at) END AS file,
         k.note
    FROM contracts k
    JOIN clients c ON c.id = k.client_id
    LEFT JOIN files f ON f.id = k.file_id AND f.deleted_at IS NULL
   WHERE k.tenant_id = $1 AND k.deleted_at IS NULL`;

@Injectable()
export class ContractsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly clients: ClientsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: { client_id?: string; status?: string }): Promise<ContractView[]> {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.clientVisibility(actor);
    if (!visibility.all && !visibility.clientIds.length) return [];
    const params: unknown[] = [tenantId, todayLocal()];
    let sql = CONTRACT_ROWS;
    if (!visibility.all) {
      params.push(visibility.clientIds);
      sql += ` AND k.client_id = ANY($${params.length}::uuid[])`;
    }
    if (filter.client_id) {
      params.push(filter.client_id);
      sql += ` AND k.client_id = $${params.length}`;
    }
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND ${statusSql('k', '$2')} = $${params.length}`;
    }
    return this.ds.query(`${sql} ORDER BY k.end_date, k.contract_no`, params);
  }

  async get(actor: AuthUser, id: string): Promise<ContractView> {
    const tenantId = tenantOf(actor);
    const [row]: ContractView[] = await this.ds.query(`${CONTRACT_ROWS} AND k.id = $3`, [tenantId, todayLocal(), id]);
    if (!row || !(await this.scopes.canSeeClient(actor, row.client_id))) throw new BusinessException('NOT_FOUND');
    row.lines = await this.ds.query(
      `SELECT id, position, headcount, unit, unit_price, shift_hours, effective_from, effective_to
         FROM contract_lines WHERE contract_id = $1 ORDER BY position, effective_from`,
      [id],
    );
    return row;
  }

  async create(actor: AuthUser, dto: CreateContractDto): Promise<ContractView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    assertTerm(dto.start_date, dto.end_date);
    const id = await this.ds.transaction(async (m) => {
      await this.clients.getForWrite(m, tenantId, dto.client_id);
      await this.assertNumberFree(m, tenantId, dto.contract_no, null);
      const contract = await new TenantRepository(m.getRepository(Contract)).create(tenantId, {
        client_id: dto.client_id, contract_no: dto.contract_no, signed_at: dto.signed_at ?? null,
        start_date: dto.start_date, end_date: dto.end_date, notice_days: dto.notice_days ?? 30,
        auto_renew: dto.auto_renew ?? false, state: 'draft', file_id: dto.file_id ?? null, note: dto.note ?? null,
      });
      const positions = new Set<string>();
      for (const line of dto.lines) {
        if (positions.has(line.position)) throw new BusinessException('CONTRACT_LINE_OVERLAP');
        positions.add(line.position);
        await this.insertLine(m, tenantId, contract.id, line, dto.start_date, null);
      }
      if (dto.file_id) await this.files.claim(m, tenantId, dto.file_id, { type: 'contract', id: contract.id });
      await this.log(m, actor, 'contract.create', contract.id, { contract_no: dto.contract_no, client_id: dto.client_id });
      return contract.id;
    });
    return this.get(actor, id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateContractDto): Promise<ContractView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.ds.transaction(async (m) => {
      const contract = await this.editable(m, tenantId, id);
      const start = dto.start_date ?? contract.start_date;
      const end = dto.end_date ?? contract.end_date;
      assertTerm(start, end);
      if (dto.start_date !== undefined || dto.end_date !== undefined) await this.assertLinesInside(m, id, start, end);
      if (dto.contract_no !== undefined) await this.assertNumberFree(m, tenantId, dto.contract_no, id);
      if (dto.file_id) await this.files.claim(m, tenantId, dto.file_id, { type: 'contract', id });
      await new TenantRepository(m.getRepository(Contract)).update(tenantId, id, { ...dto });
      await this.log(m, actor, 'contract.update', id, { ...dto });
    });
    return this.get(actor, id);
  }

  async terminate(actor: AuthUser, id: string, dto: TerminateContractDto): Promise<ContractView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const on = dto.terminated_on ?? todayLocal();
    await this.ds.transaction(async (m) => {
      await this.editable(m, tenantId, id);
      await m.update(Contract, { id, tenant_id: tenantId }, { state: 'terminated', terminated_on: on });
      await this.log(m, actor, 'contract.terminate', id, { terminated_on: on });
    });
    return this.get(actor, id);
  }

  /**
   * A new price for a position from `effective_from`. The line covering that day
   * ends the day before; a line that starts that very day is corrected in place;
   * a later line means history would be rewritten, so it is refused.
   */
  async changePrice(actor: AuthUser, id: string, dto: ChangePriceDto): Promise<ContractView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.ds.transaction(async (m) => {
      const contract = await this.editable(m, tenantId, id);
      if (dto.effective_from < contract.start_date || dto.effective_from > contract.end_date) {
        throw new BusinessException('CONTRACT_LINE_OUTSIDE');
      }
      const later = await m.query(
        `SELECT 1 FROM contract_lines WHERE contract_id = $1 AND position = $2 AND effective_from > $3 LIMIT 1`,
        [id, dto.position, dto.effective_from],
      );
      if (later.length) throw new BusinessException('CONTRACT_LINE_OVERLAP');
      const [covering]: { id: string; effective_from: string; effective_to: string | null }[] = await m.query(
        `SELECT id, effective_from, effective_to FROM contract_lines
          WHERE contract_id = $1 AND position = $2 AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3)`,
        [id, dto.position, dto.effective_from],
      );
      if (covering && covering.effective_from === dto.effective_from) {
        await m.update(ContractLine, { id: covering.id }, lineFields(dto));
      } else {
        if (covering) await m.update(ContractLine, { id: covering.id }, { effective_to: addDays(dto.effective_from, -1) });
        await this.insertLine(m, tenantId, id, dto, dto.effective_from, covering?.effective_to ?? null);
      }
      await this.log(m, actor, 'contract.price', id, { ...dto });
    });
    return this.get(actor, id);
  }

  async endPosition(actor: AuthUser, id: string, position: string, dto: EndPositionDto): Promise<ContractView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.ds.transaction(async (m) => {
      await this.editable(m, tenantId, id);
      const [open]: { id: string; effective_from: string }[] = await m.query(
        `SELECT id, effective_from FROM contract_lines WHERE contract_id = $1 AND position = $2 AND effective_to IS NULL`,
        [id, position],
      );
      if (!open) throw new BusinessException('NOT_FOUND');
      if (dto.last_day < open.effective_from) throw new BusinessException('CONTRACT_LINE_OUTSIDE');
      await m.update(ContractLine, { id: open.id }, { effective_to: dto.last_day });
      await this.log(m, actor, 'contract.position.end', id, { position, last_day: dto.last_day });
    });
    return this.get(actor, id);
  }

  /** For deployments: the contract belongs to the client and is signed and in force on `date`. */
  async activeOn(m: EntityManager, tenantId: string, contractId: string, clientId: string, date: string): Promise<boolean> {
    const rows = await m.query(
      `SELECT 1 FROM contracts WHERE id = $1 AND tenant_id = $2 AND client_id = $3 AND deleted_at IS NULL
          AND state = 'signed' AND start_date <= $4 AND end_date >= $4`,
      [contractId, tenantId, clientId, date],
    );
    return rows.length > 0;
  }

  /** Locks the contract row: term and price-line changes on one contract run one at a time. */
  private async editable(m: EntityManager, tenantId: string, id: string): Promise<Contract> {
    await m.query(`SELECT id FROM contracts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    const contract = await new TenantRepository(m.getRepository(Contract)).get(tenantId, id);
    if (contract.state === 'terminated') throw new BusinessException('CONTRACT_NOT_EDITABLE');
    return contract;
  }

  private async insertLine(m: EntityManager, tenantId: string, contractId: string, line: LineInputDto, from: string, to: string | null) {
    await m.save(
      m.create(ContractLine, { tenant_id: tenantId, contract_id: contractId, ...lineFields(line), effective_from: from, effective_to: to }),
    );
  }

  private async assertLinesInside(m: EntityManager, contractId: string, start: string, end: string) {
    const outside = await m.query(
      `SELECT 1 FROM contract_lines WHERE contract_id = $1 AND (effective_from < $2 OR effective_from > $3 OR effective_to > $3) LIMIT 1`,
      [contractId, start, end],
    );
    if (outside.length) throw new BusinessException('CONTRACT_LINE_OUTSIDE');
  }

  private async assertNumberFree(m: EntityManager, tenantId: string, no: string, exceptId: string | null) {
    const rows = await m.query(
      `SELECT 1 FROM contracts WHERE tenant_id = $1 AND lower(contract_no) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [tenantId, no, exceptId],
    );
    if (rows.length) throw new BusinessException('CONTRACT_NO_TAKEN');
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'contract', entity_id: id, data });
  }
}

function assertTerm(start: string, end: string): void {
  if (end < start) throw new BusinessException('CONTRACT_DATES_INVALID');
}

function lineFields(line: LineInputDto) {
  return {
    position: line.position,
    headcount: line.headcount,
    unit: line.unit,
    unit_price: String(line.unit_price),
    shift_hours: line.shift_hours === undefined ? null : String(line.shift_hours),
  };
}
