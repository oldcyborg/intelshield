# Plan 02 — Khách hàng, hợp đồng, điều động bảo vệ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Công ty quản lý được khách hàng, hồ sơ nhân viên đầy đủ (giấy tờ, chứng chỉ có hạn), hợp đồng với các dòng giá theo kỳ, biết hợp đồng nào sắp hết hạn, và điều động bảo vệ tới khách — xem được "khách X đang có ai", "anh Y đang ở đâu", khách nào thiếu người so với hợp đồng.

**Architecture:** Thêm vào backend NestJS của Plan 01 năm module (`files`, `clients`, `contracts`, `deployments`, `dashboard`) và mở rộng `employees`. Mọi bảng mới có `tenant_id` lấy từ token. Trạng thái hợp đồng (`upcoming/active/expiring/expired`) **tính khi đọc** từ ngày tháng — không có job nền nào có thể quên chạy. Lịch sử giá và lịch sử điều động là các khoảng ngày; PostgreSQL từ chối khoảng chồng nhau (`EXCLUDE USING gist`), giống `team_members`.

**Tech Stack:** như Plan 01 (NestJS 11, TypeORM 0.3, PostgreSQL 16 + btree_gist, Next.js 14). Thêm `@types/multer` cho upload.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` — plan này làm **§9 bước 2**: §4.1a (`contracts`, `contract_lines`, `deployments`), `clients` (§4.2), `files` (§4.5), §5.3 C1–C4, C8.

**Dựa trên code thật của Plan 01** (đã chạy, 64 test xanh): `TenantRepository`, `ScopeService`, `AccessService`, `AuditService`, `BusinessException` + `ERROR_CODES`, `todayLocal/addDays`, helpers test `createTestApp/createTenantWithAdmin/createUserWithRoles/client/uniquePhone`.

**Khác với spec (có chủ đích):**
- Thông báo hợp đồng sắp hết hạn 30/15/7/1 ngày cần hạ tầng push (Plan 05). Ở đây: trạng thái `expiring` + danh sách trên dashboard công ty, đủ để không ai bị bất ngờ.
- `auto_renew` chỉ là cờ hiển thị; gia hạn = sửa `end_date` (có nhật ký). Tự sinh hợp đồng mới khi hết hạn là việc nghiệp vụ chưa chốt.
- `deployments.site_id` để Plan 03 (khi có bảng `sites`).
- Phản ánh của khách (C5) và sự cố khách báo (C6) đi cùng Plan 05 (sự cố), theo §9.

## Global Constraints

- Mọi quy ước của Plan 01 giữ nguyên: `{data}` / `{error:{code,message}}`, tenant chỉ từ token, guard mặc định đóng, không rẽ nhánh theo mã vai trò, ghi `audit_logs` cho thao tác ghi.
- Tiền là `numeric(14,0)` VND, trả về API dạng **chuỗi số** (`"8500000"`) — không bao giờ qua `float`.
- Ngày là `date` → chuỗi `YYYY-MM-DD`; "hôm nay" là `todayLocal()` (giờ Việt Nam).
- File upload: tối đa 10 MB; chỉ PDF, JPEG, PNG, nhận diện bằng **nội dung** (magic bytes), không tin đuôi file hay `Content-Type`; lưu `UPLOAD_DIR/<tenant>/<yyyy>/<mm>/<uuid>.<ext>`; tải về chỉ qua API có kiểm quyền — không có đường dẫn tĩnh.
- Quyền mới thêm vào vai trò hệ thống của **cả công ty đã tồn tại** bằng migration, không chỉ công ty mới.

## Review Focus

1. **Giá đổi giữa kỳ**: đổi giá ngày 15 khi dòng cũ hiệu lực từ ngày 1 → dòng cũ kết thúc ngày 14, dòng mới từ ngày 15, không chồng, không hở; đổi giá trước ngày bắt đầu của dòng hiện tại → bị từ chối — test ở Task 5.
2. **Điều động trùng**: một bảo vệ không thể đang ở hai khách cùng ngày; chuyển khách giữa chừng kết thúc điều động cũ đúng ngày hôm trước; nhân viên nghỉ việc không điều động được — test ở Task 6.
3. **Hợp đồng sát mốc**: ngày kết thúc là hôm nay vẫn là "đang hiệu lực/sắp hết hạn", ngày mai mới "hết hạn"; `notice_days = 0`; hợp đồng chưa bắt đầu — test ở Task 5.
4. **File giả dạng**: file `.pdf` thực chất là HTML/EXE bị từ chối; tải file của công ty khác hoặc của hợp đồng mình không được xem → 404 — test ở Task 2.
5. **Phạm vi khách hàng**: người có phạm vi một khách chỉ thấy khách đó, hợp đồng và điều động của khách đó; quản lý đội thấy khách nơi người trong đội mình đang làm — test ở Task 3 và Task 6.

---

## File Structure

```
backend/src/database/migrations/1760400000000-ClientsContractsDeployments.ts
backend/src/access/permissions.ts            + client.*, contract.*, deployment.*
backend/src/access/scope.service.ts          + clientVisibility, canSeeClient
backend/src/access/access.service.ts         + scope 'client'
backend/src/users/dto.ts                     + 'client' trong ScopeInputDto
backend/src/files/      file.entity, files.service, files.controller, file-type.ts (+spec), module
backend/src/clients/    client.entity, clients.service, clients.controller, dto, module
backend/src/employees/  + employee-document.entity, documents trong service/controller, dto mở rộng
backend/src/contracts/  contract.entity, contract-line.entity, contract-status.ts (+spec),
                        contracts.service, contracts.controller, dto, module
backend/src/deployments/ deployment.entity, deployments.service, deployments.controller, dto, module
backend/src/dashboard/  dashboard.service, dashboard.controller, module
backend/test/           files, clients, employee-profile, contracts, deployments, dashboard, tenancy-02 .e2e-spec.ts
web/src/app/(app)/khach-hang/page.tsx, khach-hang/[id]/page.tsx, hop-dong/page.tsx,
                  nhan-vien/[id]/page.tsx, page.tsx (dashboard)
web/src/lib/types.ts, web/src/lib/format.ts, web/src/components/shell.tsx
```

---

### Task 1: Schema, quyền mới, phạm vi khách hàng

**Files:**
- Create: `backend/src/database/migrations/1760400000000-ClientsContractsDeployments.ts`
- Create: `backend/src/files/file.entity.ts`, `backend/src/clients/client.entity.ts`, `backend/src/contracts/contract.entity.ts`, `backend/src/contracts/contract-line.entity.ts`, `backend/src/deployments/deployment.entity.ts`, `backend/src/employees/employee-document.entity.ts`
- Modify: `backend/src/employees/employee.entity.ts`, `backend/src/access/permissions.ts`, `backend/src/access/scope.service.ts`, `backend/src/access/access.service.ts`, `backend/src/users/dto.ts`, `backend/src/common/errors/error-codes.ts`
- Test: `backend/test/schema-02.e2e-spec.ts`

**Interfaces:**
- Consumes: `TenantEntity`, `ScopeService.teamVisibility`, `todayLocal`.
- Produces:
  - Quyền `client.view`, `client.manage`, `contract.view`, `contract.manage`, `deployment.view`, `deployment.manage`.
  - `type ClientVisibility = { all: true } | { all: false; clientIds: string[] }`; `ScopeService.clientVisibility(user)`, `.canSeeClient(user, clientId)`.
  - Entity `FileRecord`, `Client`, `Contract`, `ContractLine`, `Deployment`, `EmployeeDocument`; `Employee` thêm `date_of_birth, national_id, address, hire_date, emergency_contact, note`.
  - `AccessService.assertCanGrant` nhận `scope_type: 'client'` (chỉ người có phạm vi toàn công ty cấp được).
  - Mã lỗi mới: `CLIENT_CODE_TAKEN`, `CONTRACT_NO_TAKEN`, `CONTRACT_DATES_INVALID`, `CONTRACT_LINE_OVERLAP`, `CONTRACT_LINE_OUTSIDE`, `CONTRACT_NOT_EDITABLE`, `DEPLOYMENT_OVERLAP`, `DEPLOYMENT_CONTRACT_MISMATCH`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `FILE_IN_USE`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/schema-02.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTenantWithAdmin, createTestApp } from './helpers';

describe('Clients/contracts/deployments schema (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  it('grants the new permissions to the system roles of companies that already existed', async () => {
    const t = await createTenantWithAdmin(app, 'sch2');
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE ANY (ARRAY['client.%','contract.%','deployment.%'])
        ORDER BY r.code, rp.permission`,
      [t.tenant.id],
    );
    const by = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission);
    expect(by('admin')).toEqual([
      'client.manage', 'client.view', 'contract.manage', 'contract.view', 'deployment.manage', 'deployment.view',
    ]);
    expect(by('accountant')).toEqual(['client.manage', 'client.view', 'contract.manage', 'contract.view', 'deployment.view']);
    expect(by('hr')).toEqual(['client.view', 'deployment.manage', 'deployment.view']);
    expect(by('manager')).toEqual(['client.view', 'deployment.view']);
    expect(by('team_leader')).toEqual([]);
  });

  it('refuses two deployments of one employee that overlap', async () => {
    const t = await createTenantWithAdmin(app, 'sch2-dep');
    const [e] = await ds.query(`INSERT INTO employees (tenant_id, code, full_name) VALUES ($1, 'E1', 'E') RETURNING id`, [t.tenant.id]);
    const [c1] = await ds.query(`INSERT INTO clients (tenant_id, code, name) VALUES ($1, 'K1', 'K1') RETURNING id`, [t.tenant.id]);
    const [c2] = await ds.query(`INSERT INTO clients (tenant_id, code, name) VALUES ($1, 'K2', 'K2') RETURNING id`, [t.tenant.id]);
    await ds.query(
      `INSERT INTO deployments (tenant_id, employee_id, client_id, start_date, end_date) VALUES ($1, $2, $3, '2026-01-01', '2026-06-30')`,
      [t.tenant.id, e.id, c1.id],
    );
    await expect(
      ds.query(`INSERT INTO deployments (tenant_id, employee_id, client_id, start_date) VALUES ($1, $2, $3, '2026-06-30')`, [
        t.tenant.id, e.id, c2.id,
      ]),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('refuses two price lines for one position that overlap in time', async () => {
    const t = await createTenantWithAdmin(app, 'sch2-line');
    const [c] = await ds.query(`INSERT INTO clients (tenant_id, code, name) VALUES ($1, 'K', 'K') RETURNING id`, [t.tenant.id]);
    const [k] = await ds.query(
      `INSERT INTO contracts (tenant_id, client_id, contract_no, start_date, end_date) VALUES ($1, $2, 'HD1', '2026-01-01', '2026-12-31') RETURNING id`,
      [t.tenant.id, c.id],
    );
    const line = (from: string, to: string | null) =>
      ds.query(
        `INSERT INTO contract_lines (tenant_id, contract_id, position, headcount, unit, unit_price, effective_from, effective_to)
         VALUES ($1, $2, 'guard', 2, 'per_guard_month', 8500000, $3, $4)`,
        [t.tenant.id, k.id, from, to],
      );
    await line('2026-01-01', '2026-03-31');
    await expect(line('2026-03-15', null)).rejects.toMatchObject({ code: '23P01' });
    await line('2026-04-01', null);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- schema-02`
Expected: FAIL — `relation "clients" does not exist`.

- [ ] **Step 3: Viết migration**

`backend/src/database/migrations/1760400000000-ClientsContractsDeployments.ts`:
```ts
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
```

- [ ] **Step 4: Viết entity**

`backend/src/files/file.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type FileOwnerType = 'contract' | 'employee_document';

@Entity('files')
export class FileRecord extends TenantEntity {
  /** null until a contract or document claims the file. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  owner_type: FileOwnerType | null;

  @Column({ type: 'uuid', nullable: true })
  owner_id: string | null;

  @Column({ length: 255 })
  original_name: string;

  @Column({ length: 500, select: false })
  path: string;

  @Column({ length: 100 })
  mime: string;

  @Column('int')
  size: number;

  @Column({ length: 64 })
  sha256: string;

  @Column({ type: 'uuid', nullable: true })
  uploaded_by: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/clients/client.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('clients')
export class Client extends TenantEntity {
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'managed' })
  management_mode: 'managed' | 'self_managed';

  @Column({ type: 'varchar', length: 20, nullable: true })
  tax_code: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact_name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  contact_phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contact_email: string | null;

  @Column({ type: 'uuid', nullable: true })
  account_manager_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/contracts/contract.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** Stored lifecycle. The date-derived status (upcoming/active/expiring/expired) is computed, see contract-status.ts. */
export type ContractState = 'draft' | 'signed' | 'terminated';

@Entity('contracts')
export class Contract extends TenantEntity {
  @Column('uuid')
  client_id: string;

  @Column({ length: 50 })
  contract_no: string;

  @Column({ type: 'date', nullable: true })
  signed_at: string | null;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column('int', { default: 30 })
  notice_days: number;

  @Column({ default: false })
  auto_renew: boolean;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  state: ContractState;

  @Column({ type: 'date', nullable: true })
  terminated_on: string | null;

  @Column({ type: 'uuid', nullable: true })
  file_id: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/contracts/contract-line.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type PriceUnit = 'per_guard_month' | 'per_shift' | 'per_hour';

/** One price for one position over one period. A price change closes this row and opens another. */
@Entity('contract_lines')
export class ContractLine extends TenantEntity {
  @Column('uuid')
  contract_id: string;

  @Column({ length: 50 })
  position: string;

  @Column('int')
  headcount: number;

  @Column({ type: 'varchar', length: 20 })
  unit: PriceUnit;

  /** numeric comes back from pg as a string; keep it that way — money never goes through float. */
  @Column({ type: 'numeric', precision: 14, scale: 0 })
  unit_price: string;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  shift_hours: string | null;

  @Column({ type: 'date' })
  effective_from: string;

  @Column({ type: 'date', nullable: true })
  effective_to: string | null;
}
```

`backend/src/deployments/deployment.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** A guard working at a client from start_date to end_date (inclusive; null = open). No overlaps per guard. */
@Entity('deployments')
export class Deployment extends TenantEntity {
  @Column('uuid')
  employee_id: string;

  @Column('uuid')
  client_id: string;

  @Column({ type: 'uuid', nullable: true })
  contract_id: string | null;

  @Column({ length: 50, default: 'guard' })
  position: string;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  end_reason: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;
}
```

`backend/src/employees/employee-document.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const DOCUMENT_KINDS = [
  'national_id', 'security_certificate', 'health_check', 'criminal_record', 'labor_contract', 'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

@Entity('employee_documents')
export class EmployeeDocument extends TenantEntity {
  @Column('uuid')
  employee_id: string;

  @Column({ type: 'varchar', length: 30 })
  kind: DocumentKind;

  @Column({ type: 'varchar', length: 50, nullable: true })
  number: string | null;

  @Column({ type: 'date', nullable: true })
  issued_on: string | null;

  @Column({ type: 'date', nullable: true })
  expires_on: string | null;

  @Column({ type: 'uuid', nullable: true })
  file_id: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

Trong `backend/src/employees/employee.entity.ts`, thêm trước `@DeleteDateColumn`:
```ts
  @Column({ type: 'date', nullable: true })
  date_of_birth: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  national_id: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'date', nullable: true })
  hire_date: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  emergency_contact: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;
```

- [ ] **Step 5: Quyền, phạm vi khách hàng, mã lỗi**

Trong `backend/src/access/permissions.ts`, thêm vào `PERMISSIONS` (sau `'employee.manage'`):
```ts
  'client.view': 'Xem khách hàng',
  'client.manage': 'Thêm, sửa khách hàng',
  'contract.view': 'Xem hợp đồng và giá',
  'contract.manage': 'Tạo, sửa hợp đồng và giá',
  'deployment.view': 'Xem điều động bảo vệ',
  'deployment.manage': 'Điều động bảo vệ tới khách',
```
và sửa `ROLE_TEMPLATES` (giữ `admin`, `guard`, `team_leader` như cũ):
```ts
  { code: 'manager', name: 'Quản lý', permissions: ['user.view', 'org.view', 'org.member.manage', 'employee.view', 'client.view', 'deployment.view'] },
  // ...team_leader, guard giữ nguyên...
  {
    code: 'hr',
    name: 'HR (nhân sự)',
    permissions: [
      'user.view', 'user.manage', 'role.view', 'org.view', 'org.manage', 'org.member.manage',
      'employee.view', 'employee.manage', 'client.view', 'deployment.view', 'deployment.manage',
    ],
  },
  {
    code: 'accountant',
    name: 'Kế toán',
    permissions: ['employee.view', 'client.view', 'client.manage', 'contract.view', 'contract.manage', 'deployment.view'],
  },
```

Trong `backend/src/access/scope.service.ts`, thêm kiểu và hai phương thức:
```ts
export type ClientVisibility = { all: true } | { all: false; clientIds: string[] };
```
```ts
  /**
   * Clients a person may see: company-wide scope sees all; otherwise the clients
   * they were scoped to, the clients they look after as account manager, and the
   * clients where someone from a team they can see is deployed today.
   */
  async clientVisibility(user: AuthUser): Promise<ClientVisibility> {
    const teams = await this.teamVisibility(user);
    if (teams.all) return { all: true };
    const rows: { id: string }[] = await this.ds.query(
      `SELECT c.id FROM clients c
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND (
              c.id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'client')
           OR c.account_manager_id = $2
           OR EXISTS (
                SELECT 1 FROM deployments d
                  JOIN team_members tm ON tm.employee_id = d.employee_id
                 WHERE d.client_id = c.id
                   AND d.start_date <= $4 AND (d.end_date IS NULL OR d.end_date >= $4)
                   AND tm.team_id = ANY($3::uuid[])
                   AND tm.start_date <= $4 AND (tm.end_date IS NULL OR tm.end_date >= $4)))`,
      [user.tenant_id, user.id, teams.teamIds, todayLocal()],
    );
    return { all: false, clientIds: rows.map((r) => r.id) };
  }

  async canSeeClient(user: AuthUser, clientId: string): Promise<boolean> {
    const visibility = await this.clientVisibility(user);
    return visibility.all || visibility.clientIds.includes(clientId);
  }
```
(thêm `import { todayLocal } from '../common/date';`).

Trong `backend/src/access/access.service.ts`, thay nhánh `else` cuối của vòng lặp phạm vi trong `assertCanGrant`:
```ts
      } else if (scope.scope_type === 'client') {
        if (!scope.scope_id || !(await this.exists('clients', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else {
        // site scopes arrive with Plan 03, together with the sites table.
        throw new BusinessException('SCOPE_INVALID');
      }
```
đổi chữ ký `exists` thành `table: 'teams' | 'team_groups' | 'clients'`, và trong `assertCanManageUser` đổi truy vấn cuối thành `scope_type IN ('team_group', 'client')` (chỉ người có phạm vi toàn công ty mới quản lý được tài khoản có phạm vi nhóm hoặc khách).

Trong `backend/src/users/dto.ts`: `@IsIn(['tenant', 'team_group', 'team', 'client'])` và kiểu `'tenant' | 'team_group' | 'team' | 'client'`.

Thêm vào `ERROR_CODES` (`backend/src/common/errors/error-codes.ts`, trước `INTERNAL_ERROR`):
```ts
  CLIENT_CODE_TAKEN: { status: 409, message: 'Mã khách hàng đã tồn tại' },
  CONTRACT_NO_TAKEN: { status: 409, message: 'Số hợp đồng đã tồn tại' },
  CONTRACT_DATES_INVALID: { status: 400, message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu' },
  CONTRACT_LINE_OVERLAP: { status: 409, message: 'Vị trí này đã có giá trong khoảng thời gian đó' },
  CONTRACT_LINE_OUTSIDE: { status: 400, message: 'Thời gian áp dụng giá phải nằm trong thời hạn hợp đồng' },
  CONTRACT_NOT_EDITABLE: { status: 409, message: 'Hợp đồng đã chấm dứt, không sửa được' },
  DEPLOYMENT_OVERLAP: { status: 409, message: 'Bảo vệ đang được điều động ở nơi khác trong thời gian này' },
  DEPLOYMENT_CONTRACT_MISMATCH: { status: 400, message: 'Hợp đồng không thuộc khách hàng này hoặc không còn hiệu lực trong thời gian điều động' },
  FILE_TOO_LARGE: { status: 413, message: 'File quá lớn (tối đa 10 MB)' },
  FILE_TYPE_NOT_ALLOWED: { status: 415, message: 'Chỉ nhận file PDF, JPG hoặc PNG' },
  FILE_IN_USE: { status: 409, message: 'File đã được gắn vào hồ sơ khác' },
```

- [ ] **Step 6: Chạy test để thấy đạt, chạy lại toàn bộ**

Run: `cd backend && npm run test:e2e`
Expected: PASS — `schema-02` 3 tests và toàn bộ suite cũ (tenant-bootstrap vẫn đúng vì `ALL_PERMISSIONS` tự gồm quyền mới).

Run: `npm run migration:run` → `ClientsContractsDeployments1760400000000 has been executed successfully.`

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): schema for clients, contracts, price lines, deployments, files, employee documents"
```

---

### Task 2: Upload và tải file có kiểm quyền

**Files:**
- Create: `backend/src/files/file-type.ts`, `backend/src/files/file-type.spec.ts`, `backend/src/files/files.service.ts`, `backend/src/files/files.controller.ts`, `backend/src/files/files.module.ts`
- Modify: `backend/src/app.module.ts`, `backend/test/test-env.ts`, `backend/.env.example`, `backend/package.json` (dev: `@types/multer`)
- Test: `backend/test/files.e2e-spec.ts`

**Interfaces:**
- Consumes: `TenantRepository`, `PermissionService`, `AuditService`, `uploadDir()`.
- Produces:
  - `detectFileType(buffer): { mime: string; ext: string } | null`.
  - `FilesService.store(actor, upload: { originalname; buffer; size })` → `FileView { id, original_name, mime, size, created_at }`; `.claim(m, tenantId, fileId, owner: { type, id })` (gắn file vào chủ, ném `FILE_IN_USE` nếu đã thuộc chủ khác); `.open(actor, id)` → `{ file: FileRecord; absolutePath }` (404 nếu không được xem).
  - Routes: `POST /api/files` (multipart, trường `file`) — cần đăng nhập thuộc tenant; `GET /api/files/:id` — tải về với `Content-Disposition: attachment`.
  - Quy tắc xem: file chưa gắn → chỉ người upload; `contract` → `contract.view` + thấy khách của hợp đồng; `employee_document` → `employee.view` + thấy nhân viên.
  - Env `UPLOAD_DIR` (mặc định `./uploads`).

- [ ] **Step 1: Viết test thất bại**

`backend/src/files/file-type.spec.ts`:
```ts
import { detectFileType } from './file-type';

describe('detectFileType', () => {
  it('knows PDF, JPEG and PNG by their first bytes', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n...'))).toEqual({ mime: 'application/pdf', ext: 'pdf' });
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ mime: 'image/png', ext: 'png' });
  });

  it('refuses everything else, whatever it is called', () => {
    expect(detectFileType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectFileType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});
```

Thêm vào `backend/test/test-env.ts`:
```ts
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Uploads from tests land in a throwaway folder, never in the dev uploads directory.
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'patrol-uploads-'));
```

`backend/test/files.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');

describe('Files (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(async () => app.close());

  const upload = (token: string, content: Buffer, filename: string) =>
    request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', content, filename);

  it('stores a real PDF and hands it back only to its uploader while unattached', async () => {
    const t = await createTenantWithAdmin(app, 'file-a');
    const res = await upload(t.token, PDF, 'hop-dong.pdf').expect(201);
    expect(res.body.data).toMatchObject({ original_name: 'hop-dong.pdf', mime: 'application/pdf', size: PDF.length });

    const back = await client(app, t.token).get(`/api/files/${res.body.data.id}`).expect(200);
    expect(back.headers['content-type']).toBe('application/pdf');
    expect(back.headers['content-disposition']).toContain('attachment');
    expect(Buffer.from(back.body).equals(PDF)).toBe(true);

    const colleague = await createUserWithRoles(app, t.tenant.id, ['accountant']);
    await client(app, colleague.token).get(`/api/files/${res.body.data.id}`).expect(404);
    const other = await createTenantWithAdmin(app, 'file-b');
    await client(app, other.token).get(`/api/files/${res.body.data.id}`).expect(404);
  });

  it('judges a file by its content, not its name', async () => {
    const t = await createTenantWithAdmin(app, 'file-fake');
    const res = await upload(t.token, Buffer.from('<html><script>x</script></html>'), 'hop-dong.pdf').expect(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('refuses files over 10 MB', async () => {
    const t = await createTenantWithAdmin(app, 'file-big');
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    const res = await upload(t.token, big, 'big.pdf').expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm i -D @types/multer && npx jest src/files && npm run test:e2e -- files`
Expected: FAIL — `Cannot find module './file-type'`; e2e `POST /api/files` 404.

- [ ] **Step 3: Viết code**

`backend/src/config/env.ts` — thêm:
```ts
export const uploadDir = () => getEnv('UPLOAD_DIR', './uploads');
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
```

`backend/.env.example` — thêm dòng `UPLOAD_DIR=./uploads`.

`backend/src/files/file-type.ts`:
```ts
const SIGNATURES: { bytes: number[]; mime: string; ext: string }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], mime: 'application/pdf', ext: 'pdf' }, // %PDF-
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: 'image/png', ext: 'png' },
];

/** The type a file really is, from its first bytes. Names and Content-Type headers are the uploader's claims. */
export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  const match = SIGNATURES.find((s) => s.bytes.every((b, i) => buffer[i] === b));
  return match ? { mime: match.mime, ext: match.ext } : null;
}
```

`backend/src/files/files.service.ts`:
```ts
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
    const file = await m.findOneBy(FileRecord, { id: fileId, tenant_id: tenantId });
    if (!file) throw new BusinessException('NOT_FOUND');
    if (file.owner_type && (file.owner_type !== owner.type || file.owner_id !== owner.id)) {
      throw new BusinessException('FILE_IN_USE');
    }
    await m.update(FileRecord, { id: fileId }, { owner_type: owner.type, owner_id: owner.id });
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
      if (!(await this.permissions.has(actor.id, ['employee.view']))) return false;
      const [row] = await this.ds.query(`SELECT employee_id FROM employee_documents WHERE id = $1 AND deleted_at IS NULL`, [
        file.owner_id,
      ]);
      return Boolean(row) && (await this.canSeeEmployee(actor, row.employee_id));
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
```

`backend/src/files/files.controller.ts`:
```ts
import { Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { BusinessException } from '../common/errors/business.exception';
import { MAX_UPLOAD_BYTES } from '../config/env';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Any user of the company may upload; what a file may be attached to is checked when it is attached. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES + 1 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BusinessException('VALIDATION_FAILED', ['file: cần chọn file']);
    return this.files.store(user, file);
  }

  @Get(':id')
  async download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { file, absolutePath } = await this.files.open(user, id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
    res.sendFile(absolutePath);
  }
}
```

Multer báo vượt giới hạn bằng `PayloadTooLargeException` (413). Trong `backend/src/common/errors/all-exceptions.filter.ts`, thêm `413: 'FILE_TOO_LARGE',` vào `CODE_BY_STATUS`.

`backend/src/files/files.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [FilesService],
  controllers: [FilesController],
  exports: [FilesService],
})
export class FilesModule {}
```

Trong `backend/src/app.module.ts`: import `FilesModule` và thêm vào cuối `imports`.

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npx jest src/files && npm run test:e2e -- files`
Expected: PASS — unit 2 tests, e2e 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): content-checked uploads and permission-checked downloads"
```

---

### Task 3: Khách hàng

**Files:**
- Create: `backend/src/clients/dto.ts`, `clients.service.ts`, `clients.controller.ts`, `clients.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/clients.e2e-spec.ts`

**Interfaces:**
- Consumes: `ScopeService.clientVisibility/canSeeClient/assertTenantScope`, `TenantRepository`, `AuditService`, `normalizePhone`.
- Produces:
  - `interface ClientView { id; code; name; management_mode; tax_code; address; contact_name; contact_phone; contact_email; account_manager_id; account_manager_name; status; note; guards_today: number; active_contracts: number }`.
  - `ClientsService.list(actor)`, `.get(actor, id)` (404 ngoài phạm vi), `.create(actor, dto)`, `.update(actor, id, dto)`; `.getForWrite(m, tenantId, id)` cho module khác.
  - Routes: `GET|POST /api/clients`, `GET|PATCH /api/clients/:id`. Ghi cần `client.manage` + phạm vi toàn công ty.

- [ ] **Step 1: Viết test thất bại**

`backend/test/clients.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Clients (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'cli');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newClient = async (code: string, extra: object = {}) =>
    (await api.post('/api/clients', { code, name: `Khách ${code}`, ...extra }).expect(201)).body.data;

  it('creates a client with contact details and an account manager', async () => {
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant']);
    const res = await api
      .post('/api/clients', {
        code: 'CT1', name: 'Toà nhà CT1', management_mode: 'self_managed', tax_code: '0101234567',
        contact_name: 'Chị Lan', contact_phone: '+84 912 000 111', account_manager_id: accountant.user.id,
      })
      .expect(201);
    expect(res.body.data).toMatchObject({
      code: 'CT1', management_mode: 'self_managed', contact_phone: '0912000111',
      account_manager_id: accountant.user.id, guards_today: 0, active_contracts: 0,
    });
    const dup = await api.post('/api/clients', { code: 'ct1', name: 'Trùng' }).expect(409);
    expect(dup.body.error.code).toBe('CLIENT_CODE_TAKEN');
  });

  it('updates a client and can mark it inactive', async () => {
    const c = await newClient('UPD');
    const res = await api.patch(`/api/clients/${c.id}`, { name: 'Đổi tên', status: 'inactive' }).expect(200);
    expect(res.body.data).toMatchObject({ name: 'Đổi tên', status: 'inactive' });
  });

  it('shows a client-scoped user only that client, and only company-wide users write', async () => {
    const mine = await newClient('MINE');
    const other = await newClient('OTHER');
    const scoped = await createUserWithRoles(app, admin.tenant.id, ['accountant'], [{ scope_type: 'client', scope_id: mine.id }]);
    const asScoped = client(app, scoped.token);
    const list = (await asScoped.get('/api/clients').expect(200)).body.data;
    expect(list.map((c: { id: string }) => c.id)).toEqual([mine.id]);
    await asScoped.get(`/api/clients/${other.id}`).expect(404);
    await asScoped.patch(`/api/clients/${mine.id}`, { name: 'X' }).expect(403);
  });

  it('lets an account manager see the clients they look after', async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const c = await newClient('AM', { account_manager_id: manager.user.id });
    const list = (await client(app, manager.token).get('/api/clients').expect(200)).body.data;
    expect(list.map((x: { id: string }) => x.id)).toEqual([c.id]);
  });

  it('refuses an account manager who is not an active office user of the company', async () => {
    const guard = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    await api.post('/api/clients', { code: 'BADAM', name: 'X', account_manager_id: guard.user.id }).expect(404);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- clients`
Expected: FAIL — `POST /api/clients` trả 404.

- [ ] **Step 3: Viết code**

`backend/src/clients/dto.ts`:
```ts
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const CODE = /^[A-Za-z0-9._-]{1,30}$/;
const PHONE = /^[+\d\s.()-]{9,20}$/;

export class CreateClientDto {
  @Matches(CODE, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsIn(['managed', 'self_managed'])
  management_mode?: 'managed' | 'self_managed';

  @IsOptional() @IsString() @MaxLength(20)
  tax_code?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @IsString() @MaxLength(200)
  contact_name?: string;

  @IsOptional() @Matches(PHONE, { message: 'contact_phone: số điện thoại không hợp lệ' })
  contact_phone?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  contact_email?: string;

  @IsOptional() @IsUUID()
  account_manager_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateClientDto {
  @IsOptional() @Matches(CODE, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsIn(['managed', 'self_managed'])
  management_mode?: 'managed' | 'self_managed';

  @IsOptional() @IsString() @MaxLength(20)
  tax_code?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  contact_name?: string | null;

  @IsOptional() @Matches(PHONE, { message: 'contact_phone: số điện thoại không hợp lệ' })
  contact_phone?: string | null;

  @IsOptional() @IsEmail() @MaxLength(200)
  contact_email?: string | null;

  @IsOptional() @IsUUID()
  account_manager_id?: string | null;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}
```

`backend/src/clients/clients.service.ts`:
```ts
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
```

`backend/src/clients/clients.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @RequirePermission('client.view')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.clients.list(user);
  }

  @RequirePermission('client.view')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(user, id);
  }

  @RequirePermission('client.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.clients.create(user, dto);
  }

  @RequirePermission('client.manage')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(user, id, dto);
  }
}
```

`backend/src/clients/clients.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [ClientsService],
  controllers: [ClientsController],
  exports: [ClientsService],
})
export class ClientsModule {}
```

Trong `backend/src/app.module.ts`: import `ClientsModule`, thêm vào cuối `imports`.

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- clients`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): clients with account managers and client-scoped visibility"
```

---

### Task 4: Hồ sơ nhân viên đầy đủ và giấy tờ có hạn

**Files:**
- Modify: `backend/src/employees/dto.ts`, `backend/src/employees/employees.service.ts`, `backend/src/employees/employees.controller.ts`, `backend/src/employees/employees.module.ts`
- Test: `backend/test/employee-profile.e2e-spec.ts`

**Interfaces:**
- Consumes: `FilesService.claim`, `toFileView`, `ScopeService`, `EmployeesService.get` (Plan 01).
- Produces:
  - `interface EmployeeProfile extends EmployeeView { date_of_birth; national_id; address; hire_date; emergency_contact; note; documents: DocumentView[] }` — các trường cá nhân (`date_of_birth`, `national_id`, `address`, `emergency_contact`) chỉ trả cho người có phạm vi toàn công ty, người khác nhận `null`.
  - `interface DocumentView { id; kind; number; issued_on; expires_on; days_left: number | null; file: FileView | null; note }`.
  - `EmployeesService.profile(actor, id)`, `.addDocument(actor, employeeId, dto)`, `.updateDocument(actor, employeeId, docId, dto)`, `.removeDocument(actor, employeeId, docId)`.
  - Routes: `GET /api/employees/:id/profile`; `POST /api/employees/:id/documents`; `PATCH|DELETE /api/employees/:id/documents/:docId`. `PATCH /api/employees/:id` nhận thêm các trường hồ sơ.

- [ ] **Step 1: Viết test thất bại**

`backend/test/employee-profile.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n%%EOF');

describe('Employee profile (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'emp2');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newEmployee = async (code: string) =>
    (await api.post('/api/employees', { code, full_name: `Bảo vệ ${code}` }).expect(201)).body.data;
  const upload = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', PDF, 'cc.pdf').expect(201)).body.data;

  it('keeps the HR profile and shows certificates with days left', async () => {
    const e = await newEmployee('HR-1');
    await api
      .patch(`/api/employees/${e.id}`, {
        date_of_birth: '1980-05-01', national_id: '001080012345', address: 'Hà Nội', hire_date: '2024-01-15',
        emergency_contact: 'Vợ — 0912345678',
      })
      .expect(200);
    const file = await upload(admin.token);
    await api
      .post(`/api/employees/${e.id}/documents`, {
        kind: 'security_certificate', number: 'NV-123', issued_on: addDays(today, -300), expires_on: addDays(today, 20), file_id: file.id,
      })
      .expect(201);

    const profile = (await api.get(`/api/employees/${e.id}/profile`).expect(200)).body.data;
    expect(profile).toMatchObject({ national_id: '001080012345', hire_date: '2024-01-15' });
    expect(profile.documents).toHaveLength(1);
    expect(profile.documents[0]).toMatchObject({ kind: 'security_certificate', days_left: 20, file: { id: file.id } });
  });

  it("hides personal details from people who only see the employee's team", async () => {
    const team = (await api.post('/api/org/teams', { name: 'Đội HS' }).expect(201)).body.data;
    const lead = await newEmployee('HS-L');
    const e = await newEmployee('HS-1');
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: lead.id }).expect(201);
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: e.id }).expect(201);
    await api.put(`/api/org/teams/${team.id}/leader`, { employee_id: lead.id }).expect(200);
    await api.patch(`/api/employees/${e.id}`, { national_id: '001090099999', address: 'Bí mật' }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });

    const seen = (await client(app, leader.token).get(`/api/employees/${e.id}/profile`).expect(200)).body.data;
    expect(seen.full_name).toBe('Bảo vệ HS-1');
    expect(seen.national_id).toBeNull();
    expect(seen.address).toBeNull();
  });

  it('refuses to attach a file that already belongs to another document', async () => {
    const a = await newEmployee('FD-1');
    const b = await newEmployee('FD-2');
    const file = await upload(admin.token);
    await api.post(`/api/employees/${a.id}/documents`, { kind: 'health_check', file_id: file.id }).expect(201);
    const res = await api.post(`/api/employees/${b.id}/documents`, { kind: 'health_check', file_id: file.id }).expect(409);
    expect(res.body.error.code).toBe('FILE_IN_USE');
  });

  it('lets the document file be downloaded by those who see the employee', async () => {
    const e = await newEmployee('DL-1');
    const file = await upload(admin.token);
    await api.post(`/api/employees/${e.id}/documents`, { kind: 'national_id', file_id: file.id }).expect(201);
    const hr = await createUserWithRoles(app, admin.tenant.id, ['hr']);
    await client(app, hr.token).get(`/api/files/${file.id}`).expect(200);
  });

  it('removes a document', async () => {
    const e = await newEmployee('RM-1');
    const doc = (await api.post(`/api/employees/${e.id}/documents`, { kind: 'other', note: 'x' }).expect(201)).body.data;
    await api.delete(`/api/employees/${e.id}/documents/${doc.id}`).expect(200);
    const profile = (await api.get(`/api/employees/${e.id}/profile`).expect(200)).body.data;
    expect(profile.documents).toEqual([]);
  });

  it('rejects an expiry date before the issue date', async () => {
    const e = await newEmployee('BAD-1');
    await api.post(`/api/employees/${e.id}/documents`, { kind: 'other', issued_on: today, expires_on: addDays(today, -1) }).expect(400);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- employee-profile`
Expected: FAIL — `PATCH /api/employees/:id` từ chối trường `date_of_birth` (VALIDATION_FAILED).

- [ ] **Step 3: Viết code**

Trong `backend/src/employees/dto.ts`, thêm vào **cả** `CreateEmployeeDto` và `UpdateEmployeeDto` (ở `Update` các kiểu thêm `| null`):
```ts
  @IsOptional() @Matches(ISO_DATE, { message: 'date_of_birth: định dạng YYYY-MM-DD' })
  date_of_birth?: string;

  @IsOptional() @Matches(/^\d{9,12}$/, { message: 'national_id: 9 hoặc 12 chữ số' })
  national_id?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'hire_date: định dạng YYYY-MM-DD' })
  hire_date?: string;

  @IsOptional() @IsString() @MaxLength(200)
  emergency_contact?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
```
và ở đầu file `const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;`, cùng hai DTO mới:
```ts
export class CreateDocumentDto {
  @IsIn(DOCUMENT_KINDS)
  kind: DocumentKind;

  @IsOptional() @IsString() @MaxLength(50)
  number?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'issued_on: định dạng YYYY-MM-DD' })
  issued_on?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'expires_on: định dạng YYYY-MM-DD' })
  expires_on?: string;

  @IsOptional() @IsUUID()
  file_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateDocumentDto {
  @IsOptional() @IsString() @MaxLength(50)
  number?: string | null;

  @IsOptional() @Matches(ISO_DATE, { message: 'issued_on: định dạng YYYY-MM-DD' })
  issued_on?: string | null;

  @IsOptional() @Matches(ISO_DATE, { message: 'expires_on: định dạng YYYY-MM-DD' })
  expires_on?: string | null;

  @IsOptional() @IsUUID()
  file_id?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}
```
(import thêm `IsUUID` từ class-validator và `DOCUMENT_KINDS, DocumentKind` từ `./employee-document.entity`).

Trong `backend/src/employees/employees.service.ts`:
- `create` và `update` chép thêm các trường hồ sơ vào `patch` (cùng kiểu `if (dto.x !== undefined) patch.x = dto.x;`) cho `date_of_birth, national_id, address, hire_date, emergency_contact, note`.
- Constructor nhận thêm `private readonly files: FilesService`.
- Thêm vào class:
```ts
  /** Everything HR keeps on one person. Personal details only reach people who see the whole company. */
  async profile(actor: AuthUser, id: string): Promise<EmployeeProfile> {
    const base = await this.get(actor, id);
    const full = await this.repo.get(tenantOf(actor), id);
    const personal = await this.scopes.hasTenantScope(actor);
    const documents = await this.documents(tenantOf(actor), id);
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
```
- Và ở mức module (ngoài class):
```ts
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

function assertDocumentDates(issued: string | null, expires: string | null): void {
  if (issued && expires && expires < issued) {
    throw new BusinessException('VALIDATION_FAILED', ['expires_on: ngày hết hạn phải sau ngày cấp']);
  }
}
```
(import `FilesService`, `FileView` từ `../files/files.service`, `EmployeeDocument, DocumentKind` từ `./employee-document.entity`, `CreateDocumentDto, UpdateDocumentDto` từ `./dto`).

Trong `backend/src/employees/employees.controller.ts`, thêm (import `Delete` và hai DTO):
```ts
  @RequirePermission('employee.view')
  @Get(':id/profile')
  profile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.profile(user, id);
  }

  @RequirePermission('employee.manage')
  @Post(':id/documents')
  addDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDocumentDto) {
    return this.employees.addDocument(user, id, dto);
  }

  @RequirePermission('employee.manage')
  @Patch(':id/documents/:docId')
  updateDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.employees.updateDocument(user, id, docId, dto);
  }

  @RequirePermission('employee.manage')
  @Delete(':id/documents/:docId')
  removeDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.employees.removeDocument(user, id, docId);
  }
```

`backend/src/employees/employees.module.ts`: thêm `FilesModule` vào `imports`.

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- employee-profile org`
Expected: PASS — employee-profile 6 tests, org vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): employee HR profile and expiring documents with attached files"
```

---

### Task 5: Hợp đồng và lịch sử giá

**Files:**
- Create: `backend/src/contracts/contract-status.ts`, `backend/src/contracts/contract-status.spec.ts`, `backend/src/contracts/dto.ts`, `contracts.service.ts`, `contracts.controller.ts`, `contracts.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/contracts.e2e-spec.ts`

**Interfaces:**
- Consumes: `ClientsService.getForWrite`, `FilesService.claim`, `ScopeService.clientVisibility/canSeeClient/assertTenantScope`, `addDays`, `todayLocal`.
- Produces:
  - `type ContractStatus = 'draft' | 'upcoming' | 'active' | 'expiring' | 'expired' | 'terminated'`; `contractStatus(c, today): ContractStatus`; `daysBetween(from, to): number`; SQL `STATUS_SQL` cùng logic.
  - `interface LineView { id; position; headcount; unit; unit_price: string; shift_hours: string | null; effective_from; effective_to }`.
  - `interface ContractView { id; client_id; client_name; contract_no; signed_at; start_date; end_date; notice_days; auto_renew; state; terminated_on; status; days_left; file: FileView | null; note; lines: LineView[] }` (`lines` chỉ có ở `get`).
  - `ContractsService.list(actor, { client_id?, status? })`, `.get(actor, id)`, `.create(actor, dto)`, `.update(actor, id, dto)`, `.terminate(actor, id, { terminated_on? })`, `.changePrice(actor, id, dto)`, `.endPosition(actor, id, position, { last_day })`; `.activeOn(m, tenantId, contractId, clientId, date)` cho điều động.
  - Routes: `GET /api/contracts?client_id&status`, `GET /api/contracts/:id`, `POST /api/contracts`, `PATCH /api/contracts/:id`, `POST /api/contracts/:id/terminate`, `POST /api/contracts/:id/prices`, `POST /api/contracts/:id/prices/:position/end`.
  - Quy ước giá: `effective_from` = ngày đầu áp dụng; dòng cũ kết thúc ngày trước đó; đổi giá đúng ngày bắt đầu của dòng hiện tại = sửa tại chỗ.

- [ ] **Step 1: Viết test thất bại**

`backend/src/contracts/contract-status.spec.ts`:
```ts
import { contractStatus, daysBetween } from './contract-status';

const base = { state: 'signed' as const, start_date: '2026-01-01', end_date: '2026-12-31', notice_days: 30 };

describe('contractStatus', () => {
  it.each([
    ['2025-12-31', 'upcoming'],
    ['2026-01-01', 'active'],
    ['2026-12-01', 'expiring'], // 30 days left
    ['2026-11-30', 'active'], // 31 days left
    ['2026-12-31', 'expiring'], // the last day still counts
    ['2027-01-01', 'expired'],
  ])('on %s a signed contract is %s', (today, expected) => {
    expect(contractStatus(base, today)).toBe(expected);
  });

  it('never calls a draft or a terminated contract anything else', () => {
    expect(contractStatus({ ...base, state: 'draft' }, '2026-06-01')).toBe('draft');
    expect(contractStatus({ ...base, state: 'terminated' }, '2026-06-01')).toBe('terminated');
  });

  it('with zero notice only the last day is "expiring"', () => {
    expect(contractStatus({ ...base, notice_days: 0 }, '2026-12-30')).toBe('active');
    expect(contractStatus({ ...base, notice_days: 0 }, '2026-12-31')).toBe('expiring');
  });

  it('counts calendar days', () => {
    expect(daysBetween('2026-12-01', '2026-12-31')).toBe(30);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});
```

`backend/test/contracts.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

describe('Contracts (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  let seq = 0;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ctr');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newClient = async () => {
    seq += 1;
    return (await api.post('/api/clients', { code: `K${seq}`, name: `Khách ${seq}` }).expect(201)).body.data;
  };
  const newContract = async (overrides: object = {}) => {
    const c = await newClient();
    seq += 1;
    return (
      await api
        .post('/api/contracts', {
          client_id: c.id, contract_no: `HD-${seq}`, start_date: addDays(today, -60), end_date: addDays(today, 300),
          lines: [{ position: 'guard', headcount: 3, unit: 'per_guard_month', unit_price: 8500000 }],
          ...overrides,
        })
        .expect(201)
    ).body.data;
  };

  it('creates a draft with its first price line and signs it', async () => {
    const k = await newContract();
    expect(k).toMatchObject({ state: 'draft', status: 'draft' });
    expect(k.lines).toEqual([
      expect.objectContaining({ position: 'guard', headcount: 3, unit_price: '8500000', effective_from: addDays(today, -60), effective_to: null }),
    ]);
    const signed = await api.patch(`/api/contracts/${k.id}`, { state: 'signed', signed_at: addDays(today, -61) }).expect(200);
    expect(signed.body.data).toMatchObject({ state: 'signed', status: 'active', days_left: 300 });
  });

  it('changes a price mid-term without overlap or gap, and corrects a same-day change in place', async () => {
    const k = await newContract();
    await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: today, headcount: 4, unit: 'per_guard_month', unit_price: 9000000 }).expect(201);
    const after = (await api.get(`/api/contracts/${k.id}`).expect(200)).body.data.lines;
    expect(after.map((l: { unit_price: string; effective_from: string; effective_to: string | null }) => [l.unit_price, l.effective_from, l.effective_to])).toEqual([
      ['8500000', addDays(today, -60), addDays(today, -1)],
      ['9000000', today, null],
    ]);

    await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: today, headcount: 4, unit: 'per_guard_month', unit_price: 9200000 }).expect(201);
    const corrected = (await api.get(`/api/contracts/${k.id}`).expect(200)).body.data.lines;
    expect(corrected).toHaveLength(2);
    expect(corrected[1].unit_price).toBe('9200000');
  });

  it('refuses a price change that would rewrite a later price, or fall outside the contract', async () => {
    const k = await newContract();
    await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: today, headcount: 3, unit: 'per_guard_month', unit_price: 9000000 }).expect(201);
    const back = await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: addDays(today, -10), headcount: 3, unit: 'per_guard_month', unit_price: 1 }).expect(409);
    expect(back.body.error.code).toBe('CONTRACT_LINE_OVERLAP');
    const outside = await api.post(`/api/contracts/${k.id}/prices`, { position: 'team_leader', effective_from: addDays(today, 400), headcount: 1, unit: 'per_guard_month', unit_price: 1 }).expect(400);
    expect(outside.body.error.code).toBe('CONTRACT_LINE_OUTSIDE');
  });

  it('adds a new position and ends one', async () => {
    const k = await newContract();
    await api.post(`/api/contracts/${k.id}/prices`, { position: 'team_leader', effective_from: today, headcount: 1, unit: 'per_shift', unit_price: 450000, shift_hours: 12 }).expect(201);
    await api.post(`/api/contracts/${k.id}/prices/team_leader/end`, { last_day: addDays(today, 30) }).expect(200);
    const lines = (await api.get(`/api/contracts/${k.id}`).expect(200)).body.data.lines;
    expect(lines.find((l: { position: string }) => l.position === 'team_leader')).toMatchObject({ effective_to: addDays(today, 30), shift_hours: '12.0' });
  });

  it('marks contracts inside the notice period as expiring, and lists them', async () => {
    const soon = await newContract({ start_date: addDays(today, -300), end_date: addDays(today, 10) });
    await api.patch(`/api/contracts/${soon.id}`, { state: 'signed' }).expect(200);
    const list = (await api.get('/api/contracts?status=expiring').expect(200)).body.data;
    expect(list.map((k: { id: string }) => k.id)).toContain(soon.id);
    expect(list.find((k: { id: string }) => k.id === soon.id)).toMatchObject({ status: 'expiring', days_left: 10 });
  });

  it('validates dates and keeps price lines inside the term when the term changes', async () => {
    const c = await newClient();
    const bad = await api.post('/api/contracts', { client_id: c.id, contract_no: 'BAD', start_date: today, end_date: addDays(today, -1), lines: [] }).expect(400);
    expect(bad.body.error.code).toBe('CONTRACT_DATES_INVALID');
    const k = await newContract();
    const shrink = await api.patch(`/api/contracts/${k.id}`, { start_date: addDays(today, -30) }).expect(400);
    expect(shrink.body.error.code).toBe('CONTRACT_LINE_OUTSIDE');
    await api.patch(`/api/contracts/${k.id}`, { end_date: addDays(today, 500) }).expect(200);
  });

  it('terminates a contract and then refuses edits', async () => {
    const k = await newContract();
    await api.patch(`/api/contracts/${k.id}`, { state: 'signed' }).expect(200);
    const res = await api.post(`/api/contracts/${k.id}/terminate`, { terminated_on: today }).expect(200);
    expect(res.body.data).toMatchObject({ state: 'terminated', status: 'terminated', terminated_on: today });
    expect((await api.patch(`/api/contracts/${k.id}`, { note: 'x' }).expect(409)).body.error.code).toBe('CONTRACT_NOT_EDITABLE');
  });

  it('attaches the signed scan and lets contract viewers download it', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const file = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${admin.token}`).attach('file', pdf, 'hd.pdf').expect(201)).body.data;
    const k = await newContract({ file_id: file.id });
    expect(k.file).toMatchObject({ id: file.id, original_name: 'hd.pdf' });
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant']);
    await client(app, accountant.token).get(`/api/files/${file.id}`).expect(200);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).get(`/api/files/${file.id}`).expect(404);
  });

  it('keeps prices from people without contract.view', async () => {
    const k = await newContract();
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).get(`/api/contracts/${k.id}`).expect(403);
  });

  it('refuses a duplicate contract number', async () => {
    const k = await newContract();
    const c = await newClient();
    const res = await api.post('/api/contracts', { client_id: c.id, contract_no: k.contract_no.toLowerCase(), start_date: today, end_date: today, lines: [] }).expect(409);
    expect(res.body.error.code).toBe('CONTRACT_NO_TAKEN');
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npx jest src/contracts && npm run test:e2e -- contracts`
Expected: FAIL — `Cannot find module './contract-status'`; e2e `POST /api/contracts` 404.

- [ ] **Step 3: Viết trạng thái hợp đồng**

`backend/src/contracts/contract-status.ts`:
```ts
import { ContractState } from './contract.entity';

export type ContractStatus = 'draft' | 'upcoming' | 'active' | 'expiring' | 'expired' | 'terminated';

export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * Status follows from the dates every time it is read, so no nightly job can
 * forget to flip a contract to "expired". The end date is the last covered day.
 */
export function contractStatus(
  c: { state: ContractState; start_date: string; end_date: string; notice_days: number },
  today: string,
): ContractStatus {
  if (c.state === 'terminated') return 'terminated';
  if (c.state === 'draft') return 'draft';
  if (c.end_date < today) return 'expired';
  if (c.start_date > today) return 'upcoming';
  return daysBetween(today, c.end_date) <= c.notice_days ? 'expiring' : 'active';
}

/** The same rule in SQL, for filtering lists. `$TODAY` is replaced with the parameter placeholder. */
export const statusSql = (alias: string, today: string) => `
  CASE WHEN ${alias}.state = 'terminated' THEN 'terminated'
       WHEN ${alias}.state = 'draft' THEN 'draft'
       WHEN ${alias}.end_date < ${today}::date THEN 'expired'
       WHEN ${alias}.start_date > ${today}::date THEN 'upcoming'
       WHEN ${alias}.end_date - ${today}::date <= ${alias}.notice_days THEN 'expiring'
       ELSE 'active' END`;
```

Run: `npx jest src/contracts` → PASS (4 tests).

- [ ] **Step 4: Viết DTO, service, controller, module**

`backend/src/contracts/dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSITION = /^[a-z][a-z0-9_]{1,49}$/;
export const PRICE_UNITS = ['per_guard_month', 'per_shift', 'per_hour'] as const;

export class LineInputDto {
  @Matches(POSITION, { message: 'position: chữ thường, số, gạch dưới' })
  position: string;

  @IsInt() @Min(1) @Max(1000)
  headcount: number;

  @IsIn(PRICE_UNITS)
  unit: (typeof PRICE_UNITS)[number];

  /** Whole đồng. Sent as a JSON integer; stored as numeric(14,0). */
  @IsInt() @Min(0) @Max(10_000_000_000)
  unit_price: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0.5) @Max(24)
  shift_hours?: number;
}

export class CreateContractDto {
  @IsUUID()
  client_id: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  contract_no: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'signed_at: định dạng YYYY-MM-DD' })
  signed_at?: string;

  @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date: string;

  @Matches(ISO_DATE, { message: 'end_date: định dạng YYYY-MM-DD' })
  end_date: string;

  @IsOptional() @IsInt() @Min(0) @Max(365)
  notice_days?: number;

  @IsOptional() @IsBoolean()
  auto_renew?: boolean;

  @IsOptional() @IsUUID()
  file_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => LineInputDto)
  lines: LineInputDto[];
}

export class UpdateContractDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  contract_no?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'signed_at: định dạng YYYY-MM-DD' })
  signed_at?: string | null;

  @IsOptional() @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'end_date: định dạng YYYY-MM-DD' })
  end_date?: string;

  @IsOptional() @IsInt() @Min(0) @Max(365)
  notice_days?: number;

  @IsOptional() @IsBoolean()
  auto_renew?: boolean;

  /** Draft → signed. Termination has its own route. */
  @IsOptional() @IsIn(['signed'])
  state?: 'signed';

  @IsOptional() @IsUUID()
  file_id?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class TerminateContractDto {
  @IsOptional() @Matches(ISO_DATE, { message: 'terminated_on: định dạng YYYY-MM-DD' })
  terminated_on?: string;
}

export class ChangePriceDto extends LineInputDto {
  @Matches(ISO_DATE, { message: 'effective_from: định dạng YYYY-MM-DD' })
  effective_from: string;
}

export class EndPositionDto {
  @Matches(ISO_DATE, { message: 'last_day: định dạng YYYY-MM-DD' })
  last_day: string;
}
```

`backend/src/contracts/contracts.service.ts`:
```ts
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
      await m.query(`SELECT id FROM contracts WHERE id = $1 FOR UPDATE`, [id]);
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

  private async editable(m: EntityManager, tenantId: string, id: string): Promise<Contract> {
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
```

`backend/src/contracts/contracts.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ContractsService } from './contracts.service';
import { ChangePriceDto, CreateContractDto, EndPositionDto, TerminateContractDto, UpdateContractDto } from './dto';

class ContractFilter {
  @IsOptional() @IsUUID()
  client_id?: string;

  @IsOptional() @IsIn(['draft', 'upcoming', 'active', 'expiring', 'expired', 'terminated'])
  status?: string;
}

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @RequirePermission('contract.view')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() filter: ContractFilter) {
    return this.contracts.list(user, filter);
  }

  @RequirePermission('contract.view')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(user, id);
  }

  @RequirePermission('contract.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContractDto) {
    return this.contracts.create(user, dto);
  }

  @RequirePermission('contract.manage')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(user, id, dto);
  }

  @RequirePermission('contract.manage')
  @Post(':id/terminate')
  @HttpCode(200)
  terminate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TerminateContractDto) {
    return this.contracts.terminate(user, id, dto);
  }

  @RequirePermission('contract.manage')
  @Post(':id/prices')
  changePrice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangePriceDto) {
    return this.contracts.changePrice(user, id, dto);
  }

  @RequirePermission('contract.manage')
  @Post(':id/prices/:position/end')
  @HttpCode(200)
  endPosition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('position') position: string,
    @Body() dto: EndPositionDto,
  ) {
    return this.contracts.endPosition(user, id, position, dto);
  }
}
```

`backend/src/contracts/contracts.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { ClientsModule } from '../clients/clients.module';
import { FilesModule } from '../files/files.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [AccessModule, AuditModule, ClientsModule, FilesModule],
  providers: [ContractsService],
  controllers: [ContractsController],
  exports: [ContractsService],
})
export class ContractsModule {}
```

Trong `backend/src/app.module.ts`: import `ContractsModule`, thêm vào cuối `imports`.

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npx jest src/contracts && npm run test:e2e -- contracts`
Expected: PASS — unit 9 tests, e2e 10 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): contracts with dated price lines and date-derived status"
```

---

### Task 6: Điều động bảo vệ tới khách

**Files:**
- Create: `backend/src/deployments/dto.ts`, `deployments.service.ts`, `deployments.controller.ts`, `deployments.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/deployments.e2e-spec.ts`

**Interfaces:**
- Consumes: `ClientsService.getForWrite`, `ContractsService.activeOn`, `ScopeService` (`clientVisibility`, `teamVisibility`, `assertTenantScope`), `addDays`, `todayLocal`.
- Produces:
  - `interface DeploymentView { id; employee_id; employee_code; employee_name; client_id; client_name; contract_id; contract_no; position; start_date; end_date; end_reason; note }`.
  - `DeploymentsService.list(actor, { client_id?, employee_id?, on? })` — `on` = ngày (mặc định: tất cả); `.create(actor, dto)`; `.end(actor, id, { last_day, reason? })`; `.cancel(actor, id)` (chỉ khi chưa bắt đầu).
  - Routes: `GET /api/deployments?client_id&employee_id&on`, `POST /api/deployments`, `POST /api/deployments/:id/end`, `DELETE /api/deployments/:id`. Ghi cần `deployment.manage` + phạm vi toàn công ty.
  - Quy ước như đội: `start_date` = ngày đầu ở khách mới; điều động đang mở ở khách khác kết thúc ngày hôm trước (`end_reason` = "Chuyển sang <tên khách>"); bắt đầu cùng ngày → sửa tại chỗ; có điều động bắt đầu sau `start_date` → từ chối.
  - Xem: người thấy khách (`clientVisibility`) **hoặc** thấy nhân viên (đội trong phạm vi) thì thấy điều động đó.

- [ ] **Step 1: Viết test thất bại**

`backend/test/deployments.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Deployments (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'dep');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newEmployee = async () =>
    (await api.post('/api/employees', { code: `D${++seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data;
  const newClient = async () =>
    (await api.post('/api/clients', { code: `KD${++seq}`, name: `Khách ${seq}` }).expect(201)).body.data;
  const signedContract = async (clientId: string, headcount = 2) => {
    const k = (
      await api
        .post('/api/contracts', {
          client_id: clientId, contract_no: `HDD-${++seq}`, start_date: addDays(today, -90), end_date: addDays(today, 270),
          lines: [{ position: 'guard', headcount, unit: 'per_guard_month', unit_price: 8000000 }],
        })
        .expect(201)
    ).body.data;
    await api.patch(`/api/contracts/${k.id}`, { state: 'signed' }).expect(200);
    return k;
  };
  const deploy = (body: object) => api.post('/api/deployments', body);
  const history = (employeeId: string) =>
    ds.query(`SELECT client_id, start_date, end_date, end_reason FROM deployments WHERE employee_id = $1 ORDER BY start_date`, [employeeId]);

  it('sends a guard to a client under a contract and shows who is where', async () => {
    const e = await newEmployee();
    const c = await newClient();
    const k = await signedContract(c.id);
    const res = await deploy({ employee_id: e.id, client_id: c.id, contract_id: k.id, start_date: addDays(today, -5) }).expect(201);
    expect(res.body.data).toMatchObject({ employee_name: e.full_name, client_name: c.name, contract_no: k.contract_no, end_date: null });

    const atClient = (await api.get(`/api/deployments?client_id=${c.id}&on=${today}`).expect(200)).body.data;
    expect(atClient.map((d: { employee_id: string }) => d.employee_id)).toEqual([e.id]);
    const ofGuard = (await api.get(`/api/deployments?employee_id=${e.id}`).expect(200)).body.data;
    expect(ofGuard).toHaveLength(1);
    expect((await api.get(`/api/clients/${c.id}`).expect(200)).body.data.guards_today).toBe(1);
  });

  it('moves a guard to another client: the old posting ends the day before, with a reason', async () => {
    const e = await newEmployee();
    const a = await newClient();
    const b = await newClient();
    await deploy({ employee_id: e.id, client_id: a.id, start_date: addDays(today, -30) }).expect(201);
    await deploy({ employee_id: e.id, client_id: b.id, start_date: today }).expect(201);
    expect(await history(e.id)).toEqual([
      { client_id: a.id, start_date: addDays(today, -30), end_date: addDays(today, -1), end_reason: `Chuyển sang ${b.name}` },
      { client_id: b.id, start_date: today, end_date: null, end_reason: null },
    ]);
  });

  it('corrects a same-day posting in place and refuses one that would rewrite later history', async () => {
    const e = await newEmployee();
    const a = await newClient();
    const b = await newClient();
    await deploy({ employee_id: e.id, client_id: a.id, start_date: today }).expect(201);
    await deploy({ employee_id: e.id, client_id: b.id, start_date: today }).expect(201);
    expect(await history(e.id)).toEqual([{ client_id: b.id, start_date: today, end_date: null, end_reason: null }]);

    const conflict = await deploy({ employee_id: e.id, client_id: a.id, start_date: addDays(today, -3) }).expect(409);
    expect(conflict.body.error.code).toBe('DEPLOYMENT_OVERLAP');
  });

  it('plans a future posting and can cancel it before it starts', async () => {
    const e = await newEmployee();
    const c = await newClient();
    const d = (await deploy({ employee_id: e.id, client_id: c.id, start_date: addDays(today, 7) }).expect(201)).body.data;
    await api.delete(`/api/deployments/${d.id}`).expect(200);
    expect(await history(e.id)).toEqual([]);
    const started = (await deploy({ employee_id: e.id, client_id: c.id, start_date: today }).expect(201)).body.data;
    await api.delete(`/api/deployments/${started.id}`).expect(409);
  });

  it('ends a posting with a last day and a reason', async () => {
    const e = await newEmployee();
    const c = await newClient();
    const d = (await deploy({ employee_id: e.id, client_id: c.id, start_date: addDays(today, -10) }).expect(201)).body.data;
    const res = await api.post(`/api/deployments/${d.id}/end`, { last_day: today, reason: 'Khách yêu cầu đổi người' }).expect(200);
    expect(res.body.data).toMatchObject({ end_date: today, end_reason: 'Khách yêu cầu đổi người' });
    await api.post(`/api/deployments/${d.id}/end`, { last_day: addDays(today, -20) }).expect(400);
  });

  it('refuses inactive guards and contracts of another client or not in force', async () => {
    const e = await newEmployee();
    const a = await newClient();
    const b = await newClient();
    const kb = await signedContract(b.id);
    const mismatch = await deploy({ employee_id: e.id, client_id: a.id, contract_id: kb.id }).expect(400);
    expect(mismatch.body.error.code).toBe('DEPLOYMENT_CONTRACT_MISMATCH');
    const late = await deploy({ employee_id: e.id, client_id: b.id, contract_id: kb.id, start_date: addDays(today, 300) }).expect(400);
    expect(late.body.error.code).toBe('DEPLOYMENT_CONTRACT_MISMATCH');

    await api.patch(`/api/employees/${e.id}`, { status: 'inactive' }).expect(200);
    expect((await deploy({ employee_id: e.id, client_id: a.id }).expect(400)).body.error.code).toBe('EMPLOYEE_INACTIVE');
  });

  it("shows a team's manager where the team's people are posted, and only that", async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const group = (await api.post('/api/org/groups', { name: `Nhóm ${++seq}`, manager_user_id: manager.user.id }).expect(201)).body.data;
    const team = (await api.post('/api/org/teams', { name: `Đội ${++seq}`, team_group_id: group.id }).expect(201)).body.data;
    const mine = await newEmployee();
    const stranger = await newEmployee();
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: mine.id }).expect(201);
    const c = await newClient();
    const other = await newClient();
    await deploy({ employee_id: mine.id, client_id: c.id }).expect(201);
    await deploy({ employee_id: stranger.id, client_id: other.id }).expect(201);

    const asManager = client(app, manager.token);
    const seen = (await asManager.get(`/api/deployments?on=${today}`).expect(200)).body.data;
    expect(seen.map((d: { employee_id: string }) => d.employee_id)).toEqual([mine.id]);
    const clients = (await asManager.get('/api/clients').expect(200)).body.data;
    expect(clients.map((x: { id: string }) => x.id)).toEqual([c.id]);
    await asManager.post('/api/deployments', { employee_id: mine.id, client_id: other.id }).expect(403);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- deployments`
Expected: FAIL — `POST /api/deployments` trả 404.

- [ ] **Step 3: Viết code**

`backend/src/deployments/dto.ts`:
```ts
import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateDeploymentDto {
  @IsUUID()
  employee_id: string;

  @IsUUID()
  client_id: string;

  @IsOptional() @IsUUID()
  contract_id?: string;

  @IsOptional() @Matches(/^[a-z][a-z0-9_]{1,49}$/, { message: 'position: chữ thường, số, gạch dưới' })
  position?: string;

  /** First day at the client. Defaults to today; may be in the future. */
  @IsOptional() @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class EndDeploymentDto {
  /** Last day at the client. */
  @Matches(ISO_DATE, { message: 'last_day: định dạng YYYY-MM-DD' })
  last_day: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  reason?: string;
}

export class DeploymentFilter {
  @IsOptional() @IsUUID()
  client_id?: string;

  @IsOptional() @IsUUID()
  employee_id?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'on: định dạng YYYY-MM-DD' })
  on?: string;
}
```

`backend/src/deployments/deployments.service.ts`:
```ts
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
      if (posting.start_date <= todayLocal()) throw new BusinessException('DEPLOYMENT_OVERLAP');
      await m.delete(Deployment, { id });
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
```

Điều động bị huỷ trả `DEPLOYMENT_OVERLAP` khi đã bắt đầu — dùng mã riêng cho rõ: thêm `DEPLOYMENT_STARTED: { status: 409, message: 'Điều động đã bắt đầu, hãy kết thúc thay vì huỷ' }` vào `ERROR_CODES` và ném mã này trong `cancel`.

`backend/src/deployments/deployments.controller.ts`:
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DeploymentsService } from './deployments.service';
import { CreateDeploymentDto, DeploymentFilter, EndDeploymentDto } from './dto';

@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @RequirePermission('deployment.view')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() filter: DeploymentFilter) {
    return this.deployments.list(user, filter);
  }

  @RequirePermission('deployment.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDeploymentDto) {
    return this.deployments.create(user, dto);
  }

  @RequirePermission('deployment.manage')
  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndDeploymentDto) {
    return this.deployments.end(user, id, dto);
  }

  @RequirePermission('deployment.manage')
  @Delete(':id')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deployments.cancel(user, id);
  }
}
```

`backend/src/deployments/deployments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { ClientsModule } from '../clients/clients.module';
import { ContractsModule } from '../contracts/contracts.module';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';

@Module({
  imports: [AccessModule, AuditModule, ClientsModule, ContractsModule],
  providers: [DeploymentsService],
  controllers: [DeploymentsController],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
```

Trong `backend/src/app.module.ts`: import `DeploymentsModule`, thêm vào cuối `imports`. Trong test "plans a future posting", lời gọi `DELETE` điều động đã bắt đầu kỳ vọng 409 — khớp `DEPLOYMENT_STARTED`.

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- deployments`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): dated guard deployments to clients with transfer and cancel rules"
```

---

### Task 7: Dashboard công ty, bộ test cách ly cho dữ liệu mới

**Files:**
- Create: `backend/src/dashboard/dashboard.service.ts`, `dashboard.controller.ts`, `dashboard.module.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/scripts/seed-demo.ts`
- Test: `backend/test/dashboard.e2e-spec.ts`, `backend/test/tenancy-02.e2e-spec.ts`

**Interfaces:**
- Consumes: `ScopeService`, `PermissionService`, `statusSql`.
- Produces:
  - `GET /api/dashboard/company` (cần `client.view`) → `{ guards: { active, deployed, idle }, expiring_contracts: ContractBrief[], shortfalls: Shortfall[], expiring_documents: DocumentAlert[] }`.
  - `ContractBrief { id; contract_no; client_id; client_name; end_date; days_left; status }` — hợp đồng `expiring`, và hợp đồng `expired` mà vẫn còn bảo vệ đang được điều động theo hợp đồng đó.
  - `Shortfall { client_id; client_name; contract_id; contract_no; position; headcount; deployed }` — dòng giá đang hiệu lực hôm nay có `deployed < headcount`.
  - `DocumentAlert { employee_id; employee_name; kind; expires_on; days_left }` — giấy tờ hết hạn trong 30 ngày tới hoặc đã hết hạn; chỉ khi người xem có `employee.view` và phạm vi toàn công ty.
  - `guards`: nhân viên `active`; `deployed` = có điều động hôm nay; `idle` = còn lại. Người không có phạm vi toàn công ty chỉ thấy số liệu của khách họ thấy (`guards.active` = số người đang ở các khách đó).

- [ ] **Step 1: Viết test thất bại**

`backend/test/dashboard.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Company dashboard (e2e)', () => {
  let app: NestExpressApplication;
  const today = todayLocal();
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(async () => app.close());

  it('counts posted and idle guards, flags expiring contracts, shortfalls and expiring papers', async () => {
    const admin = await createTenantWithAdmin(app, 'dash');
    const api = client(app, admin.token);
    const emp = async (code: string) => (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data;
    const [a, b, c] = [await emp('A'), await emp('B'), await emp('C')];
    const k1 = (await api.post('/api/clients', { code: 'K1', name: 'Toà K1' }).expect(201)).body.data;

    const contract = (
      await api
        .post('/api/contracts', {
          client_id: k1.id, contract_no: 'HD-DASH', start_date: addDays(today, -300), end_date: addDays(today, 12),
          lines: [{ position: 'guard', headcount: 3, unit: 'per_guard_month', unit_price: 8000000 }],
        })
        .expect(201)
    ).body.data;
    await api.patch(`/api/contracts/${contract.id}`, { state: 'signed' }).expect(200);
    await api.post('/api/deployments', { employee_id: a.id, client_id: k1.id, contract_id: contract.id }).expect(201);
    await api.post('/api/deployments', { employee_id: b.id, client_id: k1.id, contract_id: contract.id }).expect(201);
    await api.post(`/api/employees/${c.id}/documents`, { kind: 'security_certificate', expires_on: addDays(today, 5) }).expect(201);

    const d = (await api.get('/api/dashboard/company').expect(200)).body.data;
    expect(d.guards).toEqual({ active: 3, deployed: 2, idle: 1 });
    expect(d.expiring_contracts).toEqual([
      expect.objectContaining({ id: contract.id, client_name: 'Toà K1', days_left: 12, status: 'expiring' }),
    ]);
    expect(d.shortfalls).toEqual([
      expect.objectContaining({ contract_id: contract.id, position: 'guard', headcount: 3, deployed: 2 }),
    ]);
    expect(d.expiring_documents).toEqual([expect.objectContaining({ employee_id: c.id, kind: 'security_certificate', days_left: 5 })]);

    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const seen = (await client(app, manager.token).get('/api/dashboard/company').expect(200)).body.data;
    expect(seen.expiring_documents).toEqual([]);
    expect(seen.expiring_contracts).toEqual([]);
  });
});
```

`backend/test/tenancy-02.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, server } from './helpers';

describe('Tenant isolation for clients, contracts, deployments, files (e2e)', () => {
  let app: NestExpressApplication;
  let apiA: ReturnType<typeof client>;
  const B: Record<'client' | 'contract' | 'employee' | 'deployment' | 'file', string> = {
    client: '', contract: '', employee: '', deployment: '', file: '',
  };
  let aEmployee: string;
  let aClient: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso2-a');
    const b = await createTenantWithAdmin(app, 'iso2-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const today = todayLocal();
    B.file = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${b.token}`).attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'b.pdf').expect(201)).body.data.id;
    B.client = (await apiB.post('/api/clients', { code: 'BK', name: 'Khách B' }).expect(201)).body.data.id;
    B.contract = (await apiB.post('/api/contracts', { client_id: B.client, contract_no: 'HD-B', start_date: today, end_date: today, lines: [], file_id: B.file }).expect(201)).body.data.id;
    await apiB.patch(`/api/contracts/${B.contract}`, { state: 'signed' }).expect(200);
    B.employee = (await apiB.post('/api/employees', { code: 'BE', full_name: 'NV B' }).expect(201)).body.data.id;
    B.deployment = (await apiB.post('/api/deployments', { employee_id: B.employee, client_id: B.client }).expect(201)).body.data.id;
    aEmployee = (await apiA.post('/api/employees', { code: 'AE', full_name: 'NV A' }).expect(201)).body.data.id;
    aClient = (await apiA.post('/api/clients', { code: 'AK', name: 'Khách A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or write of B's records with 404", async () => {
    await apiA.get(`/api/clients/${B.client}`).expect(404);
    await apiA.patch(`/api/clients/${B.client}`, { name: 'x' }).expect(404);
    await apiA.get(`/api/contracts/${B.contract}`).expect(404);
    await apiA.patch(`/api/contracts/${B.contract}`, { note: 'x' }).expect(404);
    await apiA.post(`/api/contracts/${B.contract}/terminate`, {}).expect(404);
    await apiA.post(`/api/deployments/${B.deployment}/end`, { last_day: todayLocal() }).expect(404);
    await apiA.delete(`/api/deployments/${B.deployment}`).expect(404);
    await apiA.get(`/api/files/${B.file}`).expect(404);
    await apiA.get(`/api/employees/${B.employee}/profile`).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post('/api/deployments', { employee_id: B.employee, client_id: aClient }).expect(404);
    await apiA.post('/api/deployments', { employee_id: aEmployee, client_id: B.client }).expect(404);
    await apiA.post('/api/deployments', { employee_id: aEmployee, client_id: aClient, contract_id: B.contract }).expect(400);
    await apiA.post('/api/contracts', { client_id: B.client, contract_no: 'X', start_date: todayLocal(), end_date: todayLocal(), lines: [] }).expect(404);
    await apiA.post(`/api/employees/${aEmployee}/documents`, { kind: 'other', file_id: B.file }).expect(404);
  });

  it("keeps B out of A's lists and dashboard", async () => {
    const ids = async (url: string) => (await apiA.get(url).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(await ids('/api/clients')).not.toContain(B.client);
    expect(await ids('/api/contracts')).not.toContain(B.contract);
    expect(await ids('/api/deployments')).not.toContain(B.deployment);
    const d = (await apiA.get('/api/dashboard/company').expect(200)).body.data;
    expect(d.guards).toEqual({ active: 1, deployed: 0, idle: 1 });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- dashboard tenancy-02`
Expected: FAIL — `/api/dashboard/company` 404 (tenancy-02 chỉ fail ở test dashboard).

- [ ] **Step 3: Viết code**

`backend/src/dashboard/dashboard.service.ts`:
```ts
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

    const shortfalls = await this.ds.query(
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
```

`backend/src/dashboard/dashboard.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermission('client.view')
  @Get('company')
  company(@CurrentUser() user: AuthUser) {
    return this.dashboard.company(user);
  }
}
```

`backend/src/dashboard/dashboard.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [AccessModule], providers: [DashboardService], controllers: [DashboardController] })
export class DashboardModule {}
```

Trong `backend/src/app.module.ts`: import `DashboardModule`, thêm vào cuối `imports`.

Trong `backend/src/scripts/seed-demo.ts`, trước dòng `console.log('Đã tạo công ty demo...`, thêm dữ liệu khách hàng, hợp đồng và điều động demo (import `ClientsService`, `ContractsService`, `DeploymentsService`, `addDays`, `todayLocal`):
```ts
  const clientsSvc = app.get(ClientsService);
  const contractsSvc = app.get(ContractsService);
  const deploymentsSvc = app.get(DeploymentsService);
  const today = todayLocal();
  const ct1 = await clientsSvc.create(actor, { code: 'CT1', name: 'Toà nhà CT1 Mỹ Đình', contact_name: 'Chị Lan', contact_phone: '0912000111' });
  const kho = await clientsSvc.create(actor, { code: 'KLB', name: 'Kho Long Biên', management_mode: 'self_managed' });
  const k1 = await contractsSvc.create(actor, {
    client_id: ct1.id, contract_no: 'HD-2026-001', start_date: addDays(today, -200), end_date: addDays(today, 165),
    lines: [{ position: 'guard', headcount: 3, unit: 'per_guard_month', unit_price: 8500000 }],
  });
  await contractsSvc.update(actor, k1.id, { state: 'signed' });
  const k2 = await contractsSvc.create(actor, {
    client_id: kho.id, contract_no: 'HD-2026-002', start_date: addDays(today, -340), end_date: addDays(today, 20),
    lines: [{ position: 'guard', headcount: 3, unit: 'per_shift', unit_price: 420000, shift_hours: 12 }],
  });
  await contractsSvc.update(actor, k2.id, { state: 'signed' });
  for (const [i, e] of staff.entries()) {
    await deploymentsSvc.create(actor, { employee_id: e.id, client_id: i < 3 ? ct1.id : kho.id, contract_id: i < 3 ? k1.id : k2.id, start_date: addDays(today, -30) });
  }
```
Seed chỉ chạy được trên DB đã có migration Plan 02; công ty demo cũ không tự có dữ liệu mới — xoá DB dev (`docker compose down -v`) hoặc tạo bằng tay trên web.

- [ ] **Step 4: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npm test && npm run test:e2e && npm run build`
Expected: PASS toàn bộ — 15 suite e2e.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): company dashboard; isolation suite for clients, contracts, deployments, files"
```

---

### Task 8: Web — khách hàng, hợp đồng của khách, điều động

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/components/shell.tsx`
- Create: `web/src/lib/format.ts`
- Create: `web/src/app/(app)/khach-hang/page.tsx`, `web/src/app/(app)/khach-hang/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET|POST /api/clients`, `GET|PATCH /api/clients/:id`, `GET|POST /api/contracts`, `GET|POST /api/deployments`, `POST /api/deployments/:id/end`, `DELETE /api/deployments/:id`, `GET /api/employees`.
- Produces: `uploadFile(file: File): Promise<FileView>`; `money(v)`, `date(v)`, `CONTRACT_STATUS: Record<status, {label, tone}>`, `POSITION_LABEL`; trang `/khach-hang`, `/khach-hang/[id]`.

- [ ] **Step 1: Kiểu dữ liệu, định dạng, upload**

Thêm vào `web/src/lib/types.ts`:
```ts
export interface FileView {
  id: string;
  original_name: string;
  mime: string;
  size: number;
}

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

export type ContractStatus = 'draft' | 'upcoming' | 'active' | 'expiring' | 'expired' | 'terminated';

export interface LineView {
  id: string;
  position: string;
  headcount: number;
  unit: 'per_guard_month' | 'per_shift' | 'per_hour';
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
  state: 'draft' | 'signed' | 'terminated';
  terminated_on: string | null;
  status: ContractStatus;
  days_left: number;
  file: FileView | null;
  note: string | null;
  lines?: LineView[];
}

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
}

export interface DocumentView {
  id: string;
  kind: string;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  days_left: number | null;
  file: FileView | null;
  note: string | null;
}

export interface EmployeeProfile extends Employee {
  date_of_birth: string | null;
  national_id: string | null;
  address: string | null;
  hire_date: string | null;
  emergency_contact: string | null;
  note: string | null;
  documents: DocumentView[];
}

export interface CompanyDashboard {
  guards: { active: number; deployed: number; idle: number };
  expiring_contracts: { id: string; contract_no: string; client_id: string; client_name: string; end_date: string; days_left: number; status: ContractStatus }[];
  shortfalls: { client_id: string; client_name: string; contract_id: string; contract_no: string; position: string; headcount: number; deployed: number }[];
  expiring_documents: { employee_id: string; employee_name: string; kind: string; expires_on: string; days_left: number }[];
}
```

`web/src/lib/format.ts`:
```ts
import { ContractStatus } from './types';

const VND = new Intl.NumberFormat('vi-VN');

/** Money arrives as a numeric string ("8500000"); shown as "8.500.000 đ". */
export const money = (value: string | number) => `${VND.format(Number(value))} đ`;

/** "2026-10-13" → "13/10/2026". */
export const date = (value: string | null | undefined) => {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
};

export const CONTRACT_STATUS: Record<ContractStatus, { label: string; tone: string }> = {
  draft: { label: 'Nháp', tone: 'bg-slate-100 text-slate-700' },
  upcoming: { label: 'Chưa hiệu lực', tone: 'bg-sky-100 text-sky-800' },
  active: { label: 'Đang hiệu lực', tone: 'bg-teal-100 text-teal-800' },
  expiring: { label: 'Sắp hết hạn', tone: 'bg-amber-100 text-amber-800' },
  expired: { label: 'Đã hết hạn', tone: 'bg-red-100 text-red-700' },
  terminated: { label: 'Đã chấm dứt', tone: 'bg-slate-200 text-slate-600' },
};

export const POSITION_LABEL: Record<string, string> = {
  guard: 'Bảo vệ',
  team_leader: 'Đội trưởng',
  supervisor: 'Giám sát',
};

export const UNIT_LABEL: Record<string, string> = {
  per_guard_month: '/người/tháng',
  per_shift: '/ca',
  per_hour: '/giờ',
};

export const DOCUMENT_KIND: Record<string, string> = {
  national_id: 'CCCD',
  security_certificate: 'Chứng chỉ nghiệp vụ bảo vệ',
  health_check: 'Giấy khám sức khoẻ',
  criminal_record: 'Lý lịch tư pháp',
  labor_contract: 'Hợp đồng lao động',
  other: 'Khác',
};
```

Thêm vào cuối `web/src/lib/api.ts`:
```ts
/** Upload one file; the server checks its real type and size. Returns its id to attach elsewhere. */
export async function uploadFile(file: File): Promise<import('./types').FileView> {
  const form = new FormData();
  form.append('file', file);
  return api('/files', { method: 'POST', body: form });
}
```

Trong `web/src/components/shell.tsx`, đổi `NAV` thành:
```ts
const NAV: { href: string; label: string; permission?: string }[] = [
  { href: '/', label: 'Tổng quan' },
  { href: '/khach-hang', label: 'Khách hàng', permission: 'client.view' },
  { href: '/hop-dong', label: 'Hợp đồng', permission: 'contract.view' },
  { href: '/to-chuc', label: 'Tổ chức', permission: 'org.view' },
  { href: '/nhan-vien', label: 'Nhân viên', permission: 'employee.view' },
  { href: '/nguoi-dung', label: 'Người dùng', permission: 'user.view' },
];
```
và để mục đang chọn sáng cả khi ở trang con: `pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))`.

- [ ] **Step 2: Trang danh sách khách hàng**

`web/src/app/(app)/khach-hang/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ClientView } from '@/lib/types';

const EMPTY = { code: '', name: '', management_mode: 'managed', contact_name: '', contact_phone: '' };

export default function ClientsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<ClientView[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<ClientView[]>('/clients'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/clients', {
        method: 'POST',
        json: Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')),
      });
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Khách hàng</h1>
      {can('client.manage') && (
        <Card title="Thêm khách hàng">
          <form onSubmit={create} className="grid grid-cols-1 items-end gap-3 md:grid-cols-6">
            <Field label="Mã">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </Field>
            <div className="md:col-span-2">
              <Field label="Tên khách hàng">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
            </div>
            <Field label="Hình thức">
              <Select value={form.management_mode} onChange={(e) => setForm({ ...form, management_mode: e.target.value })}>
                <option value="managed">Công ty quản lý</option>
                <option value="self_managed">Khách tự quản lý</option>
              </Select>
            </Field>
            <Field label="Người liên hệ">
              <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            </Field>
            <Button type="submit">Thêm</Button>
          </form>
        </Card>
      )}
      <ErrorText error={error} />
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2">Mã</th>
              <th>Khách hàng</th>
              <th>Hình thức</th>
              <th>Phụ trách</th>
              <th className="text-right">Bảo vệ hôm nay</th>
              <th className="text-right">HĐ hiệu lực</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="py-2 font-mono">{c.code}</td>
                <td>
                  <Link href={`/khach-hang/${c.id}`} className="font-medium text-teal-700 hover:underline">
                    {c.name}
                  </Link>
                  {c.status === 'inactive' && <span className="ml-2 text-xs text-slate-400">ngừng</span>}
                </td>
                <td>{c.management_mode === 'managed' ? 'Công ty quản lý' : 'Khách tự quản lý'}</td>
                <td>{c.account_manager_name ?? '—'}</td>
                <td className="text-right">{c.guards_today}</td>
                <td className="text-right">{c.active_contracts}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">Chưa có khách hàng nào trong phạm vi của bạn</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Trang chi tiết khách hàng**

`web/src/app/(app)/khach-hang/[id]/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONTRACT_STATUS, date, POSITION_LABEL, UNIT_LABEL } from '@/lib/format';
import { ClientView, ContractView, DeploymentView, Employee, UserRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [clientRow, setClient] = useState<ClientView | null>(null);
  const [contracts, setContracts] = useState<ContractView[]>([]);
  const [deployments, setDeployments] = useState<DeploymentView[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [staff, setStaff] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [contractForm, setContractForm] = useState({
    contract_no: '', start_date: todayIso(), end_date: '', notice_days: '30',
    position: 'guard', headcount: '1', unit: 'per_guard_month', unit_price: '',
  });
  const [deployForm, setDeployForm] = useState({ employee_id: '', contract_id: '', start_date: todayIso() });

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    setClient(await api<ClientView>(`/clients/${id}`));
    if (can('contract.view')) setContracts(await api<ContractView[]>(`/contracts?client_id=${id}`));
    if (can('deployment.view')) setDeployments(await api<DeploymentView[]>(`/deployments?client_id=${id}`));
    if (can('deployment.manage') && can('employee.view')) setEmployees(await api<Employee[]>('/employees'));
    if (can('client.manage') && can('user.view')) setStaff((await api<UserRow[]>('/users')).filter((u) => u.user_type === 'staff'));
  }, [id, can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  if (!clientRow) return <ErrorText error={error} />;
  const today = todayIso();
  const current = deployments.filter((d) => d.start_date <= today && (!d.end_date || d.end_date >= today));
  const planned = deployments.filter((d) => d.start_date > today);
  const past = deployments.filter((d) => d.end_date && d.end_date < today);
  const usable = contracts.filter((k) => k.state === 'signed' && ['active', 'expiring', 'upcoming'].includes(k.status));

  async function createContract(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const f = contractForm;
      await api('/contracts', {
        method: 'POST',
        json: {
          client_id: id, contract_no: f.contract_no, start_date: f.start_date, end_date: f.end_date,
          notice_days: Number(f.notice_days),
          lines: f.unit_price
            ? [{ position: f.position, headcount: Number(f.headcount), unit: f.unit, unit_price: Number(f.unit_price) }]
            : [],
        },
      });
      setContractForm({ ...contractForm, contract_no: '', end_date: '', unit_price: '' });
      await load();
    });
  }

  async function deploy(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/deployments', {
        method: 'POST',
        json: {
          employee_id: deployForm.employee_id,
          client_id: id,
          start_date: deployForm.start_date,
          ...(deployForm.contract_id ? { contract_id: deployForm.contract_id } : {}),
        },
      });
      setDeployForm({ ...deployForm, employee_id: '' });
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Link href="/khach-hang" className="text-sm text-slate-500 hover:underline">← Khách hàng</Link>
        <h1 className="text-xl font-semibold">{clientRow.name}</h1>
        <span className="font-mono text-sm text-slate-400">{clientRow.code}</span>
      </div>
      <ErrorText error={error} />

      <Card title="Thông tin">
        <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
          <div><dt className="text-slate-500">Hình thức</dt><dd>{clientRow.management_mode === 'managed' ? 'Công ty quản lý' : 'Khách tự quản lý'}</dd></div>
          <div><dt className="text-slate-500">Người liên hệ</dt><dd>{clientRow.contact_name ?? '—'} {clientRow.contact_phone ?? ''}</dd></div>
          <div><dt className="text-slate-500">Mã số thuế</dt><dd>{clientRow.tax_code ?? '—'}</dd></div>
          <div className="md:col-span-2"><dt className="text-slate-500">Địa chỉ</dt><dd>{clientRow.address ?? '—'}</dd></div>
          <div>
            <dt className="text-slate-500">Người phụ trách bên công ty</dt>
            <dd>
              {can('client.manage') && staff.length ? (
                <Select
                  value={clientRow.account_manager_id ?? ''}
                  onChange={(e) =>
                    run(async () => {
                      await api(`/clients/${id}`, { method: 'PATCH', json: { account_manager_id: e.target.value || null } });
                      await load();
                    })
                  }
                >
                  <option value="">— Chưa có —</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </Select>
              ) : (
                clientRow.account_manager_name ?? '—'
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {can('contract.view') && (
        <Card title="Hợp đồng">
          <table className="mb-3 w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Số HĐ</th><th>Thời hạn</th><th>Trạng thái</th><th className="text-right">Còn</th></tr>
            </thead>
            <tbody>
              {contracts.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <Link href={`/hop-dong?id=${k.id}`} className="font-medium text-teal-700 hover:underline">{k.contract_no}</Link>
                  </td>
                  <td>{date(k.start_date)} – {date(k.end_date)}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[k.status].tone}`}>{CONTRACT_STATUS[k.status].label}</span></td>
                  <td className="text-right">{k.days_left >= 0 ? `${k.days_left} ngày` : '—'}</td>
                </tr>
              ))}
              {!contracts.length && <tr><td colSpan={4} className="py-4 text-center text-slate-400">Chưa có hợp đồng</td></tr>}
            </tbody>
          </table>
          {can('contract.manage') && (
            <form onSubmit={createContract} className="grid grid-cols-2 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-5">
              <Field label="Số hợp đồng"><Input value={contractForm.contract_no} onChange={(e) => setContractForm({ ...contractForm, contract_no: e.target.value })} required /></Field>
              <Field label="Từ ngày"><Input type="date" value={contractForm.start_date} onChange={(e) => setContractForm({ ...contractForm, start_date: e.target.value })} required /></Field>
              <Field label="Đến ngày"><Input type="date" value={contractForm.end_date} onChange={(e) => setContractForm({ ...contractForm, end_date: e.target.value })} required /></Field>
              <Field label="Báo trước (ngày)"><Input type="number" min={0} max={365} value={contractForm.notice_days} onChange={(e) => setContractForm({ ...contractForm, notice_days: e.target.value })} /></Field>
              <div />
              <Field label="Vị trí">
                <Select value={contractForm.position} onChange={(e) => setContractForm({ ...contractForm, position: e.target.value })}>
                  {Object.entries(POSITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Số người"><Input type="number" min={1} value={contractForm.headcount} onChange={(e) => setContractForm({ ...contractForm, headcount: e.target.value })} /></Field>
              <Field label="Đơn vị">
                <Select value={contractForm.unit} onChange={(e) => setContractForm({ ...contractForm, unit: e.target.value })}>
                  {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Đơn giá (đ)"><Input type="number" min={0} value={contractForm.unit_price} onChange={(e) => setContractForm({ ...contractForm, unit_price: e.target.value })} /></Field>
              <Button type="submit">Tạo hợp đồng (nháp)</Button>
            </form>
          )}
        </Card>
      )}

      {can('deployment.view') && (
        <Card
          title={`Bảo vệ đang làm (${current.length})`}
          actions={<button onClick={() => setShowHistory(!showHistory)} className="text-sm text-teal-700 hover:underline">{showHistory ? 'Ẩn lịch sử' : 'Xem lịch sử'}</button>}
        >
          <table className="mb-3 w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Nhân viên</th><th>Vị trí</th><th>Theo HĐ</th><th>Từ ngày</th><th /></tr>
            </thead>
            <tbody>
              {[...current, ...planned, ...(showHistory ? past : [])].map((d) => (
                <tr key={d.id} className={`border-t border-slate-100 ${d.end_date && d.end_date < today ? 'text-slate-400' : ''}`}>
                  <td className="py-2">
                    <Link href={`/nhan-vien/${d.employee_id}`} className="hover:underline">{d.employee_name}</Link>{' '}
                    <span className="font-mono text-slate-400">{d.employee_code}</span>
                  </td>
                  <td>{POSITION_LABEL[d.position] ?? d.position}</td>
                  <td>{d.contract_no ?? '—'}</td>
                  <td>
                    {date(d.start_date)}
                    {d.end_date && ` – ${date(d.end_date)}`}
                    {d.start_date > today && <span className="ml-1 text-xs text-sky-700">(sắp tới)</span>}
                    {d.end_reason && <div className="text-xs">{d.end_reason}</div>}
                  </td>
                  <td className="text-right">
                    {can('deployment.manage') && !d.end_date && d.start_date <= today && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const reason = window.prompt(`Kết thúc điều động ${d.employee_name} hôm nay. Lý do:`);
                          if (reason !== null) {
                            void run(async () => {
                              await api(`/deployments/${d.id}/end`, { method: 'POST', json: { last_day: today, ...(reason ? { reason } : {}) } });
                              await load();
                            });
                          }
                        }}
                      >
                        Rút về
                      </Button>
                    )}
                    {can('deployment.manage') && d.start_date > today && (
                      <Button variant="secondary" onClick={() => run(async () => { await api(`/deployments/${d.id}`, { method: 'DELETE' }); await load(); })}>
                        Huỷ
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!current.length && !planned.length && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Chưa có bảo vệ nào</td></tr>}
            </tbody>
          </table>
          {can('deployment.manage') && (
            <form onSubmit={deploy} className="grid grid-cols-1 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-4">
              <Field label="Điều động nhân viên">
                <Select value={deployForm.employee_id} onChange={(e) => setDeployForm({ ...deployForm, employee_id: e.target.value })} required>
                  <option value="">— Chọn nhân viên —</option>
                  {employees.filter((e) => e.status === 'active').map((e) => (
                    <option key={e.id} value={e.id}>{e.code} · {e.full_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Theo hợp đồng">
                <Select value={deployForm.contract_id} onChange={(e) => setDeployForm({ ...deployForm, contract_id: e.target.value })}>
                  <option value="">— Không gắn —</option>
                  {usable.map((k) => <option key={k.id} value={k.id}>{k.contract_no}</option>)}
                </Select>
              </Field>
              <Field label="Từ ngày"><Input type="date" value={deployForm.start_date} onChange={(e) => setDeployForm({ ...deployForm, start_date: e.target.value })} required /></Field>
              <Button type="submit">Điều động</Button>
            </form>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Điều động một người đang làm ở khách khác sẽ tự kết thúc chỗ cũ vào ngày hôm trước.
          </p>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Kiểm tra build**

Run: `cd web && npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): clients list and client page with contracts and deployments"
```

---

### Task 9: Web — hợp đồng, hồ sơ nhân viên, tổng quan công ty

**Files:**
- Create: `web/src/app/(app)/hop-dong/page.tsx`, `web/src/app/(app)/nhan-vien/[id]/page.tsx`
- Modify: `web/src/app/(app)/page.tsx`, `web/src/app/(app)/nhan-vien/page.tsx` (tên nhân viên thành link tới hồ sơ)

**Interfaces:**
- Consumes: `GET /api/contracts[?status]`, `GET|PATCH /api/contracts/:id`, `POST /api/contracts/:id/prices|terminate`, `GET /api/employees/:id/profile`, `PATCH /api/employees/:id`, `POST|DELETE /api/employees/:id/documents[/:docId]`, `GET /api/deployments?employee_id`, `GET /api/dashboard/company`, `uploadFile`.
- Produces: trang `/hop-dong` (danh sách + chi tiết theo `?id=`), `/nhan-vien/[id]`, Tổng quan có số liệu công ty.

- [ ] **Step 1: Trang hợp đồng**

`web/src/app/(app)/hop-dong/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONTRACT_STATUS, date, money, POSITION_LABEL, UNIT_LABEL } from '@/lib/format';
import { ContractStatus, ContractView } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

function ContractsInner() {
  const { can } = useAuth();
  const manage = can('contract.manage');
  const router = useRouter();
  const selectedId = useSearchParams().get('id');
  const [status, setStatus] = useState<'' | ContractStatus>('');
  const [rows, setRows] = useState<ContractView[]>([]);
  const [selected, setSelected] = useState<ContractView | null>(null);
  const [price, setPrice] = useState({ position: 'guard', effective_from: todayIso(), headcount: '1', unit: 'per_guard_month', unit_price: '' });
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    setRows(await api<ContractView[]>(`/contracts${status ? `?status=${status}` : ''}`));
    setSelected(selectedId ? await api<ContractView>(`/contracts/${selectedId}`) : null);
  }, [status, selectedId]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const patch = (json: object) =>
    run(async () => {
      await api(`/contracts/${selected!.id}`, { method: 'PATCH', json });
      await load();
    });

  async function changePrice(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/contracts/${selected!.id}/prices`, {
        method: 'POST',
        json: { ...price, headcount: Number(price.headcount), unit_price: Number(price.unit_price) },
      });
      setPrice({ ...price, unit_price: '' });
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Hợp đồng</h1>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | '')} className="w-48">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      <ErrorText error={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Số HĐ</th><th>Khách hàng</th><th>Hết hạn</th><th>Trạng thái</th></tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr
                  key={k.id}
                  onClick={() => router.replace(`/hop-dong?id=${k.id}`)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selected?.id === k.id ? 'bg-teal-50' : ''}`}
                >
                  <td className="py-2 font-medium">{k.contract_no}</td>
                  <td>{k.client_name}</td>
                  <td>{date(k.end_date)}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[k.status].tone}`}>{CONTRACT_STATUS[k.status].label}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-slate-400">Không có hợp đồng</td></tr>}
            </tbody>
          </table>
        </Card>

        {selected && (
          <Card
            title={`HĐ ${selected.contract_no}`}
            actions={<span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[selected.status].tone}`}>{CONTRACT_STATUS[selected.status].label}</span>}
          >
            <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-slate-500">Khách hàng</dt><dd><Link href={`/khach-hang/${selected.client_id}`} className="text-teal-700 hover:underline">{selected.client_name}</Link></dd></div>
              <div><dt className="text-slate-500">Thời hạn</dt><dd>{date(selected.start_date)} – {date(selected.end_date)}</dd></div>
              <div><dt className="text-slate-500">Ngày ký</dt><dd>{date(selected.signed_at)}</dd></div>
              <div><dt className="text-slate-500">Báo trước</dt><dd>{selected.notice_days} ngày{selected.auto_renew ? ' · tự gia hạn' : ''}</dd></div>
              <div className="col-span-2">
                <dt className="text-slate-500">Bản scan</dt>
                <dd>
                  {selected.file ? (
                    <a href={`/api/files/${selected.file.id}`} className="text-teal-700 hover:underline">{selected.file.original_name}</a>
                  ) : (
                    '—'
                  )}
                  {manage && selected.state !== 'terminated' && (
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="ml-3 text-xs"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void run(async () => { const up = await uploadFile(file); await api(`/contracts/${selected.id}`, { method: 'PATCH', json: { file_id: up.id } }); await load(); });
                      }}
                    />
                  )}
                </dd>
              </div>
            </dl>

            <h3 className="mb-1 text-sm font-semibold">Giá theo vị trí</h3>
            <table className="mb-3 w-full text-left text-sm">
              <thead className="text-slate-500"><tr><th className="py-1">Vị trí</th><th>Số người</th><th>Đơn giá</th><th>Áp dụng</th></tr></thead>
              <tbody>
                {(selected.lines ?? []).map((l) => (
                  <tr key={l.id} className={`border-t border-slate-100 ${l.effective_to && l.effective_to < todayIso() ? 'text-slate-400' : ''}`}>
                    <td className="py-1">{POSITION_LABEL[l.position] ?? l.position}</td>
                    <td>{l.headcount}</td>
                    <td>{money(l.unit_price)}{UNIT_LABEL[l.unit]}{l.shift_hours ? ` (${l.shift_hours}h)` : ''}</td>
                    <td>{date(l.effective_from)} – {l.effective_to ? date(l.effective_to) : 'nay'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {manage && selected.state !== 'terminated' && (
              <>
                <form onSubmit={changePrice} className="mb-3 grid grid-cols-2 items-end gap-2 md:grid-cols-3">
                  <Field label="Vị trí">
                    <Select value={price.position} onChange={(e) => setPrice({ ...price, position: e.target.value })}>
                      {Object.entries(POSITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Áp dụng từ"><Input type="date" value={price.effective_from} onChange={(e) => setPrice({ ...price, effective_from: e.target.value })} /></Field>
                  <Field label="Số người"><Input type="number" min={1} value={price.headcount} onChange={(e) => setPrice({ ...price, headcount: e.target.value })} /></Field>
                  <Field label="Đơn vị">
                    <Select value={price.unit} onChange={(e) => setPrice({ ...price, unit: e.target.value })}>
                      {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Đơn giá mới (đ)"><Input type="number" min={0} value={price.unit_price} onChange={(e) => setPrice({ ...price, unit_price: e.target.value })} required /></Field>
                  <Button type="submit">Đổi / thêm giá</Button>
                </form>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {selected.state === 'draft' && <Button onClick={() => patch({ state: 'signed', signed_at: todayIso() })}>Đánh dấu đã ký</Button>}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const end = window.prompt('Gia hạn đến ngày (YYYY-MM-DD):', selected.end_date);
                      if (end) void patch({ end_date: end });
                    }}
                  >
                    Gia hạn
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (window.confirm(`Chấm dứt hợp đồng ${selected.contract_no} từ hôm nay?`)) {
                        void run(async () => { await api(`/contracts/${selected.id}/terminate`, { method: 'POST', json: {} }); await load(); });
                      }
                    }}
                  >
                    Chấm dứt
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

export default function ContractsPage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Đang tải…</div>}>
      <ContractsInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: Trang hồ sơ nhân viên**

`web/src/app/(app)/nhan-vien/[id]/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, DOCUMENT_KIND } from '@/lib/format';
import { DeploymentView, EmployeeProfile } from '@/lib/types';

const FIELDS: { key: keyof EmployeeProfile; label: string; type?: string }[] = [
  { key: 'date_of_birth', label: 'Ngày sinh', type: 'date' },
  { key: 'national_id', label: 'Số CCCD' },
  { key: 'hire_date', label: 'Ngày vào làm', type: 'date' },
  { key: 'address', label: 'Địa chỉ' },
  { key: 'emergency_contact', label: 'Liên hệ khẩn cấp' },
];

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const manage = can('employee.manage') && me.team_visibility.all;
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [deployments, setDeployments] = useState<DeploymentView[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState({ kind: 'security_certificate', number: '', issued_on: '', expires_on: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    const p = await api<EmployeeProfile>(`/employees/${id}/profile`);
    setProfile(p);
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, (p[f.key] as string | null) ?? ''])));
    if (can('deployment.view')) setDeployments(await api<DeploymentView[]>(`/deployments?employee_id=${id}`));
  }, [id, can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  if (!profile) return <ErrorText error={error} />;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/employees/${id}`, {
        method: 'PATCH',
        json: Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key] || null])),
      });
      await load();
    });
  }

  async function addDocument(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const file = docFile ? await uploadFile(docFile) : null;
      await api(`/employees/${id}/documents`, {
        method: 'POST',
        json: {
          kind: doc.kind,
          ...(doc.number ? { number: doc.number } : {}),
          ...(doc.issued_on ? { issued_on: doc.issued_on } : {}),
          ...(doc.expires_on ? { expires_on: doc.expires_on } : {}),
          ...(file ? { file_id: file.id } : {}),
        },
      });
      setDoc({ ...doc, number: '', issued_on: '', expires_on: '' });
      setDocFile(null);
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Link href="/nhan-vien" className="text-sm text-slate-500 hover:underline">← Nhân viên</Link>
        <h1 className="text-xl font-semibold">{profile.full_name}</h1>
        <span className="font-mono text-sm text-slate-400">{profile.code}</span>
        <span className="text-sm text-slate-500">{profile.team ? `Đội ${profile.team.name}` : 'Chưa vào đội'}</span>
      </div>
      <ErrorText error={error} />

      <Card title="Hồ sơ">
        {me.team_visibility.all ? (
          <form onSubmit={saveProfile} className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input type={f.type ?? 'text'} value={draft[f.key] ?? ''} disabled={!manage} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              </Field>
            ))}
            {manage && <Button type="submit">Lưu hồ sơ</Button>}
          </form>
        ) : (
          <p className="text-sm text-slate-500">Thông tin cá nhân chỉ hiển thị cho HR và ban giám đốc.</p>
        )}
      </Card>

      <Card title="Giấy tờ, chứng chỉ">
        <table className="mb-3 w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">Loại</th><th>Số</th><th>Ngày cấp</th><th>Hết hạn</th><th>File</th><th /></tr></thead>
          <tbody>
            {profile.documents.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="py-2">{DOCUMENT_KIND[d.kind] ?? d.kind}</td>
                <td>{d.number ?? '—'}</td>
                <td>{date(d.issued_on)}</td>
                <td>
                  {date(d.expires_on)}
                  {d.days_left !== null && d.days_left <= 30 && (
                    <span className={`ml-2 rounded px-1.5 text-xs ${d.days_left < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                      {d.days_left < 0 ? 'đã hết hạn' : `còn ${d.days_left} ngày`}
                    </span>
                  )}
                </td>
                <td>{d.file ? <a href={`/api/files/${d.file.id}`} className="text-teal-700 hover:underline">Tải về</a> : '—'}</td>
                <td className="text-right">
                  {manage && (
                    <Button variant="secondary" onClick={() => run(async () => { await api(`/employees/${id}/documents/${d.id}`, { method: 'DELETE' }); await load(); })}>
                      Xoá
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!profile.documents.length && <tr><td colSpan={6} className="py-4 text-center text-slate-400">Chưa có giấy tờ</td></tr>}
          </tbody>
        </table>
        {manage && (
          <form onSubmit={addDocument} className="grid grid-cols-2 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-6">
            <Field label="Loại">
              <Select value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>
                {Object.entries(DOCUMENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Số"><Input value={doc.number} onChange={(e) => setDoc({ ...doc, number: e.target.value })} /></Field>
            <Field label="Ngày cấp"><Input type="date" value={doc.issued_on} onChange={(e) => setDoc({ ...doc, issued_on: e.target.value })} /></Field>
            <Field label="Hết hạn"><Input type="date" value={doc.expires_on} onChange={(e) => setDoc({ ...doc, expires_on: e.target.value })} /></Field>
            <Field label="File (PDF/ảnh)">
              <input type="file" accept="application/pdf,image/jpeg,image/png" className="text-xs" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Button type="submit">Thêm</Button>
          </form>
        )}
      </Card>

      {can('deployment.view') && (
        <Card title="Lịch sử điều động">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-2">Khách hàng</th><th>Từ</th><th>Đến</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2"><Link href={`/khach-hang/${d.client_id}`} className="text-teal-700 hover:underline">{d.client_name}</Link></td>
                  <td>{date(d.start_date)}</td>
                  <td>{d.end_date ? date(d.end_date) : 'nay'}</td>
                  <td className="text-slate-500">{d.end_reason ?? ''}</td>
                </tr>
              ))}
              {!deployments.length && <tr><td colSpan={4} className="py-4 text-center text-slate-400">Chưa từng được điều động</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
```

Trong `web/src/app/(app)/nhan-vien/page.tsx`, đổi ô họ tên thành link: `<td><Link href={`/nhan-vien/${e.id}`} className="text-teal-700 hover:underline">{e.full_name}</Link></td>` (import `Link` từ `next/link`).

- [ ] **Step 3: Tổng quan công ty**

`web/src/app/(app)/page.tsx` (thay toàn bộ):
```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONTRACT_STATUS, date, DOCUMENT_KIND, POSITION_LABEL } from '@/lib/format';
import { CompanyDashboard } from '@/lib/types';

function Tile({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${tone}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default function HomePage() {
  const { me, can } = useAuth();
  const [data, setData] = useState<CompanyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (can('client.view')) api<CompanyDashboard>('/dashboard/company').then(setData).catch((e) => setError(errorMessage(e)));
  }, [can]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Xin chào, {me.user.full_name}</h1>
      <ErrorText error={error} />
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label="Bảo vệ đang làm" value={data.guards.active} />
            <Tile label="Đang được điều động hôm nay" value={data.guards.deployed} />
            <Tile label="Chưa có chỗ làm" value={data.guards.idle} tone={data.guards.idle ? 'border-amber-300' : ''} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {can('contract.view') && (
              <Card title="Hợp đồng cần xử lý">
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.expiring_contracts.map((k) => (
                    <li key={k.id} className="flex items-center justify-between py-2">
                      <Link href={`/hop-dong?id=${k.id}`} className="text-teal-700 hover:underline">{k.contract_no} · {k.client_name}</Link>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[k.status].tone}`}>
                        {k.status === 'expired' ? `hết hạn ${date(k.end_date)}` : `còn ${k.days_left} ngày`}
                      </span>
                    </li>
                  ))}
                  {!data.expiring_contracts.length && <li className="py-2 text-slate-400">Không có hợp đồng sắp hết hạn</li>}
                </ul>
              </Card>
            )}
            <Card title="Khách đang thiếu người">
              <ul className="divide-y divide-slate-100 text-sm">
                {data.shortfalls.map((s) => (
                  <li key={`${s.contract_id}-${s.position}`} className="flex items-center justify-between py-2">
                    <Link href={`/khach-hang/${s.client_id}`} className="text-teal-700 hover:underline">{s.client_name}</Link>
                    <span>{POSITION_LABEL[s.position] ?? s.position}: {s.deployed}/{s.headcount}</span>
                  </li>
                ))}
                {!data.shortfalls.length && <li className="py-2 text-slate-400">Các khách đều đủ người theo hợp đồng</li>}
              </ul>
            </Card>
            {me.team_visibility.all && can('employee.view') && (
              <Card title="Giấy tờ sắp hết hạn (30 ngày)">
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.expiring_documents.map((d) => (
                    <li key={`${d.employee_id}-${d.kind}-${d.expires_on}`} className="flex items-center justify-between py-2">
                      <Link href={`/nhan-vien/${d.employee_id}`} className="text-teal-700 hover:underline">{d.employee_name}</Link>
                      <span>{DOCUMENT_KIND[d.kind] ?? d.kind} · {d.days_left < 0 ? 'đã hết hạn' : `còn ${d.days_left} ngày`}</span>
                    </li>
                  ))}
                  {!data.expiring_documents.length && <li className="py-2 text-slate-400">Không có giấy tờ sắp hết hạn</li>}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
      {!can('client.view') && (
        <Card title="Phạm vi của bạn">
          <p className="text-sm text-slate-600">{me.team_visibility.all ? 'Toàn công ty' : `${me.team_visibility.team_ids.length} đội`}</p>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Kiểm tra build và chạy thử**

Run: `cd web && npm run build`
Expected: `Compiled successfully`.

Chạy backend + web, đăng nhập giám đốc demo (sau khi `docker compose down -v && docker compose up -d postgres && npm run migration:run && npm run seed:demo`):
1. Tổng quan: 6 bảo vệ, 6 đang điều động; "Hợp đồng cần xử lý" có HD-2026-002 còn 20 ngày.
2. Khách hàng → Toà nhà CT1: 3 bảo vệ đang làm; điều động thêm một người đang ở Kho Long Biên → bên Kho tự kết thúc ngày hôm qua, lý do "Chuyển sang Toà nhà CT1…".
3. Hợp đồng → HD-2026-001: đổi giá từ hôm nay 9.000.000 đ → dòng cũ kết thúc hôm qua. Tải lên bản scan PDF → bấm tên file tải về được.
4. Nhân viên → bấm tên → hồ sơ: thêm chứng chỉ hết hạn sau 10 ngày → Tổng quan hiện ở "Giấy tờ sắp hết hạn".
5. Đăng nhập quản lý `0900000002`: menu có Khách hàng nhưng không có Hợp đồng; trang khách không có bảng hợp đồng.

- [ ] **Step 5: Chạy toàn bộ kiểm thử, commit**

Run: `cd backend && npm test && npm run test:e2e && cd ../web && npm run build`
Expected: tất cả PASS.

```bash
git add web
git commit -m "feat(web): contracts with price history, employee HR profile, company dashboard"
```

---

## Sau plan này

- **Plan 03** (spec §9 bước 3): mục tiêu (`sites`), chốt, điểm tuần tra, tuyến, in tem QR; mẫu ca và xếp ca cho bảo vệ **đang được điều động** tới khách đó; app di động (Capacitor) — đăng nhập, ca hôm nay, vào/ra ca; bảng `devices` (một máy mỗi bảo vệ); `deployments.site_id`.
- Thông báo hợp đồng 30/15/7/1 ngày đi cùng hạ tầng push ở Plan 05.
