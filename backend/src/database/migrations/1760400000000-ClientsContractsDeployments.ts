import { MigrationInterface, QueryRunner } from 'typeorm';

/** Which new permission each system role receives — for companies created before this migration. */
const GRANTS: [string, string][] = [
  ['admin', 'client.view'], ['admin', 'client.manage'], ['admin', 'contract.view'], ['admin', 'contract.manage'],
  ['admin', 'deployment.view'], ['admin', 'deployment.manage'],
  ['accountant', 'client.view'], ['accountant', 'client.manage'], ['accountant', 'contract.view'],
  ['accountant', 'contract.manage'], ['accountant', 'deployment.view'],
  ['hr', 'client.view'], ['hr', 'deployment.view'], ['hr', 'deployment.manage'],
  ['manager', 'client.view'], ['manager', 'deployment.view'],
];

export class ClientsContractsDeployments1760400000000 implements MigrationInterface {
  name = 'ClientsContractsDeployments1760400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        owner_type varchar(40),
        owner_id uuid,
        original_name varchar(255) NOT NULL,
        path varchar(500) NOT NULL,
        mime varchar(100) NOT NULL,
        size integer NOT NULL,
        sha256 varchar(64) NOT NULL,
        uploaded_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT files_owner_pair CHECK ((owner_type IS NULL) = (owner_id IS NULL))
      )`);

    await q.query(`
      CREATE TABLE clients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        code varchar(30) NOT NULL,
        name varchar(200) NOT NULL,
        management_mode varchar(20) NOT NULL DEFAULT 'managed' CHECK (management_mode IN ('managed', 'self_managed')),
        tax_code varchar(20),
        address varchar(300),
        contact_name varchar(200),
        contact_phone varchar(20),
        contact_email varchar(200),
        account_manager_id uuid REFERENCES users(id),
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX clients_tenant_code_uq ON clients (tenant_id, lower(code)) WHERE deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        client_id uuid NOT NULL REFERENCES clients(id),
        contract_no varchar(50) NOT NULL,
        signed_at date,
        start_date date NOT NULL,
        end_date date NOT NULL,
        notice_days integer NOT NULL DEFAULT 30 CHECK (notice_days BETWEEN 0 AND 365),
        auto_renew boolean NOT NULL DEFAULT false,
        state varchar(20) NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'signed', 'terminated')),
        terminated_on date,
        file_id uuid REFERENCES files(id),
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT contracts_dates CHECK (end_date >= start_date),
        CONSTRAINT contracts_terminated CHECK ((state = 'terminated') = (terminated_on IS NOT NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX contracts_tenant_no_uq ON contracts (tenant_id, lower(contract_no)) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX contracts_client_idx ON contracts (client_id)`);

    await q.query(`
      CREATE TABLE contract_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        contract_id uuid NOT NULL REFERENCES contracts(id),
        position varchar(50) NOT NULL,
        headcount integer NOT NULL CHECK (headcount > 0),
        unit varchar(20) NOT NULL CHECK (unit IN ('per_guard_month', 'per_shift', 'per_hour')),
        unit_price numeric(14, 0) NOT NULL CHECK (unit_price >= 0),
        shift_hours numeric(4, 1),
        effective_from date NOT NULL,
        effective_to date,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT contract_lines_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
        CONSTRAINT contract_lines_no_overlap EXCLUDE USING gist (
          contract_id WITH =, position WITH =, daterange(effective_from, effective_to, '[]') WITH &&
        )
      )`);

    await q.query(`
      CREATE TABLE deployments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        client_id uuid NOT NULL REFERENCES clients(id),
        contract_id uuid REFERENCES contracts(id),
        position varchar(50) NOT NULL DEFAULT 'guard',
        start_date date NOT NULL,
        end_date date,
        end_reason varchar(200),
        note text,
        created_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT deployments_dates CHECK (end_date IS NULL OR end_date >= start_date),
        CONSTRAINT deployments_no_overlap EXCLUDE USING gist (
          employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&
        )
      )`);
    await q.query(`CREATE INDEX deployments_client_idx ON deployments (client_id)`);

    await q.query(`
      CREATE TABLE employee_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        kind varchar(30) NOT NULL CHECK (kind IN ('national_id', 'security_certificate', 'health_check', 'criminal_record', 'labor_contract', 'other')),
        number varchar(50),
        issued_on date,
        expires_on date,
        file_id uuid REFERENCES files(id),
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT employee_documents_dates CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
      )`);

    await q.query(`
      ALTER TABLE employees
        ADD COLUMN date_of_birth date,
        ADD COLUMN national_id varchar(20),
        ADD COLUMN address varchar(300),
        ADD COLUMN hire_date date,
        ADD COLUMN emergency_contact varchar(200),
        ADD COLUMN note text`);

    for (const [code, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL
         ON CONFLICT DO NOTHING`,
        [code, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE ANY (ARRAY['client.%','contract.%','deployment.%'])`);
    await q.query(`ALTER TABLE employees DROP COLUMN date_of_birth, DROP COLUMN national_id, DROP COLUMN address,
                   DROP COLUMN hire_date, DROP COLUMN emergency_contact, DROP COLUMN note`);
    for (const table of ['employee_documents', 'deployments', 'contract_lines', 'contracts', 'clients', 'files']) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
