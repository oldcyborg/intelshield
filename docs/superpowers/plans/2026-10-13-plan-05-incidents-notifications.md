# Plan 05 — Sự cố, SOS, thông báo, leo thang — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bảo vệ báo sự cố (có ảnh, vị trí) hoặc bấm SOS; đội trưởng, quản lý, giám đốc nhận thông báo theo mức độ và **leo thang tự động** theo mốc của từng mục tiêu cho tới khi có người bấm "Tôi tiếp nhận"; sự cố đi qua các trạng thái tới khi đóng, mọi bước ghi vào dòng thời gian không sửa được. Nhân sự công ty ghi nhận được sự cố khách báo.

**Architecture:** Ba khối mới. `notifications`: lưu thông báo trong hệ thống, phát tức thì qua Server-Sent Events cho web, đẩy tới điện thoại qua **Firebase Cloud Messaging** (kênh ưu tiên cao cho khẩn cấp). `incidents`: tạo, xem theo phạm vi, máy trạng thái, bình luận, ảnh. `escalation`: chọn người nhận theo cơ cấu (đội trưởng của người báo → quản lý nhóm → người nhận leo thang cuối) và một vòng quét mỗi phút đẩy sự cố chưa ai tiếp nhận lên cấp trên, theo `SettingsService.effective` của mục tiêu.

**Tech Stack:** như trước, thêm `firebase-admin` (như POS). Không thêm thư viện lập lịch: vòng quét là `setInterval` trong service, tắt được bằng biến môi trường (test gọi thẳng `tick(now)`).

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` bản 1.4 — §4.5, §6 (trạng thái, ai được báo, chỉ số), §7.0 (mốc leo thang theo mục tiêu), §5.1 M6–M7, T2–T3, Q2–Q3, §5.1.4, §5.2 W7, §5.3 C6. Chủ dự án 13/10/2026: **thông báo đẩy là bắt buộc**.

**Khác với spec (có chủ đích):**
- "Người nhận leo thang cuối" là quyền `incident.final_escalation` (mặc định vai trò Quản trị) thay cho "giám đốc" cứng — công ty tự chọn ai nhận.
- Báo nhầm (`rejected`) được từ `new/acknowledged/in_progress`; `resolved` mở lại về `in_progress`.
- Chỉ số thời gian tiếp nhận/xử lý: lưu đủ dấu thời gian ở đây; báo cáo tổng hợp làm cùng báo cáo chung (W10).
- App di động (nút SOS, hộp sự cố trên app) là Plan 04b; API ở đây đủ cho app.

## Global Constraints

- Mọi quy ước Plan 01–04 giữ nguyên.
- Thứ tự mức độ: `low < medium < high < critical`; SOS luôn là `critical`.
- `incident_events` chỉ thêm, không sửa, không xoá.
- Mọi thông báo vừa lưu trong `notifications` (xem lại được) vừa phát SSE; đẩy điện thoại theo bảng §6.2 (mức thấp chỉ trong ứng dụng).
- Khoá dịch vụ Firebase chỉ nằm trong biến môi trường `FCM_SERVICE_ACCOUNT`; thiếu khoá thì hệ thống chạy bình thường, chỉ không đẩy tới điện thoại (ghi cảnh báo một lần lúc khởi động).

## Review Focus

1. **Không ai nhận**: đội không có đội trưởng, mục tiêu không có đội phụ trách, nhóm không có quản lý → thông báo rơi lên cấp trên, không bị nuốt — test ở Task 5.
2. **Leo thang theo mục tiêu**: mục tiêu đặt mốc 5 phút cho mức cao thì leo thang ở phút 5, mục tiêu khác dùng 10 phút của công ty; tiếp nhận rồi thì dừng — test ở Task 5.
3. **Chuyển trạng thái sai**: đóng khi chưa xử lý, xử lý không ghi cách xử lý, mức cao không có ảnh, đội trưởng đóng vượt mức được phép, báo nhầm không lý do → từ chối — test ở Task 4.
4. **Báo sự cố ngoài phạm vi**: bảo vệ báo cho mục tiêu của khách mình không được điều động; xem sự cố của đội khác → từ chối — test ở Task 3.
5. **SOS không có ca**: bảo vệ bấm SOS ngoài ca → vẫn tạo được, gắn khách đang được điều động — test ở Task 3.

---

### Task 1: Schema, quyền, danh mục sự cố

**Files:**
- Create: `backend/src/database/migrations/1760700000000-IncidentsNotifications.ts`
- Create: `backend/src/incidents/categories.ts`, `backend/src/incidents/incident-category.entity.ts`, `backend/src/incidents/categories.service.ts`, `backend/src/incidents/dto.ts`, `backend/src/incidents/incidents.controller.ts`, `backend/src/incidents/incidents.module.ts`
- Modify: `backend/src/access/permissions.ts`, `backend/src/tenants/tenants.service.ts`, `backend/src/common/errors/error-codes.ts`, `backend/src/app.module.ts`, `backend/test/users.e2e-spec.ts`
- Test: `backend/test/incident-categories.e2e-spec.ts`

**Interfaces:**
- Produces:
  - Quyền `incident.view`, `incident.report`, `incident.manage`, `incident.close`, `incident.final_escalation`. Vai trò mẫu: `admin` tất cả; `manager` view/report/manage/close; `team_leader` view/report/manage; `guard` report; `hr` view/report.
  - `DEFAULT_INCIDENT_CATEGORIES` (Cháy nổ — critical; Trộm cắp, Xâm nhập — high; Hư hỏng thiết bị, Khác — medium; Vệ sinh / an toàn — low). Công ty mới được tạo sẵn; công ty đã có được migration thêm.
  - `type Severity = 'low' | 'medium' | 'high' | 'critical'`, `SEVERITY_ORDER`.
  - `CategoriesService.list(actor)`, `.create(actor, dto)`, `.update(actor, id, dto)`; routes `GET /api/incident-categories` (mọi người dùng của công ty), `POST`, `PATCH /api/incident-categories/:id` (`tenant.settings.manage`).
  - Mã lỗi: `INCIDENT_CATEGORY_TAKEN`, `INCIDENT_SITE_NOT_ALLOWED`, `INCIDENT_NO_SITE`, `INCIDENT_BAD_TRANSITION`, `INCIDENT_NOTE_REQUIRED`, `INCIDENT_PHOTO_REQUIRED`, `INCIDENT_CLOSE_NOT_ALLOWED`, `INCIDENT_REASON_REQUIRED`, `PUSH_DEVICE_REQUIRED`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/incident-categories.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Incident categories (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'cat');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  it('gives every new company the default categories', async () => {
    const list = (await api.get('/api/incident-categories').expect(200)).body.data;
    expect(list.map((c: { name: string; default_severity: string }) => [c.name, c.default_severity])).toEqual([
      ['Cháy nổ', 'critical'], ['Trộm cắp', 'high'], ['Xâm nhập', 'high'],
      ['Hư hỏng thiết bị', 'medium'], ['Vệ sinh / an toàn', 'low'], ['Khác', 'medium'],
    ]);
  });

  it('grants the incident permissions to the system roles', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'incident.%' ORDER BY r.code, rp.permission`,
      [admin.tenant.id],
    );
    const by = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission);
    expect(by('guard')).toEqual(['incident.report']);
    expect(by('team_leader')).toEqual(['incident.manage', 'incident.report', 'incident.view']);
    expect(by('manager')).toEqual(['incident.close', 'incident.manage', 'incident.report', 'incident.view']);
    expect(by('admin')).toContain('incident.final_escalation');
  });

  it('lets the director add and retire categories, and everyone read them', async () => {
    const created = (await api.post('/api/incident-categories', { name: 'Ngập nước', default_severity: 'high' }).expect(201)).body.data;
    expect((await api.post('/api/incident-categories', { name: 'ngập nước', default_severity: 'low' }).expect(409)).body.error.code).toBe('INCIDENT_CATEGORY_TAKEN');
    await api.patch(`/api/incident-categories/${created.id}`, { status: 'inactive' }).expect(200);
    const guard = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const seen = (await client(app, guard.token).get('/api/incident-categories').expect(200)).body.data;
    expect(seen.map((c: { name: string }) => c.name)).not.toContain('Ngập nước');
    await client(app, guard.token).post('/api/incident-categories', { name: 'X', default_severity: 'low' }).expect(403);
  });
});
```

Trong `backend/test/users.e2e-spec.ts`, vai trò `scoped_admin` thêm `'incident.view', 'incident.report', 'incident.manage', 'incident.close'` (vẫn phải bao trùm quyền của `manager`).

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- incident-categories`
Expected: FAIL — `GET /api/incident-categories` 404.

- [ ] **Step 3: Viết migration**

`backend/src/database/migrations/1760700000000-IncidentsNotifications.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'incident.view'], ['admin', 'incident.report'], ['admin', 'incident.manage'], ['admin', 'incident.close'],
  ['admin', 'incident.final_escalation'],
  ['manager', 'incident.view'], ['manager', 'incident.report'], ['manager', 'incident.manage'], ['manager', 'incident.close'],
  ['team_leader', 'incident.view'], ['team_leader', 'incident.report'], ['team_leader', 'incident.manage'],
  ['guard', 'incident.report'],
  ['hr', 'incident.view'], ['hr', 'incident.report'],
];

/** Frozen copy of the defaults at the time of this migration; later edits to the code list do not rewrite history. */
const CATEGORIES: [string, string, number][] = [
  ['Cháy nổ', 'critical', 1], ['Trộm cắp', 'high', 2], ['Xâm nhập', 'high', 3],
  ['Hư hỏng thiết bị', 'medium', 4], ['Vệ sinh / an toàn', 'low', 5], ['Khác', 'medium', 6],
];

export class IncidentsNotifications1760700000000 implements MigrationInterface {
  name = 'IncidentsNotifications1760700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE incident_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        name varchar(100) NOT NULL,
        default_severity varchar(10) NOT NULL CHECK (default_severity IN ('low', 'medium', 'high', 'critical')),
        sort integer NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX incident_categories_name_uq ON incident_categories (tenant_id, lower(name)) WHERE deleted_at IS NULL`);
    for (const [name, severity, sort] of CATEGORIES) {
      await q.query(`INSERT INTO incident_categories (tenant_id, name, default_severity, sort) SELECT id, $1, $2, $3 FROM tenants`, [name, severity, sort]);
    }

    await q.query(`
      CREATE TABLE incidents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        seq bigint GENERATED ALWAYS AS IDENTITY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        client_id uuid NOT NULL REFERENCES clients(id),
        site_id uuid REFERENCES sites(id),
        category_id uuid REFERENCES incident_categories(id),
        severity varchar(10) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        is_sos boolean NOT NULL DEFAULT false,
        title varchar(200) NOT NULL,
        description text,
        lat numeric(9, 6),
        lng numeric(9, 6),
        source varchar(20) NOT NULL CHECK (source IN ('guard_app', 'staff', 'client_report')),
        client_reporter_name varchar(200),
        client_channel varchar(20) CHECK (client_channel IN ('phone', 'zalo', 'email', 'in_person')),
        reported_by uuid NOT NULL REFERENCES users(id),
        reporter_employee_id uuid REFERENCES employees(id),
        assignee_user_id uuid REFERENCES users(id),
        status varchar(20) NOT NULL DEFAULT 'new'
          CHECK (status IN ('new', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')),
        acknowledged_at timestamptz,
        acknowledged_by uuid REFERENCES users(id),
        resolved_at timestamptz,
        resolution_note text,
        closed_at timestamptz,
        closed_by uuid REFERENCES users(id),
        rejected_reason text,
        escalation_level integer NOT NULL DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 3),
        next_escalation_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT incidents_sos_is_critical CHECK (NOT is_sos OR severity = 'critical')
      )`);
    await q.query(`CREATE INDEX incidents_tenant_status_idx ON incidents (tenant_id, status, created_at DESC)`);
    await q.query(`CREATE INDEX incidents_escalation_idx ON incidents (next_escalation_at) WHERE next_escalation_at IS NOT NULL`);

    await q.query(`
      CREATE TABLE incident_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        incident_id uuid NOT NULL REFERENCES incidents(id),
        type varchar(20) NOT NULL CHECK (type IN ('created', 'acknowledged', 'assigned', 'comment', 'status_changed', 'escalated')),
        actor_user_id uuid REFERENCES users(id),
        body text,
        from_status varchar(20),
        to_status varchar(20),
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX incident_events_incident_idx ON incident_events (incident_id, created_at)`);
    // The timeline is evidence: once written, an event is never changed or removed.
    await q.query(`
      CREATE FUNCTION incident_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'incident_events is append-only'; END $$`);
    await q.query(`CREATE TRIGGER incident_events_no_change BEFORE UPDATE OR DELETE ON incident_events FOR EACH ROW EXECUTE FUNCTION incident_events_append_only()`);

    await q.query(`
      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type varchar(40) NOT NULL,
        title varchar(200) NOT NULL,
        body text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        priority varchar(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC)`);

    await q.query(`ALTER TABLE devices ADD COLUMN push_token varchar(4096), ADD COLUMN push_token_updated_at timestamptz`);

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
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'incident.%'`);
    await q.query(`ALTER TABLE devices DROP COLUMN IF EXISTS push_token, DROP COLUMN IF EXISTS push_token_updated_at`);
    await q.query(`DROP TABLE IF EXISTS notifications`);
    await q.query(`DROP TABLE IF EXISTS incident_events`);
    await q.query(`DROP FUNCTION IF EXISTS incident_events_append_only`);
    await q.query(`DROP TABLE IF EXISTS incidents`);
    await q.query(`DROP TABLE IF EXISTS incident_categories`);
  }
}
```

- [ ] **Step 4: Quyền, danh mục mặc định, mã lỗi**

Trong `backend/src/access/permissions.ts`, thêm vào `PERMISSIONS` sau `'device.manage'`:
```ts
  'incident.view': 'Xem sự cố trong phạm vi',
  'incident.report': 'Báo sự cố, bấm SOS',
  'incident.manage': 'Tiếp nhận, giao việc, xử lý sự cố',
  'incident.close': 'Đóng sự cố',
  'incident.final_escalation': 'Nhận leo thang cuối của sự cố',
```
và `ROLE_TEMPLATES`: `manager` + `'incident.view', 'incident.report', 'incident.manage', 'incident.close'`; `team_leader` + `'incident.view', 'incident.report', 'incident.manage'`; `guard` = `['incident.report']`; `hr` + `'incident.view', 'incident.report'`.

`backend/src/incidents/categories.ts`:
```ts
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
export const SEVERITY_ORDER: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** What a new company starts with; each company edits its own list afterwards. */
export const DEFAULT_INCIDENT_CATEGORIES: { name: string; default_severity: Severity }[] = [
  { name: 'Cháy nổ', default_severity: 'critical' },
  { name: 'Trộm cắp', default_severity: 'high' },
  { name: 'Xâm nhập', default_severity: 'high' },
  { name: 'Hư hỏng thiết bị', default_severity: 'medium' },
  { name: 'Vệ sinh / an toàn', default_severity: 'low' },
  { name: 'Khác', default_severity: 'medium' },
];
```

Trong `backend/src/tenants/tenants.service.ts`, sau vòng lặp tạo vai trò (trước `insertUser`), import `DEFAULT_INCIDENT_CATEGORIES` từ `../incidents/categories` và thêm:
```ts
      for (const [i, c] of DEFAULT_INCIDENT_CATEGORIES.entries()) {
        await m.query(`INSERT INTO incident_categories (tenant_id, name, default_severity, sort) VALUES ($1, $2, $3, $4)`, [
          tenant.id, c.name, c.default_severity, i + 1,
        ]);
      }
```

Thêm vào `ERROR_CODES` (trước `CONFLICT`):
```ts
  INCIDENT_CATEGORY_TAKEN: { status: 409, message: 'Đã có loại sự cố này' },
  INCIDENT_SITE_NOT_ALLOWED: { status: 403, message: 'Bạn chỉ báo được sự cố ở mục tiêu nơi mình đang làm' },
  INCIDENT_NO_SITE: { status: 400, message: 'Bạn chưa được điều động tới khách nào nên chưa báo được sự cố' },
  INCIDENT_BAD_TRANSITION: { status: 409, message: 'Sự cố đang ở trạng thái không cho phép thao tác này' },
  INCIDENT_NOTE_REQUIRED: { status: 400, message: 'Cần ghi cách xử lý trước khi báo đã xử lý' },
  INCIDENT_PHOTO_REQUIRED: { status: 400, message: 'Sự cố mức cao và khẩn cấp cần ít nhất một ảnh trước khi báo đã xử lý' },
  INCIDENT_CLOSE_NOT_ALLOWED: { status: 403, message: 'Bạn không được đóng sự cố ở mức độ này' },
  INCIDENT_REASON_REQUIRED: { status: 400, message: 'Cần ghi lý do' },
  PUSH_DEVICE_REQUIRED: { status: 403, message: 'Chỉ đăng ký nhận thông báo được từ ứng dụng trên máy đã duyệt' },
```

- [ ] **Step 5: Viết danh mục sự cố (entity, DTO, service, controller, module)**

`backend/src/incidents/incident-category.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';
import { Severity } from './categories';

@Entity('incident_categories')
export class IncidentCategory extends TenantEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  default_severity: Severity;

  @Column('int', { default: 0 })
  sort: number;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/incidents/dto.ts`:
```ts
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';
import { SEVERITIES, Severity } from './categories';

export class CategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsIn(SEVERITIES)
  default_severity: Severity;

  @IsOptional() @IsInt() @Min(0)
  sort?: number;
}

export class UpdateCategoryDto {
  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptionalNonNull() @IsIn(SEVERITIES)
  default_severity?: Severity;

  @IsOptionalNonNull() @IsInt() @Min(0)
  sort?: number;

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class ReportIncidentDto {
  /** Where it happened. A guard may leave it out: their current shift's site is used. */
  @IsOptional() @IsUUID()
  site_id?: string;

  /** For reports about a client with no site on the system (self-managed clients). */
  @IsOptional() @IsUUID()
  client_id?: string;

  @IsUUID()
  category_id: string;

  /** Defaults to the category's severity. */
  @IsOptional() @IsIn(SEVERITIES)
  severity?: Severity;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  description: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];

  /** Office staff recording what a client told them. */
  @IsOptional() @IsIn(['staff', 'client_report'])
  source?: 'staff' | 'client_report';

  @IsOptional() @IsString() @MaxLength(200)
  client_reporter_name?: string;

  @IsOptional() @IsIn(['phone', 'zalo', 'email', 'in_person'])
  client_channel?: 'phone' | 'zalo' | 'email' | 'in_person';
}

export class SosDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class IncidentFilter {
  @IsOptional() @IsIn(['new', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected', 'open'])
  status?: string;

  @IsOptional() @IsIn(SEVERITIES)
  severity?: Severity;

  @IsOptional() @IsUUID()
  site_id?: string;

  @IsOptional() @IsUUID()
  client_id?: string;
}

export class AssignDto {
  @IsUUID()
  user_id: string;
}

export class NoteDto {
  @IsOptional() @IsString() @MaxLength(5000)
  note?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class ReasonDto {
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class CommentDto {
  @IsString() @IsNotEmpty() @MaxLength(5000)
  body: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class PushTokenDto {
  @IsString() @IsNotEmpty() @MaxLength(4096)
  token: string;
}
```

`backend/src/incidents/categories.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { CategoryDto, UpdateCategoryDto } from './dto';
import { IncidentCategory } from './incident-category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Active categories for the report form; people managing them also see retired ones. */
  async list(actor: AuthUser, includeInactive = false) {
    const rows = await this.repo().find(tenantOf(actor), { order: { sort: 'ASC', name: 'ASC' } });
    return (includeInactive ? rows : rows.filter((c) => c.status === 'active')).map((c) => ({
      id: c.id, name: c.name, default_severity: c.default_severity, sort: c.sort, status: c.status,
    }));
  }

  async create(actor: AuthUser, dto: CategoryDto) {
    const tenantId = tenantOf(actor);
    await this.assertNameFree(tenantId, dto.name, null);
    const saved = await this.repo().create(tenantId, { name: dto.name, default_severity: dto.default_severity, sort: dto.sort ?? 100 });
    await this.audit.record(null, { tenant_id: tenantId, actor_user_id: actor.id, action: 'incident_category.create', entity_type: 'incident_category', entity_id: saved.id, data: { ...dto } });
    return { id: saved.id, name: saved.name, default_severity: saved.default_severity, sort: saved.sort, status: saved.status };
  }

  async update(actor: AuthUser, id: string, dto: UpdateCategoryDto) {
    const tenantId = tenantOf(actor);
    await this.repo().get(tenantId, id);
    if (dto.name !== undefined) await this.assertNameFree(tenantId, dto.name, id);
    const saved = await this.repo().update(tenantId, id, { ...dto });
    await this.audit.record(null, { tenant_id: tenantId, actor_user_id: actor.id, action: 'incident_category.update', entity_type: 'incident_category', entity_id: id, data: { ...dto } });
    return { id: saved.id, name: saved.name, default_severity: saved.default_severity, sort: saved.sort, status: saved.status };
  }

  private repo() {
    return new TenantRepository(this.ds.getRepository(IncidentCategory));
  }

  private async assertNameFree(tenantId: string, name: string, exceptId: string | null) {
    const rows = await this.ds.query(
      `SELECT 1 FROM incident_categories WHERE tenant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [tenantId, name, exceptId],
    );
    if (rows.length) throw new BusinessException('INCIDENT_CATEGORY_TAKEN');
  }
}
```

`backend/src/incidents/incidents.controller.ts` (bắt đầu với danh mục; Task 3–4 thêm route sự cố vào cùng file):
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CategoriesService } from './categories.service';
import { CategoryDto, UpdateCategoryDto } from './dto';

@Controller()
export class IncidentsController {
  constructor(private readonly categories: CategoriesService) {}

  /** Any user of the company: guards need the list to report. */
  @Get('incident-categories')
  listCategories(@CurrentUser() user: AuthUser) {
    return this.categories.list(user);
  }

  @RequirePermission('tenant.settings.manage')
  @Get('incident-categories/all')
  allCategories(@CurrentUser() user: AuthUser) {
    return this.categories.list(user, true);
  }

  @RequirePermission('tenant.settings.manage')
  @Post('incident-categories')
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CategoryDto) {
    return this.categories.create(user, dto);
  }

  @RequirePermission('tenant.settings.manage')
  @Patch('incident-categories/:id')
  updateCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(user, id, dto);
  }
}
```

`backend/src/incidents/incidents.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { CategoriesService } from './categories.service';
import { IncidentsController } from './incidents.controller';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [CategoriesService],
  controllers: [IncidentsController],
  exports: [CategoriesService],
})
export class IncidentsModule {}
```

Trong `backend/src/app.module.ts`: import `IncidentsModule`, thêm vào cuối `imports`.

- [ ] **Step 6: Chạy test để thấy đạt, chạy toàn bộ, migrate DB dev**

Run: `cd backend && npm run test:e2e && npm run migration:run`
Expected: PASS toàn bộ (gồm `incident-categories` 3); migration `IncidentsNotifications1760700000000` chạy xong.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): incident schema, permissions and per-company categories"
```

---

### Task 2: Thông báo trong hệ thống, SSE và đẩy qua Firebase

**Files:**
- Create: `backend/src/notifications/push.ts`, `backend/src/notifications/notification.entity.ts`, `backend/src/notifications/events.service.ts`, `backend/src/notifications/notifications.service.ts`, `backend/src/notifications/notifications.controller.ts`, `backend/src/notifications/notifications.module.ts`
- Modify: `backend/package.json` (`firebase-admin`), `backend/src/devices/device.entity.ts`, `backend/test/test-env.ts`, `backend/.env.example`, `backend/src/app.module.ts`
- Test: `backend/test/notifications.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthUser.device_id`, `Device`.
- Produces:
  - `interface PushMessage { title; body; priority: 'normal' | 'high' | 'critical'; data: Record<string, string> }`; `PushService.send(userIds, message)`; `PushService.sent` (chỉ driver `memory`, cho test).
  - Driver theo `PUSH_DRIVER`: `fcm` (mặc định khi có `FCM_SERVICE_ACCOUNT`), `log` (mặc định khi không có), `memory` (test). FCM: Android `priority: high` + kênh `critical`/`default`; iOS `apns-priority` 10/5, `interruption-level: time-sensitive` cho khẩn cấp; token chết thì xoá.
  - `NotificationsService.notify(tenantId, userIds, { type, title, body, data, priority, push })` — lưu, phát SSE, đẩy (khi `push`).
  - `EventsService.emit(userIds, event)`, `.stream(userId): Observable<object>`.
  - Routes: `GET /api/me/notifications?unread`, `POST /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all`, `POST /api/me/push-token` `{token}` (cần phiên trên máy đã duyệt), `GET /api/me/events` (SSE).

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/test/test-env.ts`: `process.env.PUSH_DRIVER = 'memory'; process.env.ESCALATION_TICK = 'off';`

`backend/test/notifications.e2e-spec.ts`:
```ts
import http from 'http';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PushService } from '../src/notifications/push';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

describe('Notifications (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ntf');
  });
  afterAll(async () => app.close());

  const notify = (userIds: string[], priority: 'normal' | 'high' | 'critical', push = true) =>
    app.get(NotificationsService).notify(admin.tenant.id, userIds, { type: 'test', title: 'Có sự cố', body: 'Cầu thang B1', data: { incident_id: 'x' }, priority, push });

  it('keeps notifications to read later and marks them read', async () => {
    const u = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await notify([u.user.id], 'normal');
    await notify([u.user.id], 'high');
    const api = client(app, u.token);
    let list = (await api.get('/api/me/notifications?unread=true').expect(200)).body.data;
    expect(list.items).toHaveLength(2);
    expect(list.unread).toBe(2);
    await api.post(`/api/me/notifications/${list.items[0].id}/read`).expect(201);
    list = (await api.get('/api/me/notifications?unread=true').expect(200)).body.data;
    expect(list.unread).toBe(1);
    await api.post('/api/me/notifications/read-all').expect(201);
    expect((await api.get('/api/me/notifications?unread=true').expect(200)).body.data.unread).toBe(0);
  });

  it("pushes to the phones that registered, with the critical channel for emergencies", async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard' });
    const phone = await loginOnDevice(app, g.phone, g.password, 'ntf-phone-0001');
    await client(app, phone.token!).post('/api/me/push-token', { token: 'fcm-token-abc' }).expect(201);
    const web = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    expect((await client(app, web.token).post('/api/me/push-token', { token: 'nope' }).expect(403)).body.error.code).toBe('PUSH_DEVICE_REQUIRED');

    const push = app.get(PushService);
    push.sent.length = 0;
    await notify([g.user.id, web.user.id], 'critical');
    expect(push.sent).toEqual([expect.objectContaining({ tokens: ['fcm-token-abc'], message: expect.objectContaining({ priority: 'critical', title: 'Có sự cố' }) })]);
    push.sent.length = 0;
    await notify([g.user.id], 'normal', false);
    expect(push.sent).toEqual([]);
  });

  it('streams new notifications to an open browser tab', async () => {
    const u = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    const address = server(app).listening ? server(app).address() : await new Promise((resolve) => {
      const s = server(app).listen(0, () => resolve(s.address()));
    });
    const port = (address as { port: number }).port;
    const received = new Promise<string>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/me/events', headers: { Authorization: `Bearer ${u.token}` } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (chunk.includes('Có sự cố')) {
            resolve(chunk);
            req.destroy();
          }
        });
      });
      req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
      setTimeout(() => notify([u.user.id], 'high'), 300);
    });
    expect(await received).toContain('"type":"notification"');
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm i firebase-admin@^14 && npm run test:e2e -- notifications`
Expected: FAIL — `Cannot find module '../src/notifications/notifications.service'`.

- [ ] **Step 3: Viết đẩy thông báo**

`backend/src/notifications/push.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getEnv } from '../config/env';

export interface PushMessage {
  title: string;
  body: string;
  priority: 'normal' | 'high' | 'critical';
  data: Record<string, string>;
}

const DEAD_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
const FCM_APP_NAME = 'patrol-push';

/**
 * Sends to the phones of the given users. Only active devices with a registered
 * token receive. FCM relays to APNs, so one channel covers Android and iOS.
 */
@Injectable()
export class PushService {
  /** Messages the `memory` driver recorded — tests read this. */
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];
  private readonly logger = new Logger('Push');
  private readonly driver: 'fcm' | 'log' | 'memory';
  private fcm: { send: (tokens: string[], message: PushMessage) => Promise<string[]> } | null = null;

  constructor(private readonly ds: DataSource) {
    const configured = getEnv('PUSH_DRIVER', '');
    const account = getEnv('FCM_SERVICE_ACCOUNT', '');
    this.driver = (configured || (account ? 'fcm' : 'log')) as 'fcm' | 'log' | 'memory';
    if (this.driver === 'fcm') this.fcm = this.buildFcm(account);
    if (this.driver === 'log') this.logger.warn('FCM_SERVICE_ACCOUNT chưa cấu hình — thông báo vẫn lưu và hiện trên web, nhưng chưa đẩy tới điện thoại.');
  }

  async send(userIds: string[], message: PushMessage): Promise<void> {
    if (!userIds.length) return;
    const rows: { id: string; push_token: string }[] = await this.ds.query(
      `SELECT id, push_token FROM devices WHERE user_id = ANY($1::uuid[]) AND status = 'active' AND push_token IS NOT NULL`,
      [userIds],
    );
    if (!rows.length) return;
    const tokens = rows.map((r) => r.push_token);
    if (this.driver === 'memory') {
      this.sent.push({ tokens, message });
      return;
    }
    if (this.driver === 'log' || !this.fcm) {
      this.logger.log(`[push:${message.priority}] ${message.title} → ${tokens.length} máy`);
      return;
    }
    const dead = await this.fcm.send(tokens, message);
    if (dead.length) {
      await this.ds.query(`UPDATE devices SET push_token = NULL WHERE push_token = ANY($1::text[])`, [dead]);
    }
  }

  private buildFcm(account: string) {
    try {
      // Loaded only when configured, so tests and unconfigured servers never touch Google.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { cert, getApps, initializeApp } = require('firebase-admin/app');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getMessaging } = require('firebase-admin/messaging');
      const fbApp = getApps().find((a: { name: string }) => a.name === FCM_APP_NAME) ?? initializeApp({ credential: cert(JSON.parse(account)) }, FCM_APP_NAME);
      return {
        send: async (tokens: string[], message: PushMessage): Promise<string[]> => {
          const urgent = message.priority !== 'normal';
          const result = await getMessaging(fbApp).sendEachForMulticast({
            tokens,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: {
              priority: urgent ? 'high' : 'normal',
              notification: { channelId: message.priority === 'critical' ? 'critical' : 'default', sound: 'default' },
            },
            apns: {
              headers: { 'apns-priority': urgent ? '10' : '5' },
              payload: { aps: { sound: 'default', 'interruption-level': message.priority === 'critical' ? 'time-sensitive' : 'active' } },
            },
          });
          return result.responses
            .map((r: { success: boolean; error?: { code: string } }, i: number) => (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code) ? tokens[i] : null))
            .filter((t: string | null): t is string => t !== null);
        },
      };
    } catch (error) {
      this.logger.error(`FCM_SERVICE_ACCOUNT không hợp lệ: ${(error as Error).message}`);
      return null;
    }
  }
}
```

- [ ] **Step 4: Viết thông báo, SSE, controller, module**

`backend/src/notifications/notification.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  tenant_id: string;

  @Column('uuid')
  user_id: string;

  @Column({ length: 40 })
  type: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  data: Record<string, unknown>;

  @Column({ type: 'varchar', length: 10, default: 'normal' })
  priority: 'normal' | 'high' | 'critical';

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
```

`backend/src/notifications/events.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { filter, map, merge, Observable, Subject, interval } from 'rxjs';

/**
 * In-process fan-out for Server-Sent Events. One backend process on one VPS (spec §2),
 * so a Subject is enough; several processes would need Redis pub/sub instead.
 */
@Injectable()
export class EventsService {
  private readonly bus = new Subject<{ userIds: string[]; event: Record<string, unknown> }>();

  emit(userIds: string[], event: Record<string, unknown>): void {
    if (userIds.length) this.bus.next({ userIds, event });
  }

  /** Events for one user, plus a heartbeat every 25 s so proxies keep the connection open. */
  stream(userId: string): Observable<Record<string, unknown>> {
    return merge(
      this.bus.pipe(filter((m) => m.userIds.includes(userId)), map((m) => m.event)),
      interval(25_000).pipe(map(() => ({ type: 'ping' }))),
    );
  }
}
```

`backend/src/notifications/notifications.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { EventsService } from './events.service';
import { Notification } from './notification.entity';
import { PushService } from './push';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  priority: 'normal' | 'high' | 'critical';
  /** Also send to phones. Low-severity matters stay in the app (spec §6.2). */
  push: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly ds: DataSource,
    private readonly events: EventsService,
    private readonly push: PushService,
  ) {}

  /** Store, stream, push. Storing happens in `m` when given, so it rolls back with the change that caused it. */
  async notify(tenantId: string, userIds: string[], input: NotifyInput, m: EntityManager = this.ds.manager): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const rows = ids.map((user_id) =>
      m.create(Notification, { tenant_id: tenantId, user_id, type: input.type, title: input.title, body: input.body, data: input.data, priority: input.priority }),
    );
    await m.save(rows);
    for (const row of rows) {
      this.events.emit([row.user_id], { type: 'notification', id: row.id, kind: input.type, title: input.title, body: input.body, data: input.data, priority: input.priority });
    }
    if (input.push) await this.push.send(ids, { title: input.title, body: input.body, priority: input.priority, data: { type: input.type, ...input.data } });
  }

  async mine(actor: AuthUser, unreadOnly: boolean) {
    const where = { user_id: actor.id, tenant_id: tenantOf(actor), ...(unreadOnly ? { read_at: IsNull() } : {}) };
    const [items, unread] = await Promise.all([
      this.ds.getRepository(Notification).find({ where, order: { created_at: 'DESC' }, take: 50 }),
      this.ds.getRepository(Notification).count({ where: { user_id: actor.id, read_at: IsNull() } }),
    ]);
    return { items, unread };
  }

  async read(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const result = await this.ds.getRepository(Notification).update({ id, user_id: actor.id, read_at: IsNull() }, { read_at: new Date() });
    if (!result.affected) {
      const exists = await this.ds.getRepository(Notification).exists({ where: { id, user_id: actor.id } });
      if (!exists) throw new BusinessException('NOT_FOUND');
    }
    return { ok: true };
  }

  async readAll(actor: AuthUser): Promise<{ ok: true }> {
    await this.ds.getRepository(Notification).update({ user_id: actor.id, read_at: IsNull() }, { read_at: new Date() });
    return { ok: true };
  }

  /** The phone the caller signed in from receives pushes from now on. */
  async registerPushToken(actor: AuthUser, token: string): Promise<{ ok: true }> {
    if (!actor.device_id) throw new BusinessException('PUSH_DEVICE_REQUIRED');
    // A token belongs to one installation: take it away from any other device row that still holds it.
    await this.ds.query(`UPDATE devices SET push_token = NULL WHERE push_token = $1 AND id <> $2`, [token, actor.device_id]);
    await this.ds.query(`UPDATE devices SET push_token = $2, push_token_updated_at = now() WHERE id = $1`, [actor.device_id, token]);
    return { ok: true };
  }
}
```

`backend/src/notifications/notifications.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Sse } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Observable } from 'rxjs';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { PushTokenDto } from '../incidents/dto';
import { EventsService } from './events.service';
import { NotificationsService } from './notifications.service';

class NotificationFilter {
  @IsOptional() @IsIn(['true', 'false'])
  unread?: string;
}

/** Every route is the caller's own: no permission beyond belonging to the company. */
@Controller('me')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser, @Query() filter: NotificationFilter) {
    return this.notifications.mine(user, filter.unread === 'true');
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.readAll(user);
  }

  @Post('notifications/:id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.read(user, id);
  }

  @Post('push-token')
  pushToken(@CurrentUser() user: AuthUser, @Body() dto: PushTokenDto) {
    return this.notifications.registerPushToken(user, dto.token);
  }

  /** Live updates for the web. The envelope interceptor turns each event into `{ data: event }`, which is an SSE message. */
  @Sse('events')
  stream(@CurrentUser() user: AuthUser): Observable<Record<string, unknown>> {
    return this.events.stream(user.id);
  }
}
```

`backend/src/notifications/notifications.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push';

@Module({
  providers: [PushService, EventsService, NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService, EventsService, PushService],
})
export class NotificationsModule {}
```

`backend/src/devices/device.entity.ts`: thêm
```ts
  @Column({ type: 'varchar', length: 4096, nullable: true, select: false })
  push_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  push_token_updated_at: Date | null;
```

`backend/.env.example`: thêm
```
# Khoá dịch vụ Firebase (nội dung JSON, một dòng). Để trống: thông báo vẫn lưu và hiện trên web, chưa đẩy tới điện thoại.
FCM_SERVICE_ACCOUNT=
# fcm | log | memory (test). Để trống thì tự chọn theo FCM_SERVICE_ACCOUNT.
PUSH_DRIVER=
# on | off — vòng quét leo thang sự cố mỗi phút.
ESCALATION_TICK=on
```

Trong `backend/src/app.module.ts`: import `NotificationsModule`, thêm vào cuối `imports`.

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- notifications`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): stored notifications with live SSE and Firebase push, phone token registration"
```

---

### Task 3: Báo sự cố, SOS, xem theo phạm vi

**Files:**
- Create: `backend/src/incidents/incident.entity.ts`, `backend/src/incidents/incidents.service.ts`
- Modify: `backend/src/incidents/incidents.controller.ts`, `backend/src/incidents/incidents.module.ts`, `backend/src/files/file.entity.ts`, `backend/src/files/files.service.ts`
- Test: `backend/test/incidents.e2e-spec.ts`

**Interfaces:**
- Consumes: `ScopeService` (`siteVisibility`, `clientVisibility`, `canSeeSite`, `canSeeClient`), `PermissionService`, `FilesService.claim`, `todayLocal`.
- Produces:
  - `IncidentRow` (mọi cột của `incidents` + `code` dạng `SC-000123`, `client_name`, `site_name`, `category_name`, `reporter_name`, `assignee_name`); `IncidentDetail = IncidentRow & { events: EventRow[]; files: FileView[] }`.
  - `IncidentsService.report(actor, dto)`, `.sos(actor, dto)`, `.list(actor, filter)`, `.get(actor, id)`, `.lockVisible(m, actor, id)` (cho Task 4–5), `.canSee(actor, incident)`.
  - Routes: `POST /api/incidents` (`incident.report`), `POST /api/incidents/sos` (`incident.report`), `GET /api/incidents?status&severity&site_id&client_id` (đăng nhập; người không có `incident.view` chỉ thấy sự cố mình báo), `GET /api/incidents/:id`.
  - Quy tắc: bảo vệ báo cho mục tiêu thuộc **khách mình đang được điều động** hôm nay; bỏ trống `site_id` thì lấy mục tiêu của ca đang trực (từ 60 phút trước giờ vào ca tới giờ ra ca), không có ca thì gắn khách đang được điều động. `source: staff | client_report` cần `incident.manage` và thấy mục tiêu/khách.
  - `FileOwnerType` thêm `'incident'`: ảnh xem được bởi người báo, hoặc người có `incident.view` thấy mục tiêu/khách của sự cố.

- [ ] **Step 1: Viết test thất bại**

`backend/test/incidents.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Incidents — reporting and visibility (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'inc');
    api = client(app, admin.token);
    ids.category = (await api.get('/api/incident-categories').expect(200)).body.data.find((c: { name: string }) => c.name === 'Trộm cắp').id;
    ids.clientA = (await api.post('/api/clients', { code: 'KA', name: 'Khách A' }).expect(201)).body.data.id;
    ids.clientB = (await api.post('/api/clients', { code: 'KB', name: 'Khách B' }).expect(201)).body.data.id;
    ids.self = (await api.post('/api/clients', { code: 'KS', name: 'Khách tự quản', management_mode: 'self_managed' }).expect(201)).body.data.id;
    ids.teamA = (await api.post('/api/org/teams', { name: 'Đội A' }).expect(201)).body.data.id;
    ids.siteA = (await api.post('/api/sites', { client_id: ids.clientA, code: 'SA', name: 'Toà A', responsible_team_id: ids.teamA }).expect(201)).body.data.id;
    ids.siteB = (await api.post('/api/sites', { client_id: ids.clientB, code: 'SB', name: 'Kho B' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  async function guardAt(clientId: string, team = ids.teamA) {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `IG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e.id }).expect(201);
    await api.post('/api/deployments', { employee_id: e.id, client_id: clientId, start_date: addDays(todayLocal(), -5) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e.id });
    return { employee: e, user: u, api: client(app, u.token), token: u.token };
  }
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'anh.jpg').expect(201)).body.data.id;

  it('lets a guard report at a site of the client they are posted to, with photos', async () => {
    const g = await guardAt(ids.clientA);
    const file = await photo(g.token);
    const res = (await g.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'Mất bình cứu hoả tầng 2', lat: 21.03, lng: 105.78, file_ids: [file] }).expect(201)).body.data;
    expect(res).toMatchObject({ status: 'new', severity: 'high', title: 'Trộm cắp', source: 'guard_app', site_name: 'Toà A', client_name: 'Khách A', reporter_name: g.user.user.full_name });
    expect(res.code).toMatch(/^SC-\d{6}$/);
    const detail = (await g.api.get(`/api/incidents/${res.id}`).expect(200)).body.data;
    expect(detail.files.map((f: { id: string }) => f.id)).toEqual([file]);
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(['created']);
    await g.api.get(`/api/files/${file}`).expect(200);
  });

  it("refuses a report at another client's site and the office-only sources", async () => {
    const g = await guardAt(ids.clientA);
    const res = await g.api.post('/api/incidents', { site_id: ids.siteB, category_id: ids.category, description: 'x' }).expect(403);
    expect(res.body.error.code).toBe('INCIDENT_SITE_NOT_ALLOWED');
    await g.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'x', source: 'client_report' }).expect(403);
  });

  it('places an SOS at the site of the current shift, or at the client when off shift', async () => {
    const onShift = await guardAt(ids.clientA);
    await api.post('/api/roster', { site_id: ids.siteA, employee_id: onShift.employee.id, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
    const sos = (await onShift.api.post('/api/incidents/sos', { lat: 21.03, lng: 105.78 }).expect(201)).body.data;
    expect(sos).toMatchObject({ is_sos: true, severity: 'critical', site_id: ids.siteA, client_id: ids.clientA });

    const offShift = await guardAt(ids.clientB);
    const off = (await offShift.api.post('/api/incidents/sos', { lat: 21, lng: 105 }).expect(201)).body.data;
    expect(off).toMatchObject({ site_id: null, client_id: ids.clientB });

    const loose = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    expect((await client(app, loose.token).post('/api/incidents/sos', { lat: 21, lng: 105 }).expect(400)).body.error.code).toBe('INCIDENT_NO_SITE');
  });

  it('records what a client reported by phone, also for self-managed clients', async () => {
    const res = (await api.post('/api/incidents', {
      client_id: ids.self, category_id: ids.category, description: 'Khách báo mất hàng ở kho', source: 'client_report',
      client_reporter_name: 'Anh Tuấn — quản lý kho', client_channel: 'phone',
    }).expect(201)).body.data;
    expect(res).toMatchObject({ source: 'client_report', site_id: null, client_name: 'Khách tự quản', client_channel: 'phone' });
  });

  it("shows guards their own reports, and leaders their team's sites, nothing else", async () => {
    const g1 = await guardAt(ids.clientA);
    const g2 = await guardAt(ids.clientA);
    const mine = (await g1.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'của g1' }).expect(201)).body.data;
    const theirs = (await g2.api.post('/api/incidents', { site_id: ids.siteA, category_id: ids.category, description: 'của g2' }).expect(201)).body.data;
    const gB = await guardAt(ids.clientB, (await api.post('/api/org/teams', { name: `Đội B${++seq}` }).expect(201)).body.data.id);
    const atB = (await gB.api.post('/api/incidents', { site_id: ids.siteB, category_id: ids.category, description: 'ở kho B' }).expect(201)).body.data;

    const own = (await g1.api.get('/api/incidents').expect(200)).body.data.map((i: { id: string }) => i.id);
    expect(own).toContain(mine.id);
    expect(own).not.toContain(theirs.id);
    await g1.api.get(`/api/incidents/${theirs.id}`).expect(404);

    const lead = (await api.post('/api/employees', { code: `IL${++seq}`, full_name: 'Đội trưởng A' }).expect(201)).body.data;
    await api.post(`/api/org/teams/${ids.teamA}/members`, { employee_id: lead.id }).expect(201);
    await api.put(`/api/org/teams/${ids.teamA}/leader`, { employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    const seen = (await client(app, leader.token).get('/api/incidents').expect(200)).body.data.map((i: { id: string }) => i.id);
    expect(seen).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    expect(seen).not.toContain(atB.id);
    await client(app, leader.token).get(`/api/incidents/${atB.id}`).expect(404);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- incidents`
Expected: FAIL — `POST /api/incidents` 404.

- [ ] **Step 3: Viết entity và service**

`backend/src/incidents/incident.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';
import { Severity } from './categories';

export type IncidentStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
export type IncidentSource = 'guard_app' | 'staff' | 'client_report';

@Entity('incidents')
export class Incident extends TenantEntity {
  /** Generated by PostgreSQL (identity); read-only here. Shown to people as SC-000123. */
  @Column({ type: 'bigint', insert: false, update: false })
  seq: string;

  @Column('uuid')
  client_id: string;

  @Column({ type: 'uuid', nullable: true })
  site_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  category_id: string | null;

  @Column({ type: 'varchar', length: 10 })
  severity: Severity;

  @Column({ default: false })
  is_sos: boolean;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column({ type: 'varchar', length: 20 })
  source: IncidentSource;

  @Column({ type: 'varchar', length: 200, nullable: true })
  client_reporter_name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  client_channel: string | null;

  @Column('uuid')
  reported_by: string;

  @Column({ type: 'uuid', nullable: true })
  reporter_employee_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignee_user_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'new' })
  status: IncidentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  acknowledged_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'text', nullable: true })
  resolution_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  closed_by: string | null;

  @Column({ type: 'text', nullable: true })
  rejected_reason: string | null;

  @Column('int', { default: 1 })
  escalation_level: number;

  @Column({ type: 'timestamptz', nullable: true })
  next_escalation_at: Date | null;
}
```

`backend/src/incidents/incidents.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { IncidentFilter, ReportIncidentDto, SosDto } from './dto';
import { Incident } from './incident.entity';

const SHIFT_EARLY_MS = 60 * 60_000;

export const INCIDENT_ROWS = `
  SELECT i.id, i.seq, 'SC-' || lpad(i.seq::text, 6, '0') AS code, i.client_id, c.name AS client_name, i.site_id, s.name AS site_name,
         i.category_id, k.name AS category_name, i.severity, i.is_sos, i.title, i.description, i.lat, i.lng, i.source,
         i.client_reporter_name, i.client_channel, i.reported_by, ru.full_name AS reporter_name, i.assignee_user_id,
         au.full_name AS assignee_name, i.status, i.acknowledged_at, i.acknowledged_by, i.resolved_at, i.resolution_note,
         i.closed_at, i.rejected_reason, i.escalation_level, i.created_at, i.updated_at
    FROM incidents i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN sites s ON s.id = i.site_id
    LEFT JOIN incident_categories k ON k.id = i.category_id
    LEFT JOIN users ru ON ru.id = i.reported_by
    LEFT JOIN users au ON au.id = i.assignee_user_id
   WHERE i.tenant_id = $1`;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly files: FilesService,
  ) {}

  /** A report from the field (guards) or from the office on a client's behalf. */
  async report(actor: AuthUser, dto: ReportIncidentDto) {
    const tenantId = tenantOf(actor);
    const [category] = await this.ds.query(
      `SELECT id, name, default_severity FROM incident_categories WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`,
      [dto.category_id, tenantId],
    );
    if (!category) throw new BusinessException('NOT_FOUND');
    const place = dto.source ? await this.officePlace(actor, dto) : await this.fieldPlace(actor, dto.site_id ?? null);
    return this.create(actor, {
      ...place,
      category_id: category.id,
      severity: dto.severity ?? category.default_severity,
      is_sos: false,
      title: dto.title?.trim() || category.name,
      description: dto.description,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      source: dto.source ?? 'guard_app',
      client_reporter_name: dto.client_reporter_name ?? null,
      client_channel: dto.client_channel ?? null,
      file_ids: dto.file_ids ?? [],
    });
  }

  /** One press: critical, located, sent. Photos can follow as comments. */
  async sos(actor: AuthUser, dto: SosDto) {
    const place = await this.fieldPlace(actor, null);
    return this.create(actor, {
      ...place, category_id: null, severity: 'critical', is_sos: true, title: 'SOS — cần hỗ trợ khẩn cấp',
      description: dto.note ?? null, lat: dto.lat, lng: dto.lng, source: 'guard_app',
      client_reporter_name: null, client_channel: null, file_ids: [],
    });
  }

  async list(actor: AuthUser, filter: IncidentFilter) {
    const tenantId = tenantOf(actor);
    const params: unknown[] = [tenantId];
    let sql = INCIDENT_ROWS + (await this.visibility(actor, params));
    if (filter.status === 'open') sql += ` AND i.status IN ('new', 'acknowledged', 'in_progress', 'resolved')`;
    else if (filter.status) {
      params.push(filter.status);
      sql += ` AND i.status = $${params.length}`;
    }
    for (const key of ['severity', 'site_id', 'client_id'] as const) {
      if (filter[key]) {
        params.push(filter[key]);
        sql += ` AND i.${key} = $${params.length}`;
      }
    }
    return this.ds.query(`${sql} ORDER BY (i.status = 'new') DESC, i.created_at DESC LIMIT 200`, params);
  }

  async get(actor: AuthUser, id: string) {
    const tenantId = tenantOf(actor);
    const params: unknown[] = [tenantId];
    const sql = INCIDENT_ROWS + (await this.visibility(actor, params));
    params.push(id);
    const [row] = await this.ds.query(`${sql} AND i.id = $${params.length}`, params);
    if (!row) throw new BusinessException('NOT_FOUND');
    const events = await this.ds.query(
      `SELECT e.id, e.type, e.actor_user_id, u.full_name AS actor_name, e.body, e.from_status, e.to_status, e.data, e.created_at
         FROM incident_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.incident_id = $1 ORDER BY e.created_at, e.id`,
      [id],
    );
    const files = await this.ds.query(
      `SELECT id, original_name, mime, size, created_at FROM files WHERE owner_type = 'incident' AND owner_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    );
    return { ...row, events, files };
  }

  /** The incident row locked for change, if the caller can see it. */
  async lockVisible(m: EntityManager, actor: AuthUser, id: string): Promise<Incident> {
    const [row] = await m.query(`SELECT id FROM incidents WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const incident = await m.findOneByOrFail(Incident, { id });
    if (!(await this.canSee(actor, incident))) throw new BusinessException('NOT_FOUND');
    return incident;
  }

  async canSee(actor: AuthUser, incident: Pick<Incident, 'reported_by' | 'site_id' | 'client_id'>): Promise<boolean> {
    if (incident.reported_by === actor.id) return true;
    if (!(await this.permissions.has(actor.id, ['incident.view']))) return false;
    return incident.site_id ? this.scopes.canSeeSite(actor, incident.site_id) : this.scopes.canSeeClient(actor, incident.client_id);
  }

  /** Writes the incident, its first event and its photos. Notifying people is the escalation service's job (Task 5). */
  protected async create(actor: AuthUser, input: NewIncident) {
    const tenantId = tenantOf(actor);
    const id = await this.ds.transaction(async (m) => {
      const saved = await m.save(
        m.create(Incident, {
          tenant_id: tenantId, client_id: input.client_id, site_id: input.site_id, category_id: input.category_id,
          severity: input.severity, is_sos: input.is_sos, title: input.title, description: input.description,
          lat: input.lat === null ? null : String(input.lat), lng: input.lng === null ? null : String(input.lng),
          source: input.source, client_reporter_name: input.client_reporter_name, client_channel: input.client_channel,
          reported_by: actor.id, reporter_employee_id: actor.employee_id, status: 'new',
        }),
      );
      for (const fileId of input.file_ids) await this.files.claim(m, tenantId, fileId, { type: 'incident', id: saved.id });
      await m.query(
        `INSERT INTO incident_events (tenant_id, incident_id, type, actor_user_id, to_status, data) VALUES ($1, $2, 'created', $3, 'new', $4)`,
        [tenantId, saved.id, actor.id, JSON.stringify({ severity: input.severity, is_sos: input.is_sos, source: input.source })],
      );
      await this.afterCreate(m, saved);
      return saved.id;
    });
    return this.get(actor, id);
  }

  /** Hook for Task 5: routing and first notifications run inside the creating transaction. */
  protected async afterCreate(_m: EntityManager, _incident: Incident): Promise<void> {}

  /** A guard reports where they work: a site of a client they are posted to today, else their current shift's site. */
  private async fieldPlace(actor: AuthUser, siteId: string | null): Promise<{ client_id: string; site_id: string | null }> {
    if (!actor.employee_id) throw new BusinessException('INCIDENT_NO_SITE');
    const today = new Date();
    const posted: { client_id: string }[] = await this.ds.query(
      `SELECT client_id FROM deployments WHERE employee_id = $1 AND tenant_id = $2
          AND start_date <= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
          AND (end_date IS NULL OR end_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`,
      [actor.employee_id, tenantOf(actor)],
    );
    if (siteId) {
      const [site] = await this.ds.query(`SELECT id, client_id FROM sites WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [siteId, tenantOf(actor)]);
      if (!site) throw new BusinessException('NOT_FOUND');
      if (!posted.some((p) => p.client_id === site.client_id)) throw new BusinessException('INCIDENT_SITE_NOT_ALLOWED');
      return { client_id: site.client_id, site_id: site.id };
    }
    const [shift] = await this.ds.query(
      `SELECT a.site_id, s.client_id FROM shift_assignments a JOIN sites s ON s.id = a.site_id
        WHERE a.employee_id = $1 AND a.tenant_id = $2 AND a.status = 'planned'
          AND a.planned_start - make_interval(secs => $3) <= $4 AND a.planned_end >= $4
        ORDER BY a.planned_start LIMIT 1`,
      [actor.employee_id, tenantOf(actor), SHIFT_EARLY_MS / 1000, today],
    );
    if (shift) return { client_id: shift.client_id, site_id: shift.site_id };
    if (posted.length) return { client_id: posted[0].client_id, site_id: null };
    throw new BusinessException('INCIDENT_NO_SITE');
  }

  /** The office records a report: it must see the site, or the client when there is no site. */
  private async officePlace(actor: AuthUser, dto: ReportIncidentDto): Promise<{ client_id: string; site_id: string | null }> {
    if (!(await this.permissions.has(actor.id, ['incident.manage']))) throw new BusinessException('AUTH_FORBIDDEN');
    if (dto.site_id) {
      if (!(await this.scopes.canSeeSite(actor, dto.site_id))) throw new BusinessException('NOT_FOUND');
      const [site] = await this.ds.query(`SELECT client_id FROM sites WHERE id = $1`, [dto.site_id]);
      return { client_id: site.client_id, site_id: dto.site_id };
    }
    if (!dto.client_id) throw new BusinessException('VALIDATION_FAILED', ['site_id hoặc client_id: cần chọn nơi xảy ra']);
    if (!(await this.scopes.canSeeClient(actor, dto.client_id))) throw new BusinessException('NOT_FOUND');
    return { client_id: dto.client_id, site_id: null };
  }

  /** SQL filter for what the caller may see: everything in scope with incident.view, otherwise their own reports. */
  private async visibility(actor: AuthUser, params: unknown[]): Promise<string> {
    params.push(actor.id);
    const self = `$${params.length}`;
    if (!(await this.permissions.has(actor.id, ['incident.view']))) return ` AND i.reported_by = ${self}`;
    const [sites, clients] = await Promise.all([this.scopes.siteVisibility(actor), this.scopes.clientVisibility(actor)]);
    if (sites.all) return '';
    params.push(sites.siteIds, clients.all ? [] : clients.clientIds);
    const s = `$${params.length - 1}`;
    const c = `$${params.length}`;
    return ` AND (i.reported_by = ${self} OR i.site_id = ANY(${s}::uuid[]) OR (i.site_id IS NULL AND i.client_id = ANY(${c}::uuid[])))`;
  }
}

export interface NewIncident {
  client_id: string;
  site_id: string | null;
  category_id: string | null;
  severity: Incident['severity'];
  is_sos: boolean;
  title: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  source: Incident['source'];
  client_reporter_name: string | null;
  client_channel: string | null;
  file_ids: string[];
}
```

- [ ] **Step 4: Gắn vào controller, module, quyền xem ảnh**

Trong `backend/src/incidents/incidents.controller.ts`: constructor nhận thêm `private readonly incidents: IncidentsService`; import `IncidentFilter, ReportIncidentDto, SosDto`, `Query`; thêm:
```ts
  @RequirePermission('incident.report')
  @Post('incidents')
  report(@CurrentUser() user: AuthUser, @Body() dto: ReportIncidentDto) {
    return this.incidents.report(user, dto);
  }

  @RequirePermission('incident.report')
  @Post('incidents/sos')
  sos(@CurrentUser() user: AuthUser, @Body() dto: SosDto) {
    return this.incidents.sos(user, dto);
  }

  /** Signed-in users of the company; the service narrows the list to what each may see. */
  @Get('incidents')
  list(@CurrentUser() user: AuthUser, @Query() filter: IncidentFilter) {
    return this.incidents.list(user, filter);
  }

  @Get('incidents/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.get(user, id);
  }
```
(route `incidents/sos` khai báo trước `incidents/:id`).

`backend/src/incidents/incidents.module.ts`: `imports` thêm `FilesModule`; `providers`/`exports` thêm `IncidentsService`.

`backend/src/files/file.entity.ts`: `FileOwnerType` thêm `| 'incident'`.

`backend/src/files/files.service.ts`, trong `maySee` trước `return false;` cuối:
```ts
    if (file.owner_type === 'incident') {
      const [row] = await this.ds.query(`SELECT reported_by, site_id, client_id FROM incidents WHERE id = $1`, [file.owner_id]);
      if (!row) return false;
      if (row.reported_by === actor.id) return true;
      if (!(await this.permissions.has(actor.id, ['incident.view']))) return false;
      return row.site_id ? this.scopes.canSeeSite(actor, row.site_id) : this.scopes.canSeeClient(actor, row.client_id);
    }
```

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- incidents`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): incident reports and SOS from the field and the office, scoped visibility"
```

---

### Task 4: Quy trình xử lý sự cố

**Files:**
- Create: `backend/src/incidents/workflow.service.ts`
- Modify: `backend/src/incidents/incidents.controller.ts`, `backend/src/incidents/incidents.module.ts`
- Test: `backend/test/incident-workflow.e2e-spec.ts`

**Interfaces:**
- Consumes: `IncidentsService.lockVisible`, `PermissionService`, `FilesService.claim`, `NotificationsService.notify`, `EventsService.emit`, `SettingsService.effective`, `SEVERITY_ORDER`.
- Produces:
  - `WorkflowService.acknowledge`, `.assign(actor, id, userId)`, `.start`, `.resolve(actor, id, { note, file_ids })`, `.close`, `.reopen(actor, id, reason)`, `.reject(actor, id, reason)`, `.comment(actor, id, { body, file_ids })` — đều trả `IncidentDetail`.
  - Routes: `POST /api/incidents/:id/acknowledge | assign | start | resolve | close | reopen | reject | comments`.
  - Ai làm gì: tiếp nhận, giao việc, báo nhầm, mở lại — `incident.manage`; bắt đầu xử lý, báo đã xử lý — `incident.manage` hoặc người được giao; đóng — `incident.close`, hoặc `incident.manage` khi mức độ ≤ `incident_close_by_leader_up_to` của mục tiêu; bình luận — ai thấy sự cố.
  - Người báo nhận thông báo khi sự cố được tiếp nhận, xử lý xong, đóng, bị đánh dấu báo nhầm; người được giao nhận thông báo khi được giao.

- [ ] **Step 1: Viết test thất bại**

`backend/test/incident-workflow.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

describe('Incidents — workflow (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let guard: { api: ReturnType<typeof client>; token: string; userId: string };
  let leader: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'wf');
    api = client(app, admin.token);
    const cats = (await api.get('/api/incident-categories').expect(200)).body.data as { id: string; name: string }[];
    ids.medium = cats.find((c) => c.name === 'Hư hỏng thiết bị')!.id;
    ids.high = cats.find((c) => c.name === 'Trộm cắp')!.id;
    ids.client = (await api.post('/api/clients', { code: 'WK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'WS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    const emp = async (code: string) => {
      const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
      await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
      await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
      return e;
    };
    const lead = await emp('LEAD');
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).token);
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: await emp('GUARD') });
    guard = { api: client(app, g.token), token: g.token, userId: g.user.id };
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
  });
  afterAll(async () => app.close());

  const report = async (category: 'medium' | 'high') =>
    (await guard.api.post('/api/incidents', { site_id: ids.site, category_id: ids[category], description: 'Hỏng khoá cửa' }).expect(201)).body.data;
  const photo = async () =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${guard.token}`).attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg').expect(201)).body.data.id;

  it('walks an incident from report to closed and keeps the whole timeline', async () => {
    const i = await report('medium');
    await leader.post(`/api/incidents/${i.id}/acknowledge`).expect(201);
    const mine = (await guard.api.get('/api/me/notifications').expect(200)).body.data.items;
    expect(mine.map((n: { type: string }) => n.type)).toContain('incident.acknowledged');
    await leader.post(`/api/incidents/${i.id}/assign`, { user_id: guard.userId }).expect(201);
    await guard.api.post(`/api/incidents/${i.id}/start`).expect(201);
    expect((await guard.api.post(`/api/incidents/${i.id}/resolve`, {}).expect(400)).body.error.code).toBe('INCIDENT_NOTE_REQUIRED');
    await guard.api.post(`/api/incidents/${i.id}/resolve`, { note: 'Đã thay khoá mới' }).expect(201);
    expect((await leader.post(`/api/incidents/${i.id}/close`).expect(403)).body.error.code).toBe('INCIDENT_CLOSE_NOT_ALLOWED');
    const closed = (await manager.post(`/api/incidents/${i.id}/close`).expect(201)).body.data;
    expect(closed).toMatchObject({ status: 'closed', resolution_note: 'Đã thay khoá mới', assignee_user_id: guard.userId });
    expect(closed.events.map((e: { type: string; to_status: string | null }) => `${e.type}:${e.to_status ?? ''}`)).toEqual([
      'created:new', 'acknowledged:acknowledged', 'assigned:', 'status_changed:in_progress', 'status_changed:resolved', 'status_changed:closed',
    ]);
  });

  it('asks for a photo before a high incident is marked resolved', async () => {
    const i = await report('high');
    await leader.post(`/api/incidents/${i.id}/acknowledge`).expect(201);
    await leader.post(`/api/incidents/${i.id}/start`).expect(201);
    expect((await leader.post(`/api/incidents/${i.id}/resolve`, { note: 'Đã báo công an' }).expect(400)).body.error.code).toBe('INCIDENT_PHOTO_REQUIRED');
    await guard.api.post(`/api/incidents/${i.id}/comments`, { body: 'Ảnh hiện trường', file_ids: [await photo()] }).expect(201);
    await leader.post(`/api/incidents/${i.id}/resolve`, { note: 'Đã báo công an' }).expect(201);
  });

  it("lets team leaders close up to the level the site allows", async () => {
    await api.patch(`/api/sites/${ids.site}/settings`, { incident_close_by_leader_up_to: 'medium' }).expect(200);
    const medium = await report('medium');
    for (const step of ['acknowledge', 'start']) await leader.post(`/api/incidents/${medium.id}/${step}`).expect(201);
    await leader.post(`/api/incidents/${medium.id}/resolve`, { note: 'xong' }).expect(201);
    await leader.post(`/api/incidents/${medium.id}/close`).expect(201);

    const high = await report('high');
    await guard.api.post(`/api/incidents/${high.id}/comments`, { body: 'ảnh', file_ids: [await photo()] }).expect(201);
    for (const step of ['acknowledge', 'start']) await leader.post(`/api/incidents/${high.id}/${step}`).expect(201);
    await leader.post(`/api/incidents/${high.id}/resolve`, { note: 'xong' }).expect(201);
    await leader.post(`/api/incidents/${high.id}/close`).expect(403);
    await api.patch(`/api/sites/${ids.site}/settings`, { incident_close_by_leader_up_to: null }).expect(200);
  });

  it('refuses moves that skip steps, and marks false alarms only with a reason', async () => {
    const i = await report('medium');
    expect((await manager.post(`/api/incidents/${i.id}/close`).expect(409)).body.error.code).toBe('INCIDENT_BAD_TRANSITION');
    expect((await leader.post(`/api/incidents/${i.id}/reject`, {}).expect(400)).body.error.code).toBe('INCIDENT_REASON_REQUIRED');
    await leader.post(`/api/incidents/${i.id}/reject`, { reason: 'Bảo vệ báo nhầm, cửa vẫn khoá' }).expect(201);
    await leader.post(`/api/incidents/${i.id}/acknowledge`).expect(409);

    const j = await report('medium');
    await guard.api.post(`/api/incidents/${j.id}/acknowledge`).expect(403);
    for (const step of ['acknowledge', 'start']) await leader.post(`/api/incidents/${j.id}/${step}`).expect(201);
    await leader.post(`/api/incidents/${j.id}/resolve`, { note: 'xong' }).expect(201);
    await leader.post(`/api/incidents/${j.id}/reopen`, {}).expect(400);
    const back = (await leader.post(`/api/incidents/${j.id}/reopen`, { reason: 'Khoá lại hỏng' }).expect(201)).body.data;
    expect(back.status).toBe('in_progress');
  });

  it('keeps the timeline append-only', async () => {
    const i = await report('medium');
    await expect(ds.query(`UPDATE incident_events SET body = 'sửa' WHERE incident_id = $1`, [i.id])).rejects.toThrow(/append-only/);
    await expect(ds.query(`DELETE FROM incident_events WHERE incident_id = $1`, [i.id])).rejects.toThrow(/append-only/);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- incident-workflow`
Expected: FAIL — `POST /api/incidents/:id/acknowledge` 404 (test append-only đã đạt nhờ trigger ở Task 1).

- [ ] **Step 3: Viết service**

`backend/src/incidents/workflow.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { EventsService } from '../notifications/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { SEVERITY_ORDER } from './categories';
import { Incident, IncidentStatus } from './incident.entity';
import { IncidentsService } from './incidents.service';

type Who = 'manage' | 'manage_or_assignee' | 'close';

interface Move {
  from: IncidentStatus[];
  to: IncidentStatus;
  who: Who;
  /** Checks and extra columns, run with the locked row. */
  prepare?: (m: EntityManager, incident: Incident) => Promise<Partial<Incident>>;
  body?: string | null;
  notifyReporter?: { type: string; title: string };
}

const CLOSE_LEVEL: Record<string, number> = { none: 0, low: 1, medium: 2 };

@Injectable()
export class WorkflowService {
  constructor(
    private readonly ds: DataSource,
    private readonly incidents: IncidentsService,
    private readonly permissions: PermissionService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
  ) {}

  /** "Tôi tiếp nhận": the clock stops, nobody else is chased. */
  acknowledge(actor: AuthUser, id: string) {
    return this.move(actor, id, {
      from: ['new'], to: 'acknowledged', who: 'manage',
      prepare: async () => ({ acknowledged_at: new Date(), acknowledged_by: actor.id, next_escalation_at: null }),
      notifyReporter: { type: 'incident.acknowledged', title: 'Sự cố đã được tiếp nhận' },
    }, 'acknowledged');
  }

  async assign(actor: AuthUser, id: string, userId: string) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const incident = await this.incidents.lockVisible(m, actor, id);
      await this.require(actor, incident, 'manage');
      if (incident.status === 'closed' || incident.status === 'rejected') throw new BusinessException('INCIDENT_BAD_TRANSITION');
      const [user] = await m.query(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`, [userId, tenantId]);
      if (!user) throw new BusinessException('NOT_FOUND');
      await m.update(Incident, { id }, { assignee_user_id: userId });
      await this.event(m, incident, actor, 'assigned', null, null, null, { user_id: userId });
      await this.notifications.notify(tenantId, [userId], {
        type: 'incident.assigned', title: `Bạn được giao xử lý · ${incident.title}`, body: incident.description ?? '',
        data: { incident_id: id }, priority: 'high', push: true,
      }, m);
    });
    return this.done(actor, id);
  }

  start(actor: AuthUser, id: string) {
    return this.move(actor, id, { from: ['acknowledged'], to: 'in_progress', who: 'manage_or_assignee' });
  }

  resolve(actor: AuthUser, id: string, input: { note?: string; file_ids?: string[] }) {
    const note = input.note?.trim();
    return this.move(actor, id, {
      from: ['acknowledged', 'in_progress'], to: 'resolved', who: 'manage_or_assignee', body: note ?? null,
      prepare: async (m, incident) => {
        if (!note) throw new BusinessException('INCIDENT_NOTE_REQUIRED');
        for (const fileId of input.file_ids ?? []) await this.files.claim(m, incident.tenant_id, fileId, { type: 'incident', id });
        if (SEVERITY_ORDER[incident.severity] >= SEVERITY_ORDER.high) {
          const [{ count }] = await m.query(`SELECT count(*)::int AS count FROM files WHERE owner_type = 'incident' AND owner_id = $1 AND deleted_at IS NULL`, [id]);
          if (count === 0) throw new BusinessException('INCIDENT_PHOTO_REQUIRED');
        }
        return { resolved_at: new Date(), resolution_note: note };
      },
      notifyReporter: { type: 'incident.resolved', title: 'Sự cố đã được xử lý' },
    });
  }

  close(actor: AuthUser, id: string) {
    return this.move(actor, id, {
      from: ['resolved'], to: 'closed', who: 'close',
      prepare: async () => ({ closed_at: new Date(), closed_by: actor.id }),
      notifyReporter: { type: 'incident.closed', title: 'Sự cố đã đóng' },
    });
  }

  reopen(actor: AuthUser, id: string, reason?: string) {
    return this.move(actor, id, {
      from: ['resolved'], to: 'in_progress', who: 'manage', body: reason?.trim() ?? null,
      prepare: async () => {
        if (!reason?.trim()) throw new BusinessException('INCIDENT_REASON_REQUIRED');
        return { resolved_at: null };
      },
    });
  }

  reject(actor: AuthUser, id: string, reason?: string) {
    return this.move(actor, id, {
      from: ['new', 'acknowledged', 'in_progress'], to: 'rejected', who: 'manage', body: reason?.trim() ?? null,
      prepare: async () => {
        if (!reason?.trim()) throw new BusinessException('INCIDENT_REASON_REQUIRED');
        return { rejected_reason: reason.trim(), next_escalation_at: null };
      },
      notifyReporter: { type: 'incident.rejected', title: 'Sự cố được đánh dấu báo nhầm' },
    });
  }

  async comment(actor: AuthUser, id: string, input: { body: string; file_ids?: string[] }) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const incident = await this.incidents.lockVisible(m, actor, id);
      for (const fileId of input.file_ids ?? []) await this.files.claim(m, tenantId, fileId, { type: 'incident', id });
      await this.event(m, incident, actor, 'comment', input.body, null, null, { file_ids: input.file_ids ?? [] });
      const others = this.participants(incident).filter((u) => u !== actor.id);
      await this.notifications.notify(tenantId, others, {
        type: 'incident.comment', title: `Bình luận mới · ${incident.title}`, body: input.body.slice(0, 200),
        data: { incident_id: id }, priority: 'normal', push: false,
      }, m);
    });
    return this.done(actor, id);
  }

  /** One status change: lock, check from-state and permission, write, record, tell people. */
  private async move(actor: AuthUser, id: string, step: Move, eventType: 'status_changed' | 'acknowledged' = 'status_changed') {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const incident = await this.incidents.lockVisible(m, actor, id);
      if (!step.from.includes(incident.status)) throw new BusinessException('INCIDENT_BAD_TRANSITION');
      await this.require(actor, incident, step.who);
      const extra = step.prepare ? await step.prepare(m, incident) : {};
      await m.update(Incident, { id }, { ...extra, status: step.to });
      await this.event(m, incident, actor, eventType, step.body ?? null, incident.status, step.to, {});
      if (step.notifyReporter && incident.reported_by !== actor.id) {
        await this.notifications.notify(tenantId, [incident.reported_by], {
          type: step.notifyReporter.type, title: step.notifyReporter.title, body: incident.title,
          data: { incident_id: id }, priority: 'normal', push: true,
        }, m);
      }
    });
    return this.done(actor, id);
  }

  private async require(actor: AuthUser, incident: Incident, who: Who): Promise<void> {
    const held = await this.permissions.permissionsOf(actor.id);
    if (who === 'manage' && held.has('incident.manage')) return;
    if (who === 'manage_or_assignee' && (held.has('incident.manage') || incident.assignee_user_id === actor.id)) return;
    if (who === 'close') {
      if (held.has('incident.close')) return;
      if (held.has('incident.manage')) {
        const s = await this.settings.effective(incident.tenant_id, incident.site_id);
        if (SEVERITY_ORDER[incident.severity] <= CLOSE_LEVEL[s.incident_close_by_leader_up_to]) return;
        throw new BusinessException('INCIDENT_CLOSE_NOT_ALLOWED');
      }
      throw new BusinessException('INCIDENT_CLOSE_NOT_ALLOWED');
    }
    throw new BusinessException('AUTH_FORBIDDEN');
  }

  private async event(
    m: EntityManager, incident: Incident, actor: AuthUser | null, type: string, body: string | null,
    from: string | null, to: string | null, data: Record<string, unknown>,
  ) {
    await m.query(
      `INSERT INTO incident_events (tenant_id, incident_id, type, actor_user_id, body, from_status, to_status, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [incident.tenant_id, incident.id, type, actor?.id ?? null, body, from, to, JSON.stringify(data)],
    );
  }

  private participants(incident: Incident): string[] {
    return [incident.reported_by, incident.assignee_user_id, incident.acknowledged_by].filter((u): u is string => Boolean(u));
  }

  /** After the commit: everyone involved sees the change live, then the caller gets the fresh detail. */
  private async done(actor: AuthUser, id: string) {
    const detail = await this.incidents.get(actor, id);
    const watchers = [detail.reported_by, detail.assignee_user_id, detail.acknowledged_by].filter(Boolean);
    this.events.emit(watchers, { type: 'incident.updated', id, status: detail.status });
    return detail;
  }
}
```

- [ ] **Step 4: Gắn vào controller và module**

Trong `backend/src/incidents/incidents.controller.ts`: constructor nhận thêm `private readonly workflow: WorkflowService`; import `AssignDto, CommentDto, NoteDto, ReasonDto`; thêm (không cần `@RequirePermission` — service kiểm quyền theo từng bước vì người được giao cũng được làm một số bước):
```ts
  @Post('incidents/:id/acknowledge')
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.acknowledge(user, id);
  }

  @Post('incidents/:id/assign')
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.workflow.assign(user, id, dto.user_id);
  }

  @Post('incidents/:id/start')
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.start(user, id);
  }

  @Post('incidents/:id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.workflow.resolve(user, id, dto);
  }

  @Post('incidents/:id/close')
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.close(user, id);
  }

  @Post('incidents/:id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.workflow.reopen(user, id, dto.reason);
  }

  @Post('incidents/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.workflow.reject(user, id, dto.reason);
  }

  @Post('incidents/:id/comments')
  comment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) {
    return this.workflow.comment(user, id, dto);
  }
```

`backend/src/incidents/incidents.module.ts`: `imports` thêm `NotificationsModule`, `SettingsModule`; `providers` thêm `WorkflowService`.

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- incident-workflow incidents`
Expected: PASS — workflow 5, incidents 5.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): incident workflow with per-step permissions, photo rule and site-set leader closing"
```

---

### Task 5: Người nhận theo cơ cấu và leo thang tự động

**Files:**
- Create: `backend/src/incidents/escalation.service.ts`
- Modify: `backend/src/incidents/incidents.service.ts`, `backend/src/incidents/incidents.module.ts`
- Test: `backend/test/incident-escalation.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.notify`, `SettingsService.effective`, `todayLocal`.
- Produces:
  - `EscalationService.chain(m, incident)` → `[level1, level2, level3]` (mảng user id): cấp 1 = đội trưởng của đội người báo (không có thì đội phụ trách mục tiêu); cấp 2 = quản lý của nhóm chứa đội đó, không có nhóm/quản lý thì những người có `incident.manage` + phạm vi toàn công ty (trừ người ở cấp 3); cấp 3 = người có `incident.final_escalation` + phạm vi toàn công ty. Người báo không nằm trong danh sách nhận.
  - `EscalationService.start(m, incident)` — gọi khi tạo: thấp → cấp 1 trong ứng dụng; trung bình → cấp 1 có đẩy; cao → cấp 1+2; khẩn cấp → cấp 1+2+3 kênh khẩn cấp. Cấp nào trống thì đẩy lên cấp kế. Sự cố khách báo còn báo người phụ trách khách.
  - `EscalationService.tick(now?)` → số sự cố đã leo thang. Với sự cố còn `new` đã quá `next_escalation_at`: lên một cấp (bỏ qua cấp trống), báo cấp đó; khẩn cấp thì nhắc lại cả chuỗi mỗi lần; ghi sự kiện `escalated`; hẹn lần sau theo mốc của mục tiêu (`incident_escalate_*_minutes`) cho tới cấp 3 (khẩn cấp: lặp mãi tới khi có người tiếp nhận).
  - Vòng quét chạy mỗi 60 giây khi `ESCALATION_TICK` khác `off`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/incident-escalation.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { EscalationService } from '../src/incidents/escalation.service';
import { PushService } from '../src/notifications/push';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe('Incidents — routing and escalation (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  const users: Record<string, { id: string; api: ReturnType<typeof client> }> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'esc');
    api = client(app, admin.token);
    users.director = { id: admin.adminUserId, api };
    const cats = (await api.get('/api/incident-categories').expect(200)).body.data as { id: string; name: string }[];
    ids.low = cats.find((c) => c.name === 'Vệ sinh / an toàn')!.id;
    ids.medium = cats.find((c) => c.name === 'Hư hỏng thiết bị')!.id;
    ids.high = cats.find((c) => c.name === 'Trộm cắp')!.id;
    ids.client = (await api.post('/api/clients', { code: 'EK', name: 'Khách' }).expect(201)).body.data.id;

    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    users.manager = { id: manager.user.id, api: client(app, manager.token) };
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: manager.user.id }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'ES', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'ES2', name: 'Toà 2', responsible_team_id: ids.team }).expect(201)).body.data.id;

    const lead = await member('LEAD', ids.team);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead });
    const phone = await loginOnDevice(app, leader.phone, leader.password, 'esc-leader-phone');
    await client(app, phone.token!).post('/api/me/push-token', { token: 'tok-leader' }).expect(201);
    users.leader = { id: leader.user.id, api: client(app, leader.token) };
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: await member('GUARD', ids.team) });
    users.guard = { id: g.user.id, api: client(app, g.token) };
  });
  afterAll(async () => app.close());

  async function member(code: string, team: string) {
    const e = (await api.post('/api/employees', { code: `${code}${++seq}`, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    return e;
  }
  const report = async (category: string, site = ids.site, by = users.guard) =>
    (await by.api.post('/api/incidents', { site_id: site, category_id: ids[category], description: 'test' }).expect(201)).body.data;
  const got = async (who: string, incidentId: string) =>
    Number((await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND data->>'incident_id' = $2`, [users[who].id, incidentId]))[0].n);
  const tick = (minutes: number) => app.get(EscalationService).tick(later(minutes));

  it('keeps a low incident with the team leader, in the app only', async () => {
    const push = app.get(PushService);
    push.sent.length = 0;
    const i = await report('low');
    expect([await got('leader', i.id), await got('manager', i.id), await got('director', i.id)]).toEqual([1, 0, 0]);
    expect(push.sent).toEqual([]);
    await tick(600);
    expect(await got('manager', i.id)).toBe(0);
  });

  it('chases a medium incident up the chain until someone takes it', async () => {
    const push = app.get(PushService);
    push.sent.length = 0;
    const i = await report('medium');
    expect([await got('leader', i.id), await got('manager', i.id)]).toEqual([1, 0]);
    expect(push.sent[0]).toMatchObject({ tokens: ['tok-leader'], message: expect.objectContaining({ priority: 'high' }) });
    await tick(29);
    expect(await got('manager', i.id)).toBe(0);
    await tick(31);
    expect(await got('manager', i.id)).toBe(1);
    await tick(62);
    expect(await got('director', i.id)).toBe(1);
    const events = (await api.get(`/api/incidents/${i.id}`).expect(200)).body.data.events;
    expect(events.filter((e: { type: string }) => e.type === 'escalated')).toHaveLength(2);
  });

  it('stops chasing once someone acknowledges', async () => {
    const i = await report('medium');
    await users.leader.api.post(`/api/incidents/${i.id}/acknowledge`).expect(201);
    await tick(31);
    expect(await got('manager', i.id)).toBe(0);
  });

  it("uses the site's own thresholds", async () => {
    await api.patch(`/api/sites/${ids.site2}/settings`, { incident_escalate_high_minutes: 5 }).expect(200);
    const fast = await report('high', ids.site2);
    const normal = await report('high');
    expect([await got('leader', fast.id), await got('manager', fast.id), await got('director', fast.id)]).toEqual([1, 1, 0]);
    await tick(6);
    expect(await got('director', fast.id)).toBe(1);
    expect(await got('director', normal.id)).toBe(0);
    await tick(11);
    expect(await got('director', normal.id)).toBe(1);
  });

  it('wakes everyone for an SOS and keeps reminding until acknowledged', async () => {
    const push = app.get(PushService);
    push.sent.length = 0;
    await api.post('/api/roster', { site_id: ids.site, employee_id: (await ds.query(`SELECT employee_id FROM users WHERE id = $1`, [users.guard.id]))[0].employee_id, start_at: later(-10).toISOString(), end_at: later(300).toISOString() }).expect(201);
    const sos = (await users.guard.api.post('/api/incidents/sos', { lat: 21, lng: 105 }).expect(201)).body.data;
    expect([await got('leader', sos.id), await got('manager', sos.id), await got('director', sos.id)]).toEqual([1, 1, 1]);
    expect(push.sent[0].message.priority).toBe('critical');
    await tick(4);
    expect([await got('leader', sos.id), await got('manager', sos.id), await got('director', sos.id)]).toEqual([2, 2, 2]);
    await users.manager.api.post(`/api/incidents/${sos.id}/acknowledge`).expect(201);
    await tick(8);
    expect(await got('director', sos.id)).toBe(2);
  });

  it('skips empty levels: a team without a leader goes straight to its manager', async () => {
    const lonely = (await api.post('/api/org/teams', { name: 'Đội không trưởng', team_group_id: ids.group }).expect(201)).body.data.id;
    const site = (await api.post('/api/sites', { client_id: ids.client, code: 'ES3', name: 'Kho', responsible_team_id: lonely }).expect(201)).body.data.id;
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: await member('LONE', lonely) });
    const i = (await client(app, g.token).post('/api/incidents', { site_id: site, category_id: ids.medium, description: 'x' }).expect(201)).body.data;
    expect(await got('manager', i.id)).toBe(1);
  });

  it("tells the client's account manager about what the client reported", async () => {
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant']);
    users.account = { id: accountant.user.id, api: client(app, accountant.token) };
    await api.patch(`/api/clients/${ids.client}`, { account_manager_id: accountant.user.id }).expect(200);
    const i = (await api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'Khách gọi báo', source: 'client_report', client_channel: 'phone' }).expect(201)).body.data;
    expect([await got('account', i.id), await got('leader', i.id)]).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- incident-escalation`
Expected: FAIL — `Cannot find module '../src/incidents/escalation.service'`.

- [ ] **Step 3: Viết service leo thang**

`backend/src/incidents/escalation.service.ts`:
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { todayLocal } from '../common/date';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { Settings } from '../settings/settings';
import { SettingsService } from '../settings/settings.service';
import { Severity } from './categories';
import { Incident } from './incident.entity';

const FIRST_LEVELS: Record<Severity, number[]> = { low: [1], medium: [1], high: [1, 2], critical: [1, 2, 3] };
const PRIORITY: Record<Severity, 'normal' | 'high' | 'critical'> = { low: 'normal', medium: 'high', high: 'high', critical: 'critical' };
const LABEL: Record<Severity, string> = { low: 'Sự cố mức thấp', medium: 'Sự cố', high: 'Sự cố mức cao', critical: 'KHẨN CẤP' };
const TICK_MS = 60_000;

type Chain = [string[], string[], string[]];

@Injectable()
export class EscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Escalation');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    if (getEnv('ESCALATION_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => {
      this.tick().catch((error: Error) => this.logger.error(`Vòng leo thang lỗi: ${error.message}`, error.stack));
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Who answers for this incident, level by level. The reporter is never on their own chain. */
  async chain(m: EntityManager, incident: Incident): Promise<Chain> {
    const today = todayLocal();
    let teamId: string | null = null;
    if (incident.reporter_employee_id) {
      const [row] = await m.query(
        `SELECT team_id FROM team_members WHERE employee_id = $1 AND start_date <= $2 AND (end_date IS NULL OR end_date >= $2)`,
        [incident.reporter_employee_id, today],
      );
      teamId = row?.team_id ?? null;
    }
    if (!teamId && incident.site_id) {
      const [site] = await m.query(`SELECT responsible_team_id FROM sites WHERE id = $1`, [incident.site_id]);
      teamId = site?.responsible_team_id ?? null;
    }
    const leaders: string[] = teamId
      ? (await m.query(
          `SELECT u.id FROM teams t JOIN users u ON u.employee_id = t.leader_employee_id
            WHERE t.id = $1 AND t.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL`,
          [teamId],
        )).map((r: { id: string }) => r.id)
      : [];
    const [group] = teamId
      ? await m.query(
          `SELECT g.manager_user_id FROM teams t JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
             JOIN users u ON u.id = g.manager_user_id AND u.status = 'active' AND u.deleted_at IS NULL
            WHERE t.id = $1`,
          [teamId],
        )
      : [];
    const final = await this.holders(m, incident.tenant_id, 'incident.final_escalation');
    const managers = group?.manager_user_id
      ? [group.manager_user_id as string]
      : (await this.holders(m, incident.tenant_id, 'incident.manage')).filter((id) => !final.includes(id));
    const without = (list: string[]) => list.filter((id) => id !== incident.reported_by);
    return [without(leaders), without(managers), without(final)];
  }

  /** First notifications, inside the transaction that creates the incident. */
  async start(m: EntityManager, incident: Incident): Promise<void> {
    const chain = await this.chain(m, incident);
    let levels = FIRST_LEVELS[incident.severity];
    let top = Math.max(...levels);
    let recipients = union(chain, levels);
    while (!recipients.length && top < 3) {
      top += 1;
      levels = [top];
      recipients = chain[top - 1];
    }
    const s = await this.settings.effective(incident.tenant_id, incident.site_id);
    const next = this.nextAt(incident.severity, top, new Date(), s);
    await m.update(Incident, { id: incident.id }, { escalation_level: top, next_escalation_at: next });

    const where = await this.where(m, incident);
    await this.notifications.notify(incident.tenant_id, recipients, {
      type: 'incident.new',
      title: `${LABEL[incident.severity]} · ${incident.title}`,
      body: `${where}${incident.description ? ` — ${incident.description.slice(0, 140)}` : ''}`,
      data: { incident_id: incident.id, severity: incident.severity },
      priority: PRIORITY[incident.severity],
      push: incident.severity !== 'low',
    }, m);

    if (incident.source === 'client_report') {
      const [c] = await m.query(`SELECT account_manager_id FROM clients WHERE id = $1`, [incident.client_id]);
      if (c?.account_manager_id && !recipients.includes(c.account_manager_id)) {
        await this.notifications.notify(incident.tenant_id, [c.account_manager_id], {
          type: 'incident.client_report', title: `Khách báo sự cố · ${incident.title}`, body: where,
          data: { incident_id: incident.id, severity: incident.severity }, priority: 'high', push: true,
        }, m);
      }
    }
  }

  /** One pass: every incident nobody took in time goes one level up. Returns how many moved. */
  async tick(now: Date = new Date()): Promise<number> {
    const due: { id: string }[] = await this.ds.query(
      `SELECT id FROM incidents WHERE status = 'new' AND next_escalation_at <= $1 ORDER BY next_escalation_at LIMIT 100`,
      [now],
    );
    let moved = 0;
    for (const { id } of due) {
      const done = await this.ds.transaction(async (m) => {
        const [locked] = await m.query(
          `SELECT id FROM incidents WHERE id = $1 AND status = 'new' AND next_escalation_at <= $2 FOR UPDATE SKIP LOCKED`,
          [id, now],
        );
        if (!locked) return false;
        const incident = await m.findOneByOrFail(Incident, { id });
        const chain = await this.chain(m, incident);
        const critical = incident.severity === 'critical';
        let level = Math.min(incident.escalation_level + 1, 3);
        let recipients = critical ? union(chain, [1, 2, 3].slice(0, level)) : chain[level - 1];
        while (!recipients.length && level < 3) {
          level += 1;
          recipients = critical ? union(chain, [1, 2, 3].slice(0, level)) : chain[level - 1];
        }
        const s = await this.settings.effective(incident.tenant_id, incident.site_id);
        await this.notifications.notify(incident.tenant_id, recipients, {
          type: 'incident.escalated',
          title: `Chưa ai tiếp nhận · ${LABEL[incident.severity]} · ${incident.title}`,
          body: await this.where(m, incident),
          data: { incident_id: incident.id, severity: incident.severity },
          priority: critical ? 'critical' : 'high',
          push: true,
        }, m);
        await m.query(
          `INSERT INTO incident_events (tenant_id, incident_id, type, to_status, data) VALUES ($1, $2, 'escalated', NULL, $3)`,
          [incident.tenant_id, incident.id, JSON.stringify({ level, notified: recipients })],
        );
        await m.update(Incident, { id }, { escalation_level: level, next_escalation_at: this.nextAt(incident.severity, level, now, s) });
        return true;
      });
      if (done) moved += 1;
    }
    return moved;
  }

  /** Low never escalates; critical reminds forever; the others climb until the last level. */
  private nextAt(severity: Severity, level: number, from: Date, s: Settings): Date | null {
    if (severity === 'low') return null;
    if (severity !== 'critical' && level >= 3) return null;
    const minutes =
      severity === 'medium' ? s.incident_escalate_medium_minutes
        : severity === 'high' ? s.incident_escalate_high_minutes
          : s.incident_escalate_critical_minutes;
    return new Date(from.getTime() + minutes * 60_000);
  }

  private async where(m: EntityManager, incident: Incident): Promise<string> {
    const [row] = await m.query(
      `SELECT c.name AS client_name, s.name AS site_name FROM clients c LEFT JOIN sites s ON s.id = $2 WHERE c.id = $1`,
      [incident.client_id, incident.site_id],
    );
    return row?.site_name ? `${row.site_name} (${row.client_name})` : row?.client_name ?? '';
  }

  private async holders(m: EntityManager, tenantId: string, permission: string): Promise<string[]> {
    const rows: { id: string }[] = await m.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
         JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = $2
         JOIN user_scopes us ON us.user_id = u.id AND us.scope_type = 'tenant'
        WHERE u.tenant_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL`,
      [tenantId, permission],
    );
    return rows.map((r) => r.id);
  }
}

function union(chain: Chain, levels: number[]): string[] {
  return [...new Set(levels.flatMap((l) => chain[l - 1]))];
}
```

- [ ] **Step 4: Nối vào việc tạo sự cố**

Trong `backend/src/incidents/incidents.service.ts`:
- constructor nhận thêm `private readonly escalation: EscalationService` (import từ `./escalation.service`);
- thay phương thức `afterCreate` bằng:
```ts
  /** Routing and first notifications run inside the creating transaction: no incident without its alerts. */
  protected async afterCreate(m: EntityManager, incident: Incident): Promise<void> {
    await this.escalation.start(m, incident);
  }
```

`backend/src/incidents/incidents.module.ts`: `providers` thêm `EscalationService`, `exports` thêm `EscalationService`.

- [ ] **Step 5: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npm run test:e2e`
Expected: PASS toàn bộ (gồm `incident-escalation` 7).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): incident routing by team, group and final level, with per-site timed escalation"
```

---

### Task 6: Cách ly công ty cho sự cố và thông báo, dữ liệu demo

**Files:**
- Modify: `backend/src/scripts/seed-demo.ts`
- Test: `backend/test/tenancy-05.e2e-spec.ts`

- [ ] **Step 1: Viết test**

`backend/test/tenancy-05.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for incidents and notifications (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let apiA: ReturnType<typeof client>;
  const B: Record<'incident' | 'category' | 'notification' | 'client', string> = { incident: '', category: '', notification: '', client: '' };
  let aClient: string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso5-a');
    const b = await createTenantWithAdmin(app, 'iso5-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    B.client = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data.id;
    B.category = (await apiB.get('/api/incident-categories').expect(200)).body.data[0].id;
    B.incident = (await apiB.post('/api/incidents', { client_id: B.client, category_id: B.category, description: 'B', source: 'staff' }).expect(201)).body.data.id;
    B.notification = (await ds.query(`SELECT id FROM notifications WHERE tenant_id = $1 LIMIT 1`, [b.tenant.id]))[0]?.id ?? '00000000-0000-4000-8000-000000000000';
    aClient = (await apiA.post('/api/clients', { code: 'AK', name: 'A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or move of B's incident with 404", async () => {
    await apiA.get(`/api/incidents/${B.incident}`).expect(404);
    for (const step of ['acknowledge', 'start', 'close']) await apiA.post(`/api/incidents/${B.incident}/${step}`).expect(404);
    await apiA.post(`/api/incidents/${B.incident}/comments`, { body: 'x' }).expect(404);
    await apiA.post(`/api/incidents/${B.incident}/reject`, { reason: 'x' }).expect(404);
    await apiA.patch(`/api/incident-categories/${B.category}`, { name: 'x' }).expect(404);
    await apiA.post(`/api/me/notifications/${B.notification}/read`).expect(404);
  });

  it("refuses B's category, client or people in A's reports", async () => {
    await apiA.post('/api/incidents', { client_id: aClient, category_id: B.category, description: 'x', source: 'staff' }).expect(404);
    await apiA.post('/api/incidents', { client_id: B.client, category_id: (await apiA.get('/api/incident-categories').expect(200)).body.data[0].id, description: 'x', source: 'staff' }).expect(404);
  });

  it("keeps B's incidents out of A's list", async () => {
    const ids = (await apiA.get('/api/incidents').expect(200)).body.data.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(B.incident);
  });
});
```

Run: `cd backend && npm run test:e2e -- tenancy-05` → PASS (3).

- [ ] **Step 2: Dữ liệu demo**

Trong `backend/src/scripts/seed-demo.ts`, import `IncidentsService` từ `../incidents/incidents.service`; thêm trước dòng `console.log('Đã tạo công ty demo...`:
```ts
  const incidentsSvc = app.get(IncidentsService);
  const [repair] = await ds.query(`SELECT id FROM incident_categories WHERE tenant_id = $1 AND name = 'Hư hỏng thiết bị'`, [tenant.id]);
  await incidentsSvc.report(actor, {
    site_id: toa.id, category_id: repair.id, source: 'staff', client_channel: 'phone', client_reporter_name: 'Chị Lan — BQL toà nhà',
    description: 'Đèn lối thoát hiểm tầng hầm B1 không sáng',
  });
```

Run: reset DB dev như Plan 04 Task 5 rồi `npm run seed:demo` → không lỗi.

- [ ] **Step 3: Chạy toàn bộ, commit**

Run: `cd backend && npm test && npm run test:e2e && npm run build` → PASS.

```bash
git add backend
git commit -m "test(backend): isolation suite for incidents and notifications; demo incident"
```

---

### Task 7: Web — danh sách, chi tiết, ghi nhận sự cố; danh mục trong Cài đặt

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/lib/format.ts`, `web/src/components/shell.tsx`, `web/src/app/(app)/cai-dat/page.tsx`
- Create: `web/src/app/(app)/su-co/page.tsx`, `web/src/app/(app)/su-co/[id]/page.tsx`, `web/src/components/incident-categories.tsx`

- [ ] **Step 1: Kiểu dữ liệu và nhãn**

Cuối `web/src/lib/types.ts`:
```ts
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed' | 'rejected';

export interface IncidentCategory {
  id: string;
  name: string;
  default_severity: Severity;
  sort: number;
  status: 'active' | 'inactive';
}

export interface IncidentRow {
  id: string;
  code: string;
  client_id: string;
  client_name: string;
  site_id: string | null;
  site_name: string | null;
  category_name: string | null;
  severity: Severity;
  is_sos: boolean;
  title: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  source: 'guard_app' | 'staff' | 'client_report';
  client_reporter_name: string | null;
  client_channel: string | null;
  reported_by: string;
  reporter_name: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  status: IncidentStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  closed_at: string | null;
  rejected_reason: string | null;
  escalation_level: number;
  created_at: string;
}

export interface IncidentEvent {
  id: string;
  type: string;
  actor_name: string | null;
  body: string | null;
  from_status: IncidentStatus | null;
  to_status: IncidentStatus | null;
  data: { level?: number; user_id?: string; file_ids?: string[] };
  created_at: string;
}

export interface IncidentDetail extends IncidentRow {
  events: IncidentEvent[];
  files: { id: string; original_name: string; mime: string; size: number; created_at: string }[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { incident_id?: string };
  priority: 'normal' | 'high' | 'critical';
  read_at: string | null;
  created_at: string;
}
```

Cuối `web/src/lib/format.ts` (thêm `IncidentStatus, Severity` vào dòng `import type`):
```ts
export const SEVERITY: Record<Severity, { label: string; tone: string }> = {
  low: { label: 'Thấp', tone: 'bg-slate-100 text-slate-700' },
  medium: { label: 'Trung bình', tone: 'bg-sky-100 text-sky-800' },
  high: { label: 'Cao', tone: 'bg-amber-100 text-amber-800' },
  critical: { label: 'Khẩn cấp', tone: 'bg-red-600 text-white' },
};

export const INCIDENT_STATUS: Record<IncidentStatus, { label: string; tone: string }> = {
  new: { label: 'Mới — chưa ai nhận', tone: 'bg-red-100 text-red-700' },
  acknowledged: { label: 'Đã tiếp nhận', tone: 'bg-amber-100 text-amber-800' },
  in_progress: { label: 'Đang xử lý', tone: 'bg-sky-100 text-sky-800' },
  resolved: { label: 'Đã xử lý — chờ đóng', tone: 'bg-teal-100 text-teal-800' },
  closed: { label: 'Đã đóng', tone: 'bg-slate-200 text-slate-700' },
  rejected: { label: 'Báo nhầm', tone: 'bg-slate-100 text-slate-500' },
};

export const INCIDENT_SOURCE: Record<string, string> = {
  guard_app: 'Bảo vệ báo',
  staff: 'Nhân sự công ty ghi',
  client_report: 'Khách báo',
};

export const CLIENT_CHANNEL: Record<string, string> = {
  phone: 'Điện thoại',
  zalo: 'Zalo',
  email: 'Email',
  in_person: 'Trực tiếp',
};

/** "2026-10-13T01:30:00Z" → "13/10 08:30" in Vietnam time. */
export const stamp = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    : '—';
```

Trong `web/src/components/shell.tsx`, mảng `NAV` thêm ngay sau mục "Tổng quan":
```ts
  { href: '/su-co', label: 'Sự cố', permission: 'incident.view' },
```

- [ ] **Step 2: Trang danh sách và ghi nhận**

`web/src/app/(app)/su-co/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CLIENT_CHANNEL, INCIDENT_SOURCE, INCIDENT_STATUS, SEVERITY, stamp } from '@/lib/format';
import { IncidentCategory, IncidentRow, Severity, SiteRow } from '@/lib/types';

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Đang mở' },
  { value: 'new', label: 'Chưa ai nhận' },
  { value: 'resolved', label: 'Chờ đóng' },
  { value: 'closed', label: 'Đã đóng' },
  { value: 'rejected', label: 'Báo nhầm' },
  { value: '', label: 'Tất cả' },
];

export default function IncidentsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (severity) q.set('severity', severity);
    setRows(await api<IncidentRow[]>(`/incidents?${q}`));
  }, [status, severity]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    // The bell already reacts at once; the list catches up within half a minute.
    const timer = setInterval(() => load().catch(() => undefined), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Sự cố</h1>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-40">
          <option value="">Mọi mức độ</option>
          {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        {can('incident.manage') && <Button onClick={() => setCreating(!creating)}>{creating ? 'Đóng' : 'Ghi nhận sự cố'}</Button>}
      </div>
      <ErrorText error={error} />
      {creating && <ReportForm onDone={() => { setCreating(false); load().catch(() => undefined); }} />}
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Mã</th><th>Mức độ</th><th>Sự cố</th><th>Nơi</th><th>Người báo</th><th>Lúc</th><th>Trạng thái</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.status === 'new' && r.severity === 'critical' ? 'bg-red-50' : ''}`}>
                <td className="py-2 font-mono text-xs"><Link href={`/su-co/${r.id}`} className="text-teal-700 hover:underline">{r.code}</Link></td>
                <td><span className={`rounded px-1.5 py-0.5 text-xs ${SEVERITY[r.severity].tone}`}>{r.is_sos ? 'SOS' : SEVERITY[r.severity].label}</span></td>
                <td><Link href={`/su-co/${r.id}`} className="hover:underline">{r.title}</Link></td>
                <td>{r.site_name ?? '—'} <span className="text-xs text-slate-400">{r.client_name}</span></td>
                <td>{r.source === 'guard_app' ? r.reporter_name : `${INCIDENT_SOURCE[r.source]}${r.client_reporter_name ? ` · ${r.client_reporter_name}` : ''}`}</td>
                <td>{stamp(r.created_at)}</td>
                <td>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${INCIDENT_STATUS[r.status].tone}`}>{INCIDENT_STATUS[r.status].label}</span>
                  {r.status === 'new' && r.escalation_level > 1 && <span className="ml-1 text-xs text-red-700">đã leo thang cấp {r.escalation_level}</span>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-6 text-center text-slate-400">Không có sự cố nào</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** Office staff writing down what happened, or what a client told them on the phone. */
function ReportForm({ onDone }: { onDone: () => void }) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [categories, setCategories] = useState<IncidentCategory[]>([]);
  const [form, setForm] = useState({ source: 'client_report', site_id: '', category_id: '', severity: '', description: '', client_reporter_name: '', client_channel: 'phone' });
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<SiteRow[]>('/sites'), api<IncidentCategory[]>('/incident-categories')])
      .then(([s, c]) => { setSites(s); setCategories(c); setForm((f) => ({ ...f, site_id: s[0]?.id ?? '', category_id: c[0]?.id ?? '' })); })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const file_ids = [];
      for (const p of photos) file_ids.push((await uploadFile(p)).id);
      const client = form.source === 'client_report';
      await api('/incidents', {
        method: 'POST',
        json: {
          source: form.source, site_id: form.site_id, category_id: form.category_id, description: form.description, file_ids,
          ...(form.severity ? { severity: form.severity as Severity } : {}),
          ...(client ? { client_reporter_name: form.client_reporter_name || undefined, client_channel: form.client_channel } : {}),
        },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card title="Ghi nhận sự cố">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nguồn">
          <Select value={form.source} onChange={set('source')}>
            <option value="client_report">Khách báo</option>
            <option value="staff">Nhân sự công ty phát hiện</option>
          </Select>
        </Field>
        <Field label="Mục tiêu">
          <Select value={form.site_id} onChange={set('site_id')} required>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Loại sự cố">
          <Select value={form.category_id} onChange={set('category_id')} required>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({SEVERITY[c.default_severity].label})</option>)}
          </Select>
        </Field>
        <Field label="Mức độ">
          <Select value={form.severity} onChange={set('severity')}>
            <option value="">Theo loại sự cố</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        {form.source === 'client_report' && (
          <>
            <Field label="Người báo bên khách">
              <Input value={form.client_reporter_name} onChange={set('client_reporter_name')} placeholder="VD: Chị Lan — BQL toà nhà" />
            </Field>
            <Field label="Báo qua">
              <Select value={form.client_channel} onChange={set('client_channel')}>
                {Object.entries(CLIENT_CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Field label="Mô tả">
            <textarea value={form.description} onChange={set('description')} required rows={3} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          </Field>
        </div>
        <Field label="Ảnh (tối đa 5)">
          <Input type="file" accept="image/jpeg,image/png" multiple onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))} />
        </Field>
        <div className="flex items-end justify-end gap-3 sm:col-span-2">
          <ErrorText error={error} />
          <Button type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi — báo người phụ trách'}</Button>
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 3: Trang chi tiết**

`web/src/app/(app)/su-co/[id]/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CLIENT_CHANNEL, INCIDENT_SOURCE, INCIDENT_STATUS, SEVERITY, stamp } from '@/lib/format';
import { IncidentDetail, IncidentEvent, UserRow } from '@/lib/types';

function describe(e: IncidentEvent): string {
  if (e.type === 'created') return 'báo sự cố';
  if (e.type === 'acknowledged') return 'tiếp nhận';
  if (e.type === 'assigned') return 'giao việc';
  if (e.type === 'comment') return 'bình luận';
  if (e.type === 'escalated') return `chưa ai tiếp nhận — leo thang lên cấp ${e.data.level}`;
  if (e.type === 'status_changed' && e.to_status) return `chuyển sang "${INCIDENT_STATUS[e.to_status].label}"`;
  return e.type;
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setIncident(await api<IncidentDetail>(`/incidents/${id}`)), [id]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    if (can('user.view')) api<UserRow[]>('/users').then((u) => setUsers(u.filter((x) => x.status === 'active'))).catch(() => undefined);
  }, [load, can]);

  /** Every button posts here; the server decides whether this person may take this step now. */
  async function act(step: string, json: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const file_ids = [];
      for (const p of photos) file_ids.push((await uploadFile(p)).id);
      setIncident(await api<IncidentDetail>(`/incidents/${id}/${step}`, { method: 'POST', json: { ...json, ...(file_ids.length ? { file_ids } : {}) } }));
      setText('');
      setPhotos([]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!incident) return <ErrorText error={error} />;
  const i = incident;
  const manage = can('incident.manage');
  const mine = i.assignee_user_id === me.user.id;
  const needsText = (step: string, field: string) => () => {
    if (!text.trim()) return setError(step === 'resolve' ? 'Ghi rõ đã xử lý thế nào vào ô bên dưới' : 'Ghi lý do vào ô bên dưới');
    act(step, { [field]: text.trim() });
  };

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/su-co" className="text-sm text-teal-700 hover:underline">← Danh sách sự cố</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{i.code} · {i.title}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${SEVERITY[i.severity].tone}`}>{i.is_sos ? 'SOS' : SEVERITY[i.severity].label}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${INCIDENT_STATUS[i.status].tone}`}>{INCIDENT_STATUS[i.status].label}</span>
      </div>

      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Nơi xảy ra</dt><dd>{i.site_name ?? '—'} · {i.client_name}</dd></div>
          <div><dt className="text-slate-500">Lúc báo</dt><dd>{stamp(i.created_at)}</dd></div>
          <div>
            <dt className="text-slate-500">Nguồn</dt>
            <dd>
              {INCIDENT_SOURCE[i.source]}: {i.source === 'client_report' ? `${i.client_reporter_name ?? 'khách'}${i.client_channel ? ` qua ${CLIENT_CHANNEL[i.client_channel]}` : ''} — ghi bởi ${i.reporter_name}` : i.reporter_name}
            </dd>
          </div>
          <div><dt className="text-slate-500">Người xử lý</dt><dd>{i.assignee_name ?? 'Chưa giao'}</dd></div>
          {i.lat !== null && i.lng !== null && (
            <div><dt className="text-slate-500">Vị trí</dt><dd><a className="text-teal-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${i.lat},${i.lng}`}>Xem bản đồ</a></dd></div>
          )}
        </dl>
        {i.description && <p className="mt-3 whitespace-pre-wrap text-sm">{i.description}</p>}
        {i.resolution_note && <p className="mt-3 rounded bg-teal-50 p-2 text-sm"><b>Đã xử lý:</b> {i.resolution_note}</p>}
        {i.rejected_reason && <p className="mt-3 rounded bg-slate-100 p-2 text-sm"><b>Báo nhầm:</b> {i.rejected_reason}</p>}
        {!!i.files.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {i.files.map((f) => (
              <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${f.id}`} alt={f.original_name} className="h-24 w-24 rounded border border-slate-200 object-cover" />
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card title="Xử lý">
        <div className="flex flex-wrap gap-2">
          {manage && i.status === 'new' && <Button onClick={() => act('acknowledge')} disabled={busy}>Tôi tiếp nhận</Button>}
          {(manage || mine) && i.status === 'acknowledged' && <Button onClick={() => act('start')} disabled={busy}>Bắt đầu xử lý</Button>}
          {(manage || mine) && (i.status === 'acknowledged' || i.status === 'in_progress') && (
            <Button onClick={needsText('resolve', 'note')} disabled={busy}>Đã xử lý xong</Button>
          )}
          {(manage || can('incident.close')) && i.status === 'resolved' && <Button onClick={() => act('close')} disabled={busy}>Đóng sự cố</Button>}
          {manage && i.status === 'resolved' && <Button variant="secondary" onClick={needsText('reopen', 'reason')} disabled={busy}>Mở lại</Button>}
          {manage && ['new', 'acknowledged', 'in_progress'].includes(i.status) && (
            <Button variant="secondary" onClick={needsText('reject', 'reason')} disabled={busy}>Báo nhầm</Button>
          )}
          {manage && !['closed', 'rejected'].includes(i.status) && (
            users.length ? (
              <Select value="" onChange={(e) => e.target.value && act('assign', { user_id: e.target.value })} className="w-56" disabled={busy}>
                <option value="">Giao cho…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            ) : (
              <Button variant="secondary" onClick={() => act('assign', { user_id: me.user.id })} disabled={busy}>Giao cho tôi</Button>
            )
          )}
        </div>
        {(i.severity === 'high' || i.severity === 'critical') && ['acknowledged', 'in_progress'].includes(i.status) && !i.files.length && (
          <p className="mt-2 text-xs text-amber-700">Sự cố mức cao cần ít nhất một ảnh trước khi báo đã xử lý — đính kèm ảnh ở dưới.</p>
        )}
        <form
          className="mt-3 space-y-2"
          onSubmit={(e: FormEvent) => { e.preventDefault(); if (text.trim()) act('comments', { body: text.trim() }); }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Ghi chú, cách xử lý, lý do…" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          <div className="flex items-center gap-2">
            <Input type="file" accept="image/jpeg,image/png" multiple onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))} className="w-72" />
            <Button type="submit" variant="secondary" disabled={busy}>Gửi bình luận</Button>
          </div>
          <ErrorText error={error} />
        </form>
      </Card>

      <Card title="Dòng thời gian">
        <ol className="space-y-2 text-sm">
          {i.events.map((e) => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3">
              <span className="text-slate-500">{stamp(e.created_at)}</span> · <b>{e.actor_name ?? 'Hệ thống'}</b> {describe(e)}
              {e.body && <p className="whitespace-pre-wrap text-slate-700">{e.body}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Danh mục sự cố trong Cài đặt**

`web/src/components/incident-categories.tsx`:
```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { SEVERITY } from '@/lib/format';
import { IncidentCategory, Severity } from '@/lib/types';

/** The kinds of incident guards pick from, each with the severity it starts at. */
export function IncidentCategories() {
  const [rows, setRows] = useState<IncidentCategory[]>([]);
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [error, setError] = useState<string | null>(null);

  const load = () => api<IncidentCategory[]>('/incident-categories/all').then(setRows);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, []);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      await api('/incident-categories', { method: 'POST', json: { name, default_severity: severity } });
      setName('');
    });
  }

  return (
    <Card title="Loại sự cố">
      <p className="mb-2 text-sm text-slate-500">Mức độ ở đây quyết định ai được báo và bao lâu thì leo thang (xem các mốc ở trên).</p>
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={`border-t border-slate-100 ${c.status === 'inactive' ? 'text-slate-400' : ''}`}>
              <td className="py-1.5">{c.name}</td>
              <td className="w-40">
                <Select value={c.default_severity} onChange={(e) => run(() => api(`/incident-categories/${c.id}`, { method: 'PATCH', json: { default_severity: e.target.value } }))}>
                  {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
              </td>
              <td className="w-28 text-right">
                <button
                  className="text-xs text-teal-700 hover:underline"
                  onClick={() => run(() => api(`/incident-categories/${c.id}`, { method: 'PATCH', json: { status: c.status === 'active' ? 'inactive' : 'active' } }))}
                >
                  {c.status === 'active' ? 'Ngừng dùng' : 'Dùng lại'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={add} className="mt-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Loại mới, VD: Ngập nước" required />
        <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="w-40">
          {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Button type="submit">Thêm</Button>
      </form>
      <ErrorText error={error} />
    </Card>
  );
}
```

Trong `web/src/app/(app)/cai-dat/page.tsx`: import `IncidentCategories` từ `@/components/incident-categories`; ngay sau `</Card>` cuối cùng (trước `</div>` đóng trang) thêm `<IncidentCategories />`.

- [ ] **Step 5: Kiểm tra build, commit**

Run: `cd web && npm run build`
Expected: build thành công, có route `/su-co` và `/su-co/[id]`.

```bash
git add web
git commit -m "feat(web): incident list, office reporting, detail with workflow and timeline, categories in settings"
```

---

### Task 8: Web — chuông thông báo tức thì, ô sự cố trên Tổng quan

**Files:**
- Create: `web/src/components/bell.tsx`
- Modify: `web/src/components/shell.tsx`, `web/src/app/(app)/page.tsx`

- [ ] **Step 1: Chuông**

`web/src/components/bell.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { stamp } from '@/lib/format';
import { NotificationItem } from '@/lib/types';

/**
 * Unread count plus the latest notifications. The server pushes each one over SSE the moment it is
 * written; a slow poll covers proxies that buffer the stream and the gap while it reconnects.
 */
export function Bell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await api<{ items: NotificationItem[]; unread: number }>('/me/notifications');
    setItems(data.items);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const poll = setInterval(() => load().catch(() => undefined), 60_000);
    const stream = new EventSource('/api/me/events');
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data)?.data as { type?: string; title?: string; priority?: string } | undefined;
      if (event?.type !== 'notification') return;
      load().catch(() => undefined);
      if (event.priority === 'critical') setAlert(event.title ?? 'Sự cố khẩn cấp');
    };
    return () => { clearInterval(poll); stream.close(); };
  }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function go(n: NotificationItem) {
    setOpen(false);
    if (!n.read_at) await api(`/me/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    load().catch(() => undefined);
    if (n.data?.incident_id) router.push(`/su-co/${n.data.incident_id}`);
  }

  return (
    <div ref={box} className="relative">
      {alert && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-4 bg-red-600 px-4 py-3 text-white">
          <b>{alert}</b>
          <Link href="/su-co?status=new" onClick={() => setAlert(null)} className="rounded bg-white px-2 py-1 text-sm text-red-700">Xem ngay</Link>
          <button onClick={() => setAlert(null)} className="text-sm underline">Ẩn</button>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="relative rounded px-2 py-1 hover:bg-slate-100" aria-label="Thông báo">
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <b className="text-sm">Thông báo</b>
            {unread > 0 && (
              <button onClick={() => api('/me/notifications/read-all', { method: 'POST' }).then(load).catch(() => undefined)} className="text-xs text-teal-700 hover:underline">
                Đánh dấu đã đọc hết
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
            {items.map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${n.read_at ? 'text-slate-500' : ''}`}>
                  <div className={n.read_at ? '' : 'font-medium'}>
                    {n.priority === 'critical' && <span className="mr-1 text-red-600">●</span>}
                    {n.title}
                  </div>
                  {n.body && <div className="truncate text-xs text-slate-500">{n.body}</div>}
                  <div className="text-xs text-slate-400">{stamp(n.created_at)}</div>
                </button>
              </li>
            ))}
            {!items.length && <li className="px-3 py-6 text-center text-slate-400">Chưa có thông báo</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
```

`web/src/components/shell.tsx`: import `Bell` từ `./bell`; trong `<header>` thêm `<Bell />` làm phần tử đầu tiên (trước `<span>{me.user.full_name}</span>`).

Trang danh sách sự cố đọc bộ lọc từ địa chỉ để liên kết "Xem ngay" mở đúng: trong `web/src/app/(app)/su-co/page.tsx` đổi khởi tạo `status` thành
```tsx
  const [status, setStatus] = useState(() => (typeof window === 'undefined' ? 'open' : new URLSearchParams(window.location.search).get('status') ?? 'open'));
```

- [ ] **Step 2: Ô sự cố trên Tổng quan**

Trong `web/src/app/(app)/page.tsx`:
- import thêm `INCIDENT_STATUS, SEVERITY, stamp` từ `@/lib/format` và `IncidentRow` từ `@/lib/types`;
- thêm state và nạp:
```tsx
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null);

  useEffect(() => {
    if (!can('incident.view')) return;
    const load = () => api<IncidentRow[]>('/incidents?status=open').then(setIncidents).catch(() => undefined);
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [can]);
```
- ngay sau `<ErrorText error={error} />` thêm:
```tsx
      {incidents && (
        <Card title={`Sự cố đang mở (${incidents.length})`} actions={<Link href="/su-co" className="text-sm text-teal-700 hover:underline">Tất cả</Link>}>
          <ul className="divide-y divide-slate-100 text-sm">
            {incidents.slice(0, 8).map((i) => (
              <li key={i.id} className={`flex items-center justify-between gap-3 py-2 ${i.status === 'new' ? 'font-medium' : ''}`}>
                <Link href={`/su-co/${i.id}`} className="text-teal-700 hover:underline">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${SEVERITY[i.severity].tone}`}>{i.is_sos ? 'SOS' : SEVERITY[i.severity].label}</span>
                  {i.title} · {i.site_name ?? i.client_name}
                </Link>
                <span className="shrink-0 text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${INCIDENT_STATUS[i.status].tone}`}>{INCIDENT_STATUS[i.status].label}</span>
                  <span className="ml-2 text-slate-400">{stamp(i.created_at)}</span>
                </span>
              </li>
            ))}
            {!incidents.length && <li className="py-2 text-slate-400">Không có sự cố đang mở</li>}
          </ul>
        </Card>
      )}
```

- [ ] **Step 3: Build, chạy thử qua trình duyệt API, commit**

Run: `cd web && npm run build` → thành công.

Chạy thử (như Plan 04): backend `npm run start:dev` (với `PUSH_DRIVER=log`), web `npm run dev`; đăng nhập giám đốc `0900000001`; qua proxy `:3000`:
- `GET /api/incidents?status=open` thấy sự cố demo;
- đội trưởng `0910000001` `POST /api/incidents/:id/acknowledge` → 201; giám đốc `GET /api/me/notifications` có thông báo của sự cố;
- `curl -N` vào `/api/me/events` qua `:3000` nhận được `ping` hoặc thông báo trong 30 giây (kiểm tra proxy của Next không giữ luồng SSE).

```bash
git add web
git commit -m "feat(web): live notification bell with critical banner, open incidents on the dashboard"
```

---

## Self-review (người viết kế hoạch)

- **Phủ spec:** §4.5 sự cố/SOS → Task 3; §6 trạng thái và bước → Task 4; §6.2 ai được báo, leo thang → Task 5; §7.0 mốc theo mục tiêu → Task 5 (test mục tiêu 5 phút); W7 web → Task 7–8; C6 khách báo → Task 3 (`client_report`) + Task 5 (người phụ trách khách); thông báo đẩy bắt buộc → Task 2 (FCM) + Task 5 (kênh khẩn cấp).
- **Không có chỗ trống:** mọi bước có mã và lệnh cụ thể.
- **Khớp tên:** `lockVisible`, `afterCreate`, `EscalationService.start/tick/chain`, `NotificationsService.notify(tenantId, userIds, input, m)`, `SettingsService.effective(tenantId, siteId)`, `FilesService.claim(m, tenantId, fileId, owner)` dùng thống nhất giữa các task.
- **Việc để sau:** app di động (Plan 04b); báo cáo thời gian phản hồi (W10); vi phạm từ sự cố (cùng bộ máy vi phạm).
