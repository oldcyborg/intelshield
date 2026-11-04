# Plan 06 — Tuần tra theo vòng (QR, GPS, ảnh) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mục tiêu có lịch tuần tra (tuyến, khung giờ, mỗi bao nhiêu phút một vòng); hệ thống sinh sẵn các vòng 24 giờ tới; bảo vệ đang trực bắt đầu vòng, xác nhận từng điểm bằng **QR, GPS hoặc chụp ảnh**, có thể bị **bắt gửi kèm ảnh** (luôn luôn hoặc ngẫu nhiên theo tỉ lệ của mục tiêu); vòng tự chốt trạng thái (đủ / thiếu điểm / bỏ lỡ), đội trưởng nhận thông báo vòng bị bỏ lỡ; dữ liệu gửi bù từ lúc mất sóng vẫn được tính đúng giờ; quản lý xem bảng vòng tuần và từng lần quét trên web.

**Architecture:** Khối mới `patrol`: `SchedulesService` (lịch theo mục tiêu), `RoundsScheduler` (sinh vòng, nhắc, chốt bỏ lỡ, tự đóng — vòng quét mỗi phút như leo thang sự cố), `PatrolRunService` (phía bảo vệ: vòng của tôi, bắt đầu, quét, kết thúc; idempotent theo `client_uuid`), `PatrolReadService` (phía quản lý). Điểm tuần tra đổi `require_photo` thành `photo_rule` (`never|always|random`); tỉ lệ ảnh ngẫu nhiên là cài đặt `patrol_photo_random_percent` (công ty → mục tiêu). Các điểm rút ngẫu nhiên được chọn **lúc sinh vòng** (lưu trên vòng) để app tải sẵn và làm việc offline.

**Tech Stack:** như trước. Không thêm thư viện.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` bản 1.5 — §4.2 (checkpoints, `photo_rule`), §4.4 (lịch, vòng, quét, quy tắc vòng), §5.1.1 M4–M5, M10–M11, §7.0 (`round_tolerance_minutes`, `patrol_photo_random_percent`), §7.2 (cờ nghi vấn), §7.4 (offline). Chủ dự án 13/10/2026: điểm dùng QR hay GPS đều có thể bắt gửi kèm ảnh.

**Khác với spec (có chủ đích):**
- Vi phạm (`missed_round`, `missed_checkpoint`, `suspicious_scan`) chưa sinh bản ghi vi phạm — làm cùng bộ máy vi phạm (Plan sau). Ở đây: trạng thái vòng, cờ, `validity` và thông báo đội trưởng khi bỏ lỡ.
- NFC: giữ trong danh sách cách xác nhận nhưng quét bằng NFC bị từ chối (Giai đoạn 2).
- Selfie đầu vòng (§7.3): chưa làm; ảnh ở điểm theo `photo_rule` là đủ cho Giai đoạn 1.

## Global Constraints

- Mọi quy ước Plan 01–05 giữ nguyên (tenant từ token, `ScopeService`, quyền đọc từ DB, `BusinessException`, `{data}`/`{error}`).
- Thao tác của bảo vệ (bắt đầu, quét, kết thúc) chỉ từ **máy đã duyệt** (`actor.device_id`) và khi có **ca được xếp** ở mục tiêu bao trùm thời điểm đó (từ 10 phút trước giờ vào ca).
- Thời điểm quét: online = giờ máy chủ; offline (`captured_offline`) = giờ máy, không quá giờ máy chủ. Mọi kiểm tra khung giờ dùng thời điểm này.
- Gửi lại cùng `client_uuid` không tạo bản ghi mới (trả kết quả cũ); `client_uuid` của người khác → 409.
- Lỗi cứng bị từ chối; dấu hiệu nghi vấn vẫn ghi nhận với `validity = 'suspicious'`.
- Chỉ sinh vòng cho khách `managed`, mục tiêu `active`, lịch `active`, tuyến chưa xoá.
- Mọi giờ trong ngày (khung lịch, ngày của vòng) theo `Asia/Ho_Chi_Minh`.

## Review Focus

1. **Offline đúng giờ**: lần quét gửi bù nằm trong khung vẫn được tính (cả khi vòng đã bị ghi bỏ lỡ hoặc thiếu điểm); quét ngoài khung bị từ chối — test ở Task 4.
2. **Ảnh bắt buộc**: `always` và `random` (theo điểm đã rút cho vòng) đều đòi ảnh của chính người quét, chưa gắn vào đâu; cách `photo` luôn đòi ảnh — test ở Task 4.
3. **Không gian lận người khác**: không bắt đầu/quét vòng người khác đã nhận, không quét khi không có ca, không dùng ảnh của người khác — test ở Task 4.

---

### Task 1: Schema, quyền, quy tắc ảnh của điểm, cài đặt tỉ lệ ảnh

**Files:**
- Create: `backend/src/database/migrations/1760800000000-Patrol.ts`, `backend/src/patrol/patrol-schedule.entity.ts`, `backend/src/patrol/patrol-round.entity.ts`, `backend/src/patrol/patrol-scan.entity.ts`, `backend/src/patrol/patrol.module.ts`
- Modify: `backend/src/access/permissions.ts`, `backend/src/common/errors/error-codes.ts`, `backend/src/settings/settings.ts`, `backend/src/settings/dto.ts`, `backend/src/sites/checkpoint.entity.ts`, `backend/src/sites/checkpoints.service.ts`, `backend/src/sites/dto.ts`, `backend/src/files/file.entity.ts`, `backend/src/app.module.ts`, `backend/test/checkpoints.e2e-spec.ts`, `backend/test/users.e2e-spec.ts`, `backend/test/test-env.ts`
- Test: `backend/test/patrol-schema.e2e-spec.ts`

**Interfaces:**
- Produces:
  - Quyền `patrol.view` (xem vòng tuần, lần quét), `patrol.perform` (đi tuần). Vai trò mẫu: `admin` tất cả; `manager` + `patrol.view`; `team_leader` + `patrol.view`, `patrol.perform`; `guard` + `patrol.perform`; `hr`, `accountant` + `patrol.view`.
  - `type PhotoRule = 'never' | 'always' | 'random'`; checkpoint có `photo_rule` (thay `require_photo`; dữ liệu cũ `true` → `always`).
  - Cài đặt `patrol_photo_random_percent` (0–100, mặc định 20).
  - Bảng `patrol_schedules`, `patrol_rounds`, `patrol_scans`; `FileOwnerType` thêm `'patrol_scan'`.
  - Mã lỗi: `PATROL_INTERVAL_TOO_LONG`, `PATROL_DEVICE_REQUIRED`, `PATROL_NOT_ON_SHIFT`, `PATROL_ROUND_TAKEN`, `PATROL_ROUND_CLOSED`, `PATROL_NOT_ON_ROUTE`, `PATROL_METHOD_NOT_ALLOWED`, `PATROL_ALREADY_SCANNED`, `PATROL_PHOTO_REQUIRED`, `PATROL_PHOTO_INVALID`, `PATROL_LOCATION_REQUIRED`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/patrol-schema.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Patrol — checkpoint photo rule and settings (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let siteId: string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'pts');
    api = client(app, admin.token);
    const clientId = (await api.post('/api/clients', { code: 'PK', name: 'Khách' }).expect(201)).body.data.id;
    siteId = (await api.post('/api/sites', { client_id: clientId, code: 'PS', name: 'Toà' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('gives each checkpoint a photo rule: never by default, always or random on request', async () => {
    const plain = (await api.post(`/api/sites/${siteId}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data;
    expect(plain.photo_rule).toBe('never');
    const gps = (await api.post(`/api/sites/${siteId}/checkpoints`, {
      code: 'B', name: 'Bãi xe', lat: 21.03, lng: 105.78, allowed_methods: ['gps'], photo_rule: 'random',
    }).expect(201)).body.data;
    expect(gps).toMatchObject({ allowed_methods: ['gps'], photo_rule: 'random' });
    const changed = (await api.patch(`/api/checkpoints/${plain.id}`, { photo_rule: 'always' }).expect(200)).body.data;
    expect(changed.photo_rule).toBe('always');
    await api.patch(`/api/checkpoints/${plain.id}`, { photo_rule: 'sometimes' }).expect(400);
    await api.post(`/api/sites/${siteId}/checkpoints`, { code: 'C', name: 'X', require_photo: true }).expect(400);
  });

  it('lets the company and each site set how often random photos are asked for', async () => {
    const company = (await api.get('/api/settings').expect(200)).body.data;
    expect(company.defaults.patrol_photo_random_percent).toBe(20);
    await api.patch(`/api/sites/${siteId}/settings`, { patrol_photo_random_percent: 50 }).expect(200);
    expect((await api.get(`/api/sites/${siteId}/settings`).expect(200)).body.data.values.patrol_photo_random_percent).toBe(50);
    await api.patch(`/api/sites/${siteId}/settings`, { patrol_photo_random_percent: 101 }).expect(400);
  });

  it('gives guards and leaders the right to patrol, managers the right to watch', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'patrol.%'`,
      [admin.tenant.id],
    );
    const of = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission).sort();
    expect(of('guard')).toEqual(['patrol.perform']);
    expect(of('team_leader')).toEqual(['patrol.perform', 'patrol.view']);
    expect(of('manager')).toEqual(['patrol.view']);
    expect(of('admin')).toEqual(['patrol.perform', 'patrol.view']);
  });
});
```

Trong `backend/test/checkpoints.e2e-spec.ts` đổi `require_photo: false` thành `photo_rule: 'never'`.

Trong `backend/test/users.e2e-spec.ts`, danh sách quyền của vai trò `scoped_admin` thêm `'patrol.view'` (vai trò quản lý mẫu có thêm quyền này).

Thêm vào `backend/test/test-env.ts`: `process.env.PATROL_TICK = 'off';`

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- patrol-schema`
Expected: FAIL — `photo_rule` undefined, cài đặt không có `patrol_photo_random_percent`.

- [ ] **Step 3: Migration**

`backend/src/database/migrations/1760800000000-Patrol.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'patrol.view'], ['admin', 'patrol.perform'],
  ['manager', 'patrol.view'],
  ['team_leader', 'patrol.view'], ['team_leader', 'patrol.perform'],
  ['guard', 'patrol.perform'],
  ['hr', 'patrol.view'],
  ['accountant', 'patrol.view'],
];

export class Patrol1760800000000 implements MigrationInterface {
  name = 'Patrol1760800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE checkpoints ADD COLUMN photo_rule varchar(10) NOT NULL DEFAULT 'never'
                     CHECK (photo_rule IN ('never', 'always', 'random'))`);
    await q.query(`UPDATE checkpoints SET photo_rule = 'always' WHERE require_photo`);
    await q.query(`ALTER TABLE checkpoints DROP COLUMN require_photo`);

    await q.query(`
      CREATE TABLE patrol_schedules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        route_id uuid NOT NULL REFERENCES routes(id),
        name varchar(100) NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        interval_minutes integer NOT NULL CHECK (interval_minutes BETWEEN 15 AND 720),
        days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}' CHECK (days <@ '{1,2,3,4,5,6,7}'::smallint[] AND cardinality(days) > 0),
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE INDEX patrol_schedules_site ON patrol_schedules (site_id) WHERE deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE patrol_rounds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        schedule_id uuid NOT NULL REFERENCES patrol_schedules(id),
        route_id uuid NOT NULL REFERENCES routes(id),
        expected_start timestamptz NOT NULL,
        expected_end timestamptz NOT NULL,
        photo_checkpoint_ids uuid[] NOT NULL DEFAULT '{}',
        stops jsonb,
        status varchar(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_progress', 'completed', 'partial', 'missed')),
        employee_id uuid REFERENCES employees(id),
        user_id uuid REFERENCES users(id),
        started_at timestamptz,
        ended_at timestamptz,
        ended_by varchar(10) CHECK (ended_by IN ('guard', 'system')),
        late boolean NOT NULL DEFAULT false,
        required_count integer NOT NULL DEFAULT 0,
        done_required integer NOT NULL DEFAULT 0,
        reminder_sent_at timestamptz,
        missed_notified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT patrol_rounds_slot_uq UNIQUE (schedule_id, expected_start),
        CONSTRAINT patrol_rounds_window CHECK (expected_end > expected_start)
      )`);
    await q.query(`CREATE INDEX patrol_rounds_site_time ON patrol_rounds (tenant_id, site_id, expected_start)`);
    await q.query(`CREATE INDEX patrol_rounds_open ON patrol_rounds (expected_end) WHERE status IN ('pending', 'in_progress')`);

    await q.query(`
      CREATE TABLE patrol_scans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        round_id uuid NOT NULL REFERENCES patrol_rounds(id),
        checkpoint_id uuid NOT NULL REFERENCES checkpoints(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        user_id uuid NOT NULL REFERENCES users(id),
        client_uuid uuid NOT NULL,
        method varchar(10) NOT NULL CHECK (method IN ('qr', 'gps', 'photo')),
        scanned_at timestamptz NOT NULL,
        device_time timestamptz NOT NULL,
        server_time timestamptz NOT NULL DEFAULT now(),
        captured_offline boolean NOT NULL DEFAULT false,
        lat numeric(9, 6),
        lng numeric(9, 6),
        accuracy_m integer,
        distance_m integer,
        mock_location boolean NOT NULL DEFAULT false,
        photo_id uuid REFERENCES files(id),
        flags text[] NOT NULL DEFAULT '{}',
        validity varchar(12) NOT NULL DEFAULT 'valid' CHECK (validity IN ('valid', 'suspicious')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT patrol_scans_client_uq UNIQUE (tenant_id, client_uuid),
        CONSTRAINT patrol_scans_once UNIQUE (round_id, checkpoint_id)
      )`);

    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'patrol.%'`);
    await q.query(`DROP TABLE IF EXISTS patrol_scans`);
    await q.query(`DROP TABLE IF EXISTS patrol_rounds`);
    await q.query(`DROP TABLE IF EXISTS patrol_schedules`);
    await q.query(`ALTER TABLE checkpoints ADD COLUMN require_photo boolean NOT NULL DEFAULT false`);
    await q.query(`UPDATE checkpoints SET require_photo = (photo_rule = 'always')`);
    await q.query(`ALTER TABLE checkpoints DROP COLUMN photo_rule`);
  }
}
```

- [ ] **Step 4: Quyền, mã lỗi, cài đặt, điểm tuần tra**

Trong `backend/src/access/permissions.ts`, thêm vào `PERMISSIONS` sau `'device.manage'`:
```ts
  'patrol.view': 'Xem vòng tuần tra và các lần quét',
  'patrol.perform': 'Đi tuần: bắt đầu vòng, quét điểm',
```
và `ROLE_TEMPLATES`: `manager` + `'patrol.view'`; `team_leader` + `'patrol.view', 'patrol.perform'`; `guard` + `'patrol.perform'`; `hr` + `'patrol.view'`; `accountant` + `'patrol.view'`.

Thêm vào `ERROR_CODES` (trước `CONFLICT`):
```ts
  PATROL_INTERVAL_TOO_LONG: { status: 400, message: 'Khoảng cách giữa các vòng dài hơn cả khung giờ tuần tra' },
  PATROL_DEVICE_REQUIRED: { status: 403, message: 'Chỉ đi tuần được từ ứng dụng trên máy đã duyệt' },
  PATROL_NOT_ON_SHIFT: { status: 403, message: 'Bạn không có ca ở mục tiêu này vào lúc đó' },
  PATROL_ROUND_TAKEN: { status: 409, message: 'Vòng này đã có người khác nhận' },
  PATROL_ROUND_CLOSED: { status: 409, message: 'Đã quá giờ của vòng tuần này' },
  PATROL_NOT_ON_ROUTE: { status: 400, message: 'Điểm này không thuộc tuyến của vòng' },
  PATROL_METHOD_NOT_ALLOWED: { status: 400, message: 'Điểm này không xác nhận bằng cách đó' },
  PATROL_ALREADY_SCANNED: { status: 409, message: 'Điểm này đã được xác nhận trong vòng' },
  PATROL_PHOTO_REQUIRED: { status: 400, message: 'Điểm này cần chụp ảnh khi xác nhận' },
  PATROL_PHOTO_INVALID: { status: 400, message: 'Ảnh không hợp lệ: cần ảnh bạn vừa chụp, chưa dùng ở đâu' },
  PATROL_LOCATION_REQUIRED: { status: 400, message: 'Cần vị trí GPS để xác nhận điểm này' },
```

`backend/src/settings/settings.ts`: trong `SETTING_DEFAULTS` thêm sau `round_tolerance_minutes: 15,`:
```ts
  patrol_photo_random_percent: 20,
```

`backend/src/settings/dto.ts`: trong `SettingsPatchDto` thêm sau `round_tolerance_minutes`:
```ts
  @IsOptional() @IsInt() @Min(0) @Max(100)
  patrol_photo_random_percent?: number | null;
```

`backend/src/sites/checkpoint.entity.ts`: thêm sau `CheckMethod`:
```ts
export const PHOTO_RULES = ['never', 'always', 'random'] as const;
export type PhotoRule = (typeof PHOTO_RULES)[number];
```
và thay cột `require_photo` bằng:
```ts
  /** Photo with the confirmation: never, always, or on the rounds drawn at random (spec §4.2). */
  @Column({ type: 'varchar', length: 10, default: 'never' })
  photo_rule: PhotoRule;
```

`backend/src/sites/dto.ts`: import `PHOTO_RULES, PhotoRule` từ `./checkpoint.entity`; trong `CreateCheckpointDto` thay
```ts
  @IsOptional() @IsBoolean()
  require_photo?: boolean;
```
bằng
```ts
  @IsOptional() @IsIn(PHOTO_RULES)
  photo_rule?: PhotoRule;
```
và trong `UpdateCheckpointDto` thay `@IsOptionalNonNull() @IsBoolean()\n  require_photo?: boolean;` bằng `@IsOptionalNonNull() @IsIn(PHOTO_RULES)\n  photo_rule?: PhotoRule;` (bỏ `IsBoolean` khỏi import nếu không còn dùng).

`backend/src/sites/checkpoints.service.ts`: trong `CheckpointView` và hàm `view` đổi `require_photo` thành `photo_rule` (kiểu `PhotoRule`, import từ `./checkpoint.entity`); trong `create` đổi `require_photo: dto.require_photo ?? false` thành `photo_rule: dto.photo_rule ?? 'never'`.

`backend/src/files/file.entity.ts`: `FileOwnerType` thêm `| 'patrol_scan'`.

- [ ] **Step 5: Entity và module**

`backend/src/patrol/patrol-schedule.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** "Route R, every N minutes between two times of day, on these weekdays." */
@Entity('patrol_schedules')
export class PatrolSchedule extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  route_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'time' })
  start_time: string;

  @Column({ type: 'time' })
  end_time: string;

  @Column('int')
  interval_minutes: number;

  /** ISO weekdays (1 = Monday) of the local date a window starts on. */
  @Column({ type: 'smallint', array: true, default: () => `'{1,2,3,4,5,6,7}'` })
  days: number[];

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/patrol/patrol-round.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type RoundStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'missed';
export interface RoundStop {
  checkpoint_id: string;
  seq: number;
  required: boolean;
}

/** One window of a schedule. Its stops are frozen when someone starts it. */
@Entity('patrol_rounds')
export class PatrolRound extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  schedule_id: string;

  @Column('uuid')
  route_id: string;

  @Column({ type: 'timestamptz' })
  expected_start: Date;

  @Column({ type: 'timestamptz' })
  expected_end: Date;

  /** Checkpoints with photo_rule "random" drawn for this round. */
  @Column({ type: 'uuid', array: true, default: () => `'{}'` })
  photo_checkpoint_ids: string[];

  @Column({ type: 'jsonb', nullable: true })
  stops: RoundStop[] | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: RoundStatus;

  @Column({ type: 'uuid', nullable: true })
  employee_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  ended_at: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  ended_by: 'guard' | 'system' | null;

  @Column({ default: false })
  late: boolean;

  @Column('int', { default: 0 })
  required_count: number;

  @Column('int', { default: 0 })
  done_required: number;

  @Column({ type: 'timestamptz', nullable: true })
  reminder_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  missed_notified_at: Date | null;
}
```

`backend/src/patrol/patrol-scan.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export type ScanMethod = 'qr' | 'gps' | 'photo';

/** One checkpoint confirmed in one round. Never edited after it is written. */
@Entity('patrol_scans')
export class PatrolScan extends TenantEntity {
  @Column('uuid')
  round_id: string;

  @Column('uuid')
  checkpoint_id: string;

  @Column('uuid')
  employee_id: string;

  @Column('uuid')
  user_id: string;

  /** Made on the phone; sending the same scan twice returns the first. */
  @Column('uuid')
  client_uuid: string;

  @Column({ type: 'varchar', length: 10 })
  method: ScanMethod;

  /** The time that counts: server time online, the phone's time for scans sent later. */
  @Column({ type: 'timestamptz' })
  scanned_at: Date;

  @Column({ type: 'timestamptz' })
  device_time: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  server_time: Date;

  @Column({ default: false })
  captured_offline: boolean;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column({ type: 'int', nullable: true })
  accuracy_m: number | null;

  @Column({ type: 'int', nullable: true })
  distance_m: number | null;

  @Column({ default: false })
  mock_location: boolean;

  @Column({ type: 'uuid', nullable: true })
  photo_id: string | null;

  @Column({ type: 'text', array: true, default: () => `'{}'` })
  flags: string[];

  @Column({ type: 'varchar', length: 12, default: 'valid' })
  validity: 'valid' | 'suspicious';
}
```

`backend/src/patrol/patrol.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [],
  controllers: [],
})
export class PatrolModule {}
```

Trong `backend/src/app.module.ts`: import `PatrolModule`, thêm vào cuối `imports`.

- [ ] **Step 6: Chạy test để thấy đạt, chạy toàn bộ, migrate DB dev**

Run: `cd backend && npm run test:e2e && npm run migration:run`
Expected: PASS toàn bộ (gồm `patrol-schema` 3); migration `Patrol1760800000000` chạy xong.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): patrol schema, permissions, per-checkpoint photo rule and random-photo rate"
```

---

### Task 2: Lịch tuần tra theo mục tiêu

**Files:**
- Create: `backend/src/patrol/dto.ts`, `backend/src/patrol/schedules.service.ts`, `backend/src/patrol/patrol.controller.ts`
- Modify: `backend/src/patrol/patrol.module.ts`
- Test: `backend/test/patrol-schedules.e2e-spec.ts`

**Interfaces:**
- Consumes: `SitesService.writable`, `ScopeService.canSeeSite`, `AuditService.record`.
- Produces:
  - `SchedulesService.list(actor, siteId)`, `.create(actor, siteId, dto)`, `.update(actor, id, dto)`, `.remove(actor, id)`; mỗi bản ghi trả `ScheduleView { id, site_id, route_id, route_name, name, start_time 'HH:MM', end_time, interval_minutes, days, status, rounds_per_day }`.
  - Sửa hoặc xoá lịch thì xoá các vòng **chưa ai bắt đầu** trong tương lai của lịch đó (vòng quét sinh lại theo lịch mới).
  - Routes: `GET /api/sites/:siteId/patrol-schedules` (`site.view`), `POST /api/sites/:siteId/patrol-schedules`, `PATCH /api/patrol-schedules/:id`, `DELETE /api/patrol-schedules/:id` (`site.manage`).

- [ ] **Step 1: Viết test thất bại**

`backend/test/patrol-schedules.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Patrol — schedules (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'psc');
    api = client(app, admin.token);
    const clientId = (await api.post('/api/clients', { code: 'SK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: clientId, code: 'S1', name: 'Toà 1' }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: clientId, code: 'S2', name: 'Toà 2' }).expect(201)).body.data.id;
    const cp = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng đêm', checkpoints: [{ checkpoint_id: cp }] }).expect(201)).body.data.id;
    const cp2 = (await api.post(`/api/sites/${ids.site2}/checkpoints`, { code: 'B', name: 'Kho' }).expect(201)).body.data.id;
    ids.route2 = (await api.post(`/api/sites/${ids.site2}/routes`, { name: 'Kho', checkpoints: [{ checkpoint_id: cp2 }] }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it('sets up a night schedule across midnight and tells how many rounds a day it makes', async () => {
    const s = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, {
      route_id: ids.route, name: 'Tuần đêm', start_time: '22:00', end_time: '06:00', interval_minutes: 120,
    }).expect(201)).body.data;
    expect(s).toMatchObject({ route_name: 'Vòng đêm', start_time: '22:00', end_time: '06:00', interval_minutes: 120, days: [1, 2, 3, 4, 5, 6, 7], status: 'active', rounds_per_day: 4 });
    const day = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, {
      route_id: ids.route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60, days: [1, 2, 3, 4, 5],
    }).expect(201)).body.data;
    expect(day).toMatchObject({ rounds_per_day: 24, days: [1, 2, 3, 4, 5] });
    const list = (await api.get(`/api/sites/${ids.site}/patrol-schedules`).expect(200)).body.data;
    expect(list.map((x: { name: string }) => x.name).sort()).toEqual(['Cả ngày', 'Tuần đêm']);
  });

  it('refuses a gap longer than the window, a route of another site, and bad days', async () => {
    const res = await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '08:00', end_time: '09:00', interval_minutes: 120 }).expect(400);
    expect(res.body.error.code).toBe('PATROL_INTERVAL_TOO_LONG');
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route2, name: 'X', start_time: '08:00', end_time: '18:00', interval_minutes: 60 }).expect(404);
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '08:00', end_time: '18:00', interval_minutes: 60, days: [0] }).expect(400);
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '8h', end_time: '18:00', interval_minutes: 60 }).expect(400);
  });

  it('drops the untouched future rounds of a schedule when it changes', async () => {
    const s = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'Ngày', start_time: '06:00', end_time: '18:00', interval_minutes: 60 }).expect(201)).body.data;
    await ds.query(
      `INSERT INTO patrol_rounds (tenant_id, site_id, schedule_id, route_id, expected_start, expected_end)
       VALUES ($1, $2, $3, $4, now() + interval '2 hours', now() + interval '3 hours'),
              ($1, $2, $3, $4, now() - interval '2 hours', now() - interval '1 hour')`,
      [admin.tenant.id, ids.site, s.id, ids.route],
    );
    const patched = (await api.patch(`/api/patrol-schedules/${s.id}`, { interval_minutes: 30, status: 'inactive' }).expect(200)).body.data;
    expect(patched).toMatchObject({ interval_minutes: 30, status: 'inactive', rounds_per_day: 24 });
    const left = await ds.query(`SELECT expected_start < now() AS past FROM patrol_rounds WHERE schedule_id = $1`, [s.id]);
    expect(left).toEqual([{ past: true }]);
    await api.patch(`/api/patrol-schedules/${s.id}`, { start_time: '18:00', end_time: '18:30', interval_minutes: 60 }).expect(400);
    await api.delete(`/api/patrol-schedules/${s.id}`).expect(200);
    expect((await api.get(`/api/sites/${ids.site}/patrol-schedules`).expect(200)).body.data.map((x: { id: string }) => x.id)).not.toContain(s.id);
  });

  it('lets leaders read but not change schedules', async () => {
    const viewer = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [{ scope_type: 'site', scope_id: ids.site }]);
    const as = client(app, viewer.token);
    await as.get(`/api/sites/${ids.site}/patrol-schedules`).expect(200);
    await as.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'X', start_time: '08:00', end_time: '18:00', interval_minutes: 60 }).expect(403);
    await as.get(`/api/sites/${ids.site2}/patrol-schedules`).expect(404);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- patrol-schedules`
Expected: FAIL — 404 trên `POST /api/sites/:id/patrol-schedules`.

- [ ] **Step 3: DTO**

`backend/src/patrol/dto.ts`:
```ts
import {
  ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsLatitude, IsLongitude, IsNotEmpty,
  IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../common/validation';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ScheduleDto {
  @IsUUID()
  route_id: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time: string;

  /** Smaller than start_time: the window crosses midnight. Equal: the whole day. */
  @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time: string;

  @IsInt() @Min(15) @Max(720)
  interval_minutes: number;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  days?: number[];
}

export class UpdateScheduleDto {
  @IsOptionalNonNull() @IsUUID()
  route_id?: string;

  @IsOptionalNonNull() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'start_time: định dạng HH:MM' })
  start_time?: string;

  @IsOptionalNonNull() @Matches(HHMM, { message: 'end_time: định dạng HH:MM' })
  end_time?: string;

  @IsOptionalNonNull() @IsInt() @Min(15) @Max(720)
  interval_minutes?: number;

  @IsOptionalNonNull() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  days?: number[];

  @IsOptionalNonNull() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

/** One step of a round sent from the phone; `client_uuid` makes a resend harmless. */
class OfflineAware {
  @IsUUID()
  client_uuid: string;

  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;
}

export class StartRoundDto {
  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;
}

export class ScanDto extends OfflineAware {
  @IsIn(['qr', 'gps', 'photo', 'nfc'])
  method: 'qr' | 'gps' | 'photo' | 'nfc';

  /** Required for GPS and photo; for QR it comes from the tag and must match when given. */
  @IsOptional() @IsUUID()
  checkpoint_id?: string;

  @IsOptional() @IsString() @MaxLength(200)
  qr_payload?: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100000)
  accuracy_m?: number;

  @IsOptional() @IsBoolean()
  mock_location?: boolean;

  @IsOptional() @IsUUID()
  photo_file_id?: string;
}

export class RoundsFilter {
  @IsUUID()
  site_id: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;
}

export class MyRoundsFilter {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date?: string;
}
```

- [ ] **Step 4: Service, controller, module**

`backend/src/patrol/schedules.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { SitesService } from '../sites/sites.service';
import { ScheduleDto, UpdateScheduleDto } from './dto';
import { PatrolSchedule } from './patrol-schedule.entity';

export interface ScheduleView {
  id: string;
  site_id: string;
  route_id: string;
  route_name: string;
  name: string;
  start_time: string;
  end_time: string;
  interval_minutes: number;
  days: number[];
  status: 'active' | 'inactive';
  rounds_per_day: number;
}

const SCHEDULE_ROWS = `
  SELECT p.id, p.site_id, p.route_id, r.name AS route_name, p.name, to_char(p.start_time, 'HH24:MI') AS start_time,
         to_char(p.end_time, 'HH24:MI') AS end_time, p.interval_minutes, p.days, p.status
    FROM patrol_schedules p JOIN routes r ON r.id = p.route_id
   WHERE p.tenant_id = $1 AND p.deleted_at IS NULL`;

/** Minutes the window lasts: across midnight when it ends "earlier", the whole day when both times match. */
export function windowMinutes(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<ScheduleView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const rows = await this.ds.query(`${SCHEDULE_ROWS} AND p.site_id = $2 ORDER BY p.start_time, p.name`, [tenantOf(actor), siteId]);
    return rows.map(view);
  }

  async create(actor: AuthUser, siteId: string, dto: ScheduleDto): Promise<ScheduleView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    await this.assertRoute(tenantId, siteId, dto.route_id);
    assertFits(dto.start_time, dto.end_time, dto.interval_minutes);
    const saved = await this.ds.getRepository(PatrolSchedule).save(
      this.ds.getRepository(PatrolSchedule).create({
        tenant_id: tenantId, site_id: siteId, route_id: dto.route_id, name: dto.name, start_time: dto.start_time,
        end_time: dto.end_time, interval_minutes: dto.interval_minutes, days: dto.days ? [...dto.days].sort() : [1, 2, 3, 4, 5, 6, 7],
      }),
    );
    await this.log(actor, 'patrol_schedule.create', saved.id, { site_id: siteId, ...dto });
    return this.one(tenantId, saved.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateScheduleDto): Promise<ScheduleView> {
    const tenantId = tenantOf(actor);
    const current = await this.get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    if (dto.route_id) await this.assertRoute(tenantId, current.site_id, dto.route_id);
    const start = dto.start_time ?? current.start_time.slice(0, 5);
    const end = dto.end_time ?? current.end_time.slice(0, 5);
    assertFits(start, end, dto.interval_minutes ?? current.interval_minutes);
    await this.ds.transaction(async (m) => {
      await m.update(PatrolSchedule, { id, tenant_id: tenantId }, { ...dto, ...(dto.days ? { days: [...dto.days].sort() } : {}) });
      await this.dropFuture(m, id);
    });
    await this.log(actor, 'patrol_schedule.update', id, { ...dto });
    return this.one(tenantId, id);
  }

  async remove(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const current = await this.get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    await this.ds.transaction(async (m) => {
      await m.softDelete(PatrolSchedule, { id, tenant_id: tenantId });
      await this.dropFuture(m, id);
    });
    await this.log(actor, 'patrol_schedule.delete', id, {});
    return { ok: true };
  }

  /** Rounds nobody has touched yet are regenerated from the new schedule by the next tick. */
  private async dropFuture(m: EntityManager, scheduleId: string) {
    await m.query(
      `DELETE FROM patrol_rounds WHERE schedule_id = $1 AND status = 'pending' AND started_at IS NULL AND expected_start > now()`,
      [scheduleId],
    );
  }

  private async get(tenantId: string, id: string): Promise<PatrolSchedule> {
    const row = await this.ds.getRepository(PatrolSchedule).findOneBy({ id, tenant_id: tenantId });
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private async one(tenantId: string, id: string): Promise<ScheduleView> {
    const [row] = await this.ds.query(`${SCHEDULE_ROWS} AND p.id = $2`, [tenantId, id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return view(row);
  }

  private async assertRoute(tenantId: string, siteId: string, routeId: string) {
    const rows = await this.ds.query(`SELECT 1 FROM routes WHERE id = $1 AND site_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`, [
      routeId, siteId, tenantId,
    ]);
    if (!rows.length) throw new BusinessException('NOT_FOUND');
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'patrol_schedule', entity_id: id, data });
  }
}

function assertFits(start: string, end: string, interval: number) {
  if (interval > windowMinutes(start, end)) throw new BusinessException('PATROL_INTERVAL_TOO_LONG');
}

function view(row: Omit<ScheduleView, 'rounds_per_day'>): ScheduleView {
  return { ...row, days: row.days.map(Number), rounds_per_day: Math.floor(windowMinutes(row.start_time, row.end_time) / row.interval_minutes) };
}
```

`backend/src/patrol/patrol.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ScheduleDto, UpdateScheduleDto } from './dto';
import { SchedulesService } from './schedules.service';

@Controller()
export class PatrolController {
  constructor(private readonly schedules: SchedulesService) {}

  @RequirePermission('site.view')
  @Get('sites/:siteId/patrol-schedules')
  listSchedules(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.schedules.list(user, siteId);
  }

  @RequirePermission('site.manage')
  @Post('sites/:siteId/patrol-schedules')
  createSchedule(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: ScheduleDto) {
    return this.schedules.create(user, siteId, dto);
  }

  @RequirePermission('site.manage')
  @Patch('patrol-schedules/:id')
  updateSchedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleDto) {
    return this.schedules.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('patrol-schedules/:id')
  removeSchedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.remove(user, id);
  }
}
```

`backend/src/patrol/patrol.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { SitesModule } from '../sites/sites.module';
import { PatrolController } from './patrol.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [AccessModule, AuditModule, SitesModule],
  providers: [SchedulesService],
  controllers: [PatrolController],
})
export class PatrolModule {}
```

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- patrol-schedules`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): per-site patrol schedules with overnight and all-day windows"
```

---

### Task 3: Sinh vòng, nhắc trước, chốt bỏ lỡ, tự đóng

**Files:**
- Create: `backend/src/patrol/round-progress.ts`, `backend/src/patrol/rounds.scheduler.ts`
- Modify: `backend/src/patrol/patrol.module.ts`
- Test: `backend/test/patrol-scheduler.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.notify`, `SettingsService.effective`, `todayLocal`.
- Produces:
  - `RoundProgress.settle(m, roundId, now)` — đếm lại điểm bắt buộc đã quét, đặt `in_progress`/`completed`/`partial`; tự kết thúc khi mọi điểm đã quét (`ended_by = 'guard'`) hoặc khi quá hạn `expected_end + round_tolerance_minutes` (`ended_by = 'system'`). `RoundProgress.deadline(round)`, `.liveStops(m, routeId)`, `.view(m, roundId, employeeId)` → `RoundView`.
  - `RoundsScheduler.generate(now)` → số vòng mới; `.remind(now)`, `.markMissed(now)`, `.closeOverdue(now)`; `.tick(now)` chạy cả bốn, mỗi bước lỗi thì ghi log và bước sau vẫn chạy. Vòng quét mỗi 60 giây khi `PATROL_TICK` khác `off`.
  - Thông báo: `patrol.reminder` (người có ca ở mục tiêu lúc vòng bắt đầu, 5 phút trước), `patrol.missed` (đội trưởng đội phụ trách mục tiêu; không có thì quản lý nhóm), dữ liệu `{ round_id }`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/patrol-scheduler.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const HOUR = 3_600_000;

describe('Patrol — round generation and the clock (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let scheduler: RoundsScheduler;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    scheduler = app.get(RoundsScheduler);
    admin = await createTenantWithAdmin(app, 'prs');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.patch(`/api/sites/${ids.site}/settings`, { patrol_photo_random_percent: 100 }).expect(200);
    const a = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    ids.random = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'B', name: 'Kho', photo_rule: 'random' }).expect(201)).body.data.id;
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: a }, { checkpoint_id: ids.random }] }).expect(201)).body.data.id;
    ids.schedule = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;

    const self = (await api.post('/api/clients', { code: 'SM', name: 'Khách tự quản', management_mode: 'self_managed' }).expect(201)).body.data.id;
    ids.selfSite = (await api.post('/api/sites', { client_id: self, code: 'SS', name: 'Kho tự quản' }).expect(201)).body.data.id;
    const sc = (await api.post(`/api/sites/${ids.selfSite}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    const sr = (await api.post(`/api/sites/${ids.selfSite}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: sc }] }).expect(201)).body.data.id;
    await api.post(`/api/sites/${ids.selfSite}/patrol-schedules`, { route_id: sr, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201);
  });
  afterAll(async () => app.close());

  async function member(code: string) {
    const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    return e;
  }
  const rounds = (siteId: string) =>
    ds.query(`SELECT id, expected_start, expected_end, status, photo_checkpoint_ids::text[] AS photo_checkpoint_ids FROM patrol_rounds WHERE site_id = $1 ORDER BY expected_start`, [siteId]);
  const notes = (userId: string, type: string) =>
    ds.query(`SELECT data->>'round_id' AS round_id FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]);

  it('lays out the next 24 hours of rounds once, with the random photo points drawn', async () => {
    const now = Date.now();
    expect(await scheduler.generate(new Date(now))).toBeGreaterThan(0);
    const made = await rounds(ids.site);
    let expected = 0;
    for (let t = Math.floor(now / HOUR) * HOUR; t < now + 24 * HOUR; t += HOUR) expected += 1;
    expect(made).toHaveLength(expected);
    expect(made.filter((r: { expected_start: Date; expected_end: Date }) => r.expected_start.getTime() <= now && r.expected_end.getTime() > now)).toHaveLength(1);
    for (const r of made) {
      expect(r.expected_end.getTime() - r.expected_start.getTime()).toBe(HOUR);
      expect(r.photo_checkpoint_ids).toEqual([ids.random]);
    }
    expect(await scheduler.generate(new Date(now))).toBe(0);
    expect(await rounds(ids.selfSite)).toEqual([]);
  });

  it('reminds whoever is on shift five minutes before a round, once', async () => {
    const e = await member('NHAC');
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const nextHour = Math.ceil(Date.now() / HOUR) * HOUR;
    await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: new Date(nextHour - HOUR).toISOString(), end_at: new Date(nextHour + 3 * HOUR).toISOString() }).expect(201);
    await scheduler.tick(new Date(nextHour - 3 * 60_000));
    await scheduler.tick(new Date(nextHour - 2 * 60_000));
    const [round] = await ds.query(`SELECT id FROM patrol_rounds WHERE site_id = $1 AND expected_start = $2`, [ids.site, new Date(nextHour)]);
    expect(await notes(g.user.id, 'patrol.reminder')).toEqual([{ round_id: round.id }]);
  });

  it('marks a round nobody started as missed when its window ends, and tells the team leader', async () => {
    const lead = await member('TRUONG');
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead });
    const now = Date.now();
    const [current] = await ds.query(`SELECT id, expected_end FROM patrol_rounds WHERE site_id = $1 AND expected_start <= $2 AND expected_end > $2`, [ids.site, new Date(now)]);
    await scheduler.tick(new Date(current.expected_end.getTime() + 1000));
    const after = await rounds(ids.site);
    expect(after.find((r: { id: string }) => r.id === current.id).status).toBe('missed');
    expect(after.filter((r: { expected_start: Date; status: string }) => r.expected_start.getTime() >= current.expected_end.getTime() && r.status !== 'pending')).toEqual([]);
    expect((await notes(leader.user.id, 'patrol.missed')).map((n: { round_id: string }) => n.round_id)).toContain(current.id);
  });

  it('stops making rounds for a paused schedule', async () => {
    await api.patch(`/api/patrol-schedules/${ids.schedule}`, { status: 'inactive' }).expect(200);
    await scheduler.generate(new Date());
    const future = (await rounds(ids.site)).filter((r: { expected_start: Date }) => r.expected_start.getTime() > Date.now());
    expect(future).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- patrol-scheduler`
Expected: FAIL — `Cannot find module '../src/patrol/rounds.scheduler'`.

- [ ] **Step 3: Tiến độ của vòng**

`backend/src/patrol/round-progress.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { CheckMethod, PhotoRule } from '../sites/checkpoint.entity';
import { PatrolRound, RoundStatus, RoundStop } from './patrol-round.entity';

export interface StopView {
  checkpoint_id: string;
  seq: number;
  required: boolean;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  photo_required: boolean;
  scanned_at: Date | null;
  method: string | null;
  validity: 'valid' | 'suspicious' | null;
  flags: string[];
}

export interface RoundView {
  id: string;
  site_id: string;
  site_name: string;
  route_name: string;
  schedule_name: string;
  expected_start: Date;
  expected_end: Date;
  status: RoundStatus;
  late: boolean;
  started_at: Date | null;
  ended_at: Date | null;
  ended_by: 'guard' | 'system' | null;
  employee_id: string | null;
  employee_name: string | null;
  mine: boolean;
  required_count: number;
  done_required: number;
  stops: StopView[];
}

interface CheckpointRow {
  id: string;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  photo_rule: PhotoRule;
}

/** Whether confirming this checkpoint in this round needs a photo (spec §4.2). */
export function photoRequired(k: Pick<CheckpointRow, 'id' | 'allowed_methods' | 'photo_rule'>, round: Pick<PatrolRound, 'photo_checkpoint_ids'>): boolean {
  if (k.allowed_methods.length === 1 && k.allowed_methods[0] === 'photo') return true;
  return k.photo_rule === 'always' || (k.photo_rule === 'random' && round.photo_checkpoint_ids.includes(k.id));
}

@Injectable()
export class RoundProgress {
  constructor(private readonly settings: SettingsService) {}

  /** Last moment a scan still counts: the end of the window plus the site's tolerance. */
  async deadline(round: Pick<PatrolRound, 'tenant_id' | 'site_id' | 'expected_end'>): Promise<Date> {
    const s = await this.settings.effective(round.tenant_id, round.site_id);
    return new Date(new Date(round.expected_end).getTime() + s.round_tolerance_minutes * 60_000);
  }

  /** The route as it stands, without retired checkpoints. A started round keeps its own frozen copy. */
  async liveStops(m: EntityManager, routeId: string): Promise<RoundStop[]> {
    return m.query(
      `SELECT rc.checkpoint_id, rc.seq, rc.required FROM route_checkpoints rc
         JOIN checkpoints k ON k.id = rc.checkpoint_id AND k.status = 'active' AND k.deleted_at IS NULL
        WHERE rc.route_id = $1 ORDER BY rc.seq`,
      [routeId],
    );
  }

  /** Recount and set the status. The caller holds the round's row lock. */
  async settle(m: EntityManager, roundId: string, now: Date): Promise<void> {
    const round = await m.findOneByOrFail(PatrolRound, { id: roundId });
    if (!round.started_at) return;
    const stops = round.stops ?? [];
    const scans: { checkpoint_id: string; scanned_at: Date }[] = await m.query(
      `SELECT checkpoint_id, scanned_at FROM patrol_scans WHERE round_id = $1 ORDER BY scanned_at`,
      [roundId],
    );
    const seen = new Set(scans.map((s) => s.checkpoint_id));
    const required = stops.filter((s) => s.required);
    const done = required.filter((s) => seen.has(s.checkpoint_id)).length;
    let endedAt = round.ended_at;
    let endedBy = round.ended_by;
    if (!endedAt && stops.length && stops.every((s) => seen.has(s.checkpoint_id))) {
      endedAt = new Date(scans[scans.length - 1].scanned_at);
      endedBy = 'guard';
    }
    const deadline = await this.deadline(round);
    if (!endedAt && now.getTime() >= deadline.getTime()) {
      endedAt = deadline;
      endedBy = 'system';
    }
    const status: RoundStatus = endedAt ? (done >= required.length ? 'completed' : 'partial') : 'in_progress';
    await m.update(PatrolRound, { id: roundId }, { required_count: required.length, done_required: done, ended_at: endedAt, ended_by: endedBy, status });
  }

  /** A round with each stop and how it was confirmed. `employeeId` marks whether it is the caller's. */
  async view(m: EntityManager, roundId: string, employeeId: string | null): Promise<RoundView> {
    const [row] = await m.query(
      `SELECT r.*, r.photo_checkpoint_ids::text[] AS photo_checkpoint_ids, s.name AS site_name, ro.name AS route_name, p.name AS schedule_name, e.full_name AS employee_name
         FROM patrol_rounds r
         JOIN sites s ON s.id = r.site_id
         JOIN routes ro ON ro.id = r.route_id
         JOIN patrol_schedules p ON p.id = r.schedule_id
         LEFT JOIN employees e ON e.id = r.employee_id
        WHERE r.id = $1`,
      [roundId],
    );
    const round = row as PatrolRound & { site_name: string; route_name: string; schedule_name: string; employee_name: string | null };
    const stops = round.stops ?? (await this.liveStops(m, round.route_id));
    const ids = stops.map((s) => s.checkpoint_id);
    const checkpoints: CheckpointRow[] = ids.length
      ? await m.query(`SELECT id, code, name, lat, lng, radius_m, allowed_methods, photo_rule FROM checkpoints WHERE id = ANY($1::uuid[])`, [ids])
      : [];
    const scans: { checkpoint_id: string; scanned_at: Date; method: string; validity: 'valid' | 'suspicious'; flags: string[] }[] = await m.query(
      `SELECT checkpoint_id, scanned_at, method, validity, flags FROM patrol_scans WHERE round_id = $1`,
      [roundId],
    );
    return {
      id: round.id, site_id: round.site_id, site_name: round.site_name, route_name: round.route_name, schedule_name: round.schedule_name,
      expected_start: round.expected_start, expected_end: round.expected_end, status: round.status, late: round.late,
      started_at: round.started_at, ended_at: round.ended_at, ended_by: round.ended_by, employee_id: round.employee_id,
      employee_name: round.employee_name, mine: Boolean(employeeId) && round.employee_id === employeeId,
      required_count: round.required_count, done_required: round.done_required,
      stops: stops.flatMap((stop) => {
        const k = checkpoints.find((c) => c.id === stop.checkpoint_id);
        if (!k) return [];
        const scan = scans.find((s) => s.checkpoint_id === stop.checkpoint_id);
        return [{
          checkpoint_id: k.id, seq: stop.seq, required: stop.required, code: k.code, name: k.name, lat: k.lat, lng: k.lng,
          radius_m: k.radius_m, allowed_methods: k.allowed_methods, photo_required: photoRequired(k, round),
          scanned_at: scan?.scanned_at ?? null, method: scan?.method ?? null, validity: scan?.validity ?? null, flags: scan?.flags ?? [],
        }];
      }),
    };
  }
}
```

- [ ] **Step 4: Vòng quét**

`backend/src/patrol/rounds.scheduler.ts`:
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'crypto';
import { DataSource } from 'typeorm';
import { todayLocal } from '../common/date';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { RoundProgress } from './round-progress';

const TICK_MS = 60_000;
const REMIND_MINUTES = 5;

const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

interface RoundRow {
  id: string;
  tenant_id: string;
  site_id: string;
  route_id: string;
  expected_start: Date;
}

@Injectable()
export class RoundsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Patrol');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly progress: RoundProgress,
  ) {}

  onModuleInit(): void {
    if (getEnv('PATROL_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass of the clock. A failing step is logged and the next one still runs. */
  async tick(now: Date = new Date()): Promise<void> {
    const steps: [string, (at: Date) => Promise<unknown>][] = [
      ['sinh vòng', (at) => this.generate(at)],
      ['nhắc vòng', (at) => this.remind(at)],
      ['chốt bỏ lỡ', (at) => this.markMissed(at)],
      ['tự đóng', (at) => this.closeOverdue(at)],
    ];
    for (const [name, step] of steps) {
      try {
        await step(now);
      } catch (error) {
        this.logger.error(`Tuần tra — ${name} lỗi: ${(error as Error).message}`, (error as Error).stack);
      }
    }
  }

  /** Rounds whose window has not ended and starts within 24 hours. Running it again adds nothing. */
  async generate(now: Date): Promise<number> {
    const made: RoundRow[] = await this.ds.query(
      `WITH s AS (
         SELECT p.id, p.tenant_id, p.site_id, p.route_id, p.start_time, p.end_time, p.interval_minutes, p.days
           FROM patrol_schedules p
           JOIN sites si ON si.id = p.site_id AND si.deleted_at IS NULL AND si.status = 'active'
           JOIN clients c ON c.id = si.client_id AND c.deleted_at IS NULL AND c.management_mode = 'managed'
           JOIN routes r ON r.id = p.route_id AND r.deleted_at IS NULL
          WHERE p.deleted_at IS NULL AND p.status = 'active'),
       w AS (
         SELECT s.*, ((d::date + s.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS w_start,
                (((d::date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS w_end
           FROM s, generate_series(($2::date - 1)::timestamp, ($2::date + 1)::timestamp, interval '1 day') d
          WHERE extract(isodow FROM d)::smallint = ANY(s.days)),
       slots AS (
         SELECT w.*, slot
           FROM w, generate_series(w.w_start, w.w_end - make_interval(mins => w.interval_minutes), make_interval(mins => w.interval_minutes)) slot)
       INSERT INTO patrol_rounds (tenant_id, site_id, schedule_id, route_id, expected_start, expected_end)
       SELECT tenant_id, site_id, id, route_id, slot, slot + make_interval(mins => interval_minutes)
         FROM slots
        WHERE slot + make_interval(mins => interval_minutes) > $1 AND slot < $1::timestamptz + interval '24 hours'
       ON CONFLICT (schedule_id, expected_start) DO NOTHING
       RETURNING id, tenant_id, site_id, route_id, expected_start`,
      [now, todayLocal(now)],
    );
    if (!made.length) return 0;
    await this.drawPhotos(made);
    return made.length;
  }

  /** Each "random" checkpoint is asked for a photo on about the site's share of rounds, decided now so phones know offline. */
  private async drawPhotos(rounds: RoundRow[]): Promise<void> {
    const pool: { route_id: string; id: string }[] = await this.ds.query(
      `SELECT rc.route_id, k.id FROM route_checkpoints rc JOIN checkpoints k ON k.id = rc.checkpoint_id
        WHERE rc.route_id = ANY($1::uuid[]) AND k.photo_rule = 'random' AND k.status = 'active' AND k.deleted_at IS NULL`,
      [[...new Set(rounds.map((r) => r.route_id))]],
    );
    if (!pool.length) return;
    const percent = new Map<string, number>();
    for (const round of rounds) {
      const candidates = pool.filter((p) => p.route_id === round.route_id).map((p) => p.id);
      if (!candidates.length) continue;
      if (!percent.has(round.site_id)) {
        percent.set(round.site_id, (await this.settings.effective(round.tenant_id, round.site_id)).patrol_photo_random_percent);
      }
      const share = percent.get(round.site_id)!;
      const picked = candidates.filter(() => randomInt(100) < share);
      if (picked.length) await this.ds.query(`UPDATE patrol_rounds SET photo_checkpoint_ids = $2 WHERE id = $1`, [round.id, picked]);
    }
  }

  async remind(now: Date): Promise<number> {
    const due: (RoundRow & { route_name: string; site_name: string })[] = await this.ds.query(
      `UPDATE patrol_rounds r SET reminder_sent_at = $1
         FROM routes ro, sites s
        WHERE ro.id = r.route_id AND s.id = r.site_id AND r.status = 'pending' AND r.reminder_sent_at IS NULL
          AND r.expected_start > $1 AND r.expected_start <= $1::timestamptz + make_interval(mins => $2)
       RETURNING r.id, r.tenant_id, r.site_id, r.route_id, r.expected_start, ro.name AS route_name, s.name AS site_name`,
      [now, REMIND_MINUTES],
    );
    for (const round of due) {
      const onShift: { id: string }[] = await this.ds.query(
        `SELECT DISTINCT u.id FROM shift_assignments a
           JOIN users u ON u.employee_id = a.employee_id AND u.status = 'active' AND u.deleted_at IS NULL
          WHERE a.site_id = $1 AND a.status = 'planned' AND a.planned_start <= $2 AND a.planned_end > $2`,
        [round.site_id, round.expected_start],
      );
      await this.notifications.notify(round.tenant_id, onShift.map((u) => u.id), {
        type: 'patrol.reminder', title: `Sắp đến vòng tuần ${hhmm(round.expected_start)} · ${round.route_name}`,
        body: round.site_name, data: { round_id: round.id }, priority: 'normal', push: true,
      });
    }
    return due.length;
  }

  async markMissed(now: Date): Promise<number> {
    const missed: (RoundRow & { route_name: string; site_name: string })[] = await this.ds.query(
      `UPDATE patrol_rounds r SET status = 'missed', missed_notified_at = $1, updated_at = now()
         FROM routes ro, sites s
        WHERE ro.id = r.route_id AND s.id = r.site_id AND r.status = 'pending' AND r.expected_end <= $1
       RETURNING r.id, r.tenant_id, r.site_id, r.route_id, r.expected_start, ro.name AS route_name, s.name AS site_name`,
      [now],
    );
    for (const round of missed) {
      await this.notifications.notify(round.tenant_id, await this.leadersOf(round.site_id), {
        type: 'patrol.missed', title: `Vòng tuần bị bỏ lỡ · ${hhmm(round.expected_start)} · ${round.route_name}`,
        body: round.site_name, data: { round_id: round.id }, priority: 'high', push: true,
      });
    }
    return missed.length;
  }

  /** Rounds still open past their deadline are closed as they stand. */
  async closeOverdue(now: Date): Promise<number> {
    const open: { id: string; tenant_id: string; site_id: string; expected_end: Date }[] = await this.ds.query(
      `SELECT id, tenant_id, site_id, expected_end FROM patrol_rounds WHERE status = 'in_progress' AND expected_end <= $1`,
      [now],
    );
    let closed = 0;
    for (const round of open) {
      if ((await this.progress.deadline(round)).getTime() > now.getTime()) continue;
      await this.ds.transaction(async (m) => {
        const [locked] = await m.query(`SELECT id FROM patrol_rounds WHERE id = $1 AND status = 'in_progress' FOR UPDATE SKIP LOCKED`, [round.id]);
        if (!locked) return;
        await this.progress.settle(m, round.id, now);
        closed += 1;
      });
    }
    return closed;
  }

  /** The leader of the team that runs the site; failing that, the manager of its group. */
  private async leadersOf(siteId: string): Promise<string[]> {
    const leaders: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM sites s JOIN teams t ON t.id = s.responsible_team_id AND t.deleted_at IS NULL
         JOIN users u ON u.employee_id = t.leader_employee_id AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE s.id = $1`,
      [siteId],
    );
    if (leaders.length) return leaders.map((u) => u.id);
    const managers: { id: string }[] = await this.ds.query(
      `SELECT g.manager_user_id AS id FROM sites s JOIN teams t ON t.id = s.responsible_team_id
         JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
        WHERE s.id = $1 AND g.manager_user_id IS NOT NULL`,
      [siteId],
    );
    return managers.map((u) => u.id);
  }
}
```

`backend/src/patrol/patrol.module.ts`: `imports` thêm `NotificationsModule`, `SettingsModule`; `providers` thêm `RoundProgress`, `RoundsScheduler`; thêm `exports: [RoundsScheduler]`.

Thêm vào `backend/.env.example`:
```
# on | off — vòng quét tuần tra mỗi phút (sinh vòng, nhắc, chốt bỏ lỡ).
PATROL_TICK=on
```

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- patrol-scheduler`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): patrol clock — rounds 24h ahead with random photo draw, reminders, missed rounds, overdue closing"
```

---

### Task 4: Bảo vệ đi tuần — vòng của tôi, bắt đầu, quét, kết thúc

**Files:**
- Create: `backend/src/patrol/patrol-run.service.ts`
- Modify: `backend/src/patrol/patrol.controller.ts`, `backend/src/patrol/patrol.module.ts`
- Test: `backend/test/patrol-run.e2e-spec.ts`

**Interfaces:**
- Consumes: `RoundProgress`, `parseQr`/`qrMatches`, `distanceMeters`, `FilesService.claim`, `SettingsService.effective`.
- Produces:
  - `PatrolRunService.myRounds(actor, date?)` → `RoundView[]` các vòng ở mục tiêu mà người gọi có ca trùng khung vòng trong ngày đó (mặc định hôm nay); mỗi điểm có `photo_required`, cách xác nhận, toạ độ — đủ để app làm offline.
  - `.start(actor, roundId, { device_time, captured_offline })`, `.scan(actor, roundId, ScanDto)`, `.finish(actor, roundId, { device_time, captured_offline })` → `RoundView`. Quét khi vòng chưa bắt đầu thì tự bắt đầu.
  - Cờ: `outside_radius`, `mock_location`, `low_accuracy` (>100 m), `clock_skew` (online, lệch >5 phút), `late_sync` (gửi bù sau >12 giờ), `impossible_speed` (>15 km/h với lần quét gần nhất trong vòng). Trừ `low_accuracy`, có cờ là `suspicious`.
  - Routes (`patrol.perform`): `GET /api/me/rounds?date`, `POST /api/patrol/rounds/:id/start`, `POST /api/patrol/rounds/:id/scans`, `POST /api/patrol/rounds/:id/finish`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/patrol-run.e2e-spec.ts`:
```ts
import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Patrol — doing a round (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  const tags: Record<string, string> = {};
  let g1: Guard;
  let g2: Guard;
  let seq = 0;
  type Guard = { userId: string; token: string; web: string; api: ReturnType<typeof client> };

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'prn');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'NK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'NS', name: 'Toà', ...SITE, responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.patch(`/api/sites/${ids.site}/settings`, { patrol_photo_random_percent: 100 }).expect(200);
    const point = async (code: string, extra: object) => (await api.post(`/api/sites/${ids.site}/checkpoints`, { code, name: `Điểm ${code}`, ...extra }).expect(201)).body.data.id;
    ids.A = await point('A', { allowed_methods: ['qr'] });
    ids.B = await point('B', { allowed_methods: ['gps'], ...SITE, radius_m: 40, photo_rule: 'random' });
    ids.C = await point('C', { allowed_methods: ['qr', 'gps'], ...SITE, photo_rule: 'always' });
    ids.D = await point('D', { allowed_methods: ['photo'] });
    ids.E = await point('E', { allowed_methods: ['gps'], ...SITE });
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, {
      name: 'Vòng chính',
      checkpoints: [{ checkpoint_id: ids.A }, { checkpoint_id: ids.B }, { checkpoint_id: ids.C }, { checkpoint_id: ids.D, required: false }],
    }).expect(201)).body.data.id;
    for (const t of (await api.get(`/api/sites/${ids.site}/qr-sheet`).expect(200)).body.data.tags) tags[t.id] = t.payload;
    g1 = await guardOnShift();
    g2 = await guardOnShift();
  });
  afterAll(async () => app.close());

  async function guardOnShift(withShift = true): Promise<Guard> {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `NG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const phone = await loginOnDevice(app, u.phone, u.password, `prn-phone-${seq}`);
    if (withShift) await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
    return { userId: u.user.id, token: phone.token!, web: u.token, api: client(app, phone.token!) };
  }
  /** A fresh schedule gives a round open right now that nobody has touched. */
  async function freshRound(): Promise<string> {
    seq += 1;
    const s = (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: `Lịch ${seq}`, start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
    await app.get(RoundsScheduler).generate(new Date());
    const [r] = await ds.query(
      `SELECT id FROM patrol_rounds WHERE schedule_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes'
        ORDER BY expected_start LIMIT 1`,
      [s],
    );
    return r.id;
  }
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;
  const scan = (g: Guard, round: string, body: object) =>
    g.api.post(`/api/patrol/rounds/${round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), ...body });
  const near = { lat: 21.0286, lng: 105.7768, accuracy_m: 8 };

  it('walks a round by QR, GPS and photo and finishes it complete', async () => {
    const round = await freshRound();
    const mine = (await g1.api.get('/api/me/rounds').expect(200)).body.data;
    const listed = mine.find((r: { id: string }) => r.id === round);
    expect(listed.stops.map((s: { code: string; photo_required: boolean }) => `${s.code}:${s.photo_required}`)).toEqual(['A:false', 'B:true', 'C:true', 'D:true']);

    await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A], ...near }).expect(201);
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.B, ...near }).expect(400)).body.error.code).toBe('PATROL_PHOTO_REQUIRED');
    await scan(g1, round, { method: 'gps', checkpoint_id: ids.B, ...near, photo_file_id: await photo(g1.token) }).expect(201);
    const res = (await scan(g1, round, { method: 'qr', qr_payload: tags[ids.C], ...near, photo_file_id: await photo(g1.token) }).expect(201)).body.data;
    expect(res).toMatchObject({ status: 'in_progress', mine: true, required_count: 3, done_required: 3, late: false });
    expect(res.stops.find((s: { code: string }) => s.code === 'B')).toMatchObject({ method: 'gps', validity: 'valid', flags: [] });

    const done = (await g1.api.post(`/api/patrol/rounds/${round}/finish`, { device_time: new Date().toISOString() }).expect(201)).body.data;
    expect(done).toMatchObject({ status: 'completed', ended_by: 'guard' });
  });

  it('refuses forged tags, points off the route, wrong methods, repeats and borrowed photos', async () => {
    const round = await freshRound();
    const forged = tags[ids.A].slice(0, -2) + (tags[ids.A].endsWith('AA') ? 'BB' : 'AA');
    expect((await scan(g1, round, { method: 'qr', qr_payload: forged }).expect(400)).body.error.code).toBe('QR_INVALID');
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.E, ...near }).expect(400)).body.error.code).toBe('PATROL_NOT_ON_ROUTE');
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.A, ...near }).expect(400)).body.error.code).toBe('PATROL_METHOD_NOT_ALLOWED');
    expect((await scan(g1, round, { method: 'nfc', checkpoint_id: ids.A }).expect(400)).body.error.code).toBe('PATROL_METHOD_NOT_ALLOWED');
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.B }).expect(400)).body.error.code).toBe('PATROL_LOCATION_REQUIRED');
    await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(201);
    expect((await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(409)).body.error.code).toBe('PATROL_ALREADY_SCANNED');
    const theirs = await photo(g2.token);
    expect((await scan(g1, round, { method: 'photo', checkpoint_id: ids.D, photo_file_id: theirs }).expect(400)).body.error.code).toBe('PATROL_PHOTO_INVALID');
  });

  it('keeps a round to one guard, on shift, on an approved phone', async () => {
    const round = await freshRound();
    await g1.api.post(`/api/patrol/rounds/${round}/start`, { device_time: new Date().toISOString() }).expect(201);
    await g1.api.post(`/api/patrol/rounds/${round}/start`, { device_time: new Date().toISOString() }).expect(201);
    expect((await g2.api.post(`/api/patrol/rounds/${round}/start`, { device_time: new Date().toISOString() }).expect(409)).body.error.code).toBe('PATROL_ROUND_TAKEN');
    expect((await scan(g2, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(409)).body.error.code).toBe('PATROL_ROUND_TAKEN');
    const idle = await guardOnShift(false);
    const other = await freshRound();
    expect((await idle.api.post(`/api/patrol/rounds/${other}/start`, { device_time: new Date().toISOString() }).expect(403)).body.error.code).toBe('PATROL_NOT_ON_SHIFT');
    expect((await client(app, g1.web).post(`/api/patrol/rounds/${other}/start`, { device_time: new Date().toISOString() }).expect(403)).body.error.code).toBe('PATROL_DEVICE_REQUIRED');
  });

  it('answers a resent scan with the first result instead of a second copy', async () => {
    const round = await freshRound();
    const body = { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: tags[ids.A] };
    await g1.api.post(`/api/patrol/rounds/${round}/scans`, body).expect(201);
    await g1.api.post(`/api/patrol/rounds/${round}/scans`, body).expect(201);
    expect((await ds.query(`SELECT count(*)::int AS n FROM patrol_scans WHERE round_id = $1`, [round]))[0].n).toBe(1);
    await g2.api.post(`/api/patrol/rounds/${round}/scans`, body).expect(409);
  });

  it('keeps suspicious scans but marks them', async () => {
    const round = await freshRound();
    const far = (await scan(g1, round, { method: 'gps', checkpoint_id: ids.C, lat: 21.04, lng: 105.79, mock_location: true, photo_file_id: await photo(g1.token) }).expect(201)).body.data;
    expect(far.stops.find((s: { code: string }) => s.code === 'C')).toMatchObject({ validity: 'suspicious', flags: expect.arrayContaining(['outside_radius', 'mock_location']) });
    const skewed = (await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A], device_time: minutes(-20) }).expect(201)).body.data;
    expect(skewed.stops.find((s: { code: string }) => s.code === 'A').flags).toContain('clock_skew');
  });

  it('counts scans sent late from offline when they fall in the window, even on a round marked missed', async () => {
    const round = await freshRound();
    await ds.query(`UPDATE patrol_rounds SET status = 'missed' WHERE id = $1`, [round]);
    const at = new Date(Date.now() - 5_000).toISOString();
    const res = (await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A], device_time: at, captured_offline: true }).expect(201)).body.data;
    expect(res).toMatchObject({ status: 'in_progress', mine: true });
    expect(new Date(res.started_at).toISOString()).toBe(at);
    const [r] = await ds.query(`SELECT expected_start FROM patrol_rounds WHERE id = $1`, [round]);
    const tooEarly = new Date(r.expected_start.getTime() - 20 * 60_000).toISOString();
    expect((await scan(g1, round, { method: 'gps', checkpoint_id: ids.C, ...near, device_time: tooEarly, captured_offline: true, photo_file_id: await photo(g1.token) }).expect(409)).body.error.code).toBe('PATROL_ROUND_CLOSED');
  });

  it('closes a round left open at its deadline as partial', async () => {
    const round = await freshRound();
    await scan(g1, round, { method: 'qr', qr_payload: tags[ids.A] }).expect(201);
    const [r] = await ds.query(`SELECT expected_end FROM patrol_rounds WHERE id = $1`, [round]);
    await app.get(RoundsScheduler).tick(new Date(r.expected_end.getTime() + 16 * 60_000));
    const [after] = await ds.query(`SELECT status, ended_by, done_required, required_count FROM patrol_rounds WHERE id = $1`, [round]);
    expect(after).toEqual({ status: 'partial', ended_by: 'system', done_required: 1, required_count: 3 });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- patrol-run`
Expected: FAIL — `GET /api/me/rounds` 404.

- [ ] **Step 3: Service**

`backend/src/patrol/patrol-run.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { distanceMeters } from '../attendance/geo';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { CheckMethod, PhotoRule } from '../sites/checkpoint.entity';
import { parseQr, qrMatches } from '../sites/qr';
import { MyRoundsFilter, ScanDto, StartRoundDto } from './dto';
import { PatrolRound } from './patrol-round.entity';
import { PatrolScan } from './patrol-scan.entity';
import { photoRequired, RoundProgress, RoundView } from './round-progress';

const EARLY_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const LATE_SYNC_MS = 12 * 60 * 60_000;
const LOW_ACCURACY_M = 100;
const MAX_SPEED_KMH = 15;
/** Signs worth a leader's look. Poor GPS alone is noted but not held against anyone. */
const SUSPICIOUS = ['outside_radius', 'mock_location', 'clock_skew', 'late_sync', 'impossible_speed'];

interface When {
  /** The moment that counts for every window check. */
  at: Date;
  server: Date;
  device: Date;
}

@Injectable()
export class PatrolRunService {
  constructor(
    private readonly ds: DataSource,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly progress: RoundProgress,
  ) {}

  /** Rounds at the sites where the caller has a shift that day overlapping the round. */
  async myRounds(actor: AuthUser, filter: MyRoundsFilter): Promise<RoundView[]> {
    if (!actor.employee_id) return [];
    const rows: { id: string }[] = await this.ds.query(
      `SELECT r.id FROM patrol_rounds r
        WHERE r.tenant_id = $1 AND EXISTS (
              SELECT 1 FROM shift_assignments a
               WHERE a.site_id = r.site_id AND a.employee_id = $2 AND a.status = 'planned' AND a.shift_date = $3
                 AND a.planned_start < r.expected_end AND a.planned_end > r.expected_start)
        ORDER BY r.expected_start, r.id`,
      [tenantOf(actor), actor.employee_id, filter.date ?? todayLocal()],
    );
    const out: RoundView[] = [];
    for (const r of rows) out.push(await this.progress.view(this.ds.manager, r.id, actor.employee_id));
    return out;
  }

  async start(actor: AuthUser, roundId: string, dto: StartRoundDto): Promise<RoundView> {
    this.assertPhone(actor);
    const when = this.when(dto.device_time, dto.captured_offline);
    await this.ds.transaction(async (m) => {
      const round = await this.lock(m, actor, roundId);
      await this.begin(m, actor, round, when.at);
      await this.progress.settle(m, roundId, when.server);
    });
    return this.progress.view(this.ds.manager, roundId, actor.employee_id);
  }

  async scan(actor: AuthUser, roundId: string, dto: ScanDto): Promise<RoundView> {
    this.assertPhone(actor);
    const tenantId = tenantOf(actor);
    // A resend of a scan already stored answers with the round as it is; someone else's id is a conflict.
    const [prior] = await this.ds.query(`SELECT round_id, user_id FROM patrol_scans WHERE tenant_id = $1 AND client_uuid = $2`, [tenantId, dto.client_uuid]);
    if (prior) {
      if (prior.user_id !== actor.id || prior.round_id !== roundId) throw new BusinessException('CONFLICT');
      return this.progress.view(this.ds.manager, roundId, actor.employee_id);
    }
    if (dto.method === 'nfc') throw new BusinessException('PATROL_METHOD_NOT_ALLOWED');
    const method = dto.method;
    const when = this.when(dto.device_time, dto.captured_offline);
    await this.ds.transaction(async (m) => {
      const locked = await this.lock(m, actor, roundId);
      await this.begin(m, actor, locked, when.at);
      const round = await m.findOneByOrFail(PatrolRound, { id: roundId });
      const deadline = await this.progress.deadline(round);
      const tooEarly = when.at.getTime() < round.expected_start.getTime() - EARLY_MS;
      const afterFinish = round.ended_by === 'guard' && round.ended_at && when.at.getTime() > round.ended_at.getTime();
      if (tooEarly || when.at.getTime() > deadline.getTime() || afterFinish) {
        throw new BusinessException('PATROL_ROUND_CLOSED');
      }

      const checkpointId = await this.identify(m, tenantId, method, dto);
      if (!(round.stops ?? []).some((s) => s.checkpoint_id === checkpointId)) throw new BusinessException('PATROL_NOT_ON_ROUTE');
      const [k]: { id: string; lat: string | null; lng: string | null; radius_m: number; allowed_methods: CheckMethod[]; photo_rule: PhotoRule }[] =
        await m.query(`SELECT id, lat, lng, radius_m, allowed_methods, photo_rule FROM checkpoints WHERE id = $1 AND tenant_id = $2`, [checkpointId, tenantId]);
      if (!k.allowed_methods.includes(method)) throw new BusinessException('PATROL_METHOD_NOT_ALLOWED');
      if (await m.exists(PatrolScan, { where: { round_id: roundId, checkpoint_id: checkpointId } })) throw new BusinessException('PATROL_ALREADY_SCANNED');
      const hasFix = dto.lat !== undefined && dto.lng !== undefined;
      if (method === 'gps' && !hasFix) throw new BusinessException('PATROL_LOCATION_REQUIRED');
      if ((method === 'photo' || photoRequired(k, round)) && !dto.photo_file_id) throw new BusinessException('PATROL_PHOTO_REQUIRED');
      if (dto.photo_file_id) await this.assertOwnPhoto(m, actor, dto.photo_file_id, Boolean(dto.captured_offline));

      const flags: string[] = [];
      let distance: number | null = null;
      if (hasFix && k.lat !== null && k.lng !== null) {
        distance = distanceMeters({ lat: Number(k.lat), lng: Number(k.lng) }, { lat: dto.lat!, lng: dto.lng! });
        if (distance > k.radius_m) flags.push('outside_radius');
      }
      if (dto.mock_location) flags.push('mock_location');
      if (dto.accuracy_m !== undefined && dto.accuracy_m > LOW_ACCURACY_M) flags.push('low_accuracy');
      if (!dto.captured_offline && Math.abs(when.device.getTime() - when.server.getTime()) > CLOCK_SKEW_MS) flags.push('clock_skew');
      if (dto.captured_offline && when.server.getTime() - when.at.getTime() > LATE_SYNC_MS) flags.push('late_sync');
      if (hasFix && (await this.tooFast(m, roundId, when.at, dto.lat!, dto.lng!))) flags.push('impossible_speed');

      const saved = await m.save(
        m.create(PatrolScan, {
          tenant_id: tenantId, round_id: roundId, checkpoint_id: checkpointId, employee_id: actor.employee_id!, user_id: actor.id,
          client_uuid: dto.client_uuid, method, scanned_at: when.at, device_time: when.device, server_time: when.server,
          captured_offline: Boolean(dto.captured_offline), lat: hasFix ? String(dto.lat) : null, lng: hasFix ? String(dto.lng) : null,
          accuracy_m: dto.accuracy_m ?? null, distance_m: distance, mock_location: Boolean(dto.mock_location),
          photo_id: dto.photo_file_id ?? null, flags, validity: flags.some((f) => SUSPICIOUS.includes(f)) ? 'suspicious' : 'valid',
        }),
      );
      if (dto.photo_file_id) await this.files.claim(m, tenantId, dto.photo_file_id, { type: 'patrol_scan', id: saved.id });
      await this.progress.settle(m, roundId, when.server);
    });
    return this.progress.view(this.ds.manager, roundId, actor.employee_id);
  }

  async finish(actor: AuthUser, roundId: string, dto: StartRoundDto): Promise<RoundView> {
    this.assertPhone(actor);
    const when = this.when(dto.device_time, dto.captured_offline);
    await this.ds.transaction(async (m) => {
      const round = await this.lock(m, actor, roundId);
      if (!round.started_at) throw new BusinessException('PATROL_ROUND_CLOSED');
      if (round.employee_id !== actor.employee_id) throw new BusinessException('PATROL_ROUND_TAKEN');
      if (round.ended_at) return;
      const endedAt = new Date(Math.max(when.at.getTime(), round.started_at.getTime()));
      await m.update(PatrolRound, { id: roundId }, { ended_at: endedAt, ended_by: 'guard' });
      await this.progress.settle(m, roundId, when.server);
    });
    return this.progress.view(this.ds.manager, roundId, actor.employee_id);
  }

  /** Taking the round: the first start or scan claims it for this guard, inside its window, on shift. */
  private async begin(m: EntityManager, actor: AuthUser, round: PatrolRound, at: Date): Promise<void> {
    if (round.started_at) {
      if (round.employee_id !== actor.employee_id) throw new BusinessException('PATROL_ROUND_TAKEN');
      return;
    }
    if (at.getTime() < round.expected_start.getTime() - EARLY_MS || at.getTime() > round.expected_end.getTime()) {
      throw new BusinessException('PATROL_ROUND_CLOSED');
    }
    const onShift = await m.query(
      `SELECT 1 FROM shift_assignments
        WHERE tenant_id = $1 AND employee_id = $2 AND site_id = $3 AND status = 'planned'
          AND planned_start - interval '10 minutes' <= $4 AND planned_end >= $4 LIMIT 1`,
      [round.tenant_id, actor.employee_id, round.site_id, at],
    );
    if (!onShift.length) throw new BusinessException('PATROL_NOT_ON_SHIFT');
    const s = await this.settings.effective(round.tenant_id, round.site_id);
    const stops = await this.progress.liveStops(m, round.route_id);
    await m.update(PatrolRound, { id: round.id }, {
      status: 'in_progress', employee_id: actor.employee_id, user_id: actor.id, started_at: at, stops,
      late: at.getTime() > round.expected_start.getTime() + s.round_tolerance_minutes * 60_000,
      required_count: stops.filter((x) => x.required).length, ended_at: null, ended_by: null,
    });
  }

  /** Which checkpoint: from a QR tag (its signature checked), or named by the phone for GPS and photo. */
  private async identify(m: EntityManager, tenantId: string, method: 'qr' | 'gps' | 'photo', dto: ScanDto): Promise<string> {
    if (method !== 'qr') {
      if (!dto.checkpoint_id) throw new BusinessException('VALIDATION_FAILED', ['checkpoint_id: cần chọn điểm']);
      return dto.checkpoint_id;
    }
    const parsed = dto.qr_payload ? parseQr(dto.qr_payload) : null;
    if (!parsed || (dto.checkpoint_id && dto.checkpoint_id !== parsed.checkpointId)) throw new BusinessException('QR_INVALID');
    const [row]: { qr_secret: string }[] = await m.query(
      `SELECT qr_secret FROM checkpoints WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND status = 'active'`,
      [parsed.checkpointId, tenantId],
    );
    if (!row || !qrMatches(row.qr_secret, parsed.checkpointId, parsed.signature)) throw new BusinessException('QR_INVALID');
    return parsed.checkpointId;
  }

  /** Locked round of the caller's company. Whether they may act on it is decided by `begin`. */
  private async lock(m: EntityManager, actor: AuthUser, roundId: string): Promise<PatrolRound> {
    const [row] = await m.query(`SELECT id FROM patrol_rounds WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [roundId, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return m.findOneByOrFail(PatrolRound, { id: roundId });
  }

  /** Server time online; for a scan sent later, the phone's time — never ahead of the server. */
  private when(deviceTime: string, offline?: boolean): When {
    const server = new Date();
    const device = new Date(deviceTime);
    return { at: offline ? new Date(Math.min(device.getTime(), server.getTime())) : server, server, device };
  }

  private assertPhone(actor: AuthUser): void {
    if (!actor.device_id) throw new BusinessException('PATROL_DEVICE_REQUIRED');
    if (!actor.employee_id) throw new BusinessException('PATROL_NOT_ON_SHIFT');
  }

  /** A photo this user took — recently when online — and not attached to anything yet. */
  private async assertOwnPhoto(m: EntityManager, actor: AuthUser, fileId: string, offline: boolean): Promise<void> {
    const rows = await m.query(
      `SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
          AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL
          AND ($4::boolean OR created_at > now() - interval '10 minutes')`,
      [fileId, tenantOf(actor), actor.id, offline],
    );
    if (!rows.length) throw new BusinessException('PATROL_PHOTO_INVALID');
  }

  /** Compared with the scan nearest in time in this round: nobody walks a site faster than 15 km/h. */
  private async tooFast(m: EntityManager, roundId: string, at: Date, lat: number, lng: number): Promise<boolean> {
    const [prev]: { lat: string; lng: string; scanned_at: Date }[] = await m.query(
      `SELECT lat, lng, scanned_at FROM patrol_scans WHERE round_id = $1 AND lat IS NOT NULL
        ORDER BY abs(extract(epoch FROM scanned_at - $2::timestamptz)) LIMIT 1`,
      [roundId, at],
    );
    if (!prev) return false;
    const meters = distanceMeters({ lat: Number(prev.lat), lng: Number(prev.lng) }, { lat, lng });
    if (meters <= 50) return false;
    const hours = Math.abs(at.getTime() - new Date(prev.scanned_at).getTime()) / 3_600_000;
    return hours === 0 || meters / 1000 / hours > MAX_SPEED_KMH;
  }
}
```

- [ ] **Step 4: Controller và module**

Trong `backend/src/patrol/patrol.controller.ts`: constructor thêm `private readonly run: PatrolRunService`; import `MyRoundsFilter, ScanDto, StartRoundDto` từ `./dto`, `Query` từ `@nestjs/common`, `PatrolRunService` từ `./patrol-run.service`; thêm:
```ts
  @RequirePermission('patrol.perform')
  @Get('me/rounds')
  myRounds(@CurrentUser() user: AuthUser, @Query() filter: MyRoundsFilter) {
    return this.run.myRounds(user, filter);
  }

  @RequirePermission('patrol.perform')
  @Post('patrol/rounds/:id/start')
  startRound(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartRoundDto) {
    return this.run.start(user, id, dto);
  }

  @RequirePermission('patrol.perform')
  @Post('patrol/rounds/:id/scans')
  scan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScanDto) {
    return this.run.scan(user, id, dto);
  }

  @RequirePermission('patrol.perform')
  @Post('patrol/rounds/:id/finish')
  finishRound(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartRoundDto) {
    return this.run.finish(user, id, dto);
  }
```

`backend/src/patrol/patrol.module.ts`: `imports` thêm `FilesModule`; `providers` thêm `PatrolRunService`.

- [ ] **Step 5: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npm run test:e2e`
Expected: PASS toàn bộ (gồm `patrol-run` 7).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): guards walk rounds by QR, GPS or photo — photo rules, flags, offline-safe timing, idempotent resend"
```

---

### Task 5: Quản lý xem vòng tuần, ảnh quét, cách ly công ty, dữ liệu demo

**Files:**
- Create: `backend/src/patrol/patrol-read.service.ts`
- Modify: `backend/src/patrol/patrol.controller.ts`, `backend/src/patrol/patrol.module.ts`, `backend/src/files/files.service.ts`, `backend/src/scripts/seed-demo.ts`
- Test: `backend/test/patrol-read.e2e-spec.ts`, `backend/test/tenancy-06.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `PatrolReadService.list(actor, { site_id, date })` → `{ summary: { total, pending, in_progress, completed, partial, missed, late, suspicious }, rounds: RoundRow[] }` (vòng có `expected_start` trong ngày địa phương đó).
  - `.get(actor, id)` → `RoundView & { scans: ScanRow[] }`; xem được nếu là vòng của chính mình, hoặc có `patrol.view` và thấy mục tiêu.
  - `.today(actor)` → mỗi mục tiêu người gọi thấy có vòng hôm nay: `{ site_id, site_name, total, completed, partial, missed, in_progress, suspicious }`.
  - Routes: `GET /api/patrol/rounds?site_id&date` và `GET /api/patrol/today` (`patrol.view`), `GET /api/patrol/rounds/:id` (service kiểm quyền).
  - Ảnh của lần quét (`owner_type = 'patrol_scan'`): người quét, hoặc `patrol.view` + thấy mục tiêu.

- [ ] **Step 1: Viết test thất bại**

`backend/test/patrol-read.e2e-spec.ts`:
```ts
import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Patrol — what managers see (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let guard: { token: string; api: ReturnType<typeof client> };
  let other: { token: string };

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'prd');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'DK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'DS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'DS2', name: 'Kho' }).expect(201)).body.data.id;
    ids.cp = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng', allowed_methods: ['photo'] }).expect(201)).body.data.id;
    const route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: ids.cp }] }).expect(201)).body.data.id;
    await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201);
    await app.get(RoundsScheduler).generate(new Date());
    const [r] = await ds.query(`SELECT id FROM patrol_rounds WHERE site_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [ids.site]);
    ids.round = r.id;
    const onShift = async (code: string) => {
      const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
      await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
      await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
      const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
      const phone = await loginOnDevice(app, u.phone, u.password, `prd-${code}`);
      await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
      return { token: phone.token!, api: client(app, phone.token!) };
    };
    guard = await onShift('DG1');
    other = await onShift('DG2');
    const photo = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${guard.token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;
    ids.photo = photo;
    await guard.api.post(`/api/patrol/rounds/${ids.round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'photo', checkpoint_id: ids.cp, photo_file_id: photo, lat: 21.5, lng: 105.5, mock_location: true }).expect(201);
  });
  afterAll(async () => app.close());

  it("shows a manager the site's rounds for the day with a summary", async () => {
    const manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
    const day = (await manager.get(`/api/patrol/rounds?site_id=${ids.site}&date=${todayLocal()}`).expect(200)).body.data;
    expect(day.summary).toMatchObject({ completed: 1, suspicious: 1 });
    expect(day.summary.total).toBe(day.rounds.length);
    const row = day.rounds.find((r: { id: string }) => r.id === ids.round);
    expect(row).toMatchObject({ status: 'completed', route_name: 'Vòng', employee_name: 'DG1', done_required: 1, required_count: 1, suspicious_count: 1 });
    const detail = (await manager.get(`/api/patrol/rounds/${ids.round}`).expect(200)).body.data;
    expect(detail.scans).toHaveLength(1);
    expect(detail.scans[0]).toMatchObject({ checkpoint_name: 'Cổng', method: 'photo', photo_id: ids.photo, validity: 'suspicious', captured_offline: false });
    await manager.get(`/api/files/${ids.photo}`).expect(200);
    const today = (await manager.get('/api/patrol/today').expect(200)).body.data;
    expect(today.find((s: { site_id: string }) => s.site_id === ids.site)).toMatchObject({ site_name: 'Toà', completed: 1 });
  });

  it('lets guards open their own round and photo, nobody else’s', async () => {
    await guard.api.get(`/api/patrol/rounds/${ids.round}`).expect(200);
    await client(app, other.token).get(`/api/patrol/rounds/${ids.round}`).expect(404);
    await client(app, other.token).get(`/api/files/${ids.photo}`).expect(404);
    await client(app, other.token).get(`/api/patrol/rounds?site_id=${ids.site}&date=${todayLocal()}`).expect(403);
  });

  it('keeps leaders to the sites they can see', async () => {
    const leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [{ scope_type: 'site', scope_id: ids.site2 }])).token);
    await leader.get(`/api/patrol/rounds?site_id=${ids.site}&date=${todayLocal()}`).expect(404);
    await leader.get(`/api/patrol/rounds/${ids.round}`).expect(404);
    expect((await leader.get('/api/patrol/today').expect(200)).body.data.map((s: { site_id: string }) => s.site_id)).not.toContain(ids.site);
  });
});
```

`backend/test/tenancy-06.e2e-spec.ts`:
```ts
import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Tenant isolation for patrol (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const A: Record<string, string> = {};
  const B: Record<string, string> = {};
  let apiA: ReturnType<typeof client>;
  let guardA: ReturnType<typeof client>;

  async function company(prefix: string, out: Record<string, string>) {
    const t = await createTenantWithAdmin(app, prefix);
    const api = client(app, t.token);
    out.tenant = t.tenant.id;
    out.client = (await api.post('/api/clients', { code: 'K', name: prefix }).expect(201)).body.data.id;
    out.site = (await api.post('/api/sites', { client_id: out.client, code: 'S', name: prefix }).expect(201)).body.data.id;
    out.cp = (await api.post(`/api/sites/${out.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    out.route = (await api.post(`/api/sites/${out.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: out.cp }] }).expect(201)).body.data.id;
    out.schedule = (await api.post(`/api/sites/${out.site}/patrol-schedules`, { route_id: out.route, name: 'Cả ngày', start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
    out.tag = (await api.get(`/api/sites/${out.site}/qr-sheet`).expect(200)).body.data.tags[0].payload;
    return { t, api };
  }

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await company('iso6-a', A);
    await company('iso6-b', B);
    apiA = a.api;
    await app.get(RoundsScheduler).generate(new Date());
    const pick = async (site: string) =>
      (await ds.query(`SELECT id FROM patrol_rounds WHERE site_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [site]))[0].id;
    A.round = await pick(A.site);
    B.round = await pick(B.site);
    const e = (await apiA.post('/api/employees', { code: 'G', full_name: 'G' }).expect(201)).body.data.id;
    await apiA.post('/api/deployments', { employee_id: e, client_id: A.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    await apiA.post('/api/roster', { site_id: A.site, employee_id: e, start_at: minutes(-30), end_at: minutes(300) }).expect(201);
    const u = await createUserWithRoles(app, a.t.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    guardA = client(app, (await loginOnDevice(app, u.phone, u.password, 'iso6-phone')).token!);
  });
  afterAll(async () => app.close());

  it("answers every read or change of B's schedules and rounds with 404", async () => {
    await apiA.get(`/api/sites/${B.site}/patrol-schedules`).expect(404);
    await apiA.patch(`/api/patrol-schedules/${B.schedule}`, { name: 'x' }).expect(404);
    await apiA.delete(`/api/patrol-schedules/${B.schedule}`).expect(404);
    await apiA.post(`/api/sites/${A.site}/patrol-schedules`, { route_id: B.route, name: 'x', start_time: '08:00', end_time: '18:00', interval_minutes: 60 }).expect(404);
    await apiA.get(`/api/patrol/rounds?site_id=${B.site}&date=${todayLocal()}`).expect(404);
    await apiA.get(`/api/patrol/rounds/${B.round}`).expect(404);
    await guardA.post(`/api/patrol/rounds/${B.round}/start`, { device_time: new Date().toISOString() }).expect(404);
    expect((await apiA.get('/api/patrol/today').expect(200)).body.data.map((s: { site_id: string }) => s.site_id)).not.toContain(B.site);
  });

  it("refuses B's QR tag on A's round", async () => {
    const res = await guardA.post(`/api/patrol/rounds/${A.round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: B.tag }).expect(400);
    expect(res.body.error.code).toBe('QR_INVALID');
    await guardA.post(`/api/patrol/rounds/${A.round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', qr_payload: A.tag }).expect(201);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- patrol-read tenancy-06`
Expected: FAIL — `GET /api/patrol/rounds` 404.

- [ ] **Step 3: Service và route**

`backend/src/patrol/patrol-read.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { RoundsFilter } from './dto';
import { RoundProgress } from './round-progress';

const STATUSES = ['pending', 'in_progress', 'completed', 'partial', 'missed'] as const;

@Injectable()
export class PatrolReadService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly progress: RoundProgress,
  ) {}

  /** One site, one local day: every round with who did it and how far they got. */
  async list(actor: AuthUser, filter: RoundsFilter) {
    if (!(await this.scopes.canSeeSite(actor, filter.site_id))) throw new BusinessException('NOT_FOUND');
    const rounds: { status: (typeof STATUSES)[number]; late: boolean; suspicious_count: number }[] = await this.ds.query(
      `SELECT r.id, r.expected_start, r.expected_end, r.status, r.late, r.started_at, r.ended_at, r.ended_by,
              r.required_count, r.done_required, ro.name AS route_name, p.name AS schedule_name, e.full_name AS employee_name,
              (SELECT count(*)::int FROM patrol_scans sc WHERE sc.round_id = r.id) AS scan_count,
              (SELECT count(*)::int FROM patrol_scans sc WHERE sc.round_id = r.id AND sc.validity = 'suspicious') AS suspicious_count
         FROM patrol_rounds r
         JOIN routes ro ON ro.id = r.route_id
         JOIN patrol_schedules p ON p.id = r.schedule_id
         LEFT JOIN employees e ON e.id = r.employee_id
        WHERE r.tenant_id = $1 AND r.site_id = $2 AND (r.expected_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $3
        ORDER BY r.expected_start, ro.name`,
      [tenantOf(actor), filter.site_id, filter.date],
    );
    const summary: Record<string, number> = { total: rounds.length, late: 0, suspicious: 0 };
    for (const s of STATUSES) summary[s] = 0;
    for (const r of rounds) {
      summary[r.status] += 1;
      if (r.late) summary.late += 1;
      if (r.suspicious_count) summary.suspicious += 1;
    }
    return { summary, rounds };
  }

  /** A round with every scan, for the guard who did it or anyone watching the site. */
  async get(actor: AuthUser, id: string) {
    const [row] = await this.ds.query(`SELECT site_id, employee_id FROM patrol_rounds WHERE id = $1 AND tenant_id = $2`, [id, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const own = Boolean(actor.employee_id) && row.employee_id === actor.employee_id;
    if (!own && !((await this.permissions.has(actor.id, ['patrol.view'])) && (await this.scopes.canSeeSite(actor, row.site_id)))) {
      throw new BusinessException('NOT_FOUND');
    }
    const view = await this.progress.view(this.ds.manager, id, actor.employee_id);
    const scans = await this.ds.query(
      `SELECT sc.id, sc.checkpoint_id, k.code AS checkpoint_code, k.name AS checkpoint_name, sc.method, sc.scanned_at, sc.device_time,
              sc.server_time, sc.captured_offline, sc.lat, sc.lng, sc.accuracy_m, sc.distance_m, sc.mock_location, sc.photo_id,
              sc.flags, sc.validity, e.full_name AS employee_name
         FROM patrol_scans sc
         JOIN checkpoints k ON k.id = sc.checkpoint_id
         JOIN employees e ON e.id = sc.employee_id
        WHERE sc.round_id = $1 ORDER BY sc.scanned_at`,
      [id],
    );
    return { ...view, scans };
  }

  /** Today's tally per visible site, for the dashboard. */
  async today(actor: AuthUser) {
    const tenantId = tenantOf(actor);
    const sites = await this.scopes.siteVisibility(actor);
    const params: unknown[] = [tenantId, todayLocal()];
    let where = '';
    if (!sites.all) {
      params.push(sites.siteIds);
      where = ` AND r.site_id = ANY($3::uuid[])`;
    }
    return this.ds.query(
      `SELECT r.site_id, s.name AS site_name, count(*)::int AS total,
              count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
              count(*) FILTER (WHERE r.status = 'partial')::int AS partial,
              count(*) FILTER (WHERE r.status = 'missed')::int AS missed,
              count(*) FILTER (WHERE r.status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM patrol_scans sc WHERE sc.round_id = r.id AND sc.validity = 'suspicious'))::int AS suspicious
         FROM patrol_rounds r JOIN sites s ON s.id = r.site_id
        WHERE r.tenant_id = $1 AND (r.expected_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $2${where}
        GROUP BY r.site_id, s.name ORDER BY s.name`,
      params,
    );
  }
}
```

Trong `backend/src/patrol/patrol.controller.ts`: constructor thêm `private readonly read: PatrolReadService`; import `RoundsFilter`; thêm (route `patrol/today` và `patrol/rounds` khai báo trước `patrol/rounds/:id`):
```ts
  @RequirePermission('patrol.view')
  @Get('patrol/rounds')
  listRounds(@CurrentUser() user: AuthUser, @Query() filter: RoundsFilter) {
    return this.read.list(user, filter);
  }

  @RequirePermission('patrol.view')
  @Get('patrol/today')
  today(@CurrentUser() user: AuthUser) {
    return this.read.today(user);
  }

  /** The guard who walked it, or anyone watching the site — the service decides. */
  @Get('patrol/rounds/:id')
  getRound(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.read.get(user, id);
  }
```

`backend/src/patrol/patrol.module.ts`: `providers` thêm `PatrolReadService`.

`backend/src/files/files.service.ts`, trong `maySee` trước `return false;` cuối:
```ts
    if (file.owner_type === 'patrol_scan') {
      const [row] = await this.ds.query(
        `SELECT sc.employee_id, r.site_id FROM patrol_scans sc JOIN patrol_rounds r ON r.id = sc.round_id WHERE sc.id = $1`,
        [file.owner_id],
      );
      if (!row) return false;
      if (row.employee_id === actor.employee_id) return true;
      return (await this.permissions.has(actor.id, ['patrol.view'])) && (await this.scopes.canSeeSite(actor, row.site_id));
    }
```

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- patrol-read tenancy-06`
Expected: PASS — 3 + 2 tests.

- [ ] **Step 5: Dữ liệu demo**

Trong `backend/src/scripts/seed-demo.ts`: import `SchedulesService` từ `../patrol/schedules.service` và `RoundsScheduler` từ `../patrol/rounds.scheduler`. Ngay sau dòng tạo tuyến `routesSvc.create(actor, toa.id, { name: 'Vòng tuần tra tầng 1 & hầm', ... })` đổi thành lưu biến `const route = await routesSvc.create(...)` rồi thêm:
```ts
  await checkpointsSvc.update(actor, created[1].id, { photo_rule: 'random' });
  await checkpointsSvc.update(actor, created[created.length - 1].id, { photo_rule: 'always' });
  const schedulesSvc = app.get(SchedulesService);
  await schedulesSvc.create(actor, toa.id, { route_id: route.id, name: 'Tuần tra ngày', start_time: '06:00', end_time: '18:00', interval_minutes: 180 });
  await schedulesSvc.create(actor, toa.id, { route_id: route.id, name: 'Tuần tra đêm', start_time: '18:00', end_time: '06:00', interval_minutes: 120 });
```
và trước dòng `console.log('Đã tạo công ty demo...`:
```ts
  await app.get(RoundsScheduler).generate(new Date());
```

Run: reset DB dev (như Plan 05 Task 6) rồi `npm run seed:demo` → không lỗi; `SELECT count(*) FROM patrol_rounds` > 0.

- [ ] **Step 6: Chạy toàn bộ, commit**

Run: `cd backend && npm test && npm run test:e2e && npm run build` → PASS.

```bash
git add backend
git commit -m "feat(backend): patrol board for managers, scan photos, isolation suite, demo schedules"
```

---

### Task 6: Web — quy tắc ảnh của điểm, lịch tuần tra, cài đặt tỉ lệ ảnh

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/lib/format.ts`, `web/src/app/(app)/muc-tieu/[id]/page.tsx`
- Create: `web/src/components/site-patrol-schedules.tsx`

- [ ] **Step 1: Kiểu và nhãn**

`web/src/lib/types.ts`:
- trong `CheckpointView` thay `require_photo: boolean;` bằng `photo_rule: PhotoRule;` và thêm phía trên interface: `export type PhotoRule = 'never' | 'always' | 'random';`
- trong `SettingsValues` thêm `patrol_photo_random_percent: number;` sau `round_tolerance_minutes`;
- cuối file:
```ts
export interface PatrolScheduleView {
  id: string;
  site_id: string;
  route_id: string;
  route_name: string;
  name: string;
  start_time: string;
  end_time: string;
  interval_minutes: number;
  days: number[];
  status: 'active' | 'inactive';
  rounds_per_day: number;
}

export type RoundStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'missed';

export interface RoundRow {
  id: string;
  expected_start: string;
  expected_end: string;
  status: RoundStatus;
  late: boolean;
  started_at: string | null;
  ended_at: string | null;
  ended_by: 'guard' | 'system' | null;
  required_count: number;
  done_required: number;
  route_name: string;
  schedule_name: string;
  employee_name: string | null;
  scan_count: number;
  suspicious_count: number;
}

export interface RoundStop {
  checkpoint_id: string;
  seq: number;
  required: boolean;
  code: string;
  name: string;
  allowed_methods: CheckMethod[];
  photo_required: boolean;
  scanned_at: string | null;
  method: string | null;
  validity: 'valid' | 'suspicious' | null;
  flags: string[];
}

export interface ScanRow {
  id: string;
  checkpoint_code: string;
  checkpoint_name: string;
  method: 'qr' | 'gps' | 'photo';
  scanned_at: string;
  device_time: string;
  server_time: string;
  captured_offline: boolean;
  lat: string | null;
  lng: string | null;
  accuracy_m: number | null;
  distance_m: number | null;
  photo_id: string | null;
  flags: string[];
  validity: 'valid' | 'suspicious';
  employee_name: string;
}

export interface RoundDetail {
  id: string;
  site_id: string;
  site_name: string;
  route_name: string;
  schedule_name: string;
  expected_start: string;
  expected_end: string;
  status: RoundStatus;
  late: boolean;
  started_at: string | null;
  ended_at: string | null;
  ended_by: 'guard' | 'system' | null;
  employee_name: string | null;
  required_count: number;
  done_required: number;
  stops: RoundStop[];
  scans: ScanRow[];
}

export interface PatrolToday {
  site_id: string;
  site_name: string;
  total: number;
  completed: number;
  partial: number;
  missed: number;
  in_progress: number;
  suspicious: number;
}
```

`web/src/lib/format.ts`:
- dòng `import type` thêm `PhotoRule, RoundStatus`;
- trong `SETTING_FIELDS` thêm sau dòng `round_tolerance_minutes`:
```ts
  { key: 'patrol_photo_random_percent', label: 'Điểm "ảnh ngẫu nhiên": tỉ lệ vòng phải chụp', unit: '%', min: 0, max: 100 },
```
- cuối file:
```ts
export const PHOTO_RULE: Record<PhotoRule, string> = {
  never: 'Không cần ảnh',
  always: 'Luôn kèm ảnh',
  random: 'Ảnh ngẫu nhiên',
};

export const METHOD_LABEL: Record<string, string> = { qr: 'QR', gps: 'GPS', photo: 'Chụp ảnh', nfc: 'NFC' };

export const ROUND_STATUS: Record<RoundStatus, { label: string; tone: string }> = {
  pending: { label: 'Chưa đến / chưa bắt đầu', tone: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'Đang tuần', tone: 'bg-sky-100 text-sky-800' },
  completed: { label: 'Đủ điểm', tone: 'bg-teal-100 text-teal-800' },
  partial: { label: 'Thiếu điểm', tone: 'bg-amber-100 text-amber-800' },
  missed: { label: 'Bỏ lỡ', tone: 'bg-red-100 text-red-700' },
};

export const SCAN_FLAG: Record<string, string> = {
  outside_radius: 'ngoài bán kính',
  mock_location: 'GPS giả',
  low_accuracy: 'GPS kém',
  clock_skew: 'giờ máy lệch',
  late_sync: 'gửi muộn',
  impossible_speed: 'di chuyển quá nhanh',
};

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' }, { value: 4, label: 'T5' },
  { value: 5, label: 'T6' }, { value: 6, label: 'T7' }, { value: 7, label: 'CN' },
];
```

- [ ] **Step 2: Lịch tuần tra trên trang mục tiêu**

`web/src/components/site-patrol-schedules.tsx`:
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { WEEKDAYS } from '@/lib/format';
import { PatrolScheduleView, RouteView } from '@/lib/types';

const EVERY: number[] = [30, 60, 90, 120, 180, 240];

/** When each route is walked: a time window, how often, which days. Rounds follow within a minute. */
export function SitePatrolSchedules({ siteId, routes, manage }: { siteId: string; routes: RouteView[]; manage: boolean }) {
  const [rows, setRows] = useState<PatrolScheduleView[]>([]);
  const [form, setForm] = useState({ route_id: '', name: '', start_time: '18:00', end_time: '06:00', interval_minutes: 120, days: [1, 2, 3, 4, 5, 6, 7] });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRows(await api<PatrolScheduleView[]>(`/sites/${siteId}/patrol-schedules`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);
  useEffect(() => { if (!form.route_id && routes[0]) setForm((f) => ({ ...f, route_id: routes[0].id })); }, [routes, form.route_id]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  function create(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/sites/${siteId}/patrol-schedules`, { method: 'POST', json: form });
      setForm({ ...form, name: '' });
    });
  }

  const dayText = (days: number[]) => (days.length === 7 ? 'mọi ngày' : WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.label).join(', '));

  return (
    <Card title="Lịch tuần tra">
      <ul className="mb-3 divide-y divide-slate-100 text-sm">
        {rows.map((s) => (
          <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${s.status === 'inactive' ? 'text-slate-400' : ''}`}>
            <span>
              <b>{s.name}</b> · {s.route_name} · {s.start_time}–{s.end_time} · mỗi {s.interval_minutes} phút ({s.rounds_per_day} vòng/ngày) · {dayText(s.days)}
            </span>
            {manage && (
              <span className="space-x-2">
                <Button variant="secondary" onClick={() => run(() => api(`/patrol-schedules/${s.id}`, { method: 'PATCH', json: { status: s.status === 'active' ? 'inactive' : 'active' } }))}>
                  {s.status === 'active' ? 'Tạm dừng' : 'Chạy lại'}
                </Button>
                <Button variant="secondary" onClick={() => window.confirm(`Xoá lịch "${s.name}"?`) && run(() => api(`/patrol-schedules/${s.id}`, { method: 'DELETE' }))}>Xoá</Button>
              </span>
            )}
          </li>
        ))}
        {!rows.length && <li className="py-2 text-slate-400">Chưa có lịch — chưa có vòng tuần nào được sinh</li>}
      </ul>
      {manage && routes.length > 0 && (
        <form onSubmit={create} className="grid grid-cols-2 items-end gap-3 md:grid-cols-6">
          <Field label="Tên lịch"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tuần tra đêm" required /></Field>
          <Field label="Tuyến">
            <Select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Từ"><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required /></Field>
          <Field label="Đến"><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required /></Field>
          <Field label="Mỗi">
            <Select value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })}>
              {EVERY.map((m) => <option key={m} value={m}>{m} phút</option>)}
            </Select>
          </Field>
          <Button type="submit">Thêm lịch</Button>
          <div className="col-span-2 flex flex-wrap gap-3 text-sm md:col-span-6">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.days.includes(d.value)}
                  onChange={() => setForm({ ...form, days: form.days.includes(d.value) ? form.days.filter((x) => x !== d.value) : [...form.days, d.value] })}
                />
                {d.label}
              </label>
            ))}
          </div>
        </form>
      )}
      {manage && !routes.length && <p className="text-sm text-slate-500">Tạo tuyến tuần tra trước, rồi đặt lịch cho tuyến.</p>}
      <p className="mt-2 text-xs text-slate-500">Giờ kết thúc nhỏ hơn giờ bắt đầu là qua đêm; bằng nhau là cả ngày. Hệ thống sinh sẵn các vòng của 24 giờ tới.</p>
      <ErrorText error={error} />
    </Card>
  );
}
```

- [ ] **Step 3: Sửa trang mục tiêu**

Trong `web/src/app/(app)/muc-tieu/[id]/page.tsx`:
- bỏ hằng `METHOD_LABEL` cục bộ, import `METHOD_LABEL, PHOTO_RULE` từ `@/lib/format`, `PhotoRule` từ `@/lib/types`, `SitePatrolSchedules` từ `@/components/site-patrol-schedules`;
- state `cp`: thay `require_photo: false` bằng `photo_rule: 'never' as PhotoRule`; trong `addCheckpoint` thay `require_photo: cp.require_photo` bằng `photo_rule: cp.photo_rule`;
- cột phương thức của bảng điểm thay `{c.allowed_methods.map((m) => METHOD_LABEL[m]).join(', ')}{c.require_photo ? ' · bắt buộc ảnh' : ''}` bằng:
```tsx
                  {c.allowed_methods.map((m) => METHOD_LABEL[m]).join(', ')}
                  {manage ? (
                    <select
                      value={c.photo_rule}
                      onChange={(e) => run(async () => { await api(`/checkpoints/${c.id}`, { method: 'PATCH', json: { photo_rule: e.target.value } }); await load(); })}
                      className="ml-2 rounded border border-slate-300 px-1 text-xs"
                    >
                      {Object.entries(PHOTO_RULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : c.photo_rule !== 'never' ? <span className="ml-1 text-xs text-slate-500">· {PHOTO_RULE[c.photo_rule]}</span> : null}
```
- trong form thêm điểm, thay ô `Bắt buộc chụp ảnh` (dòng `<label ...><input type="checkbox" checked={cp.require_photo} .../> Bắt buộc chụp ảnh</label>`) bằng:
```tsx
            <Field label="Ảnh kèm theo">
              <Select value={cp.photo_rule} onChange={(e) => setCp({ ...cp, photo_rule: e.target.value as PhotoRule })}>
                {Object.entries(PHOTO_RULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
```
- ngay sau `</Card>` của khối "Tuyến tuần tra" (cuối trang, trước `</div>` đóng) thêm `<SitePatrolSchedules siteId={site.id} routes={routes} manage={manage} />`.

- [ ] **Step 4: Build, commit**

Run: `cd web && npm run build` → thành công.

```bash
git add web
git commit -m "feat(web): per-checkpoint photo rule, patrol schedules on the site page, random-photo rate setting"
```

---

### Task 7: Web — bảng vòng tuần, chi tiết vòng, ô Tổng quan

**Files:**
- Create: `web/src/app/(app)/tuan-tra/page.tsx`, `web/src/app/(app)/tuan-tra/[id]/page.tsx`
- Modify: `web/src/components/shell.tsx`, `web/src/app/(app)/page.tsx`

- [ ] **Step 1: Bảng vòng tuần**

`web/src/app/(app)/tuan-tra/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { ROUND_STATUS, time } from '@/lib/format';
import { RoundRow, RoundStatus, SiteRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function PatrolBoardPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [day, setDay] = useState(todayIso());
  const [data, setData] = useState<{ summary: Record<string, number>; rounds: RoundRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (siteId) setData(await api(`/patrol/rounds?site_id=${siteId}&date=${day}`));
  }, [siteId, day]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    const timer = setInterval(() => load().catch(() => undefined), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const tiles: { key: string; label: string; tone?: string }[] = [
    { key: 'completed', label: 'Đủ điểm' },
    { key: 'in_progress', label: 'Đang tuần' },
    { key: 'partial', label: 'Thiếu điểm', tone: 'border-amber-300' },
    { key: 'missed', label: 'Bỏ lỡ', tone: 'border-red-300' },
    { key: 'late', label: 'Bắt đầu trễ' },
    { key: 'suspicious', label: 'Có lần quét nghi vấn', tone: 'border-amber-300' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Tuần tra</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
      </div>
      <ErrorText error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {tiles.map((t) => (
              <div key={t.key} className={`rounded-lg border bg-white p-3 ${data.summary[t.key] ? t.tone ?? 'border-slate-200' : 'border-slate-200'}`}>
                <div className="text-xs text-slate-500">{t.label}</div>
                <div className="text-xl font-semibold">{data.summary[t.key]}<span className="text-sm font-normal text-slate-400"> / {data.summary.total}</span></div>
              </div>
            ))}
          </div>
          <Card>
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-2">Khung giờ</th><th>Tuyến</th><th>Trạng thái</th><th>Người tuần</th><th>Điểm</th><th>Ghi chú</th></tr>
              </thead>
              <tbody>
                {data.rounds.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2"><Link href={`/tuan-tra/${r.id}`} className="text-teal-700 hover:underline">{time(r.expected_start)}–{time(r.expected_end)}</Link></td>
                    <td>{r.route_name} <span className="text-xs text-slate-400">{r.schedule_name}</span></td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs ${ROUND_STATUS[r.status as RoundStatus].tone}`}>{ROUND_STATUS[r.status as RoundStatus].label}</span></td>
                    <td>{r.employee_name ?? '—'}</td>
                    <td>{r.started_at ? `${r.done_required}/${r.required_count}` : '—'}</td>
                    <td className="text-xs">
                      {r.late && <span className="mr-2 text-amber-700">bắt đầu trễ</span>}
                      {r.suspicious_count > 0 && <span className="mr-2 text-red-700">{r.suspicious_count} lần quét nghi vấn</span>}
                      {r.ended_by === 'system' && <span className="text-slate-500">hệ thống tự đóng</span>}
                    </td>
                  </tr>
                ))}
                {!data.rounds.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Không có vòng tuần nào trong ngày — mục tiêu đã có lịch tuần tra chưa?</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Chi tiết vòng**

`web/src/app/(app)/tuan-tra/[id]/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { METHOD_LABEL, ROUND_STATUS, SCAN_FLAG, stamp, time } from '@/lib/format';
import { RoundDetail } from '@/lib/types';

export default function RoundPage() {
  const { id } = useParams<{ id: string }>();
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<RoundDetail>(`/patrol/rounds/${id}`).then(setRound).catch((e) => setError(errorMessage(e))); }, [id]);
  if (!round) return <ErrorText error={error} />;
  const r = round;

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/tuan-tra" className="text-sm text-teal-700 hover:underline">← Bảng tuần tra</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{r.site_name} · {r.route_name} · {time(r.expected_start)}–{time(r.expected_end)}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${ROUND_STATUS[r.status].tone}`}>{ROUND_STATUS[r.status].label}</span>
      </div>
      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Người tuần</dt><dd>{r.employee_name ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Bắt đầu</dt><dd>{stamp(r.started_at)}{r.late && <span className="ml-1 text-amber-700">(trễ)</span>}</dd></div>
          <div><dt className="text-slate-500">Kết thúc</dt><dd>{stamp(r.ended_at)}{r.ended_by === 'system' && <span className="ml-1 text-slate-500">(hệ thống tự đóng)</span>}</dd></div>
          <div><dt className="text-slate-500">Điểm bắt buộc</dt><dd>{r.done_required}/{r.required_count}</dd></div>
        </dl>
      </Card>
      <Card title="Các điểm">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">#</th><th>Điểm</th><th>Xác nhận lúc</th><th>Cách</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {r.stops.map((s) => (
              <tr key={s.checkpoint_id} className={`border-t border-slate-100 ${!s.scanned_at && s.required && r.ended_at ? 'bg-red-50' : ''}`}>
                <td className="py-2 text-slate-400">{s.seq}</td>
                <td>{s.code} · {s.name}{!s.required && <span className="ml-1 text-xs text-slate-400">(không bắt buộc)</span>}{s.photo_required && <span className="ml-1 text-xs text-slate-500">· cần ảnh</span>}</td>
                <td>{s.scanned_at ? time(s.scanned_at) : <span className="text-slate-400">chưa</span>}</td>
                <td>{s.method ? METHOD_LABEL[s.method] : '—'}</td>
                <td className={s.validity === 'suspicious' ? 'text-red-700' : 'text-slate-500'}>{s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Các lần quét">
        <ul className="space-y-3 text-sm">
          {r.scans.map((s) => (
            <li key={s.id} className="flex gap-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              {s.photo_id && (
                <a href={`/api/files/${s.photo_id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${s.photo_id}`} alt={s.checkpoint_name} className="h-20 w-20 rounded border border-slate-200 object-cover" />
                </a>
              )}
              <div>
                <div><b>{s.checkpoint_code} · {s.checkpoint_name}</b> — {METHOD_LABEL[s.method]} lúc {stamp(s.scanned_at)} · {s.employee_name}</div>
                <div className="text-xs text-slate-500">
                  {s.captured_offline ? `quét khi mất sóng, gửi lúc ${stamp(s.server_time)}` : 'gửi ngay'}
                  {s.distance_m !== null && ` · cách điểm ${s.distance_m} m`}
                  {s.accuracy_m !== null && ` · GPS ±${s.accuracy_m} m`}
                  {s.lat && s.lng && <> · <a className="text-teal-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}>bản đồ</a></>}
                </div>
                {s.flags.length > 0 && <div className={`text-xs ${s.validity === 'suspicious' ? 'text-red-700' : 'text-amber-700'}`}>{s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</div>}
              </div>
            </li>
          ))}
          {!r.scans.length && <li className="text-slate-400">Chưa có lần quét nào</li>}
        </ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Menu và ô Tổng quan**

`web/src/components/shell.tsx`, mảng `NAV` thêm sau mục "Chấm công":
```ts
  { href: '/tuan-tra', label: 'Tuần tra', permission: 'patrol.view' },
```

`web/src/app/(app)/page.tsx`:
- import thêm `PatrolToday` từ `@/lib/types`;
- thêm state và nạp:
```tsx
  const [patrol, setPatrol] = useState<PatrolToday[] | null>(null);

  useEffect(() => {
    if (can('patrol.view')) api<PatrolToday[]>('/patrol/today').then(setPatrol).catch(() => undefined);
  }, [can]);
```
- ngay sau khối `{incidents && (...)}` thêm:
```tsx
      {patrol && patrol.length > 0 && (
        <Card title="Tuần tra hôm nay" actions={<Link href="/tuan-tra" className="text-sm text-teal-700 hover:underline">Chi tiết</Link>}>
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-1">Mục tiêu</th><th>Đủ điểm</th><th>Thiếu</th><th>Bỏ lỡ</th><th>Nghi vấn</th></tr></thead>
            <tbody>
              {patrol.map((p) => (
                <tr key={p.site_id} className="border-t border-slate-100">
                  <td className="py-1">{p.site_name}</td>
                  <td>{p.completed}/{p.total}</td>
                  <td className={p.partial ? 'text-amber-700' : ''}>{p.partial}</td>
                  <td className={p.missed ? 'font-medium text-red-700' : ''}>{p.missed}</td>
                  <td className={p.suspicious ? 'text-red-700' : ''}>{p.suspicious}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
```

- [ ] **Step 4: Build, chạy thử, commit**

Run: `cd web && npm run build` → thành công, có `/tuan-tra` và `/tuan-tra/[id]`.

Chạy thử như Plan 05 (backend `npm run start:dev`, web `npm run dev`, qua `:3000`): giám đốc `0900000001` — `GET /api/sites/:toa/patrol-schedules` có 2 lịch; `GET /api/patrol/rounds?site_id=…&date=hôm nay` có vòng; `GET /api/patrol/today` có Toà nhà CT1.

```bash
git add web
git commit -m "feat(web): patrol board with daily summary, round detail with scans and photos, dashboard tile"
```

---

## Self-review (người viết kế hoạch)

- **Phủ spec:** §4.2 `photo_rule` → Task 1, 6; §4.4 lịch/vòng/quét → Task 2–4; M4–M5 → Task 4 (API cho app); M10 offline (thời điểm, gửi lại không nhân đôi, gửi muộn vẫn tính) → Task 4; M11 nhắc vòng → Task 3; §7.0 `round_tolerance_minutes`, `patrol_photo_random_percent` → Task 3–4; §7.2 cờ → Task 4; W (web) → Task 6–7.
- **Không có chỗ trống:** mọi bước có mã và lệnh cụ thể.
- **Khớp tên:** `RoundProgress.settle/deadline/liveStops/view`, `RoundsScheduler.generate/remind/markMissed/closeOverdue/tick`, `PatrolRunService.myRounds/start/scan/finish`, `PatrolReadService.list/get/today` dùng thống nhất.
- **Việc để sau:** bản ghi vi phạm từ vòng (bộ máy vi phạm); app di động (Plan 04b) dùng `GET /me/rounds` + hàng đợi offline; NFC (Giai đoạn 2); selfie đầu vòng.
