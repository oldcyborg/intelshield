import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { statusSql } from '../contracts/contract-status';

const DOCUMENT_WINDOW_DAYS = 30;

@Injectable()
export class DashboardService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
  ) {}

  async company(actor: AuthUser) {
    const tenantId = tenantOf(actor);
    const today = todayLocal();
    const visibility = await this.scopes.clientVisibility(actor);
    const held = await this.permissions.permissionsOf(actor.id);
    const clientIds = visibility.all ? null : visibility.clientIds;

    const [guards] = await this.ds.query(
      visibility.all
        ? `SELECT count(*)::int AS active,
                  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM deployments d WHERE d.employee_id = e.id
                     AND d.start_date <= $2 AND (d.end_date IS NULL OR d.end_date >= $2)))::int AS deployed
             FROM employees e WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.status = 'active'`
        : `SELECT count(DISTINCT d.employee_id)::int AS active, count(DISTINCT d.employee_id)::int AS deployed
             FROM deployments d WHERE d.tenant_id = $1 AND d.client_id = ANY($3::uuid[])
              AND d.start_date <= $2 AND (d.end_date IS NULL OR d.end_date >= $2)`,
      visibility.all ? [tenantId, today] : [tenantId, today, clientIds],
    );

    const contractFilter = clientIds ? `AND k.client_id = ANY($3::uuid[])` : '';
    const contractParams = clientIds ? [tenantId, today, clientIds] : [tenantId, today];
    const expiring = held.has('contract.view')
      ? await this.ds.query(
          `SELECT k.id, k.contract_no, k.client_id, c.name AS client_name, k.end_date, (k.end_date - $2::date) AS days_left,
                  ${statusSql('k', '$2')} AS status
             FROM contracts k JOIN clients c ON c.id = k.client_id
            WHERE k.tenant_id = $1 AND k.deleted_at IS NULL ${contractFilter}
              AND (${statusSql('k', '$2')} = 'expiring'
                   OR (${statusSql('k', '$2')} = 'expired' AND EXISTS (
                         SELECT 1 FROM deployments d WHERE d.contract_id = k.id
                            AND d.start_date <= $2 AND (d.end_date IS NULL OR d.end_date >= $2))))
            ORDER BY k.end_date`,
          contractParams,
        )
      : [];

    const shortfalls = !held.has('contract.view') ? [] : await this.ds.query(
      `SELECT c.id AS client_id, c.name AS client_name, k.id AS contract_id, k.contract_no, l.position, l.headcount,
              (SELECT count(*)::int FROM deployments d
                WHERE d.contract_id = k.id AND d.position = l.position
                  AND d.start_date <= $2 AND (d.end_date IS NULL OR d.end_date >= $2)) AS deployed
         FROM contract_lines l
         JOIN contracts k ON k.id = l.contract_id AND k.deleted_at IS NULL AND k.state = 'signed'
                         AND k.start_date <= $2 AND k.end_date >= $2
         JOIN clients c ON c.id = k.client_id
        WHERE l.tenant_id = $1 AND l.effective_from <= $2 AND (l.effective_to IS NULL OR l.effective_to >= $2) ${contractFilter}
        ORDER BY c.name, l.position`,
      contractParams,
    );

    const documents =
      held.has('employee.view') && visibility.all
        ? await this.ds.query(
            `SELECT e.id AS employee_id, e.full_name AS employee_name, d.kind, d.expires_on, (d.expires_on - $2::date) AS days_left
               FROM employee_documents d JOIN employees e ON e.id = d.employee_id
              WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND e.deleted_at IS NULL AND e.status = 'active'
                AND d.expires_on IS NOT NULL AND d.expires_on <= $2::date + $3::int
              ORDER BY d.expires_on`,
            [tenantId, today, DOCUMENT_WINDOW_DAYS],
          )
        : [];

    return {
      guards: { active: guards.active, deployed: guards.deployed, idle: guards.active - guards.deployed },
      expiring_contracts: expiring,
      shortfalls: shortfalls.filter((s: { deployed: number; headcount: number }) => s.deployed < s.headcount),
      expiring_documents: documents,
    };
  }
}
