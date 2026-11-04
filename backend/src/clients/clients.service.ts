import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { normalizePhone } from '../common/identifiers';
import { TenantRepository } from '../common/tenant-repository';
import { Client } from './client.entity';
import { CreateClientDto, UpdateClientDto } from './dto';

export interface ClientView {
  id: string;
  code: string;
  name: string;
  management_mode: 'managed' | 'self_managed';
  tax_code: string | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  account_manager_id: string | null;
  account_manager_name: string | null;
  status: 'active' | 'inactive';
  note: string | null;
  guards_today: number;
  active_contracts: number;
}

const CLIENT_ROWS = `
  SELECT c.id, c.code, c.name, c.management_mode, c.tax_code, c.address, c.contact_name, c.contact_phone,
         c.contact_email, c.account_manager_id, u.full_name AS account_manager_name, c.status, c.note,
         (SELECT count(*)::int FROM deployments d
           WHERE d.client_id = c.id AND d.start_date <= $2 AND (d.end_date IS NULL OR d.end_date >= $2)) AS guards_today,
         (SELECT count(*)::int FROM contracts k
           WHERE k.client_id = c.id AND k.deleted_at IS NULL AND k.state = 'signed'
             AND k.start_date <= $2 AND k.end_date >= $2) AS active_contracts
    FROM clients c
    LEFT JOIN users u ON u.id = c.account_manager_id
   WHERE c.tenant_id = $1 AND c.deleted_at IS NULL`;

@Injectable()
export class ClientsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser): Promise<ClientView[]> {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.clientVisibility(actor);
    if (visibility.all) return this.ds.query(`${CLIENT_ROWS} ORDER BY c.name`, [tenantId, todayLocal()]);
    if (!visibility.clientIds.length) return [];
    return this.ds.query(`${CLIENT_ROWS} AND c.id = ANY($3::uuid[]) ORDER BY c.name`, [tenantId, todayLocal(), visibility.clientIds]);
  }

  async get(actor: AuthUser, id: string): Promise<ClientView> {
    const tenantId = tenantOf(actor);
    const [row]: ClientView[] = await this.ds.query(`${CLIENT_ROWS} AND c.id = $3`, [tenantId, todayLocal(), id]);
    if (!row || !(await this.scopes.canSeeClient(actor, id))) throw new BusinessException('NOT_FOUND');
    return row;
  }

  async create(actor: AuthUser, dto: CreateClientDto): Promise<ClientView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.assertCodeFree(tenantId, dto.code, null);
    if (dto.account_manager_id) await this.assertOfficeUser(tenantId, dto.account_manager_id);
    const saved = await this.repo().create(tenantId, {
      ...dto,
      management_mode: dto.management_mode ?? 'managed',
      contact_phone: dto.contact_phone ? normalizePhone(dto.contact_phone) : null,
    });
    await this.log(actor, 'client.create', saved.id, { code: dto.code });
    return this.get(actor, saved.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateClientDto): Promise<ClientView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.repo().get(tenantId, id);
    if (dto.code !== undefined) await this.assertCodeFree(tenantId, dto.code, id);
    if (dto.account_manager_id) await this.assertOfficeUser(tenantId, dto.account_manager_id);
    const patch: DeepPartial<Client> = { ...dto };
    if (dto.contact_phone !== undefined) patch.contact_phone = dto.contact_phone ? normalizePhone(dto.contact_phone) : null;
    await this.repo().update(tenantId, id, patch);
    await this.log(actor, 'client.update', id, { ...dto });
    return this.get(actor, id);
  }

  /** For other modules writing under a client: same tenant, not deleted. */
  async getForWrite(m: EntityManager, tenantId: string, id: string): Promise<Client> {
    return new TenantRepository(m.getRepository(Client)).get(tenantId, id);
  }

  private repo() {
    return new TenantRepository(this.ds.getRepository(Client));
  }

  private async assertCodeFree(tenantId: string, code: string, exceptId: string | null) {
    const rows = await this.ds.query(
      `SELECT 1 FROM clients WHERE tenant_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [tenantId, code, exceptId],
    );
    if (rows.length) throw new BusinessException('CLIENT_CODE_TAKEN');
  }

  private async assertOfficeUser(tenantId: string, userId: string) {
    const rows = await this.ds.query(
      `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND user_type = 'staff' AND status = 'active' AND deleted_at IS NULL`,
      [userId, tenantId],
    );
    if (!rows.length) throw new BusinessException('NOT_FOUND');
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'client', entity_id: id, data });
  }
}
