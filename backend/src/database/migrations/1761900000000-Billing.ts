import { MigrationInterface, QueryRunner } from 'typeorm';

export class Billing1761900000000 implements MigrationInterface {
  name = 'Billing1761900000000';

  async up(q: QueryRunner): Promise<void> {
    // Printed on each payment request: the company's bank account and how to pay.
    await q.query(`ALTER TABLE finance_settings ADD COLUMN payment_info text`);

    // One client contract, one month: what it costs by the contract, less what went unguarded, plus extras.
    await q.query(`
      CREATE TABLE billing_statements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        client_id uuid NOT NULL REFERENCES clients(id),
        contract_id uuid NOT NULL REFERENCES contracts(id),
        month date NOT NULL CHECK (extract(day FROM month) = 1),
        status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued')),
        code varchar(30),
        vat_rate numeric(5,2) NOT NULL DEFAULT 10 CHECK (vat_rate >= 0 AND vat_rate <= 100),
        subtotal numeric(15,0) NOT NULL DEFAULT 0,
        vat_amount numeric(15,0) NOT NULL DEFAULT 0,
        total numeric(15,0) NOT NULL DEFAULT 0,
        computed_at timestamptz,
        issued_on date,
        issued_by uuid REFERENCES users(id),
        due_date date,
        note text,
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT billing_statements_month_uq UNIQUE (contract_id, month),
        CONSTRAINT billing_statements_code_uq UNIQUE (tenant_id, code)
      )`);
    await q.query(`CREATE INDEX billing_statements_client ON billing_statements (tenant_id, client_id, month)`);

    await q.query(`
      CREATE TABLE billing_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        statement_id uuid NOT NULL REFERENCES billing_statements(id) ON DELETE CASCADE,
        kind varchar(10) NOT NULL CHECK (kind IN ('contract', 'shortfall', 'extra')),
        description varchar(300) NOT NULL,
        quantity numeric(10,2),
        unit varchar(20),
        unit_price numeric(15,0),
        amount numeric(15,0) NOT NULL,
        applied boolean NOT NULL DEFAULT true,
        note text,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        sort int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX billing_lines_statement ON billing_lines (statement_id, sort)`);

    await q.query(`
      CREATE TABLE billing_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        statement_id uuid NOT NULL REFERENCES billing_statements(id),
        paid_on date NOT NULL,
        amount numeric(15,0) NOT NULL CHECK (amount > 0),
        method varchar(20) NOT NULL CHECK (method IN ('transfer', 'cash', 'other')),
        reference varchar(100),
        note text,
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid REFERENCES users(id),
        delete_reason text
      )`);
    await q.query(`CREATE INDEX billing_payments_statement ON billing_payments (statement_id) WHERE deleted_at IS NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE billing_payments`);
    await q.query(`DROP TABLE billing_lines`);
    await q.query(`DROP TABLE billing_statements`);
    await q.query(`ALTER TABLE finance_settings DROP COLUMN payment_info`);
  }
}
