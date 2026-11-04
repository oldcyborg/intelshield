# Plan 07 — Bộ máy vi phạm (tự ghi, đội trưởng đề xuất, quản lý duyệt) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi phút hệ thống tự ghi vi phạm từ chấm công (vắng ca, vào trễ, ra sớm) và tuần tra (bỏ vòng, thiếu điểm, quét nghi vấn) theo mốc của từng mục tiêu; nhắc đội trưởng khi bảo vệ chưa vào ca, báo đội trưởng + quản lý khi vắng ca; huỷ/đổi ca sau mốc vắng không xoá được dấu vắng; đội trưởng đề xuất xác nhận/miễn, quản lý duyệt; bảo vệ xem vi phạm của mình; web có trang Vi phạm và ô chờ duyệt ở Tổng quan. Vi phạm `confirmed` là đầu vào lương Giai đoạn 2.

**Architecture:** Khối mới `violations`: `ViolationsEngine` (vòng quét mỗi phút, idempotent nhờ khoá duy nhất `(ref_type, ref_id, employee_id, type)`, chỉ xét 2 ngày gần nhất; có `recordAbsenceIfDue` cho xếp ca gọi trong giao dịch huỷ/đổi ca), `ViolationsService` (danh sách theo phạm vi mục tiêu, tổng hợp, của tôi, đề xuất, duyệt). Đọc cài đặt hiệu lực của mục tiêu (`SettingsService.effective`, có bộ nhớ đệm trong một lượt quét).

**Tech Stack:** như trước.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` bản 1.6 — §4.7 (`violations`), §7.0 (mốc), §7.1 (quy tắc và quy tắc chi tiết), §3.4 (quản lý duyệt, đội trưởng đề xuất), §5.1 T5/Q5, §5.2 W9.

**Khác với spec (có chủ đích):**
- `occurred_at` và `minutes` lưu cùng `detail jsonb` (điểm thiếu, cờ nghi vấn, đổi từ vắng sang trễ) thay vì `body` tự do.
- Báo cáo vi phạm và xuất Excel làm cùng phần Báo cáo (W10).

## Global Constraints

- Mọi quy ước Plan 01–06 giữ nguyên.
- Chỉ ghi vi phạm cho mục tiêu của khách `managed`.
- Chạy lại vòng quét bao nhiêu lần cũng không sinh trùng.
- Không ai đề xuất hay duyệt vi phạm của chính mình; miễn phải có lý do.
- Một bước lỗi trong vòng quét chỉ ghi log; các bước khác vẫn chạy (như leo thang sự cố).

## Review Focus

1. **Không mất dấu vắng ca**: huỷ ca, đổi người trực sau mốc vắng; vào ca muộn hơn mốc vắng đổi thành trễ — test ở Task 2.
2. **Không ghi oan**: vòng được báo bù đủ thì vi phạm bỏ vòng/thiếu điểm tự miễn; vi phạm đã duyệt không bị máy sửa — test ở Task 2–3.
3. **Đúng người, đúng phạm vi**: đề xuất/duyệt theo quyền và phạm vi mục tiêu, không tự duyệt mình — test ở Task 4.

---

### Task 1: Schema, quyền, entity

**Files:**
- Create: `backend/src/database/migrations/1761000000000-Violations.ts`, `backend/src/violations/violation.entity.ts`, `backend/src/violations/violations.module.ts`
- Modify: `backend/src/access/permissions.ts`, `backend/src/common/errors/error-codes.ts`, `backend/src/app.module.ts`, `backend/test/users.e2e-spec.ts`, `backend/test/test-env.ts`, `backend/.env.example`
- Test: `backend/test/violations-schema.e2e-spec.ts`

**Interfaces:**
- Produces:
  - Quyền `violation.view`, `violation.propose`, `violation.review`. Vai trò mẫu: `admin` tất cả; `manager` cả ba; `team_leader` view + propose; `hr`, `accountant` view.
  - `type ViolationType = 'late_check_in' | 'absent' | 'early_check_out' | 'missed_round' | 'missed_checkpoint' | 'suspicious_scan'`; `type ViolationStatus = 'auto' | 'proposed_confirm' | 'proposed_waive' | 'confirmed' | 'waived'`.
  - Bảng `violations`; cột `shift_assignments.late_alerted_at`.
  - Mã lỗi `VIOLATION_OWN`, `VIOLATION_NOTE_REQUIRED`, `VIOLATION_ALREADY_REVIEWED`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/violations-schema.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTenantWithAdmin, createTestApp } from './helpers';

describe('Violations — schema and roles (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'vsc');
  });
  afterAll(async () => app.close());

  it('lets leaders propose, managers review, office staff only read', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'violation.%'`,
      [admin.tenant.id],
    );
    const of = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission).sort();
    expect(of('manager')).toEqual(['violation.propose', 'violation.review', 'violation.view']);
    expect(of('team_leader')).toEqual(['violation.propose', 'violation.view']);
    expect(of('hr')).toEqual(['violation.view']);
    expect(of('accountant')).toEqual(['violation.view']);
    expect(of('guard')).toEqual([]);
  });

  it('records each violation once per thing and person', async () => {
    const [cols] = await ds.query(
      `SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name = 'violations' AND constraint_name = 'violations_once'`,
    );
    expect(cols.n).toBe(1);
    const [late] = await ds.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'shift_assignments' AND column_name = 'late_alerted_at'`);
    expect(late.n).toBe(1);
  });
});
```

Trong `backend/test/users.e2e-spec.ts`, danh sách quyền của vai trò `scoped_admin` thêm `'violation.view', 'violation.propose', 'violation.review'`.

Thêm vào `backend/test/test-env.ts`: `process.env.VIOLATION_TICK = 'off';`

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- violations-schema`
Expected: FAIL — vai trò chưa có quyền `violation.*`.

- [ ] **Step 3: Migration**

`backend/src/database/migrations/1761000000000-Violations.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'violation.view'], ['admin', 'violation.propose'], ['admin', 'violation.review'],
  ['manager', 'violation.view'], ['manager', 'violation.propose'], ['manager', 'violation.review'],
  ['team_leader', 'violation.view'], ['team_leader', 'violation.propose'],
  ['hr', 'violation.view'],
  ['accountant', 'violation.view'],
];

export class Violations1761000000000 implements MigrationInterface {
  name = 'Violations1761000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE shift_assignments ADD COLUMN late_alerted_at timestamptz`);
    await q.query(`
      CREATE TABLE violations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        type varchar(30) NOT NULL CHECK (type IN ('late_check_in', 'absent', 'early_check_out', 'missed_round', 'missed_checkpoint', 'suspicious_scan')),
        ref_type varchar(20) NOT NULL CHECK (ref_type IN ('assignment', 'round', 'scan')),
        ref_id uuid NOT NULL,
        occurred_at timestamptz NOT NULL,
        minutes integer,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        status varchar(20) NOT NULL DEFAULT 'auto'
          CHECK (status IN ('auto', 'proposed_confirm', 'proposed_waive', 'confirmed', 'waived')),
        proposed_by uuid REFERENCES users(id),
        proposed_note text,
        proposed_at timestamptz,
        reviewed_by uuid REFERENCES users(id),
        review_note text,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT violations_once UNIQUE (ref_type, ref_id, employee_id, type)
      )`);
    await q.query(`CREATE INDEX violations_site_time ON violations (tenant_id, site_id, occurred_at DESC)`);
    await q.query(`CREATE INDEX violations_open ON violations (tenant_id, status) WHERE status IN ('auto', 'proposed_confirm', 'proposed_waive')`);
    await q.query(`CREATE INDEX violations_employee ON violations (employee_id, occurred_at DESC)`);
    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'violation.%'`);
    await q.query(`DROP TABLE IF EXISTS violations`);
    await q.query(`ALTER TABLE shift_assignments DROP COLUMN IF EXISTS late_alerted_at`);
  }
}
```

- [ ] **Step 4: Quyền, mã lỗi, entity, module**

Trong `backend/src/access/permissions.ts`, thêm vào `PERMISSIONS` sau `'patrol.perform'`:
```ts
  'violation.view': 'Xem vi phạm trong phạm vi',
  'violation.propose': 'Đề xuất xác nhận hoặc miễn vi phạm',
  'violation.review': 'Duyệt vi phạm',
```
và `ROLE_TEMPLATES`: `manager` + `'violation.view', 'violation.propose', 'violation.review'`; `team_leader` + `'violation.view', 'violation.propose'`; `hr` + `'violation.view'`; `accountant` + `'violation.view'`.

Thêm vào `ERROR_CODES` (trước `CONFLICT`):
```ts
  VIOLATION_OWN: { status: 403, message: 'Không tự đề xuất hay duyệt vi phạm của chính mình' },
  VIOLATION_NOTE_REQUIRED: { status: 400, message: 'Cần ghi lý do' },
  VIOLATION_ALREADY_REVIEWED: { status: 409, message: 'Vi phạm đã được quản lý duyệt' },
```

`backend/src/violations/violation.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const VIOLATION_TYPES = ['late_check_in', 'absent', 'early_check_out', 'missed_round', 'missed_checkpoint', 'suspicious_scan'] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];
export const VIOLATION_STATUSES = ['auto', 'proposed_confirm', 'proposed_waive', 'confirmed', 'waived'] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

/** One rule broken by one person about one thing (a shift, a round, a scan). Only "confirmed" reaches payroll. */
@Entity('violations')
export class Violation extends TenantEntity {
  @Column('uuid')
  employee_id: string;

  @Column('uuid')
  site_id: string;

  @Column({ type: 'varchar', length: 30 })
  type: ViolationType;

  @Column({ type: 'varchar', length: 20 })
  ref_type: 'assignment' | 'round' | 'scan';

  @Column('uuid')
  ref_id: string;

  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  @Column({ type: 'int', nullable: true })
  minutes: number | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  detail: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'auto' })
  status: ViolationStatus;

  @Column({ type: 'uuid', nullable: true })
  proposed_by: string | null;

  @Column({ type: 'text', nullable: true })
  proposed_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  proposed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string | null;

  @Column({ type: 'text', nullable: true })
  review_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;
}
```

`backend/src/violations/violations.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [],
  controllers: [],
})
export class ViolationsModule {}
```

`backend/src/app.module.ts`: import `ViolationsModule`, thêm vào cuối `imports`.

`backend/.env.example` thêm:
```
# on | off — vòng quét vi phạm mỗi phút.
VIOLATION_TICK=on
```

- [ ] **Step 5: Chạy test để thấy đạt, chạy toàn bộ, migrate DB dev**

Run: `cd backend && npm run test:e2e && npm run migration:run`
Expected: PASS toàn bộ; migration `Violations1761000000000` chạy xong.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): violations schema, permissions and roles"
```

---

### Task 2: Quy tắc chấm công — nhắc trễ, vắng ca, vào trễ, ra sớm; không mất dấu vắng khi đổi ca

**Files:**
- Create: `backend/src/violations/engine.service.ts`
- Modify: `backend/src/violations/violations.module.ts`, `backend/src/shifts/roster.service.ts`, `backend/src/shifts/shifts.module.ts`
- Test: `backend/test/violations-attendance.e2e-spec.ts`

**Interfaces:**
- Consumes: `SettingsService.effective`, `NotificationsService.notify`.
- Produces:
  - `ViolationsEngine.tick(now?)` — chạy `attendanceRules(now)` rồi `patrolRules(now)` (Task 3), mỗi bước lỗi chỉ ghi log. Vòng quét mỗi 60 giây khi `VIOLATION_TICK` khác `off`.
  - `ViolationsEngine.attendanceRules(now)`:
    - ca `planned` chưa vào ca: quá `late_after_minutes` → thông báo `attendance.late` cho đội trưởng phụ trách mục tiêu (một lần, `late_alerted_at`); quá `absent_after_minutes` → vi phạm `absent` (`occurred_at = planned_start`) + thông báo `violation.absent` cho đội trưởng và quản lý nhóm (đẩy, ưu tiên cao);
    - đã vào ca với `late_minutes > late_after_minutes` → `late_check_in` (`minutes`, `occurred_at = check_in_at`); có `absent` còn `auto` thì đổi bản ghi đó thành `late_check_in` (`detail.converted_from = 'absent'`); `absent` đã duyệt thì giữ nguyên;
    - đã ra ca với `early_minutes > early_checkout_minutes` → `early_check_out`.
  - `ViolationsEngine.recordAbsenceIfDue(m, assignmentId, now)` — trong giao dịch của xếp ca: người cũ chưa vào ca và đã quá mốc vắng → ghi `absent` trước khi huỷ/đổi.
  - `RosterService.cancel` và `.substitute` gọi `recordAbsenceIfDue` sau khi khoá ca.

- [ ] **Step 1: Viết test thất bại**

`backend/test/violations-attendance.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Violations — attendance rules (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let engine: ViolationsEngine;
  const ids: Record<string, string> = {};
  let leaderId: string;
  let managerId: string;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    admin = await createTenantWithAdmin(app, 'vat');
    api = client(app, admin.token);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    managerId = manager.user.id;
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerId }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'VK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'VS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
    const lead = (await guard('LEAD')).employee;
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    leaderId = (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).user.id;
  });
  afterAll(async () => app.close());

  async function guard(code = `VG${++seq}`) {
    const employee = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: employee }).expect(201);
    await api.post('/api/deployments', { employee_id: employee, client_id: ids.client, start_date: addDays(todayLocal(), -10) }).expect(201);
    return { employee };
  }
  async function onShift(startIn: number, hours = 4, site = ids.site) {
    const g = await guard();
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: g.employee });
    const phone = await loginOnDevice(app, u.phone, u.password, `vat-${seq}`);
    const shift = (await api.post('/api/roster', { site_id: site, employee_id: g.employee, start_at: minutes(startIn), end_at: minutes(startIn + hours * 60) }).expect(201)).body.data;
    return { ...g, token: phone.token!, shift };
  }
  const selfie = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 's.jpg').expect(201)).body.data.id;
  const clock = async (token: string, assignment: string, way: 'check-in' | 'check-out') =>
    client(app, token).post(`/api/attendance/${way}`, { assignment_id: assignment, lat: 21.0286, lng: 105.7768, accuracy_m: 10, device_time: new Date().toISOString(), selfie_file_id: await selfie(token) }).expect(201);
  const violations = (employee: string) =>
    ds.query(`SELECT type, minutes, status, detail FROM violations WHERE employee_id = $1 ORDER BY created_at`, [employee]);
  async function await_count(d: DataSource, userId: string, type: string) {
    return (await d.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]))[0].n;
  }

  it('nudges the leader once when a guard is late, and records nothing yet', async () => {
    const g = await onShift(-12);
    const before = await await_count(ds, leaderId, 'attendance.late');
    await engine.tick();
    await engine.tick();
    expect(await await_count(ds, leaderId, 'attendance.late')).toBe(before + 1);
    expect(await violations(g.employee)).toEqual([]);
  });

  it('records an absence at the site threshold and tells the leader and the manager', async () => {
    const g = await onShift(-35);
    await engine.tick();
    expect(await violations(g.employee)).toEqual([{ type: 'absent', minutes: null, status: 'auto', detail: {} }]);
    expect(await await_count(ds, managerId, 'violation.absent')).toBeGreaterThanOrEqual(1);
    await engine.tick();
    expect(await violations(g.employee)).toHaveLength(1);
  });

  it('turns an absence into lateness when the guard finally arrives', async () => {
    const g = await onShift(-40);
    await engine.tick();
    await clock(g.token, g.shift.id, 'check-in');
    await engine.tick();
    const [v] = await violations(g.employee);
    expect(v).toMatchObject({ type: 'late_check_in', status: 'auto', detail: { converted_from: 'absent' } });
    expect(v.minutes).toBeGreaterThanOrEqual(39);
  });

  it('records late arrivals past the threshold and early departures', async () => {
    const late = await onShift(-20);
    await clock(late.token, late.shift.id, 'check-in');
    const fine = await onShift(-5);
    await clock(fine.token, fine.shift.id, 'check-in');
    await clock(fine.token, fine.shift.id, 'check-out');
    await engine.tick();
    expect((await violations(late.employee)).map((v: { type: string }) => v.type)).toEqual(['late_check_in']);
    const early = await violations(fine.employee);
    expect(early.map((v: { type: string }) => v.type)).toEqual(['early_check_out']);
    expect(early[0].minutes).toBeGreaterThan(200);
  });

  it('keeps the absence when the shift is cancelled or handed to someone else afterwards', async () => {
    const a = await onShift(-45);
    await api.post(`/api/roster/${a.shift.id}/cancel`).expect(201);
    expect((await violations(a.employee)).map((v: { type: string }) => v.type)).toEqual(['absent']);
    const b = await onShift(-45);
    const stand = await guard();
    await api.post(`/api/roster/${b.shift.id}/substitute`, { employee_id: stand.employee }).expect(201);
    expect((await violations(b.employee)).map((v: { type: string }) => v.type)).toEqual(['absent']);
    const early = await onShift(-5);
    await api.post(`/api/roster/${early.shift.id}/cancel`).expect(201);
    expect(await violations(early.employee)).toEqual([]);
  });

  it('leaves reviewed absences alone and ignores clients who run their own guards', async () => {
    const g = await onShift(-40);
    await engine.tick();
    await ds.query(`UPDATE violations SET status = 'confirmed' WHERE employee_id = $1`, [g.employee]);
    await clock(g.token, g.shift.id, 'check-in');
    await engine.tick();
    expect((await violations(g.employee)).map((v: { type: string; status: string }) => `${v.type}:${v.status}`)).toEqual(['absent:confirmed']);

    const other = (await api.post('/api/clients', { code: 'TQ', name: 'Tự quản' }).expect(201)).body.data.id;
    const site = (await api.post('/api/sites', { client_id: other, code: 'TS', name: 'Kho' }).expect(201)).body.data.id;
    const h = await onShift(-40, 4, site);
    await api.patch(`/api/clients/${other}`, { management_mode: 'self_managed' }).expect(200);
    await engine.tick();
    expect(await violations(h.employee)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- violations-attendance`
Expected: FAIL — `Cannot find module '../src/violations/engine.service'`.

- [ ] **Step 3: Bộ máy**

`backend/src/violations/engine.service.ts`:
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { Settings } from '../settings/settings';
import { SettingsService } from '../settings/settings.service';
import { ViolationType } from './violation.entity';

const TICK_MS = 60_000;
/** Rules look this far back; older data is settled. */
const LOOKBACK = `interval '2 days'`;
const MANAGED = `JOIN sites s ON s.id = x.site_id JOIN clients c ON c.id = s.client_id AND c.management_mode = 'managed' AND c.deleted_at IS NULL`;

interface NewViolation {
  tenant_id: string;
  employee_id: string;
  site_id: string;
  type: ViolationType;
  ref_type: 'assignment' | 'round' | 'scan';
  ref_id: string;
  occurred_at: Date;
  minutes?: number | null;
  detail?: Record<string, unknown>;
}

@Injectable()
export class ViolationsEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Violations');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    if (getEnv('VIOLATION_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    const steps: [string, (at: Date) => Promise<void>][] = [
      ['chấm công', (at) => this.attendanceRules(at)],
      ['tuần tra', (at) => this.patrolRules(at)],
    ];
    for (const [name, step] of steps) {
      try {
        await step(now);
      } catch (error) {
        this.logger.error(`Vi phạm — ${name} lỗi: ${(error as Error).message}`, (error as Error).stack);
      }
    }
  }

  async attendanceRules(now: Date): Promise<void> {
    const settingsOf = this.cache();
    await this.notYetIn(now, settingsOf);
    await this.lateArrivals(now, settingsOf);
    await this.earlyLeaves(now, settingsOf);
  }

  /** Filled in by Task 3. */
  async patrolRules(_now: Date): Promise<void> {}

  /**
   * Inside a roster change: if the person never clocked in and the absence threshold has passed,
   * the absence is written before the shift is cancelled or handed over.
   */
  async recordAbsenceIfDue(m: EntityManager, assignmentId: string, now: Date = new Date()): Promise<void> {
    const [a] = await m.query(
      `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, x.planned_start FROM shift_assignments x ${MANAGED}
        WHERE x.id = $1 AND NOT EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = x.id)`,
      [assignmentId],
    );
    if (!a) return;
    const s = await this.settings.effective(a.tenant_id, a.site_id);
    if (now.getTime() < new Date(a.planned_start).getTime() + s.absent_after_minutes * 60_000) return;
    await this.insert(m, { tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'absent', ref_type: 'assignment', ref_id: a.id, occurred_at: a.planned_start });
  }

  /** Shifts begun without a clock-in: a nudge at the late mark, an absence at the absent mark. */
  private async notYetIn(now: Date, settingsOf: SettingsLookup): Promise<void> {
    const rows: { id: string; tenant_id: string; site_id: string; employee_id: string; planned_start: Date; late_alerted_at: Date | null; employee_name: string; site_name: string }[] =
      await this.ds.query(
        `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, x.planned_start, x.late_alerted_at, e.full_name AS employee_name, s.name AS site_name
           FROM shift_assignments x ${MANAGED} JOIN employees e ON e.id = x.employee_id
          WHERE x.status = 'planned' AND x.planned_start <= $1 AND x.planned_start > $1::timestamptz - ${LOOKBACK}
            AND NOT EXISTS (SELECT 1 FROM attendances t WHERE t.assignment_id = x.id)
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.type IN ('absent', 'late_check_in'))`,
        [now],
      );
    for (const a of rows) {
      const s = await settingsOf(a.tenant_id, a.site_id);
      const late = Math.floor((now.getTime() - new Date(a.planned_start).getTime()) / 60_000);
      if (late >= s.absent_after_minutes) {
        const made = await this.insert(this.ds.manager, {
          tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'absent', ref_type: 'assignment', ref_id: a.id, occurred_at: a.planned_start,
        });
        if (made) {
          const people = [...(await this.leadersOf(a.site_id)), ...(await this.managersOf(a.site_id))];
          await this.notifications.notify(a.tenant_id, people, {
            type: 'violation.absent', title: `Vắng ca · ${a.employee_name}`, body: `${a.site_name} — chưa vào ca sau ${late} phút`,
            data: { assignment_id: a.id }, priority: 'high', push: true,
          });
        }
      } else if (late >= s.late_after_minutes && !a.late_alerted_at) {
        const claimed = await this.ds.query(`UPDATE shift_assignments SET late_alerted_at = $2 WHERE id = $1 AND late_alerted_at IS NULL RETURNING id`, [a.id, now]);
        if (rowsOf(claimed).length) {
          await this.notifications.notify(a.tenant_id, await this.leadersOf(a.site_id), {
            type: 'attendance.late', title: `Chưa vào ca · ${a.employee_name}`, body: `${a.site_name} — trễ ${late} phút`,
            data: { assignment_id: a.id }, priority: 'normal', push: true,
          });
        }
      }
    }
  }

  /** Clock-ins past the late mark. An unreviewed absence for the same shift becomes this lateness. */
  private async lateArrivals(now: Date, settingsOf: SettingsLookup): Promise<void> {
    const rows: { id: string; tenant_id: string; site_id: string; employee_id: string; check_in_at: Date; late_minutes: number; absent_id: string | null }[] =
      await this.ds.query(
        `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, t.check_in_at, t.late_minutes,
                (SELECT v.id FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.employee_id = x.employee_id
                    AND v.type = 'absent' AND v.status = 'auto') AS absent_id
           FROM attendances t JOIN shift_assignments x ON x.id = t.assignment_id ${MANAGED}
          WHERE t.check_in_at > $1::timestamptz - ${LOOKBACK} AND t.late_minutes > 0
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.type = 'late_check_in')
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.type = 'absent' AND v.status <> 'auto')`,
        [now],
      );
    for (const a of rows) {
      const s = await settingsOf(a.tenant_id, a.site_id);
      if (a.late_minutes <= s.late_after_minutes) continue;
      if (a.absent_id) {
        await this.ds.query(
          `UPDATE violations SET type = 'late_check_in', minutes = $2, occurred_at = $3, detail = detail || '{"converted_from":"absent"}'::jsonb, updated_at = now()
            WHERE id = $1 AND status = 'auto' AND type = 'absent'`,
          [a.absent_id, a.late_minutes, a.check_in_at],
        );
      } else {
        await this.insert(this.ds.manager, {
          tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'late_check_in', ref_type: 'assignment', ref_id: a.id,
          occurred_at: a.check_in_at, minutes: a.late_minutes,
        });
      }
    }
  }

  private async earlyLeaves(now: Date, settingsOf: SettingsLookup): Promise<void> {
    const rows: { id: string; tenant_id: string; site_id: string; employee_id: string; check_out_at: Date; early_minutes: number }[] = await this.ds.query(
      `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, t.check_out_at, t.early_minutes
         FROM attendances t JOIN shift_assignments x ON x.id = t.assignment_id ${MANAGED}
        WHERE t.check_out_at > $1::timestamptz - ${LOOKBACK} AND t.early_minutes > 0
          AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'assignment' AND v.ref_id = x.id AND v.type = 'early_check_out')`,
      [now],
    );
    for (const a of rows) {
      const s = await settingsOf(a.tenant_id, a.site_id);
      if (a.early_minutes <= s.early_checkout_minutes) continue;
      await this.insert(this.ds.manager, {
        tenant_id: a.tenant_id, employee_id: a.employee_id, site_id: a.site_id, type: 'early_check_out', ref_type: 'assignment', ref_id: a.id,
        occurred_at: a.check_out_at, minutes: a.early_minutes,
      });
    }
  }

  /** Written once per (thing, person, rule): a second run of the same rule changes nothing. */
  protected async insert(m: EntityManager, v: NewViolation): Promise<boolean> {
    const rows = await m.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at, minutes, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ON CONSTRAINT violations_once DO NOTHING RETURNING id`,
      [v.tenant_id, v.employee_id, v.site_id, v.type, v.ref_type, v.ref_id, v.occurred_at, v.minutes ?? null, JSON.stringify(v.detail ?? {})],
    );
    return rows.length > 0;
  }

  protected async leadersOf(siteId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM sites s JOIN teams t ON t.id = s.responsible_team_id AND t.deleted_at IS NULL
         JOIN users u ON u.employee_id = t.leader_employee_id AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE s.id = $1`,
      [siteId],
    );
    return rows.map((r) => r.id);
  }

  protected async managersOf(siteId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT g.manager_user_id AS id FROM sites s JOIN teams t ON t.id = s.responsible_team_id
         JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
         JOIN users u ON u.id = g.manager_user_id AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE s.id = $1`,
      [siteId],
    );
    return rows.map((r) => r.id);
  }

  /** Effective settings per site, looked up once per tick. */
  protected cache(): SettingsLookup {
    const seen = new Map<string, Settings>();
    return async (tenantId, siteId) => {
      if (!seen.has(siteId)) seen.set(siteId, await this.settings.effective(tenantId, siteId));
      return seen.get(siteId)!;
    };
  }
}

type SettingsLookup = (tenantId: string, siteId: string) => Promise<Settings>;

/** TypeORM answers an UPDATE … RETURNING with [rows, count]. */
export const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];
```

`backend/src/violations/violations.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ViolationsEngine } from './engine.service';

@Module({
  imports: [AccessModule, AuditModule, NotificationsModule, SettingsModule],
  providers: [ViolationsEngine],
  controllers: [],
  exports: [ViolationsEngine],
})
export class ViolationsModule {}
```

- [ ] **Step 4: Xếp ca ghi dấu vắng trước khi huỷ/đổi**

`backend/src/shifts/shifts.module.ts`: `imports` thêm `ViolationsModule` (import từ `../violations/violations.module`).

`backend/src/shifts/roster.service.ts`:
- import `ViolationsEngine` từ `../violations/engine.service`; constructor thêm `private readonly violations: ViolationsEngine`;
- trong `substitute`, ngay sau `const a = await this.lockOpen(m, actor, id);` thêm:
```ts
      // An absence already due belongs to the person who did not come, before anyone else takes the shift.
      await this.violations.recordAbsenceIfDue(m, id);
```
- trong `cancel`, ngay sau `const a = await this.lockOpen(m, actor, id);` thêm:
```ts
      await this.violations.recordAbsenceIfDue(m, id);
```

- [ ] **Step 5: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npm run test:e2e`
Expected: PASS toàn bộ (gồm `violations-attendance` 6).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): attendance violations — late nudge, absence, late arrival, early leave; absences survive roster changes"
```

---

### Task 3: Quy tắc tuần tra — bỏ vòng, thiếu điểm, quét nghi vấn, tự miễn khi báo bù

**Files:**
- Modify: `backend/src/violations/engine.service.ts`
- Test: `backend/test/violations-patrol.e2e-spec.ts`

**Interfaces:**
- Produces: `ViolationsEngine.patrolRules(now)`:
  - vòng `missed` → `missed_round` cho mỗi người có ca `planned` ở mục tiêu bao trùm **điểm giữa** khung vòng (`occurred_at = expected_start`, `detail.route_name`);
  - vòng `partial` → `missed_checkpoint` cho người làm vòng (`detail.missing = [{code, name}]`, `occurred_at = ended_at`);
  - lần quét `suspicious` → `suspicious_scan` cho người quét (`detail = { flags, checkpoint_code, checkpoint_name, round_id }`);
  - vi phạm `missed_round` còn `auto` mà vòng không còn `missed`, hoặc `missed_checkpoint` còn `auto` mà vòng đã `completed` → `waived`, `review_note = 'Hệ thống: vòng đã được báo bù'`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/violations-patrol.e2e-spec.ts`:
```ts
import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();

describe('Violations — patrol rules (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let engine: ViolationsEngine;
  let scheduler: RoundsScheduler;
  const ids: Record<string, string> = {};
  const tags: Record<string, string> = {};
  let g: { employee: string; api: ReturnType<typeof client> };
  let late: { employee: string };
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    scheduler = app.get(RoundsScheduler);
    admin = await createTenantWithAdmin(app, 'vpt');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'PK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'PS', name: 'Toà' }).expect(201)).body.data.id;
    ids.A = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    ids.B = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'B', name: 'Kho' }).expect(201)).body.data.id;
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: ids.A }, { checkpoint_id: ids.B }] }).expect(201)).body.data.id;
    for (const t of (await api.get(`/api/sites/${ids.site}/qr-sheet`).expect(200)).body.data.tags) tags[t.id] = t.payload;
    g = await person(-5 * HOUR, HOUR);
    late = await person(-30 * 60_000, HOUR);
  });
  afterAll(async () => app.close());

  async function person(startMs: number, endMs: number) {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `PG${seq}`, full_name: `PG${seq}` }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: employee, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    await api.post('/api/roster', { site_id: ids.site, employee_id: employee, start_at: at(Date.now() + startMs), end_at: at(Date.now() + endMs) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee });
    return { employee, api: client(app, (await loginOnDevice(app, u.phone, u.password, `vpt-${seq}`)).token!) };
  }
  async function schedule() {
    seq += 1;
    return (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: `L${seq}`, start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
  }
  const scan = (round: string, body: object) =>
    g.api.post(`/api/patrol/rounds/${round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', ...body });
  const of = (ref: string) => ds.query(`SELECT employee_id, type, status, detail, review_note FROM violations WHERE ref_id = $1 ORDER BY type`, [ref]);

  it('charges a missed round to whoever was on shift across it, nobody else', async () => {
    const s = await schedule();
    await scheduler.generate(new Date(Date.now() - 4 * HOUR));
    const [r] = await ds.query(`SELECT id FROM patrol_rounds WHERE schedule_id = $1 AND expected_end < now() - interval '2 hours' ORDER BY expected_start LIMIT 1`, [s]);
    await scheduler.markMissed(new Date());
    await engine.tick();
    const v = await of(r.id);
    expect(v.map((x: { employee_id: string; type: string }) => `${x.employee_id === g.employee}:${x.type}`)).toEqual(['true:missed_round']);
    ids.missed = r.id;
  });

  it('lists the missing checkpoints of a round closed short', async () => {
    const s = await schedule();
    await scheduler.generate(new Date());
    const [r] = await ds.query(`SELECT id, expected_end FROM patrol_rounds WHERE schedule_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [s]);
    await scan(r.id, { qr_payload: tags[ids.A] }).expect(201);
    await scheduler.closeOverdue(new Date(r.expected_end.getTime() + 16 * 60_000));
    await engine.tick();
    const [v] = await of(r.id);
    expect(v).toMatchObject({ type: 'missed_checkpoint', status: 'auto', detail: { missing: [{ code: 'B', name: 'Kho' }] } });
  });

  it('records each suspicious scan for the leader to look at', async () => {
    const s = await schedule();
    await scheduler.generate(new Date());
    const [r] = await ds.query(`SELECT id FROM patrol_rounds WHERE schedule_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [s]);
    await scan(r.id, { qr_payload: tags[ids.A], mock_location: true }).expect(201);
    await engine.tick();
    const [sc] = await ds.query(`SELECT id FROM patrol_scans WHERE round_id = $1`, [r.id]);
    const [v] = await of(sc.id);
    expect(v).toMatchObject({ type: 'suspicious_scan', detail: { checkpoint_code: 'A', round_id: r.id, flags: ['mock_location'] } });
  });

  it('forgives a missed round once it is reported in full, while the late report stays suspicious', async () => {
    const [r] = await ds.query(`SELECT expected_start FROM patrol_rounds WHERE id = $1`, [ids.missed]);
    const when = at(r.expected_start.getTime() + 5 * 60_000);
    await scan(ids.missed, { qr_payload: tags[ids.A], device_time: when, captured_offline: true }).expect(201);
    await scan(ids.missed, { qr_payload: tags[ids.B], device_time: when, captured_offline: true }).expect(201);
    await engine.tick();
    const [v] = await of(ids.missed);
    expect(v).toMatchObject({ type: 'missed_round', status: 'waived', review_note: 'Hệ thống: vòng đã được báo bù' });
    const scans = await ds.query(`SELECT id FROM patrol_scans WHERE round_id = $1`, [ids.missed]);
    const flagged = await ds.query(`SELECT detail FROM violations WHERE type = 'suspicious_scan' AND ref_id = ANY($1::uuid[])`, [scans.map((x: { id: string }) => x.id)]);
    expect(flagged).toHaveLength(2);
    expect(flagged[0].detail.flags).toContain('backdated');
    expect(late.employee).toBeTruthy();
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- violations-patrol`
Expected: FAIL — không có vi phạm `missed_round`.

- [ ] **Step 3: Quy tắc tuần tra**

Trong `backend/src/violations/engine.service.ts` thay
```ts
  /** Filled in by Task 3. */
  async patrolRules(_now: Date): Promise<void> {}
```
bằng:
```ts
  async patrolRules(now: Date): Promise<void> {
    await this.forgiveReported();
    await this.missedRounds(now);
    await this.shortRounds(now);
    await this.suspiciousScans(now);
  }

  /** Nobody walked the round: everyone rostered across the middle of its window answers for it. */
  private async missedRounds(now: Date): Promise<void> {
    const rounds: { id: string; tenant_id: string; site_id: string; expected_start: Date; expected_end: Date; route_name: string }[] = await this.ds.query(
      `SELECT x.id, x.tenant_id, x.site_id, x.expected_start, x.expected_end, ro.name AS route_name
         FROM patrol_rounds x ${MANAGED} JOIN routes ro ON ro.id = x.route_id
        WHERE x.status = 'missed' AND x.expected_start > $1::timestamptz - ${LOOKBACK}
          AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'round' AND v.ref_id = x.id AND v.type = 'missed_round')`,
      [now],
    );
    for (const r of rounds) {
      const middle = new Date((new Date(r.expected_start).getTime() + new Date(r.expected_end).getTime()) / 2);
      const people: { employee_id: string }[] = await this.ds.query(
        `SELECT DISTINCT employee_id FROM shift_assignments
          WHERE site_id = $1 AND status = 'planned' AND planned_start <= $2 AND planned_end > $2`,
        [r.site_id, middle],
      );
      for (const p of people) {
        await this.insert(this.ds.manager, {
          tenant_id: r.tenant_id, employee_id: p.employee_id, site_id: r.site_id, type: 'missed_round', ref_type: 'round', ref_id: r.id,
          occurred_at: r.expected_start, detail: { route_name: r.route_name },
        });
      }
    }
  }

  /** A round closed with required checkpoints left: the guard who walked it, with what was left. */
  private async shortRounds(now: Date): Promise<void> {
    const rounds: { id: string; tenant_id: string; site_id: string; employee_id: string; ended_at: Date; stops: { checkpoint_id: string; required: boolean }[] | null }[] =
      await this.ds.query(
        `SELECT x.id, x.tenant_id, x.site_id, x.employee_id, x.ended_at, x.stops FROM patrol_rounds x ${MANAGED}
          WHERE x.status = 'partial' AND x.employee_id IS NOT NULL AND x.expected_start > $1::timestamptz - ${LOOKBACK}
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'round' AND v.ref_id = x.id AND v.type = 'missed_checkpoint')`,
        [now],
      );
    for (const r of rounds) {
      const required = (r.stops ?? []).filter((s) => s.required).map((s) => s.checkpoint_id);
      const missing: { code: string; name: string }[] = required.length
        ? await this.ds.query(
            `SELECT k.code, k.name FROM checkpoints k
              WHERE k.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM patrol_scans sc WHERE sc.round_id = $2 AND sc.checkpoint_id = k.id)
              ORDER BY k.code`,
            [required, r.id],
          )
        : [];
      await this.insert(this.ds.manager, {
        tenant_id: r.tenant_id, employee_id: r.employee_id, site_id: r.site_id, type: 'missed_checkpoint', ref_type: 'round', ref_id: r.id,
        occurred_at: r.ended_at, detail: { missing },
      });
    }
  }

  private async suspiciousScans(now: Date): Promise<void> {
    const scans: { id: string; tenant_id: string; site_id: string; employee_id: string; scanned_at: Date; flags: string[]; code: string; name: string; round_id: string }[] =
      await this.ds.query(
        `SELECT sc.id, sc.tenant_id, x.site_id, sc.employee_id, sc.scanned_at, sc.flags, k.code, k.name, sc.round_id
           FROM patrol_scans sc JOIN patrol_rounds x ON x.id = sc.round_id ${MANAGED} JOIN checkpoints k ON k.id = sc.checkpoint_id
          WHERE sc.validity = 'suspicious' AND sc.created_at > $1::timestamptz - ${LOOKBACK}
            AND NOT EXISTS (SELECT 1 FROM violations v WHERE v.ref_type = 'scan' AND v.ref_id = sc.id)`,
        [now],
      );
    for (const s of scans) {
      await this.insert(this.ds.manager, {
        tenant_id: s.tenant_id, employee_id: s.employee_id, site_id: s.site_id, type: 'suspicious_scan', ref_type: 'scan', ref_id: s.id,
        occurred_at: s.scanned_at, detail: { flags: s.flags, checkpoint_code: s.code, checkpoint_name: s.name, round_id: s.round_id },
      });
    }
  }

  /** Rounds reported in full after all (offline reports) clear what the machine wrote; reviewed ones stay as decided. */
  private async forgiveReported(): Promise<void> {
    await this.ds.query(
      `UPDATE violations v SET status = 'waived', review_note = 'Hệ thống: vòng đã được báo bù', reviewed_at = now(), updated_at = now()
         FROM patrol_rounds r
        WHERE v.ref_type = 'round' AND v.ref_id = r.id AND v.status = 'auto'
          AND ((v.type = 'missed_round' AND r.status <> 'missed') OR (v.type = 'missed_checkpoint' AND r.status = 'completed'))`,
    );
  }
```

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- violations-patrol violations-attendance`
Expected: PASS — 4 + 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): patrol violations — missed rounds, missing checkpoints, suspicious scans, forgiven when reported in full"
```

---

### Task 4: Đề xuất, duyệt, danh sách theo phạm vi, của tôi; cách ly công ty

**Files:**
- Create: `backend/src/violations/dto.ts`, `backend/src/violations/violations.service.ts`, `backend/src/violations/violations.controller.ts`
- Modify: `backend/src/violations/violations.module.ts`
- Test: `backend/test/violations-review.e2e-spec.ts`, `backend/test/tenancy-07.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `ViolationsService.list(actor, filter)` — `filter { status?: ViolationStatus | 'open', type?, site_id?, employee_id?, from?, to? }` (`open` = `auto` + hai trạng thái đề xuất; `from`/`to` là ngày địa phương), chỉ mục tiêu người gọi thấy, mới nhất trước, tối đa 500.
  - `.summary(actor)` → `{ auto, proposed_confirm, proposed_waive, confirmed_30d, waived_30d }`.
  - `.mine(actor)` → vi phạm 90 ngày của chính người gọi.
  - `.propose(actor, id, { decision: 'confirm' | 'waive', note? })` → `proposed_confirm`/`proposed_waive`; chưa duyệt mới được đề xuất.
  - `.review(actor, id, { decision, note? })` → `confirmed`/`waived`; từ bất kỳ trạng thái; đổi quyết định đã duyệt phải có lý do.
  - Routes: `GET /api/violations`, `GET /api/violations/summary` (`violation.view`), `POST /api/violations/:id/propose` (`violation.propose`), `POST /api/violations/:id/review` (`violation.review`), `GET /api/me/violations` (người dùng công ty).

- [ ] **Step 1: Viết test thất bại**

`backend/test/violations-review.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Violations — proposing and reviewing (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let leader: ReturnType<typeof client>;
  let otherLeader: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;
  let guard: ReturnType<typeof client>;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'vrv');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội 1' }).expect(201)).body.data.id;
    ids.team2 = (await api.post('/api/org/teams', { name: 'Đội 2' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    const lead = await employee(ids.team);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).token);
    const lead2 = await employee(ids.team2);
    await api.put(`/api/org/teams/${ids.team2}/leader`, { employee_id: lead2 }).expect(200);
    otherLeader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead2 })).token);
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    ids.guard = await employee(ids.team);
    guard = client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: ids.guard })).token);
    ids.lead = lead;
  });
  afterAll(async () => app.close());

  async function employee(team: string) {
    const e = (await api.post('/api/employees', { code: `RV${++seq}`, full_name: `NV ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    return e;
  }
  async function violation(employeeId: string, type = 'absent') {
    const [row] = await ds.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at)
       VALUES ($1, $2, $3, $4, 'assignment', gen_random_uuid(), now()) RETURNING id`,
      [admin.tenant.id, employeeId, ids.site, type],
    );
    return row.id as string;
  }

  it('goes from leader proposal to manager decision', async () => {
    const id = await violation(ids.guard);
    expect((await leader.post(`/api/violations/${id}/propose`, { decision: 'waive' }).expect(400)).body.error.code).toBe('VIOLATION_NOTE_REQUIRED');
    const proposed = (await leader.post(`/api/violations/${id}/propose`, { decision: 'waive', note: 'Xe hỏng giữa đường, có báo trước' }).expect(201)).body.data;
    expect(proposed).toMatchObject({ status: 'proposed_waive', proposed_note: 'Xe hỏng giữa đường, có báo trước' });
    await leader.post(`/api/violations/${id}/review`, { decision: 'confirm' }).expect(403);
    const done = (await manager.post(`/api/violations/${id}/review`, { decision: 'confirm', note: 'Không báo trước' }).expect(201)).body.data;
    expect(done).toMatchObject({ status: 'confirmed', review_note: 'Không báo trước' });
    expect(done.proposed_by_name).toBeTruthy();
    expect(done.reviewed_by_name).toBeTruthy();
    expect((await leader.post(`/api/violations/${id}/propose`, { decision: 'confirm' }).expect(409)).body.error.code).toBe('VIOLATION_ALREADY_REVIEWED');
    await manager.post(`/api/violations/${id}/review`, { decision: 'waive' }).expect(400);
    expect((await manager.post(`/api/violations/${id}/review`, { decision: 'waive', note: 'Có giấy xác nhận' }).expect(201)).body.data.status).toBe('waived');
  });

  it('never lets anyone judge their own violation', async () => {
    const own = await violation(ids.lead);
    expect((await leader.post(`/api/violations/${own}/propose`, { decision: 'waive', note: 'x' }).expect(403)).body.error.code).toBe('VIOLATION_OWN');
    await manager.post(`/api/violations/${own}/review`, { decision: 'confirm' }).expect(201);
  });

  it('shows each person what is theirs to see', async () => {
    const id = await violation(ids.guard, 'late_check_in');
    const open = (await leader.get('/api/violations?status=open').expect(200)).body.data.map((v: { id: string }) => v.id);
    expect(open).toContain(id);
    expect((await otherLeader.get('/api/violations').expect(200)).body.data.map((v: { id: string }) => v.id)).not.toContain(id);
    await otherLeader.post(`/api/violations/${id}/propose`, { decision: 'confirm' }).expect(404);
    const mine = (await guard.get('/api/me/violations').expect(200)).body.data;
    expect(mine.map((v: { id: string }) => v.id)).toContain(id);
    expect(mine.every((v: { employee_id: string }) => v.employee_id === ids.guard)).toBe(true);
    await guard.get('/api/violations').expect(403);
    const summary = (await manager.get('/api/violations/summary').expect(200)).body.data;
    expect(summary.auto).toBeGreaterThanOrEqual(1);
    expect(Object.keys(summary).sort()).toEqual(['auto', 'confirmed_30d', 'proposed_confirm', 'proposed_waive', 'waived_30d']);
  });
});
```

`backend/test/tenancy-07.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for violations (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let apiA: ReturnType<typeof client>;
  let bViolation: string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso7-a');
    const b = await createTenantWithAdmin(app, 'iso7-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const c = (await apiB.post('/api/clients', { code: 'K', name: 'B' }).expect(201)).body.data.id;
    const site = (await apiB.post('/api/sites', { client_id: c, code: 'S', name: 'B' }).expect(201)).body.data.id;
    const e = (await apiB.post('/api/employees', { code: 'E', full_name: 'B' }).expect(201)).body.data.id;
    [{ id: bViolation }] = await ds.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at)
       VALUES ($1, $2, $3, 'absent', 'assignment', gen_random_uuid(), now()) RETURNING id`,
      [b.tenant.id, e, site],
    );
  });
  afterAll(async () => app.close());

  it("keeps B's violations out of A's lists and actions", async () => {
    expect((await apiA.get('/api/violations').expect(200)).body.data.map((v: { id: string }) => v.id)).not.toContain(bViolation);
    expect((await apiA.get('/api/violations/summary').expect(200)).body.data.auto).toBe(0);
    await apiA.post(`/api/violations/${bViolation}/propose`, { decision: 'confirm' }).expect(404);
    await apiA.post(`/api/violations/${bViolation}/review`, { decision: 'confirm' }).expect(404);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- violations-review tenancy-07`
Expected: FAIL — 404 trên `/api/violations`.

- [ ] **Step 3: DTO, service, controller**

`backend/src/violations/dto.ts`:
```ts
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { VIOLATION_STATUSES, VIOLATION_TYPES, ViolationStatus, ViolationType } from './violation.entity';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ViolationFilter {
  @IsOptional() @IsIn([...VIOLATION_STATUSES, 'open'])
  status?: ViolationStatus | 'open';

  @IsOptional() @IsIn(VIOLATION_TYPES)
  type?: ViolationType;

  @IsOptional() @IsUUID()
  site_id?: string;

  @IsOptional() @IsUUID()
  employee_id?: string;

  @IsOptional() @Matches(DAY, { message: 'from: định dạng YYYY-MM-DD' })
  from?: string;

  @IsOptional() @Matches(DAY, { message: 'to: định dạng YYYY-MM-DD' })
  to?: string;
}

export class DecisionDto {
  @IsIn(['confirm', 'waive'])
  decision: 'confirm' | 'waive';

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
```

`backend/src/violations/violations.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { DecisionDto, ViolationFilter } from './dto';
import { Violation } from './violation.entity';

const ROWS = `
  SELECT v.id, v.type, v.status, v.occurred_at, v.minutes, v.detail, v.ref_type, v.ref_id, v.site_id, s.name AS site_name,
         v.employee_id, e.code AS employee_code, e.full_name AS employee_name,
         v.proposed_note, v.proposed_at, pu.full_name AS proposed_by_name, v.review_note, v.reviewed_at, ru.full_name AS reviewed_by_name
    FROM violations v
    JOIN sites s ON s.id = v.site_id
    JOIN employees e ON e.id = v.employee_id
    LEFT JOIN users pu ON pu.id = v.proposed_by
    LEFT JOIN users ru ON ru.id = v.reviewed_by
   WHERE v.tenant_id = $1`;
const LOCAL_DAY = (p: string) => `(${p}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
const OPEN = ['auto', 'proposed_confirm', 'proposed_waive'];

@Injectable()
export class ViolationsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: ViolationFilter) {
    const params: unknown[] = [tenantOf(actor)];
    let sql = ROWS + (await this.visible(actor, params));
    if (filter.status === 'open') {
      params.push(OPEN);
      sql += ` AND v.status = ANY($${params.length})`;
    } else if (filter.status) {
      params.push(filter.status);
      sql += ` AND v.status = $${params.length}`;
    }
    for (const key of ['type', 'site_id', 'employee_id'] as const) {
      if (filter[key]) {
        params.push(filter[key]);
        sql += ` AND v.${key} = $${params.length}`;
      }
    }
    if (filter.from) {
      params.push(filter.from);
      sql += ` AND v.occurred_at >= ${LOCAL_DAY(`$${params.length}`)}`;
    }
    if (filter.to) {
      params.push(filter.to);
      sql += ` AND v.occurred_at < (${LOCAL_DAY(`$${params.length}`)} + interval '1 day')`;
    }
    return this.ds.query(`${sql} ORDER BY v.occurred_at DESC, v.id LIMIT 500`, params);
  }

  async summary(actor: AuthUser) {
    const params: unknown[] = [tenantOf(actor)];
    const where = await this.visible(actor, params);
    const [row] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE v.status = 'auto')::int AS auto,
              count(*) FILTER (WHERE v.status = 'proposed_confirm')::int AS proposed_confirm,
              count(*) FILTER (WHERE v.status = 'proposed_waive')::int AS proposed_waive,
              count(*) FILTER (WHERE v.status = 'confirmed' AND v.reviewed_at > now() - interval '30 days')::int AS confirmed_30d,
              count(*) FILTER (WHERE v.status = 'waived' AND v.reviewed_at > now() - interval '30 days')::int AS waived_30d
         FROM violations v WHERE v.tenant_id = $1${where}`,
      params,
    );
    return row;
  }

  /** What a guard has on record — they see it as their leader does. */
  async mine(actor: AuthUser) {
    if (!actor.employee_id) return [];
    return this.ds.query(`${ROWS} AND v.employee_id = $2 AND v.occurred_at > now() - interval '90 days' ORDER BY v.occurred_at DESC`, [
      tenantOf(actor), actor.employee_id,
    ]);
  }

  async propose(actor: AuthUser, id: string, dto: DecisionDto) {
    await this.ds.transaction(async (m) => {
      const v = await this.lockJudgeable(m, actor, id);
      if (v.status === 'confirmed' || v.status === 'waived') throw new BusinessException('VIOLATION_ALREADY_REVIEWED');
      const note = dto.note?.trim() || null;
      if (dto.decision === 'waive' && !note) throw new BusinessException('VIOLATION_NOTE_REQUIRED');
      const status = dto.decision === 'confirm' ? 'proposed_confirm' : 'proposed_waive';
      await m.update(Violation, { id }, { status, proposed_by: actor.id, proposed_note: note, proposed_at: new Date() });
      await this.audit.record(m, { tenant_id: v.tenant_id, actor_user_id: actor.id, action: 'violation.propose', entity_type: 'violation', entity_id: id, data: { from: v.status, to: status, note } });
    });
    return this.one(actor, id);
  }

  async review(actor: AuthUser, id: string, dto: DecisionDto) {
    await this.ds.transaction(async (m) => {
      const v = await this.lockJudgeable(m, actor, id);
      const note = dto.note?.trim() || null;
      const status = dto.decision === 'confirm' ? 'confirmed' : 'waived';
      const changingDecision = (v.status === 'confirmed' || v.status === 'waived') && v.status !== status;
      if ((dto.decision === 'waive' || changingDecision) && !note) throw new BusinessException('VIOLATION_NOTE_REQUIRED');
      await m.update(Violation, { id }, { status, reviewed_by: actor.id, review_note: note, reviewed_at: new Date() });
      await this.audit.record(m, { tenant_id: v.tenant_id, actor_user_id: actor.id, action: 'violation.review', entity_type: 'violation', entity_id: id, data: { from: v.status, to: status, note } });
    });
    return this.one(actor, id);
  }

  /** Locked, in the caller's company and sight, and not about the caller themself. */
  private async lockJudgeable(m: EntityManager, actor: AuthUser, id: string): Promise<Violation> {
    const [row] = await m.query(`SELECT id FROM violations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const v = await m.findOneByOrFail(Violation, { id });
    if (!(await this.scopes.canSeeSite(actor, v.site_id))) throw new BusinessException('NOT_FOUND');
    if (actor.employee_id && v.employee_id === actor.employee_id) throw new BusinessException('VIOLATION_OWN');
    return v;
  }

  private async one(actor: AuthUser, id: string) {
    const [row] = await this.ds.query(`${ROWS} AND v.id = $2`, [tenantOf(actor), id]);
    return row;
  }

  private async visible(actor: AuthUser, params: unknown[]): Promise<string> {
    const sites = await this.scopes.siteVisibility(actor);
    if (sites.all) return '';
    params.push(sites.siteIds);
    return ` AND v.site_id = ANY($${params.length}::uuid[])`;
  }
}
```

`backend/src/violations/violations.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DecisionDto, ViolationFilter } from './dto';
import { ViolationsService } from './violations.service';

@Controller()
export class ViolationsController {
  constructor(private readonly violations: ViolationsService) {}

  @RequirePermission('violation.view')
  @Get('violations')
  list(@CurrentUser() user: AuthUser, @Query() filter: ViolationFilter) {
    return this.violations.list(user, filter);
  }

  @RequirePermission('violation.view')
  @Get('violations/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.violations.summary(user);
  }

  @RequirePermission('violation.propose')
  @Post('violations/:id/propose')
  propose(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.violations.propose(user, id, dto);
  }

  @RequirePermission('violation.review')
  @Post('violations/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.violations.review(user, id, dto);
  }

  /** Any signed-in person of the company: their own record. */
  @Get('me/violations')
  mine(@CurrentUser() user: AuthUser) {
    return this.violations.mine(user);
  }
}
```

`backend/src/violations/violations.module.ts`: `providers` thêm `ViolationsService`; `controllers: [ViolationsController]`.

- [ ] **Step 4: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npm run test:e2e`
Expected: PASS toàn bộ (gồm `violations-review` 3, `tenancy-07` 1).

- [ ] **Step 5: Dữ liệu demo, commit**

Trong `backend/src/scripts/seed-demo.ts`: import `ViolationsEngine` từ `../violations/engine.service`; ngay sau dòng `await app.get(RoundsScheduler).generate(new Date());` thêm:
```ts
  await app.get(ViolationsEngine).tick();
```

Run: reset DB dev rồi `npm run seed:demo` → không lỗi. `cd backend && npm test && npm run build` → PASS.

```bash
git add backend
git commit -m "feat(backend): violations review — leader proposals, manager decisions, scoped lists, own record, isolation suite"
```

---

### Task 5: Web — trang Vi phạm, ô chờ xử lý ở Tổng quan

**Files:**
- Create: `web/src/app/(app)/vi-pham/page.tsx`
- Modify: `web/src/lib/types.ts`, `web/src/lib/format.ts`, `web/src/components/shell.tsx`, `web/src/app/(app)/page.tsx`

- [ ] **Step 1: Kiểu và nhãn**

Cuối `web/src/lib/types.ts`:
```ts
export type ViolationType = 'late_check_in' | 'absent' | 'early_check_out' | 'missed_round' | 'missed_checkpoint' | 'suspicious_scan';
export type ViolationStatus = 'auto' | 'proposed_confirm' | 'proposed_waive' | 'confirmed' | 'waived';

export interface ViolationRow {
  id: string;
  type: ViolationType;
  status: ViolationStatus;
  occurred_at: string;
  minutes: number | null;
  detail: { converted_from?: string; missing?: { code: string; name: string }[]; flags?: string[]; checkpoint_code?: string; checkpoint_name?: string; round_id?: string; route_name?: string };
  ref_type: 'assignment' | 'round' | 'scan';
  ref_id: string;
  site_id: string;
  site_name: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  proposed_note: string | null;
  proposed_at: string | null;
  proposed_by_name: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
}

export interface ViolationSummary {
  auto: number;
  proposed_confirm: number;
  proposed_waive: number;
  confirmed_30d: number;
  waived_30d: number;
}
```

Cuối `web/src/lib/format.ts` (thêm `ViolationRow, ViolationStatus, ViolationType` vào dòng `import type`):
```ts
export const VIOLATION_TYPE: Record<ViolationType, string> = {
  late_check_in: 'Vào ca trễ',
  absent: 'Vắng ca',
  early_check_out: 'Ra ca sớm',
  missed_round: 'Bỏ vòng tuần',
  missed_checkpoint: 'Thiếu điểm tuần tra',
  suspicious_scan: 'Lần quét nghi vấn',
};

export const VIOLATION_STATUS: Record<ViolationStatus, { label: string; tone: string }> = {
  auto: { label: 'Mới — chưa xem', tone: 'bg-amber-100 text-amber-800' },
  proposed_confirm: { label: 'Đội trưởng đề xuất xác nhận', tone: 'bg-sky-100 text-sky-800' },
  proposed_waive: { label: 'Đội trưởng đề xuất miễn', tone: 'bg-sky-100 text-sky-800' },
  confirmed: { label: 'Đã xác nhận', tone: 'bg-red-100 text-red-700' },
  waived: { label: 'Đã miễn', tone: 'bg-slate-100 text-slate-500' },
};

/** One line saying what happened, in the guard's terms. */
export function violationText(v: ViolationRow): string {
  switch (v.type) {
    case 'late_check_in':
      return `Trễ ${v.minutes ?? '?'} phút${v.detail.converted_from === 'absent' ? ' (lúc đầu ghi vắng)' : ''}`;
    case 'absent':
      return 'Không vào ca';
    case 'early_check_out':
      return `Về sớm ${v.minutes ?? '?'} phút`;
    case 'missed_round':
      return `Không ai đi vòng${v.detail.route_name ? ` "${v.detail.route_name}"` : ''}`;
    case 'missed_checkpoint':
      return `Thiếu: ${(v.detail.missing ?? []).map((k) => `${k.code} ${k.name}`).join(', ') || '—'}`;
    case 'suspicious_scan':
      return `${v.detail.checkpoint_code ?? ''} ${v.detail.checkpoint_name ?? ''}: ${(v.detail.flags ?? []).map((f) => SCAN_FLAG[f] ?? f).join(', ')}`;
  }
}
```

`web/src/components/shell.tsx`, `NAV` thêm sau mục "Tuần tra":
```ts
  { href: '/vi-pham', label: 'Vi phạm', permission: 'violation.view' },
```

- [ ] **Step 2: Trang Vi phạm**

`web/src/app/(app)/vi-pham/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { stamp, VIOLATION_STATUS, VIOLATION_TYPE, violationText } from '@/lib/format';
import { SiteRow, ViolationRow } from '@/lib/types';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Chờ xử lý' },
  { value: 'auto', label: 'Mới — chưa xem' },
  { value: 'proposed_confirm', label: 'Đề xuất xác nhận' },
  { value: 'proposed_waive', label: 'Đề xuất miễn' },
  { value: 'confirmed', label: 'Đã xác nhận' },
  { value: 'waived', label: 'Đã miễn' },
  { value: '', label: 'Tất cả' },
];

export default function ViolationsPage() {
  const { me, can } = useAuth();
  const [rows, setRows] = useState<ViolationRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [filter, setFilter] = useState({ status: 'open', type: '', site_id: '' });
  const [error, setError] = useState<string | null>(null);
  const reviewer = can('violation.review');
  const proposer = can('violation.propose');

  const load = useCallback(async () => {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    setRows(await api<ViolationRow[]>(`/violations?${q}`));
  }, [filter]);

  useEffect(() => { api<SiteRow[]>('/sites').then(setSites).catch(() => undefined); }, []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function decide(v: ViolationRow, step: 'propose' | 'review', decision: 'confirm' | 'waive') {
    const ask = decision === 'waive' ? 'Lý do miễn (bắt buộc):' : 'Ghi chú (không bắt buộc):';
    const note = window.prompt(ask) ?? undefined;
    if (note === undefined) return;
    setError(null);
    try {
      await api(`/violations/${v.id}/${step}`, { method: 'POST', json: { decision, ...(note ? { note } : {}) } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Vi phạm</h1>
        <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className="w-52">
          {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
        <Select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className="w-48">
          <option value="">Mọi loại</option>
          {Object.entries(VIOLATION_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={filter.site_id} onChange={(e) => setFilter({ ...filter, site_id: e.target.value })} className="w-64">
          <option value="">Mọi mục tiêu</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
      </div>
      <p className="text-sm text-slate-500">Hệ thống tự ghi theo mốc của từng mục tiêu. Đội trưởng đề xuất, quản lý duyệt; chỉ vi phạm đã xác nhận mới tính vào lương.</p>
      <ErrorText error={error} />
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Lúc</th><th>Nhân viên</th><th>Mục tiêu</th><th>Vi phạm</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const own = Boolean(me.user.employee_id) && v.employee_id === me.user.employee_id;
              const final = v.status === 'confirmed' || v.status === 'waived';
              const roundId = v.ref_type === 'round' ? v.ref_id : v.detail.round_id;
              return (
                <tr key={v.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 whitespace-nowrap">{stamp(v.occurred_at)}</td>
                  <td>{v.employee_name} <span className="font-mono text-xs text-slate-400">{v.employee_code}</span></td>
                  <td>{v.site_name}</td>
                  <td>
                    <b>{VIOLATION_TYPE[v.type]}</b> — {violationText(v)}
                    {roundId && <Link href={`/tuan-tra/${roundId}`} className="ml-2 text-xs text-teal-700 hover:underline">xem vòng</Link>}
                    {v.proposed_by_name && <div className="text-xs text-slate-500">Đề xuất: {v.proposed_by_name}{v.proposed_note ? ` — ${v.proposed_note}` : ''}</div>}
                    {v.reviewed_at && <div className="text-xs text-slate-500">Duyệt: {v.reviewed_by_name ?? 'Hệ thống'}{v.review_note ? ` — ${v.review_note}` : ''}</div>}
                  </td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${VIOLATION_STATUS[v.status].tone}`}>{VIOLATION_STATUS[v.status].label}</span></td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {!own && reviewer && (
                      <>
                        <Button variant="secondary" onClick={() => decide(v, 'review', 'confirm')}>Xác nhận</Button>
                        <Button variant="secondary" onClick={() => decide(v, 'review', 'waive')}>Miễn</Button>
                      </>
                    )}
                    {!own && !reviewer && proposer && !final && (
                      <>
                        <Button variant="secondary" onClick={() => decide(v, 'propose', 'confirm')}>Đề xuất xác nhận</Button>
                        <Button variant="secondary" onClick={() => decide(v, 'propose', 'waive')}>Đề xuất miễn</Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Không có vi phạm nào</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Ô chờ xử lý ở Tổng quan**

`web/src/app/(app)/page.tsx`:
- import thêm `ViolationSummary` từ `@/lib/types`;
- thêm state và nạp:
```tsx
  const [pending, setPending] = useState<ViolationSummary | null>(null);

  useEffect(() => {
    if (can('violation.propose') || can('violation.review')) api<ViolationSummary>('/violations/summary').then(setPending).catch(() => undefined);
  }, [can]);
```
- ngay trước khối `{incidents && (` thêm:
```tsx
      {pending && pending.auto + pending.proposed_confirm + pending.proposed_waive > 0 && (
        <Link href="/vi-pham" className="block rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100">
          <b>Vi phạm chờ xử lý:</b> {pending.auto} mới
          {can('violation.review') && <>, {pending.proposed_confirm + pending.proposed_waive} đề xuất chờ duyệt</>}
          <span className="ml-2 text-teal-700">Xem →</span>
        </Link>
      )}
```

- [ ] **Step 4: Build, chạy thử, commit**

Run: `cd web && npm run build` → thành công, có `/vi-pham`.

Chạy thử qua `:3000` (giám đốc demo): `GET /api/violations?status=open` có vắng ca/trễ của ca ngày hôm nay (nếu đã quá giờ); `GET /api/violations/summary` trả số; trang `/vi-pham` 200.

```bash
git add web
git commit -m "feat(web): violations page with leader proposals and manager decisions, pending tile on the dashboard"
```

---

## Self-review (người viết kế hoạch)

- **Phủ spec:** §7.1 sáu loại vi phạm → Task 2–3; quy tắc chi tiết v1.6 (nhắc trễ, vắng → trễ, dấu vắng khi đổi ca, bỏ vòng theo người có ca, tự miễn khi báo bù, idempotent, 2 ngày) → Task 2–3; §3.4 đề xuất/duyệt, không tự duyệt, miễn có lý do → Task 4; T5/Q5/W9 → Task 4–5 (API cho app); §4.8 đầu vào lương = `confirmed`.
- **Không có chỗ trống:** mọi bước có mã và lệnh cụ thể.
- **Khớp tên:** `ViolationsEngine.tick/attendanceRules/patrolRules/recordAbsenceIfDue`, `ViolationsService.list/summary/mine/propose/review` dùng thống nhất.
- **Việc để sau:** gợi ý người trực thay khi vắng (§7.1 "gợi ý") — cùng màn xếp ca; báo cáo vi phạm, xuất Excel (W10); thông báo cho quản lý khi có đề xuất mới (hiện qua ô chờ xử lý).
