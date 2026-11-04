import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { ClientsService } from '../clients/clients.service';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { ContractsService } from '../contracts/contracts.service';
import { CreateDeploymentDto, DeploymentFilter, EndDeploymentDto } from './dto';
import { Deployment } from './deployment.entity';

export interface DeploymentView {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  client_id: string;
  client_name: string;
  contract_id: string | null;
  contract_no: string | null;
  position: string;
  start_date: string;
  end_date: string | null;
  end_reason: string | null;
  note: string | null;
}

const DEPLOYMENT_ROWS = `
  SELECT d.id, d.employee_id, e.code AS employee_code, e.full_name AS employee_name, d.client_id, c.name AS client_name,
         d.contract_id, k.contract_no, d.position, d.start_date, d.end_date, d.end_reason, d.note
    FROM deployments d
    JOIN employees e ON e.id = d.employee_id
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN contracts k ON k.id = d.contract_id
   WHERE d.tenant_id = $1`;

interface Posting {
  id: string;
  client_id: string;
  start_date: string;
}

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly clients: ClientsService,
    private readonly contracts: ContractsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: DeploymentFilter): Promise<DeploymentView[]> {
    const tenantId = tenantOf(actor);
    const params: unknown[] = [tenantId];
    let sql = DEPLOYMENT_ROWS;
    const [clients, teams] = await Promise.all([this.scopes.clientVisibility(actor), this.scopes.teamVisibility(actor)]);
    if (!clients.all) {
      // Visible because the client is, or because the guard is in a team the caller sees today.
      params.push(clients.clientIds, teams.all ? [] : teams.teamIds, todayLocal());
      sql += ` AND (d.client_id = ANY($2::uuid[]) OR EXISTS (
                 SELECT 1 FROM team_members tm WHERE tm.employee_id = d.employee_id AND tm.team_id = ANY($3::uuid[])
                    AND tm.start_date <= $4 AND (tm.end_date IS NULL OR tm.end_date >= $4)))`;
    }
    if (filter.client_id) {
      params.push(filter.client_id);
      sql += ` AND d.client_id = $${params.length}`;
    }
    if (filter.employee_id) {
      params.push(filter.employee_id);
      sql += ` AND d.employee_id = $${params.length}`;
    }
    if (filter.on) {
      params.push(filter.on);
      sql += ` AND d.start_date <= $${params.length} AND (d.end_date IS NULL OR d.end_date >= $${params.length})`;
    }
    return this.ds.query(`${sql} ORDER BY d.start_date DESC, e.full_name`, params);
  }

  /**
   * Posts a guard to a client from `start_date`. An open posting elsewhere ends
   * the day before; one that starts the same day is corrected; later postings
   * are never rewritten.
   */
  async create(actor: AuthUser, dto: CreateDeploymentDto): Promise<DeploymentView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const startDate = dto.start_date ?? todayLocal();

    const id = await this.ds.transaction(async (m) => {
      const client = await this.clients.getForWrite(m, tenantId, dto.client_id);
      const [employee]: { id: string; status: string }[] = await m.query(
        `SELECT id, status FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [dto.employee_id, tenantId],
      );
      if (!employee) throw new BusinessException('NOT_FOUND');
      if (employee.status !== 'active') throw new BusinessException('EMPLOYEE_INACTIVE');
      if (dto.contract_id && !(await this.contracts.activeOn(m, tenantId, dto.contract_id, client.id, startDate))) {
        throw new BusinessException('DEPLOYMENT_CONTRACT_MISMATCH');
      }

      const later = await m.query(`SELECT 1 FROM deployments WHERE employee_id = $1 AND start_date > $2 LIMIT 1`, [employee.id, startDate]);
      if (later.length) throw new BusinessException('DEPLOYMENT_OVERLAP');
      const current = await this.postingOn(m, employee.id, startDate);

      const fields = {
        client_id: client.id,
        contract_id: dto.contract_id ?? null,
        position: dto.position ?? 'guard',
        note: dto.note ?? null,
      };
      let postingId: string;
      if (current && current.start_date === startDate) {
        await m.update(Deployment, { id: current.id }, fields);
        postingId = current.id;
      } else {
        if (current) {
          await m.update(Deployment, { id: current.id }, { end_date: addDays(startDate, -1), end_reason: `Chuyển sang ${client.name}` });
        }
        const saved = await m.save(
          m.create(Deployment, { tenant_id: tenantId, employee_id: employee.id, start_date: startDate, end_date: null, created_by: actor.id, ...fields }),
        );
        postingId = saved.id;
      }
      await this.log(m, actor, 'deployment.create', postingId, { employee_id: employee.id, client_id: client.id, start_date: startDate });
      return postingId;
    });
    return this.one(tenantId, id);
  }

  async end(actor: AuthUser, id: string, dto: EndDeploymentDto): Promise<DeploymentView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.ds.transaction(async (m) => {
      const posting = await this.posting(m, tenantId, id);
      if (dto.last_day < posting.start_date) {
        throw new BusinessException('VALIDATION_FAILED', ['last_day: không được trước ngày bắt đầu điều động']);
      }
      const later = await m.query(`SELECT 1 FROM deployments WHERE employee_id = $1 AND start_date > $2 AND id <> $3 LIMIT 1`, [
        posting.employee_id, posting.start_date, id,
      ]);
      if (later.length) throw new BusinessException('DEPLOYMENT_OVERLAP');
      await m.update(Deployment, { id }, { end_date: dto.last_day, end_reason: dto.reason ?? null });
      await this.log(m, actor, 'deployment.end', id, { ...dto });
    });
    return this.one(tenantId, id);
  }

  /** Only a posting that has not started yet can be taken back; anything else is history and gets an end date. */
  async cancel(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.ds.transaction(async (m) => {
      const posting = await this.posting(m, tenantId, id);
      if (posting.start_date <= todayLocal()) throw new BusinessException('DEPLOYMENT_STARTED');
      const [client] = await m.query(`SELECT name FROM clients WHERE id = $1`, [posting.client_id]);
      await m.delete(Deployment, { id });
      // The transfer had ended the previous posting the day before; give it back.
      await m.query(
        `UPDATE deployments SET end_date = NULL, end_reason = NULL, updated_at = now()
          WHERE employee_id = $1 AND end_date = $2 AND end_reason = $3`,
        [posting.employee_id, addDays(posting.start_date, -1), `Chuyển sang ${client?.name}`],
      );
      await this.log(m, actor, 'deployment.cancel', id, { employee_id: posting.employee_id, client_id: posting.client_id });
    });
    return { ok: true };
  }

  private async posting(m: EntityManager, tenantId: string, id: string): Promise<Deployment> {
    const posting = await m.findOneBy(Deployment, { id, tenant_id: tenantId });
    if (!posting) throw new BusinessException('NOT_FOUND');
    return posting;
  }

  private async postingOn(m: EntityManager, employeeId: string, date: string): Promise<Posting | null> {
    const [row]: Posting[] = await m.query(
      `SELECT id, client_id, start_date FROM deployments
        WHERE employee_id = $1 AND start_date <= $2 AND (end_date IS NULL OR end_date >= $2)`,
      [employeeId, date],
    );
    return row ?? null;
  }

  private async one(tenantId: string, id: string): Promise<DeploymentView> {
    const [row] = await this.ds.query(`${DEPLOYMENT_ROWS} AND d.id = $2`, [tenantId, id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'deployment', entity_id: id, data });
  }
}
