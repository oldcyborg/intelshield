# Plan 04 — Cài đặt theo mục tiêu, thiết bị, mẫu ca, xếp ca, chấm công — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đội trưởng xếp ca tuần cho đội (không cần duyệt), bảo vệ vào/ra ca bằng selfie + GPS từ đúng chiếc máy đã được duyệt, và quản lý/đội trưởng thấy ngay ai đang trực, ai trễ, ai vắng — với mốc trễ/vắng lấy theo cài đặt của từng mục tiêu, rơi về bộ mặc định của công ty.

**Architecture:** Bốn khối mới trong backend: `settings` (mặc định hệ thống → công ty → mục tiêu), `devices` (gắn phiên đăng nhập với một máy; bảo vệ chỉ một máy hoạt động), `shifts` (mẫu ca của mục tiêu, phân ca có khoảng thời gian không chồng cho mỗi người), `attendance` (vào/ra ca, trạng thái bảng chấm công tính khi đọc). App di động làm ở Plan 04b; ở đây API vào/ra ca được kiểm bằng e2e và web hiển thị kết quả.

**Tech Stack:** như Plan 01–03.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` bản 1.4 — §7.0 (cài đặt), §4.1 `devices`, §4.3 (`shift_templates`, `shift_assignments`, `attendances`), §5.1 M2–M3 (phía API), §5.2 W5, §5.1.2 T4. Quyết định 13/10/2026: xếp ca **không cần duyệt**; ca **tự cấu hình theo mục tiêu**; xoay ca **xếp tay theo tuần + chép từ tuần trước**.

**Khác với spec (có chủ đích):**
- Khoá cài đặt dùng dạng phẳng (`incident_escalate_medium_minutes` thay cho `incident_escalate_minutes.medium`) — dễ kiểm tra và ghi đè từng khoá. `incident_notify_client` để Giai đoạn 2 (chưa có người dùng phía khách).
- Cảnh báo đẩy khi đi trễ/vắng (push) cần hạ tầng thông báo — Plan 05. Ở đây trạng thái trễ/vắng hiện trên bảng chấm công, tính từ cài đặt hiệu lực.
- Selfie được lưu và xem lại; kiểm tra "có khuôn mặt" bằng ML Kit làm trong app (Plan 04b).

## Global Constraints

- Mọi quy ước Plan 01–03 giữ nguyên.
- Giờ ca nhập theo **giờ Việt Nam** (`HH:MM`), lưu `timestamptz`; ca có giờ kết thúc ≤ giờ bắt đầu là ca qua đêm; một ca dài tối đa 24 giờ.
- Một người không có hai ca `planned` chồng giờ (CSDL từ chối, `EXCLUDE … tstzrange`).
- Chỉ xếp ca cho người **đang được điều động** tới khách của mục tiêu vào ngày của ca.
- Vào/ra ca chỉ từ phiên đăng nhập gắn với một **máy đang hoạt động**; giờ chuẩn là giờ máy chủ.
- Giá trị cài đặt hiệu lực = mục tiêu → công ty → mặc định hệ thống; mọi thay đổi ghi `audit_logs` (cũ → mới).

## Review Focus

1. **Ca qua đêm và múi giờ**: mẫu 22:00–06:00 ngày 13/10 phải là 22:00 13/10 → 06:00 14/10 giờ Việt Nam; ngày của ca = ngày bắt đầu — test ở Task 3.
2. **Chấm công hộ**: dùng phiên web, phiên trên máy chưa duyệt, ca của người khác, selfie người khác upload → từ chối — test ở Task 2 và Task 4.
3. **Cài đặt chồng nhau**: mục tiêu ghi đè rồi bỏ ghi đè; công ty đổi mặc định khi mục tiêu đang ghi đè; vắng ca ≤ trễ → từ chối — test ở Task 1.
4. **Xếp ca ngoài phạm vi**: đội trưởng xếp người đội khác, xếp người không được điều động tới khách, xếp trùng giờ, chép tuần có người đã thôi điều động → từ chối hoặc bỏ qua có lý do — test ở Task 3.
5. **Ca đã chấm công**: không huỷ, không đổi người — test ở Task 3/4.

---

### Task 1: Schema Plan 04, quyền mới, cài đặt công ty và mục tiêu

**Files:**
- Create: `backend/src/database/migrations/1760600000000-SettingsDevicesShiftsAttendance.ts`
- Create: `backend/src/settings/settings.ts`, `backend/src/settings/settings.spec.ts`, `backend/src/settings/dto.ts`, `backend/src/settings/settings.service.ts`, `backend/src/settings/settings.controller.ts`, `backend/src/settings/settings.module.ts`
- Modify: `backend/src/access/permissions.ts`, `backend/src/common/errors/error-codes.ts`, `backend/src/app.module.ts`, `backend/test/users.e2e-spec.ts`
- Test: `backend/test/settings.e2e-spec.ts`

**Interfaces:**
- Consumes: `SitesService.writable`, `ScopeService.canSeeSite`, `AuditService`.
- Produces:
  - Quyền `roster.view`, `roster.manage`, `attendance.view`, `device.manage`. Vai trò mẫu: `manager` + roster.view/manage, attendance.view; `team_leader` + roster.view/manage, attendance.view; `hr` + roster.view/manage, attendance.view, device.manage; `accountant` + roster.view, attendance.view.
  - `SETTING_DEFAULTS`, `type Settings`, `type SettingKey`, `resolveSettings(company, site)` → `{ effective: Settings; source: Record<SettingKey, 'site' | 'company' | 'default'> }`.
  - `SettingsService.company(actor)`, `.updateCompany(actor, patch)`, `.site(actor, siteId)`, `.updateSite(actor, siteId, patch)`, `.effective(tenantId, siteId | null): Promise<Settings>`.
  - Routes: `GET /api/settings` (mọi người dùng của công ty), `PATCH /api/settings` (`tenant.settings.manage`), `GET /api/sites/:id/settings` (`site.view`), `PATCH /api/sites/:id/settings` (`site.manage`). Trong PATCH, giá trị `null` = bỏ ghi đè (về giá trị cấp trên).
  - Mã lỗi: `SETTINGS_INVALID`, `DEVICE_PENDING`, `DEVICE_REVOKED`, `ROSTER_NOT_DEPLOYED`, `ROSTER_OVERLAP`, `ROSTER_NOT_YOUR_TEAM`, `ROSTER_LOCKED`, `ROSTER_WEEK_INVALID`, `ATTENDANCE_DEVICE_REQUIRED`, `ATTENDANCE_OUTSIDE_WINDOW`, `ATTENDANCE_ALREADY`, `ATTENDANCE_NOT_CHECKED_IN`, `ATTENDANCE_SELFIE_INVALID`.

- [ ] **Step 1: Viết test thất bại**

`backend/src/settings/settings.spec.ts`:
```ts
import { resolveSettings, SETTING_DEFAULTS } from './settings';

describe('resolveSettings', () => {
  it('takes the site value, then the company value, then the system default', () => {
    const { effective, source } = resolveSettings({ late_after_minutes: 15, absent_after_minutes: 45 }, { late_after_minutes: 5 });
    expect(effective.late_after_minutes).toBe(5);
    expect(source.late_after_minutes).toBe('site');
    expect(effective.absent_after_minutes).toBe(45);
    expect(source.absent_after_minutes).toBe('company');
    expect(effective.incident_escalate_high_minutes).toBe(SETTING_DEFAULTS.incident_escalate_high_minutes);
    expect(source.incident_escalate_high_minutes).toBe('default');
  });

  it('ignores unknown keys and values of the wrong type', () => {
    const { effective } = resolveSettings({ late_after_minutes: 'abc' as unknown as number, foo: 1 } as never, {});
    expect(effective.late_after_minutes).toBe(SETTING_DEFAULTS.late_after_minutes);
    expect(effective).not.toHaveProperty('foo');
  });
});
```

`backend/test/settings.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Settings (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let siteId: string;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'set');
    api = client(app, admin.token);
    const c = (await api.post('/api/clients', { code: 'SK', name: 'Khách' }).expect(201)).body.data;
    siteId = (await api.post('/api/sites', { client_id: c.id, code: 'SS', name: 'Toà' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('starts from the system defaults', async () => {
    const res = (await api.get('/api/settings').expect(200)).body.data;
    expect(res.values).toMatchObject({ late_after_minutes: 10, absent_after_minutes: 30, incident_escalate_critical_minutes: 3, incident_close_by_leader_up_to: 'none' });
  });

  it('lets a site override the company, and fall back when the override is removed', async () => {
    await api.patch('/api/settings', { late_after_minutes: 15 }).expect(200);
    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: 5, incident_escalate_high_minutes: 5 }).expect(200);
    let site = (await api.get(`/api/sites/${siteId}/settings`).expect(200)).body.data;
    expect(site.values.late_after_minutes).toBe(5);
    expect(site.source).toMatchObject({ late_after_minutes: 'site', absent_after_minutes: 'default', incident_escalate_high_minutes: 'site' });

    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: null }).expect(200);
    site = (await api.get(`/api/sites/${siteId}/settings`).expect(200)).body.data;
    expect(site.values.late_after_minutes).toBe(15);
    expect(site.source.late_after_minutes).toBe('company');
    expect(site.overrides).toEqual({ incident_escalate_high_minutes: 5 });
  });

  it('refuses an absent threshold at or below the late threshold, wherever it comes from', async () => {
    const res = await api.patch(`/api/sites/${siteId}/settings`, { absent_after_minutes: 10 }).expect(400);
    expect(res.body.error.code).toBe('SETTINGS_INVALID');
    await api.patch('/api/settings', { absent_after_minutes: 12, late_after_minutes: 12 }).expect(400);
    await api.patch('/api/settings', { late_after_minutes: 300 }).expect(400);
  });

  it('records each change with its old and new values', async () => {
    await api.patch('/api/settings', { early_checkout_minutes: 20 }).expect(200);
    const [row] = await ds.query(
      `SELECT data FROM audit_logs WHERE tenant_id = $1 AND action = 'settings.company' ORDER BY created_at DESC LIMIT 1`,
      [admin.tenant.id],
    );
    expect(row.data).toMatchObject({ before: { early_checkout_minutes: null }, after: { early_checkout_minutes: 20 } });
  });

  it('keeps company defaults for the director and site overrides for those who configure the site', async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).patch('/api/settings', { late_after_minutes: 1 }).expect(403);
    await client(app, manager.token).patch(`/api/sites/${siteId}/settings`, { round_tolerance_minutes: 20 }).expect(200);
    const guard = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    await client(app, guard.token).get('/api/settings').expect(200);
    await client(app, guard.token).patch(`/api/sites/${siteId}/settings`, { round_tolerance_minutes: 1 }).expect(403);
  });
});
```

Trong `backend/test/users.e2e-spec.ts`, vai trò `scoped_admin` phải tiếp tục giữ mọi quyền của `manager`: thêm `'roster.view', 'roster.manage', 'attendance.view'` vào danh sách quyền của nó.

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npx jest src/settings && npm run test:e2e -- settings`
Expected: FAIL — `Cannot find module './settings'`; `GET /api/settings` 404.

- [ ] **Step 3: Viết migration**

`backend/src/database/migrations/1760600000000-SettingsDevicesShiftsAttendance.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'roster.view'], ['admin', 'roster.manage'], ['admin', 'attendance.view'], ['admin', 'device.manage'],
  ['manager', 'roster.view'], ['manager', 'roster.manage'], ['manager', 'attendance.view'],
  ['team_leader', 'roster.view'], ['team_leader', 'roster.manage'], ['team_leader', 'attendance.view'],
  ['hr', 'roster.view'], ['hr', 'roster.manage'], ['hr', 'attendance.view'], ['hr', 'device.manage'],
  ['accountant', 'roster.view'], ['accountant', 'attendance.view'],
];

export class SettingsDevicesShiftsAttendance1760600000000 implements MigrationInterface {
  name = 'SettingsDevicesShiftsAttendance1760600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sites ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb`);

    await q.query(`
      CREATE TABLE devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id varchar(200) NOT NULL,
        platform varchar(20),
        label varchar(200),
        restricted boolean NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
        decided_by uuid REFERENCES users(id),
        decided_at timestamptz,
        last_seen_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT devices_user_device_uq UNIQUE (user_id, device_id)
      )`);
    // Guards and team leaders (restricted) keep exactly one working phone; office staff may use several.
    await q.query(`CREATE UNIQUE INDEX devices_one_active ON devices (user_id) WHERE status = 'active' AND restricted`);
    await q.query(`ALTER TABLE sessions ADD COLUMN device_id uuid REFERENCES devices(id)`);

    await q.query(`
      CREATE TABLE shift_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        name varchar(100) NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        headcount integer NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 100),
        position varchar(50) NOT NULL DEFAULT 'guard',
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT shift_templates_not_zero CHECK (start_time <> end_time)
      )`);

    await q.query(`
      CREATE TABLE shift_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        template_id uuid REFERENCES shift_templates(id),
        post_id uuid REFERENCES posts(id),
        shift_date date NOT NULL,
        planned_start timestamptz NOT NULL,
        planned_end timestamptz NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled')),
        substitute_for_id uuid REFERENCES shift_assignments(id),
        note text,
        created_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT shift_assignments_order CHECK (planned_end > planned_start),
        CONSTRAINT shift_assignments_max_24h CHECK (planned_end - planned_start <= interval '24 hours'),
        CONSTRAINT shift_assignments_no_overlap EXCLUDE USING gist (
          employee_id WITH =, tstzrange(planned_start, planned_end) WITH &&
        ) WHERE (status = 'planned')
      )`);
    await q.query(`CREATE INDEX shift_assignments_site_date_idx ON shift_assignments (site_id, shift_date)`);

    await q.query(`
      CREATE TABLE attendances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        assignment_id uuid NOT NULL UNIQUE REFERENCES shift_assignments(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        check_in_at timestamptz NOT NULL,
        check_in_lat numeric(9, 6),
        check_in_lng numeric(9, 6),
        check_in_accuracy_m integer,
        check_in_distance_m integer,
        check_in_selfie_id uuid REFERENCES files(id),
        check_in_device_time timestamptz,
        check_in_flags text[] NOT NULL DEFAULT '{}',
        late_minutes integer NOT NULL DEFAULT 0,
        check_out_at timestamptz,
        check_out_lat numeric(9, 6),
        check_out_lng numeric(9, 6),
        check_out_accuracy_m integer,
        check_out_distance_m integer,
        check_out_selfie_id uuid REFERENCES files(id),
        check_out_device_time timestamptz,
        check_out_flags text[] NOT NULL DEFAULT '{}',
        early_minutes integer,
        worked_minutes integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT attendances_order CHECK (check_out_at IS NULL OR check_out_at > check_in_at)
      )`);

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
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE ANY (ARRAY['roster.%', 'attendance.%', 'device.%'])`);
    await q.query(`DROP TABLE IF EXISTS attendances`);
    await q.query(`DROP TABLE IF EXISTS shift_assignments`);
    await q.query(`DROP TABLE IF EXISTS shift_templates`);
    await q.query(`ALTER TABLE sessions DROP COLUMN IF EXISTS device_id`);
    await q.query(`DROP TABLE IF EXISTS devices`);
    await q.query(`ALTER TABLE sites DROP COLUMN IF EXISTS settings`);
  }
}
```

- [ ] **Step 4: Quyền và mã lỗi**

Trong `backend/src/access/permissions.ts`, thêm vào `PERMISSIONS` sau `'site.manage'`:
```ts
  'roster.view': 'Xem lịch ca',
  'roster.manage': 'Xếp ca, đổi ca',
  'attendance.view': 'Xem chấm công',
  'device.manage': 'Duyệt, thu hồi máy của bảo vệ',
```
và trong `ROLE_TEMPLATES`: `manager` + `'roster.view', 'roster.manage', 'attendance.view'`; `team_leader` + `'roster.view', 'roster.manage', 'attendance.view'`; `hr` + `'roster.view', 'roster.manage', 'attendance.view', 'device.manage'`; `accountant` + `'roster.view', 'attendance.view'`.

Thêm vào `ERROR_CODES` (trước `CONFLICT`):
```ts
  SETTINGS_INVALID: { status: 400, message: 'Cài đặt không hợp lệ: mốc vắng ca phải lớn hơn mốc đi trễ' },
  DEVICE_PENDING: { status: 403, message: 'Máy này chưa được duyệt. Hãy báo HR để duyệt máy mới' },
  DEVICE_REVOKED: { status: 403, message: 'Máy này đã bị thu hồi quyền dùng' },
  ROSTER_NOT_DEPLOYED: { status: 400, message: 'Nhân viên không được điều động tới khách của mục tiêu này vào ngày đó' },
  ROSTER_OVERLAP: { status: 409, message: 'Nhân viên đã có ca khác trùng giờ' },
  ROSTER_NOT_YOUR_TEAM: { status: 403, message: 'Chỉ xếp ca được cho người trong đội bạn phụ trách' },
  ROSTER_LOCKED: { status: 409, message: 'Ca đã chấm công, không huỷ hay đổi người được' },
  ROSTER_WEEK_INVALID: { status: 400, message: 'Tuần phải bắt đầu từ thứ Hai' },
  ATTENDANCE_DEVICE_REQUIRED: { status: 403, message: 'Chỉ chấm công được từ máy đã được duyệt trên ứng dụng Patrol' },
  ATTENDANCE_OUTSIDE_WINDOW: { status: 400, message: 'Chưa đến giờ vào ca hoặc ca đã kết thúc' },
  ATTENDANCE_ALREADY: { status: 409, message: 'Đã chấm công cho ca này' },
  ATTENDANCE_NOT_CHECKED_IN: { status: 400, message: 'Chưa vào ca nên chưa ra ca được' },
  ATTENDANCE_SELFIE_INVALID: { status: 400, message: 'Ảnh selfie phải là ảnh bạn vừa chụp trên ứng dụng' },
```

- [ ] **Step 5: Viết cài đặt**

`backend/src/settings/settings.ts`:
```ts
/** System defaults. A company overrides any of them; a site overrides the company. */
export const SETTING_DEFAULTS = {
  late_after_minutes: 10,
  absent_after_minutes: 30,
  early_checkout_minutes: 10,
  round_tolerance_minutes: 15,
  incident_escalate_medium_minutes: 30,
  incident_escalate_high_minutes: 10,
  incident_escalate_critical_minutes: 3,
  incident_close_by_leader_up_to: 'none' as 'none' | 'low' | 'medium',
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;
export type SettingSource = 'site' | 'company' | 'default';
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

/** Keeps only known keys whose value has the default's type — anything else in the jsonb is ignored. */
export function cleanSettings(raw: Record<string, unknown> | null | undefined): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = raw?.[key];
    if (value !== undefined && value !== null && typeof value === typeof SETTING_DEFAULTS[key]) out[key] = value;
  }
  return out as Partial<Settings>;
}

export function resolveSettings(
  company: Record<string, unknown> | null | undefined,
  site: Record<string, unknown> | null | undefined,
): { effective: Settings; source: Record<SettingKey, SettingSource> } {
  const c = cleanSettings(company);
  const s = cleanSettings(site);
  const effective = { ...SETTING_DEFAULTS } as Record<string, unknown>;
  const source = {} as Record<SettingKey, SettingSource>;
  for (const key of SETTING_KEYS) {
    if (s[key] !== undefined) {
      effective[key] = s[key];
      source[key] = 'site';
    } else if (c[key] !== undefined) {
      effective[key] = c[key];
      source[key] = 'company';
    } else {
      source[key] = 'default';
    }
  }
  return { effective: effective as Settings, source };
}
```

`backend/src/settings/dto.ts`:
```ts
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Every field optional; `null` removes the value at this level so the level above applies. */
export class SettingsPatchDto {
  @IsOptional() @IsInt() @Min(1) @Max(240)
  late_after_minutes?: number | null;

  @IsOptional() @IsInt() @Min(2) @Max(480)
  absent_after_minutes?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(240)
  early_checkout_minutes?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(120)
  round_tolerance_minutes?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(240)
  incident_escalate_medium_minutes?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(120)
  incident_escalate_high_minutes?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  incident_escalate_critical_minutes?: number | null;

  @IsOptional() @IsIn(['none', 'low', 'medium'])
  incident_close_by_leader_up_to?: 'none' | 'low' | 'medium' | null;
}
```

`backend/src/settings/settings.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { SitesService } from '../sites/sites.service';
import { SettingsPatchDto } from './dto';
import { cleanSettings, resolveSettings, SETTING_DEFAULTS, SETTING_KEYS, Settings } from './settings';

@Injectable()
export class SettingsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async company(actor: AuthUser) {
    const raw = await this.companyRaw(tenantOf(actor));
    const { effective, source } = resolveSettings(raw, {});
    return { values: effective, source, defaults: SETTING_DEFAULTS };
  }

  async updateCompany(actor: AuthUser, patch: SettingsPatchDto) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const [row] = await m.query(`SELECT settings FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
      const { next, before, after } = applyPatch(row.settings ?? {}, patch);
      assertCoherent(resolveSettings(next, {}).effective);
      await m.query(`UPDATE tenants SET settings = $2, updated_at = now() WHERE id = $1`, [tenantId, JSON.stringify(next)]);
      // Sites that override nothing follow the new company value; sites that override keep theirs.
      const sites: { id: string; settings: Record<string, unknown> }[] = await m.query(
        `SELECT id, settings FROM sites WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );
      for (const site of sites) assertCoherent(resolveSettings(next, site.settings).effective);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'settings.company', entity_type: 'tenant', entity_id: tenantId,
        data: { before, after },
      });
    });
    return this.company(actor);
  }

  async site(actor: AuthUser, siteId: string) {
    const tenantId = tenantOf(actor);
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const [row] = await this.ds.query(`SELECT settings FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantId]);
    const company = await this.companyRaw(tenantId);
    const { effective, source } = resolveSettings(company, row.settings);
    return { values: effective, source, overrides: cleanSettings(row.settings), company: resolveSettings(company, {}).effective };
  }

  async updateSite(actor: AuthUser, siteId: string, patch: SettingsPatchDto) {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    await this.ds.transaction(async (m) => {
      const [row] = await m.query(`SELECT settings FROM sites WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [siteId, tenantId]);
      const { next, before, after } = applyPatch(row.settings ?? {}, patch);
      assertCoherent(resolveSettings(await this.companyRaw(tenantId), next).effective);
      await m.query(`UPDATE sites SET settings = $2, updated_at = now() WHERE id = $1`, [siteId, JSON.stringify(next)]);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'settings.site', entity_type: 'site', entity_id: siteId,
        data: { before, after },
      });
    });
    return this.site(actor, siteId);
  }

  /** What rules use: the site's value, else the company's, else the system default. */
  async effective(tenantId: string, siteId: string | null): Promise<Settings> {
    const company = await this.companyRaw(tenantId);
    if (!siteId) return resolveSettings(company, {}).effective;
    const [row] = await this.ds.query(`SELECT settings FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantId]);
    return resolveSettings(company, row?.settings ?? {}).effective;
  }

  private async companyRaw(tenantId: string): Promise<Record<string, unknown>> {
    const [row] = await this.ds.query(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    return row?.settings ?? {};
  }
}

/** Applies a patch to a stored settings object: values set, nulls removed; other stored keys untouched. */
function applyPatch(stored: Record<string, unknown>, patch: SettingsPatchDto) {
  const next: Record<string, unknown> = { ...stored };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    before[key] = stored[key] ?? null;
    after[key] = value;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return { next, before, after };
}

function assertCoherent(s: Settings): void {
  if (s.absent_after_minutes <= s.late_after_minutes) throw new BusinessException('SETTINGS_INVALID');
}
```

`backend/src/settings/settings.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { SettingsPatchDto } from './dto';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Every user of the company may read the defaults the app applies to them. */
  @Get('settings')
  company(@CurrentUser() user: AuthUser) {
    return this.settings.company(user);
  }

  @RequirePermission('tenant.settings.manage')
  @Patch('settings')
  updateCompany(@CurrentUser() user: AuthUser, @Body() dto: SettingsPatchDto) {
    return this.settings.updateCompany(user, dto);
  }

  @RequirePermission('site.view')
  @Get('sites/:id/settings')
  site(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.site(user, id);
  }

  @RequirePermission('site.manage')
  @Patch('sites/:id/settings')
  updateSite(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettingsPatchDto) {
    return this.settings.updateSite(user, id, dto);
  }
}
```

`backend/src/settings/settings.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { SitesModule } from '../sites/sites.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [AccessModule, AuditModule, SitesModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
```

Trong `backend/src/app.module.ts`: import `SettingsModule`, thêm vào cuối `imports`.

- [ ] **Step 6: Chạy test để thấy đạt, chạy toàn bộ, migrate DB dev**

Run: `cd backend && npx jest src/settings && npm run test:e2e && npm run migration:run`
Expected: unit 2, e2e toàn bộ xanh (gồm `settings` 5); migration `SettingsDevicesShiftsAttendance1760600000000` chạy xong.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): company defaults with per-site overrides for duty and incident thresholds"
```

---

### Task 2: Thiết bị — một máy cho mỗi bảo vệ

**Files:**
- Create: `backend/src/devices/device.entity.ts`, `backend/src/devices/devices.service.ts`, `backend/src/devices/devices.controller.ts`, `backend/src/devices/devices.module.ts`
- Modify: `backend/src/auth/auth-user.ts`, `backend/src/auth/jwt.strategy.ts`, `backend/src/auth/session.entity.ts`, `backend/src/auth/dto.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.module.ts`, `backend/src/app.module.ts`, `backend/test/helpers.ts`
- Test: `backend/test/devices.e2e-spec.ts`

**Interfaces:**
- Consumes: `AccessService.assertCanManageUser`, `ScopeService.assertTenantScope`, `AuditService`.
- Produces:
  - `AuthUser.device_id?: string | null` — id dòng `devices` **đang hoạt động** gắn với phiên; `null` cho phiên web hoặc máy chưa duyệt.
  - `LoginDto` thêm `device_id?` (`^[\w.:-]{4,200}$`), `platform?` (`android|ios|web`).
  - `DevicesService.bind(user: { id; tenant_id; user_type }, input)` → id thiết bị; ném `DEVICE_PENDING` / `DEVICE_REVOKED` cho bảo vệ trên máy chưa duyệt / đã thu hồi.
  - Quy tắc: `user_type = 'guard'` → `restricted`; máy đầu tiên tự hoạt động; máy sau ở `pending` cho tới khi HR duyệt; duyệt máy mới thu hồi máy cũ và kết thúc các phiên trên máy cũ. Nhân sự văn phòng: máy nào cũng hoạt động.
  - Routes: `GET /api/devices?status` (`device.manage`), `POST /api/devices/:id/approve`, `POST /api/devices/:id/revoke`.
  - Test helper `loginOnDevice(app, identifier, password, deviceId)` → `{ status, token }`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/test/helpers.ts`:
```ts
/** Signs in the way the mobile app does, from a given phone. Returns the HTTP status too: a new phone may be refused. */
export async function loginOnDevice(app: NestExpressApplication, identifier: string, password: string, deviceId: string) {
  const res = await request(server(app))
    .post('/api/auth/login')
    .set('X-Client', 'mobile')
    .send({ identifier, password, device_id: deviceId, platform: 'android' });
  return { status: res.status, body: res.body, token: res.body?.data?.access_token as string | undefined };
}
```

`backend/test/devices.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

describe('Devices (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'dev');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  it("binds a guard's first phone, holds a second one for approval, and swaps on approval", async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const first = await loginOnDevice(app, g.phone, g.password, 'phone-A-0001');
    expect(first.status).toBe(200);

    const second = await loginOnDevice(app, g.phone, g.password, 'phone-B-0002');
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe('DEVICE_PENDING');

    const pending = (await api.get('/api/devices?status=pending').expect(200)).body.data;
    const request = pending.find((d: { user_id: string }) => d.user_id === g.user.id);
    expect(request).toMatchObject({ device_id: 'phone-B-0002', platform: 'android', status: 'pending' });

    await api.post(`/api/devices/${request.id}/approve`).expect(201);
    await client(app, first.token!).get('/api/auth/me').expect(401); // the old phone is signed out
    expect((await loginOnDevice(app, g.phone, g.password, 'phone-B-0002')).status).toBe(200);
    expect((await loginOnDevice(app, g.phone, g.password, 'phone-A-0001')).body.error.code).toBe('DEVICE_REVOKED');
  });

  it('lets office staff use several devices freely', async () => {
    const hr = await createUserWithRoles(app, admin.tenant.id, ['hr']);
    expect((await loginOnDevice(app, hr.phone, hr.password, 'laptop-0001')).status).toBe(200);
    expect((await loginOnDevice(app, hr.phone, hr.password, 'phone-0002')).status).toBe(200);
  });

  it('revoking a phone ends its sessions', async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const on = await loginOnDevice(app, g.phone, g.password, 'phone-R-0001');
    const list = (await api.get('/api/devices').expect(200)).body.data;
    const device = list.find((d: { user_id: string }) => d.user_id === g.user.id);
    await api.post(`/api/devices/${device.id}/revoke`).expect(201);
    await client(app, on.token!).get('/api/auth/me').expect(401);
  });

  it('reports the active device on /me and keeps device approval for HR and the director', async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' });
    const on = await loginOnDevice(app, g.phone, g.password, 'phone-M-0001');
    const me = (await client(app, on.token!).get('/api/auth/me').expect(200)).body.data;
    expect(me.device).toMatchObject({ device_id: 'phone-M-0001', status: 'active' });
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).get('/api/devices').expect(403);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- devices`
Expected: FAIL — đăng nhập máy thứ hai trả 200 (chưa có ràng buộc), `forbidNonWhitelisted` từ chối `device_id` (400).

- [ ] **Step 3: Viết code**

`backend/src/devices/device.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('devices')
export class Device extends TenantEntity {
  @Column('uuid')
  user_id: string;

  /** The app's own installation id (Capacitor Device.getId). */
  @Column({ length: 200 })
  device_id: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  platform: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  label: string | null;

  /** Guards and team leaders: one active phone at a time. */
  @Column()
  restricted: boolean;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: 'pending' | 'active' | 'revoked';

  @Column({ type: 'uuid', nullable: true })
  decided_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at: Date | null;
}
```

`backend/src/devices/devices.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccessService } from '../access/access.service';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { Device } from './device.entity';

export interface DeviceInput {
  device_id: string;
  platform?: string | null;
  label?: string | null;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records the phone a user signs in from and decides whether it may be used.
   * A guard's first phone becomes theirs; any other phone waits for HR, so a
   * colleague's phone cannot be used to clock in for them.
   */
  async bind(user: { id: string; tenant_id: string | null; user_type: string }, input: DeviceInput): Promise<string> {
    const tenantId = user.tenant_id;
    if (!tenantId) throw new BusinessException('AUTH_FORBIDDEN');
    const restricted = user.user_type === 'guard';
    // Decide inside the transaction, refuse after it commits: a phone waiting for approval
    // must stay recorded so HR can see and approve it.
    const device = await this.ds.transaction(async (m) => {
      await m.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
      let device = await m.findOneBy(Device, { user_id: user.id, device_id: input.device_id });
      if (!device) {
        const hasActive = restricted && (await m.exists(Device, { where: { user_id: user.id, status: 'active', restricted: true } }));
        device = await m.save(
          m.create(Device, {
            tenant_id: tenantId, user_id: user.id, device_id: input.device_id, platform: input.platform ?? null,
            label: input.label ?? null, restricted, status: restricted && hasActive ? 'pending' : 'active',
          }),
        );
      }
      await m.update(Device, { id: device.id }, { last_seen_at: new Date(), platform: input.platform ?? device.platform });
      return device;
    });
    if (device.status === 'pending') throw new BusinessException('DEVICE_PENDING');
    if (device.status === 'revoked') throw new BusinessException('DEVICE_REVOKED');
    return device.id;
  }

  async list(actor: AuthUser, status?: string) {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    return this.ds.query(
      `SELECT d.id, d.user_id, u.full_name, u.phone, e.code AS employee_code, d.device_id, d.platform, d.label,
              d.restricted, d.status, d.created_at, d.last_seen_at, d.decided_at
         FROM devices d JOIN users u ON u.id = d.user_id LEFT JOIN employees e ON e.id = u.employee_id
        WHERE d.tenant_id = $1 AND ($2::text IS NULL OR d.status = $2)
        ORDER BY (d.status = 'pending') DESC, d.created_at DESC`,
      [tenantId, status ?? null],
    );
  }

  /** The new phone becomes the only one: the old one is revoked and its sessions end. */
  async approve(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const device = await this.get(tenantId, id);
    await this.access.assertCanManageUser(actor, device.user_id);
    await this.ds.transaction(async (m) => {
      if (device.restricted) {
        const result = await m.query(
          `UPDATE devices SET status = 'revoked', decided_by = $3, decided_at = now(), updated_at = now()
            WHERE user_id = $1 AND id <> $2 AND status = 'active' AND restricted RETURNING id`,
          [device.user_id, id, actor.id],
        );
        const others: { id: string }[] = Array.isArray(result[0]) ? result[0] : result;
        if (others.length) {
          await m.query(`UPDATE sessions SET revoked_at = now() WHERE device_id = ANY($1::uuid[]) AND revoked_at IS NULL`, [others.map((o) => o.id)]);
        }
      }
      await m.update(Device, { id }, { status: 'active', decided_by: actor.id, decided_at: new Date() });
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'device.approve', entity_type: 'user', entity_id: device.user_id,
        data: { device: device.device_id },
      });
    });
    return { ok: true };
  }

  async revoke(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const device = await this.get(tenantId, id);
    await this.access.assertCanManageUser(actor, device.user_id);
    await this.ds.transaction(async (m) => {
      await m.update(Device, { id }, { status: 'revoked', decided_by: actor.id, decided_at: new Date() });
      await m.query(`UPDATE sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL`, [id]);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'device.revoke', entity_type: 'user', entity_id: device.user_id,
        data: { device: device.device_id },
      });
    });
    return { ok: true };
  }

  private async get(tenantId: string, id: string): Promise<Device> {
    const device = await this.ds.getRepository(Device).findOneBy({ id, tenant_id: tenantId });
    if (!device) throw new BusinessException('NOT_FOUND');
    return device;
  }
}
```

`backend/src/devices/devices.controller.ts`:
```ts
import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DevicesService } from './devices.service';

class DeviceFilter {
  @IsOptional() @IsIn(['pending', 'active', 'revoked'])
  status?: string;
}

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @RequirePermission('device.manage')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() filter: DeviceFilter) {
    return this.devices.list(user, filter.status);
  }

  @RequirePermission('device.manage')
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.approve(user, id);
  }

  @RequirePermission('device.manage')
  @Post(':id/revoke')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.revoke(user, id);
  }
}
```

`backend/src/devices/devices.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [DevicesService],
  controllers: [DevicesController],
  exports: [DevicesService],
})
export class DevicesModule {}
```

Sửa phần xác thực:
- `backend/src/auth/auth-user.ts`: thêm vào `AuthUser` dòng `device_id?: string | null; // active device bound to this session, if any`.
- `backend/src/auth/session.entity.ts`: thêm `@Column({ type: 'uuid', nullable: true }) device_id: string | null;`.
- `backend/src/auth/dto.ts`, trong `LoginDto` thêm:
```ts
  @IsOptional() @Matches(/^[\w.:-]{4,200}$/, { message: 'device_id: không hợp lệ' })
  device_id?: string;

  @IsOptional() @IsIn(['android', 'ios', 'web'])
  platform?: string;
```
(import `IsIn`, `Matches`).
- `backend/src/auth/jwt.strategy.ts`: truy vấn trong `validate` thành
```ts
      `SELECT u.id, u.tenant_id, u.user_type, u.employee_id, d.id AS device_id
         FROM users u
         JOIN sessions s ON s.id = $2 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
         LEFT JOIN devices d ON d.id = s.device_id AND d.status = 'active'
         LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
          AND (u.tenant_id IS NULL OR t.status = 'active')`,
```
- `backend/src/auth/auth.service.ts`:
  - constructor nhận thêm `private readonly devices: DevicesService`;
  - trong `login`, sau `assertTenantActive`: `const deviceId = dto.device_id ? await this.devices.bind(user, { device_id: dto.device_id, platform: dto.platform, label: dto.device_label }) : null;` và gọi `this.openSession(user.id, dto.device_label ?? null, deviceId)`;
  - `openSession(userId, deviceLabel, deviceId: string | null = null)` lưu `device_id: deviceId`;
  - trong `refresh`, nhánh grace: `return this.openSession(session.user_id, session.device_label, session.device_id);`
  - `me()` trả thêm `device`: `user.device_id ? (await this.users.manager.query(\`SELECT device_id, platform, status FROM devices WHERE id = $1\`, [user.device_id]))[0] : null` (với platform admin cũng `null`).
- `backend/src/auth/auth.module.ts`: import `DevicesModule`.
- `backend/src/app.module.ts`: import `DevicesModule`, thêm vào cuối `imports`.

- [ ] **Step 4: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npm run test:e2e`
Expected: PASS — `devices` 4 tests, `auth` và các suite cũ vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): one approved phone per guard, bound to the session"
```

---

### Task 3: Mẫu ca và xếp ca

**Files:**
- Create: `backend/src/shifts/shift-template.entity.ts`, `backend/src/shifts/shift-assignment.entity.ts`, `backend/src/shifts/dto.ts`, `backend/src/shifts/templates.service.ts`, `backend/src/shifts/roster.service.ts`, `backend/src/shifts/shifts.controller.ts`, `backend/src/shifts/shifts.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/roster.e2e-spec.ts`

**Interfaces:**
- Consumes: `SitesService.writable`, `ScopeService` (`canSeeSite`, `hasTenantScope`, `teamVisibility`), `todayLocal`, `addDays`, `AuditService`.
- Produces:
  - `TemplatesService.list(actor, siteId)`, `.create(actor, siteId, dto)`, `.update(actor, id, dto)`, `.remove(actor, id)`; `TemplateView { id; site_id; name; start_time 'HH:MM'; end_time; overnight: boolean; headcount; position; status }`.
  - `RosterService.list(actor, { site_id, from, to })` → `AssignmentRow[]`, `.create(actor, dto)`, `.copyWeek(actor, dto)` → `{ created: number; skipped: { employee_name; shift_date; reason }[] }`, `.substitute(actor, id, { employee_id })`, `.cancel(actor, id)`.
  - `AssignmentRow { id; site_id; employee_id; employee_code; employee_name; template_id; template_name; post_id; shift_date; planned_start; planned_end; status; substitute_for_id; note; attendance: { check_in_at; check_out_at; late_minutes } | null }`.
  - Routes: `GET|POST /api/sites/:id/shift-templates`, `PATCH|DELETE /api/shift-templates/:id`; `GET /api/roster?site_id&from&to` (`roster.view`), `POST /api/roster`, `POST /api/roster/copy-week`, `POST /api/roster/:id/substitute`, `POST /api/roster/:id/cancel` (`roster.manage`).
  - Ai được xếp ca: phạm vi toàn công ty; hoặc thấy mục tiêu **và** nhân viên đang ở một đội mình thấy (đội trưởng → đội mình; quản lý nhóm → các đội trong nhóm).
  - Tạo ca theo mẫu (`template_id` + `shift_date`) hoặc ca lẻ (`start_at` + `end_at` ISO). Ngày của ca = ngày (giờ VN) của giờ bắt đầu.

- [ ] **Step 1: Viết test thất bại**

`backend/test/roster.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const nextMonday = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, ((8 - day) % 7) || 7);
};

describe('Roster (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  const W = addDays(nextMonday(today), 14); // a Monday safely in the future
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ros');
    api = client(app, admin.token);
    const emp = async (code: string) => (await api.post('/api/employees', { code, full_name: `NV ${code}` }).expect(201)).body.data.id;
    for (const code of ['L', 'G1', 'G2', 'G3', 'G4']) ids[code] = await emp(code);
    ids.team = (await api.post('/api/org/teams', { name: 'Đội A' }).expect(201)).body.data.id;
    ids.other = (await api.post('/api/org/teams', { name: 'Đội B' }).expect(201)).body.data.id;
    for (const code of ['L', 'G1', 'G2']) await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: ids[code] }).expect(201);
    await api.post(`/api/org/teams/${ids.other}/members`, { employee_id: ids.G3 }).expect(201);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: ids.L }).expect(200);
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    for (const code of ['L', 'G1', 'G2', 'G3']) {
      ids[`dep_${code}`] = (await api.post('/api/deployments', { employee_id: ids[code], client_id: ids.client, start_date: addDays(today, -30) }).expect(201)).body.data.id;
    }
    ids.night = (await api.post(`/api/sites/${ids.site}/shift-templates`, { name: 'Ca đêm', start_time: '22:00', end_time: '06:00' }).expect(201)).body.data.id;
    ids.day = (await api.post(`/api/sites/${ids.site}/shift-templates`, { name: 'Ca ngày', start_time: '06:00', end_time: '18:00', headcount: 2 }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const shift = (employee: string, template: string, date: string) =>
    api.post('/api/roster', { site_id: ids.site, employee_id: ids[employee], template_id: ids[template], shift_date: date });

  it('lists templates and marks overnight ones', async () => {
    const list = (await api.get(`/api/sites/${ids.site}/shift-templates`).expect(200)).body.data;
    expect(list.find((t: { id: string }) => t.id === ids.night)).toMatchObject({ start_time: '22:00', end_time: '06:00', overnight: true });
    expect(list.find((t: { id: string }) => t.id === ids.day)).toMatchObject({ overnight: false, headcount: 2 });
  });

  it('builds a night shift that ends the next morning, in Vietnam time', async () => {
    const res = (await shift('G1', 'night', W).expect(201)).body.data;
    expect(res).toMatchObject({ shift_date: W, planned_start: `${W}T15:00:00.000Z`, planned_end: `${W}T23:00:00.000Z`, template_name: 'Ca đêm' });
  });

  it('refuses overlapping shifts and people not posted to the client', async () => {
    await shift('G1', 'day', W).expect(201); // 06:00–18:00 the same day does not touch 22:00–06:00
    expect((await shift('G1', 'night', W).expect(409)).body.error.code).toBe('ROSTER_OVERLAP');
    expect((await shift('G4', 'day', W).expect(400)).body.error.code).toBe('ROSTER_NOT_DEPLOYED');
  });

  it('lets a team leader roster their own team and nobody else', async () => {
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: ids.L });
    const asLeader = client(app, leader.token);
    await asLeader.post('/api/roster', { site_id: ids.site, employee_id: ids.G2, template_id: ids.day, shift_date: W }).expect(201);
    const res = await asLeader.post('/api/roster', { site_id: ids.site, employee_id: ids.G3, template_id: ids.day, shift_date: W }).expect(403);
    expect(res.body.error.code).toBe('ROSTER_NOT_YOUR_TEAM');
    const week = (await asLeader.get(`/api/roster?site_id=${ids.site}&from=${W}&to=${addDays(W, 6)}`).expect(200)).body.data;
    expect(week.length).toBeGreaterThanOrEqual(3);
  });

  it('copies a week, skipping people no longer posted there and saying why', async () => {
    await api.post(`/api/deployments/${ids.dep_G2}/end`, { last_day: addDays(W, 6) }).expect(200);
    const res = (await api.post('/api/roster/copy-week', { site_id: ids.site, from_week: W, to_week: addDays(W, 7) }).expect(201)).body.data;
    expect(res.created).toBe(2); // G1's night and day
    expect(res.skipped).toEqual([expect.objectContaining({ employee_name: 'NV G2', shift_date: addDays(W, 7) })]);
    expect((await api.post('/api/roster/copy-week', { site_id: ids.site, from_week: addDays(W, 1), to_week: addDays(W, 8) }).expect(400)).body.error.code).toBe('ROSTER_WEEK_INVALID');
  });

  it('hands a shift to a substitute and cancels shifts', async () => {
    const original = (await shift('G1', 'night', addDays(W, 2)).expect(201)).body.data;
    const sub = (await api.post(`/api/roster/${original.id}/substitute`, { employee_id: ids.G3 }).expect(201)).body.data;
    expect(sub).toMatchObject({ employee_id: ids.G3, substitute_for_id: original.id, planned_start: original.planned_start });
    const week = (await api.get(`/api/roster?site_id=${ids.site}&from=${addDays(W, 2)}&to=${addDays(W, 2)}`).expect(200)).body.data;
    expect(week.find((a: { id: string }) => a.id === original.id).status).toBe('cancelled');
    await api.post(`/api/roster/${sub.id}/cancel`).expect(201);
  });

  it('takes one-off shifts with explicit times, up to 24 hours', async () => {
    const start = `${addDays(W, 3)}T01:00:00.000Z`;
    const ok = await api.post('/api/roster', { site_id: ids.site, employee_id: ids.G1, start_at: start, end_at: `${addDays(W, 3)}T05:00:00.000Z` }).expect(201);
    expect(ok.body.data.template_id).toBeNull();
    await api.post('/api/roster', { site_id: ids.site, employee_id: ids.G1, start_at: `${addDays(W, 4)}T00:00:00.000Z`, end_at: `${addDays(W, 5)}T01:00:00.000Z` }).expect(400);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- roster`
Expected: FAIL — `POST /api/sites/:id/shift-templates` 404.

- [ ] **Step 3: Viết entity và DTO**

`backend/src/shifts/shift-template.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** A site's own shift: local start and end times. End at or before start means it runs past midnight. */
@Entity('shift_templates')
export class ShiftTemplate extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'time' })
  start_time: string;

  @Column({ type: 'time' })
  end_time: string;

  @Column('int', { default: 1 })
  headcount: number;

  @Column({ length: 50, default: 'guard' })
  position: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/shifts/shift-assignment.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** One person on one shift. Planned shifts of one person never overlap (database exclusion). */
@Entity('shift_assignments')
export class ShiftAssignment extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  employee_id: string;

  @Column({ type: 'uuid', nullable: true })
  template_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  post_id: string | null;

  /** Local (Vietnam) date the shift starts on. */
  @Column({ type: 'date' })
  shift_date: string;

  @Column({ type: 'timestamptz' })
  planned_start: Date;

  @Column({ type: 'timestamptz' })
  planned_end: Date;

  @Column({ type: 'varchar', length: 20, default: 'planned' })
  status: 'planned' | 'cancelled';

  @Column({ type: 'uuid', nullable: true })
  substitute_for_id: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;
}
```

`backend/src/shifts/dto.ts`:
```ts
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSITION = /^[a-z][a-z0-9_]{1,49}$/;

export class TemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time: string;

  @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time: string;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  headcount?: number;

  @IsOptional() @Matches(POSITION, { message: 'position: chữ thường, số, gạch dưới' })
  position?: string;
}

export class UpdateTemplateDto {
  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time?: string;

  @IsOptionalNonNull() @IsInt() @Min(1) @Max(100)
  headcount?: number;

  @IsOptionalNonNull() @Matches(POSITION, { message: 'position: chữ thường, số, gạch dưới' })
  position?: string;

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class CreateAssignmentDto {
  @IsUUID()
  site_id: string;

  @IsUUID()
  employee_id: string;

  /** Either a template and a date… */
  @IsOptional() @IsUUID()
  template_id?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'shift_date: định dạng YYYY-MM-DD' })
  shift_date?: string;

  /** …or explicit instants for a one-off shift. */
  @IsOptional() @IsISO8601()
  start_at?: string;

  @IsOptional() @IsISO8601()
  end_at?: string;

  @IsOptional() @IsUUID()
  post_id?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class CopyWeekDto {
  @IsUUID()
  site_id: string;

  @Matches(ISO_DATE, { message: 'from_week: định dạng YYYY-MM-DD' })
  from_week: string;

  @Matches(ISO_DATE, { message: 'to_week: định dạng YYYY-MM-DD' })
  to_week: string;
}

export class SubstituteDto {
  @IsUUID()
  employee_id: string;
}

export class RosterFilter {
  @IsUUID()
  site_id: string;

  @Matches(ISO_DATE, { message: 'from: định dạng YYYY-MM-DD' })
  from: string;

  @Matches(ISO_DATE, { message: 'to: định dạng YYYY-MM-DD' })
  to: string;
}
```

- [ ] **Step 4: Viết service, controller, module**

`backend/src/shifts/templates.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { SitesService } from '../sites/sites.service';
import { TemplateDto, UpdateTemplateDto } from './dto';
import { ShiftTemplate } from './shift-template.entity';

export interface TemplateView {
  id: string;
  site_id: string;
  name: string;
  start_time: string;
  end_time: string;
  overnight: boolean;
  headcount: number;
  position: string;
  status: 'active' | 'inactive';
}

const TEMPLATE_ROWS = `
  SELECT id, site_id, name, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time,
         (end_time <= start_time) AS overnight, headcount, position, status
    FROM shift_templates
   WHERE tenant_id = $1 AND deleted_at IS NULL`;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<TemplateView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(`${TEMPLATE_ROWS} AND site_id = $2 ORDER BY start_time`, [tenantOf(actor), siteId]);
  }

  async create(actor: AuthUser, siteId: string, dto: TemplateDto): Promise<TemplateView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    assertDistinct(dto.start_time, dto.end_time);
    const saved = await this.repo().create(tenantId, {
      site_id: siteId, name: dto.name, start_time: dto.start_time, end_time: dto.end_time,
      headcount: dto.headcount ?? 1, position: dto.position ?? 'guard',
    });
    await this.log(actor, 'shift_template.create', saved.id, { site_id: siteId, ...dto });
    return this.one(tenantId, saved.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateTemplateDto): Promise<TemplateView> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    assertDistinct(dto.start_time ?? current.start_time.slice(0, 5), dto.end_time ?? current.end_time.slice(0, 5));
    await this.repo().update(tenantId, id, { ...dto });
    await this.log(actor, 'shift_template.update', id, { ...dto });
    return this.one(tenantId, id);
  }

  /** Shifts already rostered from a template keep their times; the template just stops being offered. */
  async remove(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    await this.repo().softDelete(tenantId, id);
    await this.log(actor, 'shift_template.remove', id, {});
    return { ok: true };
  }

  private async one(tenantId: string, id: string): Promise<TemplateView> {
    const [row] = await this.ds.query(`${TEMPLATE_ROWS} AND id = $2`, [tenantId, id]);
    return row;
  }

  private repo() {
    return new TenantRepository(this.ds.getRepository(ShiftTemplate));
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'shift_template', entity_id: id, data });
  }
}

function assertDistinct(start: string, end: string): void {
  if (start === end) throw new BusinessException('VALIDATION_FAILED', ['end_time: giờ kết thúc phải khác giờ bắt đầu']);
}
```

`backend/src/shifts/roster.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { CopyWeekDto, CreateAssignmentDto, RosterFilter, SubstituteDto } from './dto';
import { ShiftAssignment } from './shift-assignment.entity';

export interface AssignmentRow {
  id: string;
  site_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  template_id: string | null;
  template_name: string | null;
  post_id: string | null;
  shift_date: string;
  planned_start: Date;
  planned_end: Date;
  status: 'planned' | 'cancelled';
  substitute_for_id: string | null;
  note: string | null;
  attendance: { check_in_at: string; check_out_at: string | null; late_minutes: number } | null;
}

const ASSIGNMENT_ROWS = `
  SELECT a.id, a.site_id, a.employee_id, e.code AS employee_code, e.full_name AS employee_name, a.template_id,
         t.name AS template_name, a.post_id, a.shift_date, a.planned_start, a.planned_end, a.status, a.substitute_for_id, a.note,
         CASE WHEN at.id IS NULL THEN NULL ELSE json_build_object(
           'check_in_at', at.check_in_at, 'check_out_at', at.check_out_at, 'late_minutes', at.late_minutes) END AS attendance
    FROM shift_assignments a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shift_templates t ON t.id = a.template_id
    LEFT JOIN attendances at ON at.assignment_id = a.id
   WHERE a.tenant_id = $1`;

const DAY_MS = 86_400_000;

interface NewShift {
  site_id: string;
  employee_id: string;
  template_id: string | null;
  post_id: string | null;
  start: Date;
  end: Date;
  note: string | null;
  substitute_for_id: string | null;
}

@Injectable()
export class RosterService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: RosterFilter): Promise<AssignmentRow[]> {
    if (!(await this.scopes.canSeeSite(actor, filter.site_id))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `${ASSIGNMENT_ROWS} AND a.site_id = $2 AND a.shift_date BETWEEN $3 AND $4 ORDER BY a.planned_start, e.full_name`,
      [tenantOf(actor), filter.site_id, filter.from, filter.to],
    );
  }

  async create(actor: AuthUser, dto: CreateAssignmentDto): Promise<AssignmentRow> {
    const tenantId = tenantOf(actor);
    const times = await this.timesFor(tenantId, dto);
    const id = await this.ds.transaction((m) =>
      this.insert(m, actor, {
        site_id: dto.site_id, employee_id: dto.employee_id, template_id: dto.template_id ?? null, post_id: dto.post_id ?? null,
        start: times.start, end: times.end, note: dto.note ?? null, substitute_for_id: null,
      }),
    );
    return this.one(tenantId, id);
  }

  /** Repeats a week's planned shifts seven days later. Each shift that no longer fits is skipped with its reason. */
  async copyWeek(actor: AuthUser, dto: CopyWeekDto) {
    const tenantId = tenantOf(actor);
    if (!isMonday(dto.from_week) || !isMonday(dto.to_week)) throw new BusinessException('ROSTER_WEEK_INVALID');
    if (!(await this.scopes.canSeeSite(actor, dto.site_id))) throw new BusinessException('NOT_FOUND');
    const shiftMs = (Date.UTC(...ymd(dto.to_week)) - Date.UTC(...ymd(dto.from_week)));
    const source: ShiftAssignment[] = await this.ds.getRepository(ShiftAssignment).find({
      where: { tenant_id: tenantId, site_id: dto.site_id, status: 'planned' },
      order: { planned_start: 'ASC' },
    });
    const week = source.filter((a) => a.shift_date >= dto.from_week && a.shift_date <= addDays(dto.from_week, 6));
    let created = 0;
    const skipped: { employee_name: string; shift_date: string; reason: string }[] = [];
    for (const a of week) {
      const start = new Date(a.planned_start.getTime() + shiftMs);
      try {
        await this.ds.transaction((m) =>
          this.insert(m, actor, {
            site_id: a.site_id, employee_id: a.employee_id, template_id: a.template_id, post_id: a.post_id,
            start, end: new Date(a.planned_end.getTime() + shiftMs), note: a.note, substitute_for_id: null,
          }),
        );
        created += 1;
      } catch (error) {
        if (!(error instanceof BusinessException)) throw error;
        const [e] = await this.ds.query(`SELECT full_name FROM employees WHERE id = $1`, [a.employee_id]);
        skipped.push({ employee_name: e.full_name, shift_date: todayLocal(start), reason: error.message });
      }
    }
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'roster.copy_week', entity_type: 'site', entity_id: dto.site_id,
      data: { from_week: dto.from_week, to_week: dto.to_week, created, skipped: skipped.length },
    });
    return { created, skipped };
  }

  /** Someone else works this shift: the original is cancelled, the new one remembers whom it replaces. */
  async substitute(actor: AuthUser, id: string, dto: SubstituteDto): Promise<AssignmentRow> {
    const tenantId = tenantOf(actor);
    const newId = await this.ds.transaction(async (m) => {
      const a = await this.lockOpen(m, actor, id);
      await m.update(ShiftAssignment, { id }, { status: 'cancelled' });
      const created = await this.insert(m, actor, {
        site_id: a.site_id, employee_id: dto.employee_id, template_id: a.template_id, post_id: a.post_id,
        start: a.planned_start, end: a.planned_end, note: a.note, substitute_for_id: a.id,
      });
      await this.log(m, actor, 'roster.substitute', id, { from: a.employee_id, to: dto.employee_id, new_id: created });
      return created;
    });
    return this.one(tenantId, newId);
  }

  async cancel(actor: AuthUser, id: string): Promise<{ ok: true }> {
    await this.ds.transaction(async (m) => {
      const a = await this.lockOpen(m, actor, id);
      await m.update(ShiftAssignment, { id }, { status: 'cancelled' });
      await this.log(m, actor, 'roster.cancel', id, { employee_id: a.employee_id, shift_date: a.shift_date });
    });
    return { ok: true };
  }

  /** The planned, not yet clocked-in shift, if the caller may roster its person. */
  private async lockOpen(m: EntityManager, actor: AuthUser, id: string): Promise<ShiftAssignment> {
    const [row] = await m.query(`SELECT id FROM shift_assignments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const a = await m.findOneByOrFail(ShiftAssignment, { id });
    if (a.status !== 'planned') throw new BusinessException('NOT_FOUND');
    await this.assertCanRoster(actor, a.employee_id, a.site_id);
    if ((await m.query(`SELECT 1 FROM attendances WHERE assignment_id = $1`, [id])).length) throw new BusinessException('ROSTER_LOCKED');
    return a;
  }

  private async insert(m: EntityManager, actor: AuthUser, s: NewShift): Promise<string> {
    const tenantId = tenantOf(actor);
    const [site] = await m.query(`SELECT id, client_id FROM sites WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [s.site_id, tenantId]);
    if (!site) throw new BusinessException('NOT_FOUND');
    await this.assertCanRoster(actor, s.employee_id, s.site_id);
    const [employee] = await m.query(
      `SELECT id, status FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [s.employee_id, tenantId],
    );
    if (!employee) throw new BusinessException('NOT_FOUND');
    if (employee.status !== 'active') throw new BusinessException('EMPLOYEE_INACTIVE');
    if (s.end.getTime() <= s.start.getTime() || s.end.getTime() - s.start.getTime() > DAY_MS) {
      throw new BusinessException('VALIDATION_FAILED', ['end_at: ca phải dài hơn 0 và tối đa 24 giờ']);
    }
    const shiftDate = todayLocal(s.start);
    if (s.post_id) {
      const post = await m.query(`SELECT 1 FROM posts WHERE id = $1 AND site_id = $2 AND deleted_at IS NULL`, [s.post_id, s.site_id]);
      if (!post.length) throw new BusinessException('NOT_FOUND');
    }
    const posted = await m.query(
      `SELECT 1 FROM deployments WHERE employee_id = $1 AND client_id = $2 AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3)`,
      [s.employee_id, site.client_id, shiftDate],
    );
    if (!posted.length) throw new BusinessException('ROSTER_NOT_DEPLOYED');
    const clash = await m.query(
      `SELECT 1 FROM shift_assignments WHERE employee_id = $1 AND status = 'planned' AND tstzrange(planned_start, planned_end) && tstzrange($2, $3)`,
      [s.employee_id, s.start, s.end],
    );
    if (clash.length) throw new BusinessException('ROSTER_OVERLAP');
    const saved = await m.save(
      m.create(ShiftAssignment, {
        tenant_id: tenantId, site_id: s.site_id, employee_id: s.employee_id, template_id: s.template_id, post_id: s.post_id,
        shift_date: shiftDate, planned_start: s.start, planned_end: s.end, status: 'planned',
        substitute_for_id: s.substitute_for_id, note: s.note, created_by: actor.id,
      }),
    );
    await this.log(m, actor, 'roster.create', saved.id, { employee_id: s.employee_id, site_id: s.site_id, start: s.start, end: s.end });
    return saved.id;
  }

  /**
   * Company-wide scope rosters anyone. Otherwise the caller must see the site and the
   * person must be in one of the caller's teams today: a leader rosters their team,
   * a group manager the group's teams.
   */
  private async assertCanRoster(actor: AuthUser, employeeId: string, siteId: string): Promise<void> {
    if (await this.scopes.hasTenantScope(actor)) return;
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const teams = await this.scopes.teamVisibility(actor);
    const teamIds = teams.all ? [] : teams.teamIds;
    const today = todayLocal();
    const inTeam = await this.ds.query(
      `SELECT 1 FROM team_members WHERE employee_id = $1 AND team_id = ANY($2::uuid[]) AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3)`,
      [employeeId, teamIds, today],
    );
    if (!inTeam.length) throw new BusinessException('ROSTER_NOT_YOUR_TEAM');
  }

  /** Template + date → instants, computed by PostgreSQL in Vietnam time; or the explicit one-off instants. */
  private async timesFor(tenantId: string, dto: CreateAssignmentDto): Promise<{ start: Date; end: Date }> {
    if (dto.template_id) {
      if (!dto.shift_date) throw new BusinessException('VALIDATION_FAILED', ['shift_date: cần ngày của ca']);
      const [t] = await this.ds.query(
        `SELECT (($3::date + start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start,
                ((($3::date + CASE WHEN end_time <= start_time THEN 1 ELSE 0 END) + end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS "end"
           FROM shift_templates
          WHERE id = $1 AND tenant_id = $2 AND site_id = $4 AND deleted_at IS NULL AND status = 'active'`,
        [dto.template_id, tenantId, dto.shift_date, dto.site_id],
      );
      if (!t) throw new BusinessException('NOT_FOUND');
      return { start: new Date(t.start), end: new Date(t.end) };
    }
    if (!dto.start_at || !dto.end_at) throw new BusinessException('VALIDATION_FAILED', ['start_at, end_at: cần mẫu ca hoặc giờ bắt đầu và kết thúc']);
    return { start: new Date(dto.start_at), end: new Date(dto.end_at) };
  }

  private async one(tenantId: string, id: string): Promise<AssignmentRow> {
    const [row] = await this.ds.query(`${ASSIGNMENT_ROWS} AND a.id = $2`, [tenantId, id]);
    return row;
  }

  private log(m: EntityManager, actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(m, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'shift_assignment', entity_id: id, data });
  }
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

function isMonday(iso: string): boolean {
  return new Date(Date.UTC(...ymd(iso))).getUTCDay() === 1;
}
```

`backend/src/shifts/shifts.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CopyWeekDto, CreateAssignmentDto, RosterFilter, SubstituteDto, TemplateDto, UpdateTemplateDto } from './dto';
import { RosterService } from './roster.service';
import { TemplatesService } from './templates.service';

@Controller()
export class ShiftsController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly roster: RosterService,
  ) {}

  @RequirePermission('site.view')
  @Get('sites/:id/shift-templates')
  listTemplates(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.list(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/shift-templates')
  createTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TemplateDto) {
    return this.templates.create(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Patch('shift-templates/:id')
  updateTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('shift-templates/:id')
  removeTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(user, id);
  }

  @RequirePermission('roster.view')
  @Get('roster')
  list(@CurrentUser() user: AuthUser, @Query() filter: RosterFilter) {
    return this.roster.list(user, filter);
  }

  @RequirePermission('roster.manage')
  @Post('roster')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAssignmentDto) {
    return this.roster.create(user, dto);
  }

  @RequirePermission('roster.manage')
  @Post('roster/copy-week')
  copyWeek(@CurrentUser() user: AuthUser, @Body() dto: CopyWeekDto) {
    return this.roster.copyWeek(user, dto);
  }

  @RequirePermission('roster.manage')
  @Post('roster/:id/substitute')
  substitute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubstituteDto) {
    return this.roster.substitute(user, id, dto);
  }

  @RequirePermission('roster.manage')
  @Post('roster/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roster.cancel(user, id);
  }
}
```

`backend/src/shifts/shifts.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { SitesModule } from '../sites/sites.module';
import { RosterService } from './roster.service';
import { ShiftsController } from './shifts.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [AccessModule, AuditModule, SitesModule],
  providers: [TemplatesService, RosterService],
  controllers: [ShiftsController],
  exports: [TemplatesService, RosterService],
})
export class ShiftsModule {}
```

Trong `backend/src/app.module.ts`: import `ShiftsModule`, thêm vào cuối `imports`.

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- roster`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): site shift templates and team-scoped weekly roster with copy-week and substitutes"
```

---

### Task 4: Chấm công vào/ra ca và bảng chấm công

**Files:**
- Create: `backend/src/attendance/geo.ts`, `backend/src/attendance/attendance-status.ts`, `backend/src/attendance/attendance.spec.ts`, `backend/src/attendance/attendance.entity.ts`, `backend/src/attendance/dto.ts`, `backend/src/attendance/attendance.service.ts`, `backend/src/attendance/attendance.controller.ts`, `backend/src/attendance/attendance.module.ts`
- Modify: `backend/src/files/file.entity.ts`, `backend/src/files/files.service.ts`, `backend/src/app.module.ts`
- Test: `backend/test/attendance.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthUser.device_id`, `SettingsService.effective`, `FilesService.claim`, `ScopeService.canSeeSite`, `PermissionService`.
- Produces:
  - `distanceMeters(a, b): number` (haversine, làm tròn mét).
  - `type AttendanceStatus = 'upcoming' | 'waiting' | 'late' | 'absent' | 'on_duty' | 'done' | 'cancelled'`; `attendanceStatus(row, now, settings)`.
  - `AttendanceService.myShifts(actor, { from, to })`, `.checkIn(actor, dto)`, `.checkOut(actor, dto)`, `.board(actor, { site_id, date })`.
  - Routes: `GET /api/me/shifts?from&to` (mọi người dùng có hồ sơ nhân viên), `POST /api/attendance/check-in`, `POST /api/attendance/check-out` (chính người được xếp ca, từ máy đã duyệt), `GET /api/attendance/board?site_id&date` (`attendance.view`).
  - Cửa sổ vào ca: từ 60 phút trước giờ bắt đầu đến giờ kết thúc; ra ca: sau khi vào ca, tới 6 giờ sau giờ kết thúc.
  - Cờ: `outside_geofence` (xa mục tiêu hơn `geofence_radius_m`), `mock_location` (app báo), `clock_skew` (giờ máy lệch > 5 phút), `low_accuracy` (sai số GPS > 100 m).
  - `FileOwnerType` thêm `'attendance'`: selfie xem được bởi chính người chấm công, hoặc người có `attendance.view` thấy mục tiêu.

- [ ] **Step 1: Viết test thất bại**

`backend/src/attendance/attendance.spec.ts`:
```ts
import { attendanceStatus } from './attendance-status';
import { distanceMeters } from './geo';

const at = (iso: string) => new Date(iso);
const S = { late_after_minutes: 10, absent_after_minutes: 30 };
const shift = { status: 'planned' as const, planned_start: at('2026-10-13T00:00:00Z'), planned_end: at('2026-10-13T12:00:00Z'), check_in_at: null, check_out_at: null };

describe('distanceMeters', () => {
  it('measures short distances on the ground', () => {
    expect(distanceMeters({ lat: 21.0285, lng: 105.8542 }, { lat: 21.0285, lng: 105.8542 })).toBe(0);
    const d = distanceMeters({ lat: 21.0285, lng: 105.8542 }, { lat: 21.0294, lng: 105.8542 });
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe('attendanceStatus', () => {
  it.each([
    ['2026-10-12T23:59:00Z', 'upcoming'],
    ['2026-10-13T00:10:00Z', 'waiting'],
    ['2026-10-13T00:11:00Z', 'late'],
    ['2026-10-13T00:31:00Z', 'absent'],
    ['2026-10-13T12:00:00Z', 'absent'],
  ])('with nobody clocked in, at %s the shift is %s', (now, expected) => {
    expect(attendanceStatus(shift, at(now), S)).toBe(expected);
  });

  it('follows the clock-in and clock-out once they exist', () => {
    expect(attendanceStatus({ ...shift, check_in_at: at('2026-10-13T00:20:00Z') }, at('2026-10-13T03:00:00Z'), S)).toBe('on_duty');
    expect(attendanceStatus({ ...shift, check_in_at: at('2026-10-13T00:00:00Z'), check_out_at: at('2026-10-13T12:00:00Z') }, at('2026-10-13T13:00:00Z'), S)).toBe('done');
    expect(attendanceStatus({ ...shift, status: 'cancelled' }, at('2026-10-13T03:00:00Z'), S)).toBe('cancelled');
  });

  it('uses the site thresholds it is given', () => {
    expect(attendanceStatus(shift, at('2026-10-13T00:15:00Z'), { late_after_minutes: 20, absent_after_minutes: 40 })).toBe('waiting');
  });
});
```

`backend/test/attendance.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Attendance (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let siteId: string;
  let clientId: string;
  let teamId: string;
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'att');
    api = client(app, admin.token);
    clientId = (await api.post('/api/clients', { code: 'AK', name: 'Khách' }).expect(201)).body.data.id;
    teamId = (await api.post('/api/org/teams', { name: 'Đội chấm công' }).expect(201)).body.data.id;
    siteId = (await api.post('/api/sites', { client_id: clientId, code: 'AS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: teamId }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  /** A guard posted to the client, in the team, signed in on their own phone, with one shift. */
  async function guardWithShift(startInMinutes: number, hours = 8) {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `AG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data;
    await api.post(`/api/org/teams/${teamId}/members`, { employee_id: employee.id }).expect(201);
    await api.post('/api/deployments', { employee_id: employee.id, client_id: clientId, start_date: addDays(todayLocal(), -10) }).expect(201);
    const user = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee.id });
    const phone = await loginOnDevice(app, user.phone, user.password, `att-phone-${seq}`);
    const shift = (await api.post('/api/roster', { site_id: siteId, employee_id: employee.id, start_at: minutes(startInMinutes), end_at: minutes(startInMinutes + hours * 60) }).expect(201)).body.data;
    return { employee, user, token: phone.token!, shift };
  }
  const selfie = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'selfie.jpg').expect(201)).body.data.id;
  const checkIn = (token: string, body: object) => client(app, token).post('/api/attendance/check-in', { device_time: new Date().toISOString(), ...body });

  it('clocks a guard in at the site from their approved phone', async () => {
    const g = await guardWithShift(-5);
    const res = await checkIn(g.token, { assignment_id: g.shift.id, lat: 21.0286, lng: 105.7768, accuracy_m: 12, selfie_file_id: await selfie(g.token) }).expect(201);
    expect(res.body.data).toMatchObject({ check_in_flags: [], late_minutes: 5 });
    expect(res.body.data.check_in_distance_m).toBeLessThan(30);
    const mine = (await client(app, g.token).get(`/api/me/shifts?from=${todayLocal()}&to=${todayLocal()}`).expect(200)).body.data;
    expect(mine[0]).toMatchObject({ id: g.shift.id, site_name: 'Toà', attendance: expect.objectContaining({ late_minutes: 5 }) });
  });

  it('flags a clock-in far from the site or with a faked location', async () => {
    const g = await guardWithShift(-1);
    const res = await checkIn(g.token, { assignment_id: g.shift.id, lat: 21.05, lng: 105.80, accuracy_m: 300, mock_location: true, selfie_file_id: await selfie(g.token) }).expect(201);
    expect(res.body.data.check_in_flags.sort()).toEqual(['low_accuracy', 'mock_location', 'outside_geofence']);
  });

  it('refuses clock-ins from the web, for others, with borrowed selfies, too early, or twice', async () => {
    const g = await guardWithShift(-1);
    const other = await guardWithShift(-1);
    const web = (await request(server(app)).post('/api/auth/login').set('X-Client', 'mobile').send({ identifier: g.user.phone, password: g.user.password })).body.data.access_token;
    const mySelfie = await selfie(g.token);
    expect((await checkIn(web, { assignment_id: g.shift.id, ...SITE, selfie_file_id: mySelfie }).expect(403)).body.error.code).toBe('ATTENDANCE_DEVICE_REQUIRED');
    await checkIn(g.token, { assignment_id: other.shift.id, ...SITE, selfie_file_id: mySelfie }).expect(404);
    expect((await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: await selfie(admin.token) }).expect(400)).body.error.code).toBe('ATTENDANCE_SELFIE_INVALID');

    const early = await guardWithShift(180);
    expect((await checkIn(early.token, { assignment_id: early.shift.id, ...SITE, selfie_file_id: await selfie(early.token) }).expect(400)).body.error.code).toBe('ATTENDANCE_OUTSIDE_WINDOW');

    await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: mySelfie }).expect(201);
    expect((await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: await selfie(g.token) }).expect(409)).body.error.code).toBe('ATTENDANCE_ALREADY');
  });

  it('clocks out with early minutes and worked time, and locks the shift against roster changes', async () => {
    const g = await guardWithShift(-1);
    expect((await client(app, g.token).post('/api/attendance/check-out', { assignment_id: g.shift.id, ...SITE, device_time: new Date().toISOString(), selfie_file_id: await selfie(g.token) }).expect(400)).body.error.code).toBe('ATTENDANCE_NOT_CHECKED_IN');
    await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: await selfie(g.token) }).expect(201);
    const res = await client(app, g.token).post('/api/attendance/check-out', { assignment_id: g.shift.id, ...SITE, device_time: new Date().toISOString(), selfie_file_id: await selfie(g.token) }).expect(201);
    expect(res.body.data.early_minutes).toBeGreaterThan(470);
    expect(res.body.data.worked_minutes).toBe(0);
    expect((await api.post(`/api/roster/${g.shift.id}/cancel`).expect(409)).body.error.code).toBe('ROSTER_LOCKED');
  });

  it("shows who is late or absent by the site's own thresholds", async () => {
    const late = await guardWithShift(-15);
    const absent = await guardWithShift(-120);
    const upcoming = await guardWithShift(60);
    const board = async () => (await api.get(`/api/attendance/board?site_id=${siteId}&date=${todayLocal()}`).expect(200)).body.data;
    const statusOf = (rows: { id: string; status: string }[], id: string) => rows.find((r) => r.id === id)?.status;

    let b = await board();
    expect(b.settings).toMatchObject({ late_after_minutes: 10, absent_after_minutes: 30 });
    expect(statusOf(b.rows, late.shift.id)).toBe('late');
    expect(statusOf(b.rows, absent.shift.id)).toBe('absent');
    expect(statusOf(b.rows, upcoming.shift.id)).toBe('upcoming');

    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: 20, absent_after_minutes: 150 }).expect(200);
    b = await board();
    expect(statusOf(b.rows, late.shift.id)).toBe('waiting');
    expect(statusOf(b.rows, absent.shift.id)).toBe('late');
    await api.patch(`/api/sites/${siteId}/settings`, { late_after_minutes: null, absent_after_minutes: null }).expect(200);
  });

  it("lets the team's leader see the selfie, and nobody outside", async () => {
    const g = await guardWithShift(-1);
    const photo = await selfie(g.token);
    await checkIn(g.token, { assignment_id: g.shift.id, ...SITE, selfie_file_id: photo }).expect(201);
    await client(app, g.token).get(`/api/files/${photo}`).expect(200);
    const lead = (await api.post('/api/employees', { code: `LEAD${++seq}`, full_name: 'Đội trưởng' }).expect(201)).body.data;
    await api.post(`/api/org/teams/${teamId}/members`, { employee_id: lead.id }).expect(201);
    await api.put(`/api/org/teams/${teamId}/leader`, { employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    await client(app, leader.token).get(`/api/files/${photo}`).expect(200);
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant'], [{ scope_type: 'client', scope_id: (await api.post('/api/clients', { code: `OT${seq}`, name: 'Khác' }).expect(201)).body.data.id }]);
    await client(app, accountant.token).get(`/api/files/${photo}`).expect(404);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npx jest src/attendance && npm run test:e2e -- attendance`
Expected: FAIL — `Cannot find module './attendance-status'`; e2e `POST /api/attendance/check-in` 404.

- [ ] **Step 3: Viết hàm thuần**

`backend/src/attendance/geo.ts`:
```ts
const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in whole metres — plenty for "is the guard at the building". */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}
```

`backend/src/attendance/attendance-status.ts`:
```ts
export type AttendanceStatus = 'upcoming' | 'waiting' | 'late' | 'absent' | 'on_duty' | 'done' | 'cancelled';

/**
 * Where a shift stands right now, from its times, its clock-in/out and the site's
 * thresholds. Computed when read, so changing a site's threshold changes the board at once.
 */
export function attendanceStatus(
  a: { status: 'planned' | 'cancelled'; planned_start: Date; planned_end: Date; check_in_at: Date | null; check_out_at: Date | null },
  now: Date,
  s: { late_after_minutes: number; absent_after_minutes: number },
): AttendanceStatus {
  if (a.status === 'cancelled') return 'cancelled';
  if (a.check_out_at) return 'done';
  if (a.check_in_at) return 'on_duty';
  const minutesIn = (now.getTime() - a.planned_start.getTime()) / 60_000;
  if (minutesIn < 0) return 'upcoming';
  if (now.getTime() >= a.planned_end.getTime() || minutesIn > s.absent_after_minutes) return 'absent';
  if (minutesIn > s.late_after_minutes) return 'late';
  return 'waiting';
}
```

Run: `npx jest src/attendance` → PASS (9 tests).

- [ ] **Step 4: Viết entity, DTO, service, controller, module**

`backend/src/attendance/attendance.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('attendances')
export class Attendance extends TenantEntity {
  @Column('uuid')
  assignment_id: string;

  @Column('uuid')
  employee_id: string;

  @Column({ type: 'timestamptz' })
  check_in_at: Date;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_in_lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_in_lng: string | null;

  @Column('int', { nullable: true })
  check_in_accuracy_m: number | null;

  @Column('int', { nullable: true })
  check_in_distance_m: number | null;

  @Column({ type: 'uuid', nullable: true })
  check_in_selfie_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_in_device_time: Date | null;

  @Column({ type: 'text', array: true, default: () => `'{}'` })
  check_in_flags: string[];

  @Column('int', { default: 0 })
  late_minutes: number;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_out_lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  check_out_lng: string | null;

  @Column('int', { nullable: true })
  check_out_accuracy_m: number | null;

  @Column('int', { nullable: true })
  check_out_distance_m: number | null;

  @Column({ type: 'uuid', nullable: true })
  check_out_selfie_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_device_time: Date | null;

  @Column({ type: 'text', array: true, default: () => `'{}'` })
  check_out_flags: string[];

  @Column('int', { nullable: true })
  early_minutes: number | null;

  @Column('int', { nullable: true })
  worked_minutes: number | null;
}
```

`backend/src/attendance/dto.ts`:
```ts
import { IsBoolean, IsInt, IsISO8601, IsLatitude, IsLongitude, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CheckDto {
  @IsUUID()
  assignment_id: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  accuracy_m?: number;

  @IsUUID()
  selfie_file_id: string;

  /** The phone's own clock, kept to spot a phone whose time was changed. */
  @IsISO8601()
  device_time: string;

  /** The app's own mock-location detection (Android reports it; iOS only partly). */
  @IsOptional() @IsBoolean()
  mock_location?: boolean;
}

export class MyShiftsFilter {
  @Matches(ISO_DATE, { message: 'from: định dạng YYYY-MM-DD' })
  from: string;

  @Matches(ISO_DATE, { message: 'to: định dạng YYYY-MM-DD' })
  to: string;
}

export class BoardFilter {
  @IsUUID()
  site_id: string;

  @Matches(ISO_DATE, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;
}
```

`backend/src/attendance/attendance.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { attendanceStatus } from './attendance-status';
import { Attendance } from './attendance.entity';
import { BoardFilter, CheckDto, MyShiftsFilter } from './dto';
import { distanceMeters } from './geo';

const EARLY_WINDOW_MS = 60 * 60_000;
const LATE_CHECKOUT_MS = 6 * 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const LOW_ACCURACY_M = 100;

interface ShiftForCheck {
  id: string;
  site_id: string;
  planned_start: Date;
  planned_end: Date;
  lat: string | null;
  lng: string | null;
  geofence_radius_m: number;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
  ) {}

  /** The caller's own planned shifts, with where to go and what they have done so far. */
  async myShifts(actor: AuthUser, filter: MyShiftsFilter) {
    if (!actor.employee_id) return [];
    return this.ds.query(
      `SELECT a.id, a.shift_date, a.planned_start, a.planned_end, a.site_id, s.name AS site_name, s.address AS site_address,
              s.lat AS site_lat, s.lng AS site_lng, s.geofence_radius_m, t.name AS template_name,
              CASE WHEN at.id IS NULL THEN NULL ELSE json_build_object(
                'check_in_at', at.check_in_at, 'check_out_at', at.check_out_at, 'late_minutes', at.late_minutes) END AS attendance
         FROM shift_assignments a
         JOIN sites s ON s.id = a.site_id
         LEFT JOIN shift_templates t ON t.id = a.template_id
         LEFT JOIN attendances at ON at.assignment_id = a.id
        WHERE a.tenant_id = $1 AND a.employee_id = $2 AND a.status = 'planned' AND a.shift_date BETWEEN $3 AND $4
        ORDER BY a.planned_start`,
      [tenantOf(actor), actor.employee_id, filter.from, filter.to],
    );
  }

  async checkIn(actor: AuthUser, dto: CheckDto): Promise<Attendance> {
    const tenantId = tenantOf(actor);
    if (!actor.device_id) throw new BusinessException('ATTENDANCE_DEVICE_REQUIRED');
    const now = new Date();
    return this.ds.transaction(async (m) => {
      const shift = await this.ownShift(m, actor, dto.assignment_id);
      if (now.getTime() < shift.planned_start.getTime() - EARLY_WINDOW_MS || now.getTime() > shift.planned_end.getTime()) {
        throw new BusinessException('ATTENDANCE_OUTSIDE_WINDOW');
      }
      if (await m.exists(Attendance, { where: { assignment_id: shift.id } })) throw new BusinessException('ATTENDANCE_ALREADY');
      await this.assertOwnSelfie(m, actor, dto.selfie_file_id);
      const { distance, flags } = this.observe(shift, dto, now);
      const saved = await m.save(
        m.create(Attendance, {
          tenant_id: tenantId, assignment_id: shift.id, employee_id: actor.employee_id!, check_in_at: now,
          check_in_lat: String(dto.lat), check_in_lng: String(dto.lng), check_in_accuracy_m: dto.accuracy_m ?? null,
          check_in_distance_m: distance, check_in_selfie_id: dto.selfie_file_id, check_in_device_time: new Date(dto.device_time),
          check_in_flags: flags, late_minutes: Math.max(0, Math.floor((now.getTime() - shift.planned_start.getTime()) / 60_000)),
        }),
      );
      await this.files.claim(m, tenantId, dto.selfie_file_id, { type: 'attendance', id: saved.id });
      return saved;
    });
  }

  async checkOut(actor: AuthUser, dto: CheckDto): Promise<Attendance> {
    const tenantId = tenantOf(actor);
    if (!actor.device_id) throw new BusinessException('ATTENDANCE_DEVICE_REQUIRED');
    const now = new Date();
    return this.ds.transaction(async (m) => {
      const shift = await this.ownShift(m, actor, dto.assignment_id);
      const record = await m.findOneBy(Attendance, { assignment_id: shift.id });
      if (!record) throw new BusinessException('ATTENDANCE_NOT_CHECKED_IN');
      if (record.check_out_at) throw new BusinessException('ATTENDANCE_ALREADY');
      if (now.getTime() > shift.planned_end.getTime() + LATE_CHECKOUT_MS) throw new BusinessException('ATTENDANCE_OUTSIDE_WINDOW');
      await this.assertOwnSelfie(m, actor, dto.selfie_file_id);
      const { distance, flags } = this.observe(shift, dto, now);
      await m.update(Attendance, { id: record.id }, {
        check_out_at: now, check_out_lat: String(dto.lat), check_out_lng: String(dto.lng), check_out_accuracy_m: dto.accuracy_m ?? null,
        check_out_distance_m: distance, check_out_selfie_id: dto.selfie_file_id, check_out_device_time: new Date(dto.device_time),
        check_out_flags: flags,
        early_minutes: Math.max(0, Math.ceil((shift.planned_end.getTime() - now.getTime()) / 60_000)),
        worked_minutes: Math.floor((now.getTime() - record.check_in_at.getTime()) / 60_000),
      });
      await this.files.claim(m, tenantId, dto.selfie_file_id, { type: 'attendance', id: record.id });
      return m.findOneByOrFail(Attendance, { id: record.id });
    });
  }

  /** One site, one day: every shift with its live status under the site's own thresholds. */
  async board(actor: AuthUser, filter: BoardFilter) {
    const tenantId = tenantOf(actor);
    if (!(await this.scopes.canSeeSite(actor, filter.site_id))) throw new BusinessException('NOT_FOUND');
    const settings = await this.settings.effective(tenantId, filter.site_id);
    const rows: Record<string, unknown>[] = await this.ds.query(
      `SELECT a.id, a.employee_id, e.code AS employee_code, e.full_name AS employee_name, t.name AS template_name,
              a.planned_start, a.planned_end, a.status, at.check_in_at, at.check_out_at, at.late_minutes, at.early_minutes,
              at.check_in_flags, at.check_out_flags, at.check_in_distance_m, at.check_in_selfie_id, at.check_out_selfie_id
         FROM shift_assignments a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN shift_templates t ON t.id = a.template_id
         LEFT JOIN attendances at ON at.assignment_id = a.id
        WHERE a.tenant_id = $1 AND a.site_id = $2 AND a.shift_date = $3
        ORDER BY a.planned_start, e.full_name`,
      [tenantId, filter.site_id, filter.date],
    );
    const now = new Date();
    return {
      settings: {
        late_after_minutes: settings.late_after_minutes,
        absent_after_minutes: settings.absent_after_minutes,
        early_checkout_minutes: settings.early_checkout_minutes,
      },
      rows: rows.map((r) => ({
        ...r,
        status: attendanceStatus(r as never, now, settings),
        late_in: r.check_in_at ? (r.late_minutes as number) > settings.late_after_minutes : false,
        early_out: r.check_out_at ? (r.early_minutes as number) > settings.early_checkout_minutes : false,
      })),
    };
  }

  /** The caller's own planned shift, locked; another person's shift is simply not found. */
  private async ownShift(m: EntityManager, actor: AuthUser, assignmentId: string): Promise<ShiftForCheck> {
    const [row]: ShiftForCheck[] = await m.query(
      `SELECT a.id, a.site_id, a.planned_start, a.planned_end, s.lat, s.lng, s.geofence_radius_m
         FROM shift_assignments a JOIN sites s ON s.id = a.site_id
        WHERE a.id = $1 AND a.tenant_id = $2 AND a.employee_id = $3 AND a.status = 'planned'
        FOR UPDATE OF a`,
      [assignmentId, tenantOf(actor), actor.employee_id],
    );
    if (!row) throw new BusinessException('NOT_FOUND');
    return { ...row, planned_start: new Date(row.planned_start), planned_end: new Date(row.planned_end) };
  }

  /** A selfie this very user just uploaded, an image, not yet attached to anything. */
  private async assertOwnSelfie(m: EntityManager, actor: AuthUser, fileId: string): Promise<void> {
    const rows = await m.query(
      `SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
          AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL`,
      [fileId, tenantOf(actor), actor.id],
    );
    if (!rows.length) throw new BusinessException('ATTENDANCE_SELFIE_INVALID');
  }

  private observe(shift: ShiftForCheck, dto: CheckDto, now: Date): { distance: number | null; flags: string[] } {
    const flags: string[] = [];
    let distance: number | null = null;
    if (shift.lat !== null && shift.lng !== null) {
      distance = distanceMeters({ lat: Number(shift.lat), lng: Number(shift.lng) }, { lat: dto.lat, lng: dto.lng });
      if (distance > shift.geofence_radius_m) flags.push('outside_geofence');
    }
    if (dto.mock_location) flags.push('mock_location');
    if (Math.abs(new Date(dto.device_time).getTime() - now.getTime()) > CLOCK_SKEW_MS) flags.push('clock_skew');
    if (dto.accuracy_m !== undefined && dto.accuracy_m > LOW_ACCURACY_M) flags.push('low_accuracy');
    return { distance, flags };
  }
}
```

`backend/src/attendance/attendance.controller.ts`:
```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AttendanceService } from './attendance.service';
import { BoardFilter, CheckDto, MyShiftsFilter } from './dto';

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** Any user of the company: their own shifts only. */
  @Get('me/shifts')
  myShifts(@CurrentUser() user: AuthUser, @Query() filter: MyShiftsFilter) {
    return this.attendance.myShifts(user, filter);
  }

  @Post('attendance/check-in')
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckDto) {
    return this.attendance.checkIn(user, dto);
  }

  @Post('attendance/check-out')
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: CheckDto) {
    return this.attendance.checkOut(user, dto);
  }

  @RequirePermission('attendance.view')
  @Get('attendance/board')
  board(@CurrentUser() user: AuthUser, @Query() filter: BoardFilter) {
    return this.attendance.board(user, filter);
  }
}
```

`backend/src/attendance/attendance.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { FilesModule } from '../files/files.module';
import { SettingsModule } from '../settings/settings.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [AccessModule, FilesModule, SettingsModule],
  providers: [AttendanceService],
  controllers: [AttendanceController],
})
export class AttendanceModule {}
```

Sửa phần file:
- `backend/src/files/file.entity.ts`: `export type FileOwnerType = 'contract' | 'employee_document' | 'attendance';`
- `backend/src/files/files.service.ts`, trong `maySee` trước `return false;` cuối:
```ts
    if (file.owner_type === 'attendance') {
      const [row] = await this.ds.query(
        `SELECT at.employee_id, a.site_id FROM attendances at JOIN shift_assignments a ON a.id = at.assignment_id WHERE at.id = $1`,
        [file.owner_id],
      );
      if (!row) return false;
      if (row.employee_id === actor.employee_id) return true;
      return (await this.permissions.has(actor.id, ['attendance.view'])) && (await this.scopes.canSeeSite(actor, row.site_id));
    }
```

Trong `backend/src/app.module.ts`: import `AttendanceModule`, thêm vào cuối `imports`.

- [ ] **Step 5: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npx jest src/attendance && npm run test:e2e`
Expected: unit 9; e2e toàn bộ xanh (gồm `attendance` 6).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): clock-in/out from approved phones with geofence flags, and a live attendance board"
```

---

### Task 5: Cách ly công ty cho dữ liệu mới, dữ liệu demo

**Files:**
- Modify: `backend/src/scripts/seed-demo.ts`
- Test: `backend/test/tenancy-04.e2e-spec.ts`

- [ ] **Step 1: Viết test**

`backend/test/tenancy-04.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for settings, devices, shifts, attendance (e2e)', () => {
  let app: NestExpressApplication;
  let apiA: ReturnType<typeof client>;
  const B: Record<'site' | 'template' | 'shift' | 'employee', string> = { site: '', template: '', shift: '', employee: '' };
  let aSite: string;
  const D = addDays(todayLocal(), 20);

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso4-a');
    const b = await createTenantWithAdmin(app, 'iso4-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const cB = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data.id;
    B.site = (await apiB.post('/api/sites', { client_id: cB, code: 'BS', name: 'B' }).expect(201)).body.data.id;
    B.template = (await apiB.post(`/api/sites/${B.site}/shift-templates`, { name: 'Ca', start_time: '06:00', end_time: '18:00' }).expect(201)).body.data.id;
    B.employee = (await apiB.post('/api/employees', { code: 'BE', full_name: 'B' }).expect(201)).body.data.id;
    await apiB.post('/api/deployments', { employee_id: B.employee, client_id: cB, start_date: todayLocal() }).expect(201);
    B.shift = (await apiB.post('/api/roster', { site_id: B.site, employee_id: B.employee, template_id: B.template, shift_date: D }).expect(201)).body.data.id;
    const cA = (await apiA.post('/api/clients', { code: 'AK', name: 'A' }).expect(201)).body.data.id;
    aSite = (await apiA.post('/api/sites', { client_id: cA, code: 'AS', name: 'A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or write of B's records with 404", async () => {
    await apiA.get(`/api/sites/${B.site}/settings`).expect(404);
    await apiA.patch(`/api/sites/${B.site}/settings`, { late_after_minutes: 5 }).expect(404);
    await apiA.get(`/api/sites/${B.site}/shift-templates`).expect(404);
    await apiA.patch(`/api/shift-templates/${B.template}`, { name: 'x' }).expect(404);
    await apiA.get(`/api/roster?site_id=${B.site}&from=${D}&to=${D}`).expect(404);
    await apiA.post(`/api/roster/${B.shift}/cancel`).expect(404);
    await apiA.post(`/api/roster/${B.shift}/substitute`, { employee_id: B.employee }).expect(404);
    await apiA.get(`/api/attendance/board?site_id=${B.site}&date=${D}`).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post('/api/roster', { site_id: aSite, employee_id: B.employee, start_at: `${D}T01:00:00.000Z`, end_at: `${D}T05:00:00.000Z` }).expect(404);
    await apiA.post('/api/roster', { site_id: aSite, employee_id: B.employee, template_id: B.template, shift_date: D }).expect(404);
  });

  it("keeps B's devices out of A's list", async () => {
    const list = (await apiA.get('/api/devices').expect(200)).body.data;
    expect(list).toEqual([]);
  });
});
```

Run: `cd backend && npm run test:e2e -- tenancy-04` → PASS (3 tests). Một dòng trả 200/201 là lỗ hổng: sửa service trước khi đi tiếp.

- [ ] **Step 2: Thêm ca trực vào dữ liệu demo**

Trong `backend/src/scripts/seed-demo.ts`, import `TemplatesService`, `RosterService` từ `../shifts/...`; thêm trước dòng `console.log('Đã tạo công ty demo...`:
```ts
  const templatesSvc = app.get(TemplatesService);
  const rosterSvc = app.get(RosterService);
  const dayShift = await templatesSvc.create(actor, toa.id, { name: 'Ca ngày', start_time: '06:00', end_time: '18:00', headcount: 2 });
  const nightShift = await templatesSvc.create(actor, toa.id, { name: 'Ca đêm', start_time: '18:00', end_time: '06:00', headcount: 1 });
  for (let d = 0; d < 7; d += 1) {
    const date = addDays(today, d);
    await rosterSvc.create(actor, { site_id: toa.id, employee_id: staff[d % 2 === 0 ? 0 : 1].id, template_id: dayShift.id, shift_date: date });
    await rosterSvc.create(actor, { site_id: toa.id, employee_id: staff[2].id, template_id: nightShift.id, shift_date: date });
  }
```
(ca ngày luân phiên Nguyễn Văn An / Phạm Văn Bình, ca đêm Hoàng Văn Cường — cả ba đang được điều động tới Toà nhà CT1).

Run: `cd .. && docker compose exec -T postgres psql -q -U patrol -d patrol -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && cd backend && npm run migration:run && npm run seed:demo` → in danh sách tài khoản, không lỗi.

- [ ] **Step 3: Chạy toàn bộ, commit**

Run: `cd backend && npm test && npm run test:e2e && npm run build` → PASS.

```bash
git add backend
git commit -m "test(backend): isolation suite for settings, shifts, attendance; demo week roster"
```

---

### Task 6: Web — cài đặt công ty, cài đặt riêng và mẫu ca của mục tiêu

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/lib/format.ts`, `web/src/components/shell.tsx`, `web/src/app/(app)/muc-tieu/[id]/page.tsx`
- Create: `web/src/app/(app)/cai-dat/page.tsx`, `web/src/components/site-settings.tsx`, `web/src/components/site-shifts.tsx`

**Interfaces:**
- Consumes: `GET|PATCH /api/settings`, `GET|PATCH /api/sites/:id/settings`, `GET|POST /api/sites/:id/shift-templates`, `PATCH|DELETE /api/shift-templates/:id`.
- Produces: `SETTING_FIELDS` (nhãn tiếng Việt cho từng khoá); trang `/cai-dat`; `<SiteSettings siteId manage />`, `<SiteShifts siteId manage />` gắn vào trang mục tiêu; menu Cài đặt, Xếp ca, Chấm công, Thiết bị.

- [ ] **Step 1: Kiểu dữ liệu, nhãn, menu**

Thêm vào `web/src/lib/types.ts`:
```ts
export interface SettingsValues {
  late_after_minutes: number;
  absent_after_minutes: number;
  early_checkout_minutes: number;
  round_tolerance_minutes: number;
  incident_escalate_medium_minutes: number;
  incident_escalate_high_minutes: number;
  incident_escalate_critical_minutes: number;
  incident_close_by_leader_up_to: 'none' | 'low' | 'medium';
}
export type SettingKey = keyof SettingsValues;

export interface CompanySettings {
  values: SettingsValues;
  defaults: SettingsValues;
}

export interface SiteSettingsView {
  values: SettingsValues;
  source: Record<SettingKey, 'site' | 'company' | 'default'>;
  overrides: Partial<SettingsValues>;
  company: SettingsValues;
}

export interface TemplateView {
  id: string;
  site_id: string;
  name: string;
  start_time: string;
  end_time: string;
  overnight: boolean;
  headcount: number;
  position: string;
  status: 'active' | 'inactive';
}

export interface AssignmentRow {
  id: string;
  site_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  template_id: string | null;
  template_name: string | null;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  status: 'planned' | 'cancelled';
  substitute_for_id: string | null;
  attendance: { check_in_at: string; check_out_at: string | null; late_minutes: number } | null;
}

export type AttendanceStatus = 'upcoming' | 'waiting' | 'late' | 'absent' | 'on_duty' | 'done' | 'cancelled';

export interface BoardRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  template_name: string | null;
  planned_start: string;
  planned_end: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number | null;
  early_minutes: number | null;
  check_in_flags: string[] | null;
  check_out_flags: string[] | null;
  check_in_distance_m: number | null;
  check_in_selfie_id: string | null;
  check_out_selfie_id: string | null;
  late_in: boolean;
  early_out: boolean;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  employee_code: string | null;
  device_id: string;
  platform: string | null;
  restricted: boolean;
  status: 'pending' | 'active' | 'revoked';
  created_at: string;
  last_seen_at: string | null;
}
```

Thêm vào `web/src/lib/format.ts`:
```ts
import type { AttendanceStatus, SettingKey } from './types';

export const SETTING_FIELDS: { key: SettingKey; label: string; unit?: string; min?: number; max?: number }[] = [
  { key: 'late_after_minutes', label: 'Tính đi trễ sau', unit: 'phút', min: 1, max: 240 },
  { key: 'absent_after_minutes', label: 'Tính vắng ca sau', unit: 'phút', min: 2, max: 480 },
  { key: 'early_checkout_minutes', label: 'Ra ca sớm hơn … thì ghi vi phạm', unit: 'phút', min: 0, max: 240 },
  { key: 'round_tolerance_minutes', label: 'Vòng tuần được trễ', unit: 'phút', min: 0, max: 120 },
  { key: 'incident_escalate_medium_minutes', label: 'Sự cố trung bình: leo thang sau', unit: 'phút', min: 1, max: 240 },
  { key: 'incident_escalate_high_minutes', label: 'Sự cố cao: leo thang sau', unit: 'phút', min: 1, max: 120 },
  { key: 'incident_escalate_critical_minutes', label: 'Khẩn cấp / SOS: nhắc lại mỗi', unit: 'phút', min: 1, max: 30 },
  { key: 'incident_close_by_leader_up_to', label: 'Đội trưởng được tự đóng sự cố' },
];

export const CLOSE_BY_LEADER: Record<string, string> = {
  none: 'Không (chỉ quản lý trở lên)',
  low: 'Mức thấp',
  medium: 'Mức thấp và trung bình',
};

export const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: string }> = {
  upcoming: { label: 'Chưa đến giờ', tone: 'bg-slate-100 text-slate-700' },
  waiting: { label: 'Đang chờ vào ca', tone: 'bg-sky-100 text-sky-800' },
  late: { label: 'Chưa vào ca — trễ', tone: 'bg-amber-100 text-amber-800' },
  absent: { label: 'Vắng ca', tone: 'bg-red-100 text-red-700' },
  on_duty: { label: 'Đang trực', tone: 'bg-teal-100 text-teal-800' },
  done: { label: 'Đã ra ca', tone: 'bg-slate-200 text-slate-700' },
  cancelled: { label: 'Đã huỷ', tone: 'bg-slate-100 text-slate-400' },
};

export const FLAG_LABEL: Record<string, string> = {
  outside_geofence: 'ngoài mục tiêu',
  mock_location: 'GPS giả',
  clock_skew: 'giờ máy lệch',
  low_accuracy: 'GPS kém',
};

/** "2026-10-13T01:30:00Z" → "08:30" in Vietnam time. */
export const time = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
```
(đặt dòng `import type` lên đầu file, gộp với import có sẵn).

Trong `web/src/components/shell.tsx`, `NAV` thêm sau "Mục tiêu":
```ts
  { href: '/xep-ca', label: 'Xếp ca', permission: 'roster.view' },
  { href: '/cham-cong', label: 'Chấm công', permission: 'attendance.view' },
```
và ở cuối:
```ts
  { href: '/thiet-bi', label: 'Thiết bị', permission: 'device.manage' },
  { href: '/cai-dat', label: 'Cài đặt', permission: 'tenant.settings.manage' },
```

- [ ] **Step 2: Trang cài đặt công ty**

`web/src/app/(app)/cai-dat/page.tsx`:
```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { CLOSE_BY_LEADER, SETTING_FIELDS } from '@/lib/format';
import { CompanySettings, SettingsValues } from '@/lib/types';

export default function CompanySettingsPage() {
  const [data, setData] = useState<CompanySettings | null>(null);
  const [draft, setDraft] = useState<SettingsValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<CompanySettings>('/settings').then((d) => { setData(d); setDraft(d.values); }).catch((e) => setError(errorMessage(e)));
  }, []);

  if (!data || !draft) return <ErrorText error={error} />;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const next = await api<CompanySettings>('/settings', { method: 'PATCH', json: draft });
      setData(next);
      setDraft(next.values);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Cài đặt công ty</h1>
      <p className="text-sm text-slate-500">Đây là giá trị chung. Mục tiêu nào cần khác thì đặt riêng trong trang của mục tiêu đó.</p>
      <Card>
        <form onSubmit={save} className="space-y-3">
          {SETTING_FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''} — mặc định hệ thống: ${f.key === 'incident_close_by_leader_up_to' ? CLOSE_BY_LEADER[data.defaults[f.key]] : data.defaults[f.key]}`}>
              {f.key === 'incident_close_by_leader_up_to' ? (
                <Select value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value as SettingsValues['incident_close_by_leader_up_to'] })}>
                  {Object.entries(CLOSE_BY_LEADER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              ) : (
                <Input type="number" min={f.min} max={f.max} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })} required />
              )}
            </Field>
          ))}
          <ErrorText error={error} />
          {saved && <p className="text-sm text-teal-700">Đã lưu. Các mục tiêu không đặt riêng sẽ dùng giá trị mới ngay.</p>}
          <Button type="submit">Lưu cài đặt</Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Cài đặt riêng và mẫu ca của mục tiêu**

`web/src/components/site-settings.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { CLOSE_BY_LEADER, SETTING_FIELDS } from '@/lib/format';
import { SettingKey, SiteSettingsView } from '@/lib/types';

/** Each value either follows the company or is set for this site; one switch per row moves between the two. */
export function SiteSettings({ siteId, manage }: { siteId: string; manage: boolean }) {
  const [data, setData] = useState<SiteSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setData(await api<SiteSettingsView>(`/sites/${siteId}/settings`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const patch = async (key: SettingKey, value: number | string | null) => {
    setError(null);
    try {
      setData(await api<SiteSettingsView>(`/sites/${siteId}/settings`, { method: 'PATCH', json: { [key]: value } }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!data) return <ErrorText error={error} />;
  return (
    <Card title="Cài đặt riêng của mục tiêu">
      <table className="w-full text-left text-sm">
        <thead className="text-slate-500"><tr><th className="py-2">Cài đặt</th><th>Giá trị đang dùng</th><th>Theo</th><th /></tr></thead>
        <tbody>
          {SETTING_FIELDS.map((f) => {
            const own = data.source[f.key] === 'site';
            const value = data.values[f.key];
            return (
              <tr key={f.key} className="border-t border-slate-100">
                <td className="py-2">{f.label}</td>
                <td className="w-48">
                  {own && manage ? (
                    f.key === 'incident_close_by_leader_up_to' ? (
                      <Select value={String(value)} onChange={(e) => patch(f.key, e.target.value)}>
                        {Object.entries(CLOSE_BY_LEADER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    ) : (
                      <Input type="number" min={f.min} max={f.max} defaultValue={Number(value)} onBlur={(e) => e.target.value !== String(value) && patch(f.key, Number(e.target.value))} />
                    )
                  ) : (
                    <span>{f.key === 'incident_close_by_leader_up_to' ? CLOSE_BY_LEADER[String(value)] : `${value} ${f.unit ?? ''}`}</span>
                  )}
                </td>
                <td className={own ? 'font-medium text-teal-700' : 'text-slate-500'}>{own ? 'Riêng mục tiêu' : 'Công ty'}</td>
                <td className="text-right">
                  {manage && (own ? (
                    <Button variant="secondary" onClick={() => patch(f.key, null)}>Dùng giá trị công ty</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => patch(f.key, data.company[f.key])}>Đặt riêng</Button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ErrorText error={error} />
    </Card>
  );
}
```

`web/src/components/site-shifts.tsx`:
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { TemplateView } from '@/lib/types';

export function SiteShifts({ siteId, manage }: { siteId: string; manage: boolean }) {
  const [rows, setRows] = useState<TemplateView[]>([]);
  const [form, setForm] = useState({ name: '', start_time: '06:00', end_time: '18:00', headcount: '1' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRows(await api<TemplateView[]>(`/sites/${siteId}/shift-templates`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  async function create(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/sites/${siteId}/shift-templates`, { method: 'POST', json: { ...form, headcount: Number(form.headcount) } });
      setForm({ ...form, name: '' });
    });
  }

  return (
    <Card title="Mẫu ca">
      <ul className="mb-3 divide-y divide-slate-100 text-sm">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span>
              <b>{t.name}</b> · {t.start_time}–{t.end_time}{t.overnight ? ' (qua đêm)' : ''} · cần {t.headcount} người
            </span>
            {manage && <Button variant="secondary" onClick={() => run(() => api(`/shift-templates/${t.id}`, { method: 'DELETE' }))}>Xoá</Button>}
          </li>
        ))}
        {!rows.length && <li className="py-2 text-slate-400">Chưa có mẫu ca — đội trưởng cần ít nhất một mẫu để xếp ca</li>}
      </ul>
      {manage && (
        <form onSubmit={create} className="grid grid-cols-2 items-end gap-3 md:grid-cols-5">
          <Field label="Tên ca"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ca ngày" required /></Field>
          <Field label="Bắt đầu"><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required /></Field>
          <Field label="Kết thúc"><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required /></Field>
          <Field label="Số người"><Input type="number" min={1} max={100} value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} /></Field>
          <Button type="submit">Thêm mẫu ca</Button>
        </form>
      )}
      <p className="mt-2 text-xs text-slate-500">Giờ kết thúc nhỏ hơn giờ bắt đầu là ca qua đêm (VD 18:00–06:00).</p>
      <ErrorText error={error} />
    </Card>
  );
}
```

Trong `web/src/app/(app)/muc-tieu/[id]/page.tsx`: import `SiteSettings` từ `@/components/site-settings` và `SiteShifts` từ `@/components/site-shifts`; đặt `<SiteShifts siteId={site.id} manage={manage} />` và `<SiteSettings siteId={site.id} manage={manage} />` ngay sau thẻ "Chốt gác".

- [ ] **Step 4: Kiểm tra build, commit**

Run: `cd web && npm run build` → `Compiled successfully`.

```bash
git add web
git commit -m "feat(web): company settings, per-site overrides and shift templates"
```

---

### Task 7: Web — xếp ca tuần, bảng chấm công, duyệt thiết bị

**Files:**
- Create: `web/src/app/(app)/xep-ca/page.tsx`, `web/src/app/(app)/cham-cong/page.tsx`, `web/src/app/(app)/thiet-bi/page.tsx`

**Interfaces:**
- Consumes: `GET /api/sites`, `GET /api/sites/:id/shift-templates`, `GET /api/deployments?client_id&on`, `GET|POST /api/roster`, `POST /api/roster/copy-week`, `POST /api/roster/:id/cancel|substitute`, `GET /api/attendance/board`, `GET /api/devices`, `POST /api/devices/:id/approve|revoke`.
- Produces: trang `/xep-ca` (lưới người × 7 ngày), `/cham-cong` (theo mục tiêu và ngày), `/thiet-bi`.

- [ ] **Step 1: Trang xếp ca**

`web/src/app/(app)/xep-ca/page.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, ErrorText, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, time } from '@/lib/format';
import { AssignmentRow, DeploymentView, SiteRow, TemplateView } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
};
const DAY_NAMES = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export default function RosterPage() {
  const { can } = useAuth();
  const manage = can('roster.manage');
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [week, setWeek] = useState(mondayOf(todayIso()));
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; code: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    const site = sites.find((s) => s.id === siteId);
    const [t, r] = await Promise.all([
      api<TemplateView[]>(`/sites/${siteId}/shift-templates`),
      api<AssignmentRow[]>(`/roster?site_id=${siteId}&from=${days[0]}&to=${days[6]}`),
    ]);
    setTemplates(t.filter((x) => x.status === 'active'));
    setRows(r);
    // People who can be rostered here: posted to the site's client during the week, plus anyone already rostered.
    const posted = site && can('deployment.view') ? await api<DeploymentView[]>(`/deployments?client_id=${site.client_id}&on=${days[0]}`) : [];
    const map = new Map<string, { id: string; name: string; code: string }>();
    for (const d of posted) map.set(d.employee_id, { id: d.employee_id, name: d.employee_name, code: d.employee_code });
    for (const a of r) map.set(a.employee_id, { id: a.employee_id, name: a.employee_name, code: a.employee_code });
    setPeople([...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
  }, [siteId, sites, days, can]);

  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setNote(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const copyLastWeek = () =>
    run(async () => {
      const res = await api<{ created: number; skipped: { employee_name: string; shift_date: string; reason: string }[] }>('/roster/copy-week', {
        method: 'POST', json: { site_id: siteId, from_week: addDays(week, -7), to_week: week },
      });
      setNote(`Đã chép ${res.created} ca.${res.skipped.length ? ` Bỏ qua ${res.skipped.length}: ${res.skipped.map((s) => `${s.employee_name} ngày ${date(s.shift_date)} (${s.reason})`).join('; ')}` : ''}`);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Xếp ca</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <div className="flex items-center gap-1">
          <Button variant="secondary" onClick={() => setWeek(addDays(week, -7))}>←</Button>
          <span className="w-48 text-center text-sm">{date(days[0])} – {date(days[6])}</span>
          <Button variant="secondary" onClick={() => setWeek(addDays(week, 7))}>→</Button>
        </div>
        {manage && <Button variant="secondary" onClick={copyLastWeek}>Chép từ tuần trước</Button>}
      </div>
      <ErrorText error={error} />
      {note && <p className="text-sm text-teal-700">{note}</p>}
      {!templates.length && siteId && <p className="text-sm text-amber-700">Mục tiêu chưa có mẫu ca. Vào trang mục tiêu để thêm.</p>}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="w-44 py-2">Nhân viên</th>
                {days.map((d, i) => <th key={d} className={d === todayIso() ? 'text-teal-700' : ''}>{DAY_NAMES[i]} {date(d).slice(0, 5)}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">{p.name}<div className="font-mono text-xs text-slate-400">{p.code}</div></td>
                  {days.map((d) => {
                    const cell = rows.filter((a) => a.employee_id === p.id && a.shift_date === d && a.status === 'planned');
                    return (
                      <td key={d} className="space-y-1 py-2 pr-1">
                        {cell.map((a) => (
                          <div key={a.id} className={`rounded px-1.5 py-0.5 text-xs ${a.attendance ? 'bg-teal-100 text-teal-800' : 'bg-slate-100'}`}>
                            {a.template_name ?? 'Ca lẻ'} {time(a.planned_start)}–{time(a.planned_end)}
                            {manage && !a.attendance && (
                              <button onClick={() => run(() => api(`/roster/${a.id}/cancel`, { method: 'POST' }))} className="ml-1 text-slate-400 hover:text-red-600" title="Huỷ ca">×</button>
                            )}
                          </div>
                        ))}
                        {manage && templates.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => e.target.value && run(() => api('/roster', { method: 'POST', json: { site_id: siteId, employee_id: p.id, template_id: e.target.value, shift_date: d } }))}
                            className="w-full rounded border border-dashed border-slate-300 bg-transparent px-1 text-xs text-slate-500"
                          >
                            <option value="">+ ca</option>
                            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} {t.start_time}</option>)}
                          </select>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!people.length && <tr><td colSpan={8} className="py-6 text-center text-slate-400">Chưa có ai được điều động tới khách của mục tiêu này</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-slate-500">Ca màu xanh là ca đã chấm công — không huỷ được. Mỗi ô chỉ nhận người đang được điều động tới khách vào ngày đó.</p>
    </div>
  );
}
```

- [ ] **Step 2: Trang chấm công**

`web/src/app/(app)/cham-cong/page.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { ATTENDANCE_STATUS, FLAG_LABEL, time } from '@/lib/format';
import { BoardRow, SiteRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function AttendancePage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [day, setDay] = useState(todayIso());
  const [board, setBoard] = useState<{ settings: { late_after_minutes: number; absent_after_minutes: number }; rows: BoardRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (siteId) setBoard(await api(`/attendance/board?site_id=${siteId}&date=${day}`));
  }, [siteId, day]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    const timer = setInterval(() => load().catch(() => undefined), 60_000); // statuses move with the clock
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Chấm công</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
      </div>
      <ErrorText error={error} />
      {board && (
        <>
          <p className="text-sm text-slate-500">
            Mục tiêu này tính trễ sau {board.settings.late_after_minutes} phút, vắng sau {board.settings.absent_after_minutes} phút. Bảng tự cập nhật mỗi phút.
          </p>
          <Card>
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-2">Nhân viên</th><th>Ca</th><th>Trạng thái</th><th>Vào ca</th><th>Ra ca</th><th>Ghi chú</th></tr>
              </thead>
              <tbody>
                {board.rows.map((r) => {
                  const flags = [...(r.check_in_flags ?? []), ...(r.check_out_flags ?? [])].map((f) => FLAG_LABEL[f] ?? f);
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="py-2">{r.employee_name} <span className="font-mono text-xs text-slate-400">{r.employee_code}</span></td>
                      <td>{r.template_name ?? 'Ca lẻ'} {time(r.planned_start)}–{time(r.planned_end)}</td>
                      <td><span className={`rounded px-1.5 py-0.5 text-xs ${ATTENDANCE_STATUS[r.status].tone}`}>{ATTENDANCE_STATUS[r.status].label}</span></td>
                      <td>
                        {time(r.check_in_at)}
                        {r.late_in && <span className="ml-1 text-xs text-amber-700">trễ {r.late_minutes}′</span>}
                        {r.check_in_selfie_id && <a href={`/api/files/${r.check_in_selfie_id}`} className="ml-2 text-xs text-teal-700 hover:underline">ảnh</a>}
                      </td>
                      <td>
                        {time(r.check_out_at)}
                        {r.early_out && <span className="ml-1 text-xs text-amber-700">sớm {r.early_minutes}′</span>}
                        {r.check_out_selfie_id && <a href={`/api/files/${r.check_out_selfie_id}`} className="ml-2 text-xs text-teal-700 hover:underline">ảnh</a>}
                      </td>
                      <td className="text-xs text-red-700">{flags.join(', ')}{r.check_in_distance_m !== null && r.check_in_distance_m !== undefined ? <span className="ml-1 text-slate-400">cách {r.check_in_distance_m} m</span> : null}</td>
                    </tr>
                  );
                })}
                {!board.rows.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Không có ca nào trong ngày</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Trang thiết bị**

`web/src/app/(app)/thiet-bi/page.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { DeviceRow } from '@/lib/types';

const STATUS: Record<DeviceRow['status'], string> = { pending: 'Chờ duyệt', active: 'Đang dùng', revoked: 'Đã thu hồi' };

export default function DevicesPage() {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setRows(await api<DeviceRow[]>('/devices')), []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const act = async (id: string, action: 'approve' | 'revoke') => {
    setError(null);
    try {
      await api(`/devices/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Thiết bị</h1>
      <p className="text-sm text-slate-500">
        Mỗi bảo vệ chỉ chấm công được từ một điện thoại. Khi họ đổi máy, máy mới hiện ở đây để duyệt; duyệt xong, máy cũ bị đăng xuất.
      </p>
      <ErrorText error={error} />
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">Người dùng</th><th>Máy</th><th>Lần đầu</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={`border-t border-slate-100 ${d.status === 'pending' ? 'bg-amber-50' : ''}`}>
                <td className="py-2">{d.full_name} <span className="text-xs text-slate-400">{d.employee_code ?? d.phone}</span></td>
                <td className="font-mono text-xs">{d.platform ?? '?'} · {d.device_id}</td>
                <td>{date(d.created_at.slice(0, 10))}</td>
                <td>{STATUS[d.status]}{!d.restricted && <span className="ml-1 text-xs text-slate-400">(văn phòng)</span>}</td>
                <td className="space-x-2 text-right">
                  {d.status === 'pending' && <Button onClick={() => act(d.id, 'approve')}>Duyệt</Button>}
                  {d.status !== 'revoked' && <Button variant="secondary" onClick={() => act(d.id, 'revoke')}>Thu hồi</Button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có thiết bị nào đăng nhập từ ứng dụng</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Kiểm tra build, chạy toàn bộ, commit**

Run: `cd backend && npm test && npm run test:e2e && cd ../web && npm run build`
Expected: tất cả PASS.

Chạy thử (giám đốc demo): Mục tiêu → Toà A: có 2 mẫu ca và bảng "Cài đặt riêng" (mọi dòng "Công ty"); bấm "Đặt riêng" ở "Tính đi trễ sau" → đổi 15 → dòng thành "Riêng mục tiêu". Xếp ca: tuần này có ca ngày luân phiên và ca đêm; tuần sau → "Chép từ tuần trước" → 14 ca. Chấm công: hôm nay hiện ca ngày "Vắng ca"/"Chưa vào ca — trễ" theo giờ hiện tại (chưa có app nên chưa ai vào ca).

```bash
git add web
git commit -m "feat(web): weekly roster grid, live attendance board, device approvals"
```

---

## Sau plan này

- **Plan 04b — App di động** (Capacitor 8, như POS): đăng nhập (gửi `device_id`, `platform`), ca hôm nay (`/me/shifts`), vào/ra ca (camera trước + GPS + `mock_location` của Android), tab Đội của tôi cho đội trưởng (`/attendance/board`). Cần chủ dự án: tên app, appId, quyền dùng Codemagic.
- **Plan 05**: lịch tuần tra, vòng tuần, check-in điểm, sự cố + SOS + push + leo thang (đọc `SettingsService.effective`), vi phạm tự động từ chấm công và vòng tuần.
