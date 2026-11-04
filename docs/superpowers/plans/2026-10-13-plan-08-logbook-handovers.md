# Plan 08 — Sổ trực điện tử và giao ca — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bảo vệ ghi sổ trực ngay tại mục tiêu (ghi chú, khách ra vào, xe ra vào, tài sản, khác; kèm ảnh tuỳ ý; ghi giờ ra cho khách/xe; gửi bù khi mất sóng không nhân đôi); quản lý xem và tìm sổ theo mục tiêu/ngày, biết ai "đang ở trong". Hết ca, người giao điền danh mục bàn giao của mục tiêu; người nhận xác nhận trên tài khoản của mình (đồng ý / không đồng ý kèm lý do); đội trưởng duyệt; có món thiếu, có vấn đề hoặc bị phản đối thì báo đội trưởng + quản lý; người nhận đã vào ca 15 phút mà chưa có biên bản được xác nhận thì báo một lần.

**Architecture:** Khối mới `logbook`: `LogbookService` (ghi, ghi giờ ra, danh sách/tìm, đang ở trong), `HandoversService` (danh mục bàn giao của mục tiêu, nộp, nhận/phản đối, duyệt, danh sách, của tôi), `HandoverWatcher` (vòng quét mỗi phút, `HANDOVER_TICK`). Quyền ghi theo **ca đang có ở mục tiêu** (như tuần tra) hoặc quyền `logbook.manage` cho nhân sự văn phòng.

**Tech Stack:** như trước.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` bản 1.8 — §4.6, §5.1 M8–M9, T6, §5.2 W8. Chủ dự án 13/10/2026: không bắt buộc giấy tờ tuỳ thân, ảnh tuỳ ý; chưa xác nhận giao ca vẫn vào ca, báo quản lý.

**Khác với spec (có chủ đích):**
- Danh mục bàn giao là cột `sites.handover_items` (một danh sách mỗi mục tiêu) thay cho bảng `handover_templates` riêng.
- Biên bản giao ca chưa thành vi phạm; báo qua thông báo. Xuất sổ trực ra file làm cùng Báo cáo.

## Global Constraints

- Mọi quy ước Plan 01–07 giữ nguyên.
- Dòng sổ trực không sửa, không xoá (chỉ ghi giờ ra cho khách/xe một lần).
- Thời điểm: online = giờ máy chủ; gửi bù (`captured_offline`) = giờ máy, không quá giờ máy chủ; cùng `client_uuid` trả kết quả cũ.
- Ảnh: của chính người ghi, chưa gắn vào đâu, tối đa 5.

## Review Focus

1. **Đúng người ghi, đúng người nhận**: chỉ người có ca (hoặc `logbook.manage`) ghi sổ; chỉ người nhận ca xác nhận biên bản — test ở Task 2–3.
2. **Không mất cảnh báo**: món thiếu/phản đối/chưa xác nhận đều báo — test ở Task 3.

---

### Task 1: Schema, quyền, entity

**Files:**
- Create: `backend/src/database/migrations/1761200000000-LogbookHandovers.ts`, `backend/src/logbook/logbook-entry.entity.ts`, `backend/src/logbook/handover.entity.ts`, `backend/src/logbook/logbook.module.ts`
- Modify: `backend/src/access/permissions.ts`, `backend/src/common/errors/error-codes.ts`, `backend/src/files/file.entity.ts`, `backend/src/app.module.ts`, `backend/test/users.e2e-spec.ts`, `backend/test/access.e2e-spec.ts`, `backend/test/test-env.ts`, `backend/.env.example`
- Test: `backend/test/logbook-schema.e2e-spec.ts`

**Interfaces:**
- Produces:
  - Quyền `logbook.view`, `logbook.write`, `logbook.manage`, `handover.review`. Vai trò mẫu: `admin` tất cả; `manager` view + manage + `handover.review`; `team_leader` view + write + `handover.review`; `guard` write; `hr` view + write (HR tạo tài khoản bảo vệ nên phải giữ đủ quyền của bảo vệ).
  - Bảng `logbook_entries`, `handovers`; cột `sites.handover_items jsonb`, `shift_assignments.handover_alerted_at`.
  - `FileOwnerType` thêm `'logbook_entry' | 'handover'`.
  - Mã lỗi: `LOGBOOK_NOT_ON_SHIFT`, `LOGBOOK_FIELD_REQUIRED`, `LOGBOOK_NO_EXIT`, `LOGBOOK_ALREADY_EXITED`, `LOGBOOK_PHOTO_INVALID`, `HANDOVER_NOT_YOURS`, `HANDOVER_TOO_EARLY`, `HANDOVER_RECEIVER_REQUIRED`, `HANDOVER_ITEMS_INCOMPLETE`, `HANDOVER_ALREADY`, `HANDOVER_CLOSED`, `HANDOVER_NOTE_REQUIRED`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/logbook-schema.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTenantWithAdmin, createTestApp } from './helpers';

describe('Logbook — roles (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'lbs');
  });
  afterAll(async () => app.close());

  it('lets guards write, leaders write and review handovers, managers read and manage', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND (rp.permission LIKE 'logbook.%' OR rp.permission LIKE 'handover.%')`,
      [admin.tenant.id],
    );
    const of = (code: string) => rows.filter((r) => r.code === code).map((r) => r.permission).sort();
    expect(of('guard')).toEqual(['logbook.write']);
    expect(of('team_leader')).toEqual(['handover.review', 'logbook.view', 'logbook.write']);
    expect(of('manager')).toEqual(['handover.review', 'logbook.manage', 'logbook.view']);
    expect(of('hr')).toEqual(['logbook.view', 'logbook.write']);
    expect(of('accountant')).toEqual([]);
  });
});
```

`backend/test/users.e2e-spec.ts`: quyền của `scoped_admin` thêm `'logbook.view', 'logbook.manage', 'handover.review'`.
`backend/test/access.e2e-spec.ts`: vai trò `role_editor` thêm `'logbook.write'` (vai trò bảo vệ mẫu giờ có quyền này).
`backend/test/test-env.ts` thêm `process.env.HANDOVER_TICK = 'off';`

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- logbook-schema`
Expected: FAIL.

- [ ] **Step 3: Migration**

`backend/src/database/migrations/1761200000000-LogbookHandovers.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'logbook.view'], ['admin', 'logbook.write'], ['admin', 'logbook.manage'], ['admin', 'handover.review'],
  ['manager', 'logbook.view'], ['manager', 'logbook.manage'], ['manager', 'handover.review'],
  ['team_leader', 'logbook.view'], ['team_leader', 'logbook.write'], ['team_leader', 'handover.review'],
  ['guard', 'logbook.write'],
  ['hr', 'logbook.view'], ['hr', 'logbook.write'],
];

export class LogbookHandovers1761200000000 implements MigrationInterface {
  name = 'LogbookHandovers1761200000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sites ADD COLUMN handover_items jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await q.query(`ALTER TABLE shift_assignments ADD COLUMN handover_alerted_at timestamptz`);
    await q.query(`
      CREATE TABLE logbook_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        assignment_id uuid REFERENCES shift_assignments(id),
        author_user_id uuid NOT NULL REFERENCES users(id),
        author_employee_id uuid REFERENCES employees(id),
        type varchar(20) NOT NULL CHECK (type IN ('note', 'visitor', 'vehicle', 'asset', 'other')),
        body text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL,
        exited_at timestamptz,
        exited_by uuid REFERENCES users(id),
        client_uuid uuid NOT NULL,
        captured_offline boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT logbook_client_uq UNIQUE (tenant_id, client_uuid),
        CONSTRAINT logbook_exit_after CHECK (exited_at IS NULL OR exited_at >= occurred_at)
      )`);
    await q.query(`CREATE INDEX logbook_site_time ON logbook_entries (tenant_id, site_id, occurred_at DESC)`);
    await q.query(`CREATE INDEX logbook_inside ON logbook_entries (site_id) WHERE type IN ('visitor', 'vehicle') AND exited_at IS NULL`);

    await q.query(`
      CREATE TABLE handovers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        from_assignment_id uuid NOT NULL REFERENCES shift_assignments(id),
        from_employee_id uuid NOT NULL REFERENCES employees(id),
        to_assignment_id uuid REFERENCES shift_assignments(id),
        to_employee_id uuid REFERENCES employees(id),
        items jsonb NOT NULL DEFAULT '[]'::jsonb,
        notes text,
        status varchar(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'disputed')),
        submitted_at timestamptz NOT NULL DEFAULT now(),
        receiver_note text,
        answered_at timestamptz,
        reviewed_by uuid REFERENCES users(id),
        reviewed_at timestamptz,
        review_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT handovers_once UNIQUE (from_assignment_id)
      )`);
    await q.query(`CREATE INDEX handovers_site_time ON handovers (tenant_id, site_id, submitted_at DESC)`);
    await q.query(`CREATE INDEX handovers_to ON handovers (to_assignment_id)`);
    for (const [role, permission] of GRANTS) {
      await q.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $2 FROM roles WHERE code = $1 AND is_system AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [role, permission],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'logbook.%' OR permission LIKE 'handover.%'`);
    await q.query(`DROP TABLE IF EXISTS handovers`);
    await q.query(`DROP TABLE IF EXISTS logbook_entries`);
    await q.query(`ALTER TABLE shift_assignments DROP COLUMN IF EXISTS handover_alerted_at`);
    await q.query(`ALTER TABLE sites DROP COLUMN IF EXISTS handover_items`);
  }
}
```

- [ ] **Step 4: Quyền, mã lỗi, entity, module**

`backend/src/access/permissions.ts` — thêm vào `PERMISSIONS` sau `'violation.review'`:
```ts
  'logbook.view': 'Xem sổ trực, biên bản giao ca',
  'logbook.write': 'Ghi sổ trực, giao ca (khi có ca ở mục tiêu)',
  'logbook.manage': 'Ghi sổ trực từ văn phòng, cấu hình danh mục bàn giao',
  'handover.review': 'Duyệt biên bản giao ca',
```
và `ROLE_TEMPLATES`: `manager` + `'logbook.view', 'logbook.manage', 'handover.review'`; `team_leader` + `'logbook.view', 'logbook.write', 'handover.review'`; `guard` + `'logbook.write'`; `hr` + `'logbook.view', 'logbook.write'`.

Thêm vào `ERROR_CODES` (trước `CONFLICT`):
```ts
  LOGBOOK_NOT_ON_SHIFT: { status: 403, message: 'Bạn không có ca ở mục tiêu này lúc này' },
  LOGBOOK_FIELD_REQUIRED: { status: 400, message: 'Thiếu thông tin bắt buộc của dòng sổ' },
  LOGBOOK_NO_EXIT: { status: 400, message: 'Chỉ khách và xe mới ghi giờ ra' },
  LOGBOOK_ALREADY_EXITED: { status: 409, message: 'Đã ghi giờ ra rồi' },
  LOGBOOK_PHOTO_INVALID: { status: 400, message: 'Ảnh không hợp lệ: cần ảnh bạn vừa tải lên, chưa dùng ở đâu' },
  HANDOVER_NOT_YOURS: { status: 403, message: 'Đây không phải ca của bạn' },
  HANDOVER_TOO_EARLY: { status: 400, message: 'Chỉ giao ca trong khoảng 2 giờ quanh giờ kết thúc ca' },
  HANDOVER_RECEIVER_REQUIRED: { status: 400, message: 'Có nhiều người nhận ca — chọn người nhận' },
  HANDOVER_ITEMS_INCOMPLETE: { status: 400, message: 'Cần đánh dấu đủ mọi món trong danh mục bàn giao' },
  HANDOVER_ALREADY: { status: 409, message: 'Ca này đã có biên bản giao ca' },
  HANDOVER_CLOSED: { status: 409, message: 'Biên bản đã được trả lời' },
  HANDOVER_NOTE_REQUIRED: { status: 400, message: 'Cần ghi lý do không đồng ý' },
```

`backend/src/files/file.entity.ts`: `FileOwnerType` thêm `| 'logbook_entry' | 'handover'`.

`backend/src/logbook/logbook-entry.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const LOGBOOK_TYPES = ['note', 'visitor', 'vehicle', 'asset', 'other'] as const;
export type LogbookType = (typeof LOGBOOK_TYPES)[number];

/** One line of the site's book. Never edited — only a visitor's or vehicle's exit time is added, once. */
@Entity('logbook_entries')
export class LogbookEntry extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ type: 'uuid', nullable: true })
  assignment_id: string | null;

  @Column('uuid')
  author_user_id: string;

  @Column({ type: 'uuid', nullable: true })
  author_employee_id: string | null;

  @Column({ type: 'varchar', length: 20 })
  type: LogbookType;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  data: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  exited_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  exited_by: string | null;

  @Column('uuid')
  client_uuid: string;

  @Column({ default: false })
  captured_offline: boolean;
}
```

`backend/src/logbook/handover.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export interface HandoverItem {
  label: string;
  status: 'ok' | 'missing' | 'issue';
  note?: string;
}

/** What one shift hands to the next: the site's checklist, ticked; the receiver answers on their own account. */
@Entity('handovers')
export class Handover extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column('uuid')
  from_assignment_id: string;

  @Column('uuid')
  from_employee_id: string;

  @Column({ type: 'uuid', nullable: true })
  to_assignment_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  to_employee_id: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  items: HandoverItem[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 20, default: 'submitted' })
  status: 'submitted' | 'accepted' | 'disputed';

  @Column({ type: 'timestamptz', default: () => 'now()' })
  submitted_at: Date;

  @Column({ type: 'text', nullable: true })
  receiver_note: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  answered_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;

  @Column({ type: 'text', nullable: true })
  review_note: string | null;
}
```

`backend/src/logbook/logbook.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [],
  controllers: [],
})
export class LogbookModule {}
```

`backend/src/app.module.ts`: import `LogbookModule`, thêm vào cuối `imports`. `backend/.env.example` thêm `# on | off — nhắc giao ca chưa xác nhận.\nHANDOVER_TICK=on`.

- [ ] **Step 5: Chạy toàn bộ, migrate, commit**

Run: `cd backend && npm run test:e2e && npm run migration:run` → PASS.

```bash
git add backend
git commit -m "feat(backend): logbook and handover schema, permissions and roles"
```

---

### Task 2: Sổ trực — ghi, ghi giờ ra, xem, tìm, đang ở trong

**Files:**
- Create: `backend/src/logbook/dto.ts`, `backend/src/logbook/presence.ts`, `backend/src/logbook/logbook.service.ts`, `backend/src/logbook/logbook.controller.ts`
- Modify: `backend/src/logbook/logbook.module.ts`, `backend/src/files/files.service.ts`
- Test: `backend/test/logbook.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `Presence.onShift(m, actor, siteId, at)` → `assignment_id | null`: ca `planned` của người gọi ở mục tiêu, từ 10 phút trước giờ vào tới 30 phút sau giờ ra. `Presence.canWrite(actor, siteId, at)` → `{ assignmentId }` hoặc ném `LOGBOOK_NOT_ON_SHIFT` (có `logbook.manage` + thấy mục tiêu thì được, `assignmentId = null`). `Presence.canRead(actor, siteId)` — `logbook.view` + thấy mục tiêu, hoặc có ca ở mục tiêu trong vòng 12 giờ.
  - `LogbookService.write(actor, siteId, dto)` → dòng sổ; bắt buộc: `note`/`other` có `body`; `visitor` có `visitor_name`; `vehicle` có `plate`; `asset` có `item` và `asset_action`.
  - `.exit(actor, id, { device_time, captured_offline? })` — chỉ `visitor`/`vehicle`, một lần.
  - `.list(actor, siteId, { date, type?, q? })` — trong ngày địa phương, tìm theo nội dung và mọi trường; có tên người ghi, ảnh.
  - `.inside(actor, siteId)` — khách/xe chưa ghi giờ ra (7 ngày gần nhất).
  - Routes: `POST /api/sites/:siteId/logbook` (`logbook.write` hoặc `logbook.manage`, kiểm trong service), `POST /api/logbook/:id/exit`, `GET /api/sites/:siteId/logbook?date&type&q`, `GET /api/sites/:siteId/logbook/inside`.
  - Ảnh dòng sổ (`owner_type = 'logbook_entry'`): người xem được sổ của mục tiêu.

- [ ] **Step 1: Viết test thất bại**

`backend/test/logbook.e2e-spec.ts`:
```ts
import { randomUUID } from 'crypto';
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Logbook (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let g: { token: string; api: ReturnType<typeof client> };
  let idle: { api: ReturnType<typeof client> };
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'lbk');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'LK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'LS', name: 'Toà' }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'LS2', name: 'Kho' }).expect(201)).body.data.id;
    g = await guard(true);
    idle = await guard(false);
  });
  afterAll(async () => app.close());

  async function guard(withShift: boolean) {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `LG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    if (withShift) await api.post('/api/roster', { site_id: ids.site, employee_id: e, start_at: minutes(-60), end_at: minutes(240) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    const token = (await loginOnDevice(app, u.phone, u.password, `lbk-${seq}`)).token!;
    return { token, api: client(app, token) };
  }
  const write = (who: { api: ReturnType<typeof client> }, site: string, body: object) =>
    who.api.post(`/api/sites/${site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), ...body });
  const photo = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', JPEG, 'p.jpg').expect(201)).body.data.id;

  it('keeps a visitor in the book until they leave, with an optional photo', async () => {
    const pic = await photo(g.token);
    const v = (await write(g, ids.site, { type: 'visitor', visitor_name: 'Anh Hùng', visitor_org: 'Điện lực', meet_whom: 'BQL', purpose: 'Kiểm tra công tơ', file_ids: [pic] }).expect(201)).body.data;
    expect(v).toMatchObject({ type: 'visitor', data: { visitor_name: 'Anh Hùng', visitor_org: 'Điện lực', meet_whom: 'BQL', purpose: 'Kiểm tra công tơ' }, exited_at: null, author_name: 'Bảo vệ 1' });
    expect(v.files.map((f: { id: string }) => f.id)).toEqual([pic]);
    const car = (await write(g, ids.site, { type: 'vehicle', plate: '30A-123.45', vehicle_kind: 'Xe tải', cargo: 'Thiết bị điện' }).expect(201)).body.data;
    const inside = (await g.api.get(`/api/sites/${ids.site}/logbook/inside`).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(inside).toEqual(expect.arrayContaining([v.id, car.id]));
    const out = (await g.api.post(`/api/logbook/${v.id}/exit`, { device_time: new Date().toISOString() }).expect(201)).body.data;
    expect(out.exited_at).toBeTruthy();
    expect((await g.api.post(`/api/logbook/${v.id}/exit`, { device_time: new Date().toISOString() }).expect(409)).body.error.code).toBe('LOGBOOK_ALREADY_EXITED');
    expect((await g.api.get(`/api/sites/${ids.site}/logbook/inside`).expect(200)).body.data.map((x: { id: string }) => x.id)).not.toContain(v.id);
    await api.get(`/api/files/${pic}`).expect(200);
  });

  it('asks for what each kind of line needs', async () => {
    expect((await write(g, ids.site, { type: 'note' }).expect(400)).body.error.code).toBe('LOGBOOK_FIELD_REQUIRED');
    await write(g, ids.site, { type: 'visitor' }).expect(400);
    await write(g, ids.site, { type: 'vehicle', cargo: 'x' }).expect(400);
    await write(g, ids.site, { type: 'asset', item: 'Chìa khoá kho' }).expect(400);
    await write(g, ids.site, { type: 'asset', item: 'Chìa khoá kho', quantity: 1, asset_action: 'lent', counterpart: 'Anh Nam kỹ thuật' }).expect(201);
    const note = (await write(g, ids.site, { type: 'note', body: 'Mất điện tầng hầm 10 phút' }).expect(201)).body.data;
    expect((await g.api.post(`/api/logbook/${note.id}/exit`, { device_time: new Date().toISOString() }).expect(400)).body.error.code).toBe('LOGBOOK_NO_EXIT');
  });

  it('lets only people on shift write, or the office with the right to', async () => {
    expect((await write(idle, ids.site, { type: 'note', body: 'x' }).expect(403)).body.error.code).toBe('LOGBOOK_NOT_ON_SHIFT');
    await write(g, ids.site2, { type: 'note', body: 'x' }).expect(403);
    await write({ api }, ids.site2, { type: 'note', body: 'Văn phòng ghi: khách báo đổi giờ giao hàng' }).expect(201);
    const theirs = await photo(idle.token);
    expect((await write(g, ids.site, { type: 'note', body: 'x', file_ids: [theirs] }).expect(400)).body.error.code).toBe('LOGBOOK_PHOTO_INVALID');
  });

  it('answers a resent line with the first one', async () => {
    const body = { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'note', body: 'Gửi lại' };
    const a = (await g.api.post(`/api/sites/${ids.site}/logbook`, body).expect(201)).body.data;
    const b = (await g.api.post(`/api/sites/${ids.site}/logbook`, body).expect(201)).body.data;
    expect(b.id).toBe(a.id);
    await idle.api.post(`/api/sites/${ids.site}/logbook`, body).expect(409);
  });

  it('shows and searches a day of the book to those who may see it', async () => {
    const day = (await api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(200)).body.data;
    expect(day.length).toBeGreaterThanOrEqual(4);
    const found = (await api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}&q=${encodeURIComponent('30A-123')}`).expect(200)).body.data;
    expect(found.map((x: { type: string }) => x.type)).toEqual(['vehicle']);
    expect((await api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}&type=asset`).expect(200)).body.data).toHaveLength(1);
    await g.api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(200);
    await idle.api.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(404);
    const leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [{ scope_type: 'site', scope_id: ids.site2 }])).token);
    await leader.get(`/api/sites/${ids.site}/logbook?date=${todayLocal()}`).expect(404);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- logbook.e2e`
Expected: FAIL — 404 trên `POST /api/sites/:id/logbook`.

- [ ] **Step 3: DTO**

`backend/src/logbook/dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { LOGBOOK_TYPES, LogbookType } from './logbook-entry.entity';

export class LogbookDto {
  @IsUUID()
  client_uuid: string;

  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;

  @IsIn(LOGBOOK_TYPES)
  type: LogbookType;

  @IsOptional() @IsString() @MaxLength(5000)
  body?: string;

  @IsOptional() @IsString() @MaxLength(200)
  visitor_name?: string;

  @IsOptional() @IsString() @MaxLength(200)
  visitor_org?: string;

  @IsOptional() @IsString() @MaxLength(200)
  meet_whom?: string;

  @IsOptional() @IsString() @MaxLength(500)
  purpose?: string;

  @IsOptional() @IsString() @MaxLength(30)
  plate?: string;

  @IsOptional() @IsString() @MaxLength(100)
  vehicle_kind?: string;

  @IsOptional() @IsString() @MaxLength(500)
  cargo?: string;

  @IsOptional() @IsString() @MaxLength(200)
  item?: string;

  @IsOptional() @IsInt() @Min(1)
  quantity?: number;

  @IsOptional() @IsIn(['received', 'handed_out', 'lent', 'returned'])
  asset_action?: 'received' | 'handed_out' | 'lent' | 'returned';

  @IsOptional() @IsString() @MaxLength(200)
  counterpart?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class ExitDto {
  @IsISO8601({ strict: true })
  device_time: string;

  @IsOptional() @IsBoolean()
  captured_offline?: boolean;
}

export class LogbookFilter {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;

  @IsOptional() @IsIn(LOGBOOK_TYPES)
  type?: LogbookType;

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;
}

export class HandoverItemDto {
  @IsString() @MaxLength(200)
  label: string;

  @IsIn(['ok', 'missing', 'issue'])
  status: 'ok' | 'missing' | 'issue';

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class HandoverDto {
  @IsUUID()
  from_assignment_id: string;

  @IsOptional() @IsUUID()
  to_assignment_id?: string;

  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => HandoverItemDto)
  items: HandoverItemDto[];

  @IsOptional() @IsString() @MaxLength(5000)
  notes?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  file_ids?: string[];
}

export class AnswerDto {
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class HandoverItemsDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(200, { each: true })
  items: string[];
}

export class HandoverFilter {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: định dạng YYYY-MM-DD' })
  date: string;
}
```

- [ ] **Step 4: Ai được ghi, ai được xem**

`backend/src/logbook/presence.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';

/** Being at a site is having a planned shift there: from 10 minutes before it starts to 30 minutes after it ends. */
@Injectable()
export class Presence {
  constructor(
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
  ) {}

  async onShift(m: EntityManager, actor: AuthUser, siteId: string, at: Date): Promise<string | null> {
    if (!actor.employee_id) return null;
    const [row] = await m.query(
      `SELECT id FROM shift_assignments
        WHERE tenant_id = $1 AND employee_id = $2 AND site_id = $3 AND status = 'planned'
          AND planned_start - interval '10 minutes' <= $4 AND planned_end + interval '30 minutes' >= $4
        ORDER BY planned_start DESC LIMIT 1`,
      [tenantOf(actor), actor.employee_id, siteId, at],
    );
    return row?.id ?? null;
  }

  /** On shift there (with the right to write), or office staff who manage the book and can see the site. */
  async canWrite(m: EntityManager, actor: AuthUser, siteId: string, at: Date): Promise<{ assignmentId: string | null }> {
    const held = await this.permissions.permissionsOf(actor.id);
    if (held.has('logbook.write')) {
      const assignmentId = await this.onShift(m, actor, siteId, at);
      if (assignmentId) return { assignmentId };
    }
    if (held.has('logbook.manage') && (await this.scopes.canSeeSite(actor, siteId))) return { assignmentId: null };
    throw new BusinessException('LOGBOOK_NOT_ON_SHIFT');
  }

  /** Watching the site, or having worked a shift there in the last 12 hours. */
  async canRead(m: EntityManager, actor: AuthUser, siteId: string): Promise<boolean> {
    if ((await this.permissions.has(actor.id, ['logbook.view'])) && (await this.scopes.canSeeSite(actor, siteId))) return true;
    if (!actor.employee_id) return false;
    const rows = await m.query(
      `SELECT 1 FROM shift_assignments WHERE tenant_id = $1 AND employee_id = $2 AND site_id = $3 AND status = 'planned'
          AND planned_start - interval '10 minutes' <= now() AND planned_end + interval '12 hours' >= now() LIMIT 1`,
      [tenantOf(actor), actor.employee_id, siteId],
    );
    return rows.length > 0;
  }
}
```

- [ ] **Step 5: Service, controller, module, quyền xem ảnh**

`backend/src/logbook/logbook.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { ExitDto, LogbookDto, LogbookFilter } from './dto';
import { LogbookEntry } from './logbook-entry.entity';
import { Presence } from './presence';

const ROWS = `
  SELECT l.id, l.site_id, l.type, l.body, l.data, l.occurred_at, l.exited_at, l.captured_offline, l.created_at,
         COALESCE(ae.full_name, u.full_name) AS author_name, xu.full_name AS exited_by_name,
         COALESCE((SELECT json_agg(json_build_object('id', f.id, 'mime', f.mime) ORDER BY f.created_at)
                     FROM files f WHERE f.owner_type = 'logbook_entry' AND f.owner_id = l.id AND f.deleted_at IS NULL), '[]') AS files
    FROM logbook_entries l
    JOIN users u ON u.id = l.author_user_id
    LEFT JOIN employees ae ON ae.id = l.author_employee_id
    LEFT JOIN users xu ON xu.id = l.exited_by
   WHERE l.tenant_id = $1`;

/** The fields each kind of line keeps, and the one it cannot do without. */
const SHAPES: Record<string, { fields: (keyof LogbookDto)[]; required: (keyof LogbookDto)[] }> = {
  note: { fields: [], required: ['body'] },
  other: { fields: [], required: ['body'] },
  visitor: { fields: ['visitor_name', 'visitor_org', 'meet_whom', 'purpose'], required: ['visitor_name'] },
  vehicle: { fields: ['plate', 'vehicle_kind', 'cargo'], required: ['plate'] },
  asset: { fields: ['item', 'quantity', 'asset_action', 'counterpart'], required: ['item', 'asset_action'] },
};

const when = (deviceTime: string, offline?: boolean) => {
  const server = new Date();
  return offline ? new Date(Math.min(new Date(deviceTime).getTime(), server.getTime())) : server;
};

@Injectable()
export class LogbookService {
  constructor(
    private readonly ds: DataSource,
    private readonly presence: Presence,
    private readonly files: FilesService,
  ) {}

  async write(actor: AuthUser, siteId: string, dto: LogbookDto) {
    const tenantId = tenantOf(actor);
    const replay = await this.replayed(actor, dto.client_uuid);
    if (replay) return this.one(tenantId, replay);
    const shape = SHAPES[dto.type];
    for (const key of shape.required) {
      const value = dto[key];
      if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
        throw new BusinessException('LOGBOOK_FIELD_REQUIRED', [`${key}: bắt buộc với loại này`]);
      }
    }
    const data: Record<string, unknown> = {};
    for (const key of shape.fields) if (dto[key] !== undefined) data[key] = typeof dto[key] === 'string' ? (dto[key] as string).trim() : dto[key];
    const at = when(dto.device_time, dto.captured_offline);
    let id: string;
    try {
      id = await this.ds.transaction(async (m) => {
        const [site] = await m.query(`SELECT id FROM sites WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [siteId, tenantId]);
        if (!site) throw new BusinessException('NOT_FOUND');
        const { assignmentId } = await this.presence.canWrite(m, actor, siteId, at);
        for (const fileId of dto.file_ids ?? []) await this.assertOwnPhoto(m, actor, fileId);
        const saved = await m.save(
          m.create(LogbookEntry, {
            tenant_id: tenantId, site_id: siteId, assignment_id: assignmentId, author_user_id: actor.id, author_employee_id: actor.employee_id,
            type: dto.type, body: dto.body?.trim() || null, data, occurred_at: at, client_uuid: dto.client_uuid,
            captured_offline: Boolean(dto.captured_offline),
          }),
        );
        for (const fileId of dto.file_ids ?? []) await this.files.claim(m, tenantId, fileId, { type: 'logbook_entry', id: saved.id });
        return saved.id;
      });
    } catch (error) {
      // Two copies of one line racing: the loser answers like a resend.
      const duplicate = error instanceof QueryFailedError && (error as QueryFailedError & { constraint?: string }).constraint === 'logbook_client_uq';
      const again = duplicate ? await this.replayed(actor, dto.client_uuid) : null;
      if (!again) throw error;
      id = again;
    }
    return this.one(tenantId, id);
  }

  /** A visitor or vehicle leaving: once, by anyone who may write in this site's book. */
  async exit(actor: AuthUser, id: string, dto: ExitDto) {
    const tenantId = tenantOf(actor);
    const at = when(dto.device_time, dto.captured_offline);
    await this.ds.transaction(async (m) => {
      const [row] = await m.query(`SELECT id, site_id, type, exited_at, occurred_at FROM logbook_entries WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
      if (!row) throw new BusinessException('NOT_FOUND');
      await this.presence.canWrite(m, actor, row.site_id, at);
      if (row.type !== 'visitor' && row.type !== 'vehicle') throw new BusinessException('LOGBOOK_NO_EXIT');
      if (row.exited_at) throw new BusinessException('LOGBOOK_ALREADY_EXITED');
      const exitAt = new Date(Math.max(at.getTime(), new Date(row.occurred_at).getTime()));
      await m.update(LogbookEntry, { id }, { exited_at: exitAt, exited_by: actor.id });
    });
    return this.one(tenantId, id);
  }

  async list(actor: AuthUser, siteId: string, filter: LogbookFilter) {
    const tenantId = tenantOf(actor);
    if (!(await this.presence.canRead(this.ds.manager, actor, siteId))) throw new BusinessException('NOT_FOUND');
    const params: unknown[] = [tenantId, siteId, filter.date];
    let sql = `${ROWS} AND l.site_id = $2
      AND l.occurred_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND l.occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
    if (filter.type) {
      params.push(filter.type);
      sql += ` AND l.type = $${params.length}`;
    }
    if (filter.q?.trim()) {
      params.push(`%${filter.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      sql += ` AND (l.body ILIKE $${params.length} OR l.data::text ILIKE $${params.length})`;
    }
    return this.ds.query(`${sql} ORDER BY l.occurred_at DESC, l.id LIMIT 500`, params);
  }

  /** Visitors and vehicles still in, from the last week. */
  async inside(actor: AuthUser, siteId: string) {
    const tenantId = tenantOf(actor);
    if (!(await this.presence.canRead(this.ds.manager, actor, siteId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `${ROWS} AND l.site_id = $2 AND l.type IN ('visitor', 'vehicle') AND l.exited_at IS NULL AND l.occurred_at > now() - interval '7 days'
        ORDER BY l.occurred_at`,
      [tenantId, siteId],
    );
  }

  private async replayed(actor: AuthUser, clientUuid: string): Promise<string | null> {
    const [prior] = await this.ds.query(`SELECT id, author_user_id FROM logbook_entries WHERE tenant_id = $1 AND client_uuid = $2`, [tenantOf(actor), clientUuid]);
    if (!prior) return null;
    if (prior.author_user_id !== actor.id) throw new BusinessException('CONFLICT');
    return prior.id;
  }

  private async assertOwnPhoto(m: EntityManager, actor: AuthUser, fileId: string): Promise<void> {
    const rows = await m.query(
      `SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
          AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL`,
      [fileId, tenantOf(actor), actor.id],
    );
    if (!rows.length) throw new BusinessException('LOGBOOK_PHOTO_INVALID');
  }

  private async one(tenantId: string, id: string) {
    const [row] = await this.ds.query(`${ROWS} AND l.id = $2`, [tenantId, id]);
    return row;
  }
}
```

`backend/src/logbook/logbook.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { ExitDto, LogbookDto, LogbookFilter } from './dto';
import { LogbookService } from './logbook.service';

/** Who may write or read depends on shifts at the site as much as on permissions; the services decide. */
@Controller()
export class LogbookController {
  constructor(private readonly logbook: LogbookService) {}

  @Post('sites/:siteId/logbook')
  write(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: LogbookDto) {
    return this.logbook.write(user, siteId, dto);
  }

  @Post('logbook/:id/exit')
  exit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExitDto) {
    return this.logbook.exit(user, id, dto);
  }

  @Get('sites/:siteId/logbook/inside')
  inside(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.logbook.inside(user, siteId);
  }

  @Get('sites/:siteId/logbook')
  list(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Query() filter: LogbookFilter) {
    return this.logbook.list(user, siteId, filter);
  }
}
```

`backend/src/logbook/logbook.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { LogbookController } from './logbook.controller';
import { LogbookService } from './logbook.service';
import { Presence } from './presence';

@Module({
  imports: [AccessModule, AuditModule, FilesModule],
  providers: [Presence, LogbookService],
  controllers: [LogbookController],
  exports: [Presence],
})
export class LogbookModule {}
```

`backend/src/files/files.service.ts`, trong `maySee` trước `return false;` cuối:
```ts
    if (file.owner_type === 'logbook_entry' || file.owner_type === 'handover') {
      const table = file.owner_type === 'logbook_entry' ? 'logbook_entries' : 'handovers';
      const [row] = await this.ds.query(`SELECT site_id FROM ${table} WHERE id = $1`, [file.owner_id]);
      if (!row) return false;
      if (file.uploaded_by === actor.id) return true;
      if (await this.permissions.has(actor.id, ['logbook.view'])) return this.scopes.canSeeSite(actor, row.site_id);
      return false;
    }
```

- [ ] **Step 6: Chạy test để thấy đạt, commit**

Run: `cd backend && npm run test:e2e -- logbook`
Expected: PASS — `logbook-schema` 1, `logbook` 5.

```bash
git add backend
git commit -m "feat(backend): site logbook — notes, visitors, vehicles, assets with photos; exits; search; who is inside"
```

---

### Task 3: Giao ca — danh mục, nộp, nhận/phản đối, duyệt, nhắc chưa xác nhận

**Files:**
- Create: `backend/src/logbook/site-people.ts`, `backend/src/logbook/handovers.service.ts`, `backend/src/logbook/handovers.controller.ts`, `backend/src/logbook/handover.watcher.ts`
- Modify: `backend/src/logbook/logbook.module.ts`
- Test: `backend/test/handovers.e2e-spec.ts`

**Interfaces:**
- Consumes: `Presence`, `SitesService.writable`, `NotificationsService.notify`, `FilesService.claim`.
- Produces:
  - `HandoversService.items(actor, siteId)` / `.setItems(actor, siteId, { items: string[] })` — danh mục của mục tiêu (`site.manage` để sửa).
  - `.submit(actor, dto)` — chỉ ca của chính mình, trong 2 giờ quanh giờ kết thúc; đủ mọi món của danh mục; người nhận: ca của người khác ở mục tiêu bắt đầu trong 2 giờ quanh giờ kết thúc ca giao — một người thì tự chọn, nhiều người thì bắt buộc chọn (`HANDOVER_RECEIVER_REQUIRED`, `details` là danh sách lựa chọn), không ai thì để trống. Có món `missing`/`issue` → `handover.problem` cho đội trưởng + quản lý nhóm; người nhận nhận `handover.incoming`.
  - `.answer(actor, id, accept, note?)` — chỉ người nhận; một lần; không đồng ý phải có lý do → `handover.disputed` cho đội trưởng + quản lý.
  - `.review(actor, id, note?)` (`handover.review` + thấy mục tiêu), `.list(actor, siteId, date)`, `.mine(actor)` (biên bản đang chờ mình trả lời).
  - `HandoverWatcher.tick(now)` — người đã vào ca ≥ 15 phút (trong 12 giờ), có người ca trước ở mục tiêu (kết thúc trong 2 giờ quanh giờ vào ca này) mà biên bản của ca trước chưa được đồng ý → `handover.unconfirmed` cho đội trưởng + quản lý nhóm, một lần (`handover_alerted_at`).
  - Routes: `GET|PUT /api/sites/:siteId/handover-items`, `POST /api/handovers`, `POST /api/handovers/:id/accept`, `POST /api/handovers/:id/dispute`, `POST /api/handovers/:id/review` (`handover.review`), `GET /api/sites/:siteId/handovers?date`, `GET /api/me/handovers`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/handovers.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { HandoverWatcher } from '../src/logbook/handover.watcher';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SITE = { lat: 21.028511, lng: 105.776742 };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
type Person = { employee: string; token: string; api: ReturnType<typeof client>; shift: { id: string } };

describe('Handovers (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let leaderUser: string;
  let managerUser: string;
  let leader: ReturnType<typeof client>;
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'hov');
    api = client(app, admin.token);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    managerUser = manager.user.id;
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: managerUser }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.client = (await api.post('/api/clients', { code: 'HK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'HS', name: 'Toà', ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.put(`/api/sites/${ids.site}/handover-items`, { items: ['Chìa khoá kho', 'Bộ đàm'] }).expect(200);
    const lead = (await api.post('/api/employees', { code: 'HL', full_name: 'Đội trưởng' }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: lead }).expect(201);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    const l = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead });
    leaderUser = l.user.id;
    leader = client(app, l.token);
  });
  afterAll(async () => app.close());

  /** Each test works at its own site, so shifts of one test are never candidates in another. */
  async function newSite() {
    seq += 1;
    const site = (await api.post('/api/sites', { client_id: ids.client, code: `HS${seq}`, name: `Toà ${seq}`, ...SITE, geofence_radius_m: 150, responsible_team_id: ids.team }).expect(201)).body.data.id;
    await api.put(`/api/sites/${site}/handover-items`, { items: ['Chìa khoá kho', 'Bộ đàm'] }).expect(200);
    return site as string;
  }
  async function person(start: number, end: number, site = ids.site): Promise<Person> {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `HG${seq}`, full_name: `Bảo vệ ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: employee }).expect(201);
    await api.post('/api/deployments', { employee_id: employee, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    const shift = (await api.post('/api/roster', { site_id: site, employee_id: employee, start_at: minutes(start), end_at: minutes(end) }).expect(201)).body.data;
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee });
    const token = (await loginOnDevice(app, u.phone, u.password, `hov-${seq}`)).token!;
    return { employee, token, api: client(app, token), shift };
  }
  const items = (radio: 'ok' | 'missing') => [{ label: 'Chìa khoá kho', status: 'ok' }, { label: 'Bộ đàm', status: radio, ...(radio === 'missing' ? { note: 'Thiếu 1 cái' } : {}) }];
  const notes = async (userId: string, type: string) =>
    (await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`, [userId, type]))[0].n as number;

  it('passes the checklist to the next guard, who answers on their own account', async () => {
    const out = await person(-480, 30);
    const inn = await person(30, 480);
    const other = await person(-300, 100);
    expect((await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: [{ label: 'Chìa khoá kho', status: 'ok' }] }).expect(400)).body.error.code).toBe('HANDOVER_ITEMS_INCOMPLETE');
    const before = await notes(managerUser, 'handover.problem');
    const h = (await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('missing'), notes: 'Phòng 1205 hẹn 7h lấy hàng' }).expect(201)).body.data;
    expect(h).toMatchObject({ status: 'submitted', to_employee_id: inn.employee, to_assignment_id: inn.shift.id });
    expect(await notes(managerUser, 'handover.problem')).toBe(before + 1);
    expect((await inn.api.get('/api/me/handovers').expect(200)).body.data.map((x: { id: string }) => x.id)).toContain(h.id);
    expect((await other.api.post(`/api/handovers/${h.id}/accept`, {}).expect(403)).body.error.code).toBe('HANDOVER_NOT_YOURS');
    expect((await inn.api.post(`/api/handovers/${h.id}/dispute`, {}).expect(400)).body.error.code).toBe('HANDOVER_NOTE_REQUIRED');
    const disputed = (await inn.api.post(`/api/handovers/${h.id}/dispute`, { note: 'Thiếu cả chìa khoá kho' }).expect(201)).body.data;
    expect(disputed).toMatchObject({ status: 'disputed', receiver_note: 'Thiếu cả chìa khoá kho' });
    expect(await notes(leaderUser, 'handover.disputed')).toBe(1);
    expect((await inn.api.post(`/api/handovers/${h.id}/accept`, {}).expect(409)).body.error.code).toBe('HANDOVER_CLOSED');
    const reviewed = (await leader.post(`/api/handovers/${h.id}/review`, { note: 'Đã kiểm, thiếu chìa khoá thật' }).expect(201)).body.data;
    expect(reviewed.reviewed_by_name).toBeTruthy();
    const day = (await api.get(`/api/sites/${ids.site}/handovers?date=${todayLocal()}`).expect(200)).body.data;
    expect(day.find((x: { id: string }) => x.id === h.id)).toMatchObject({ from_name: 'Bảo vệ 1', to_name: 'Bảo vệ 2', status: 'disputed' });
  });

  it("refuses someone else's shift, a handover hours early, and a second one", async () => {
    const site = await newSite();
    const out = await person(-400, 20, site);
    await person(20, 400, site);
    const early = await person(-200, 400, site);
    expect((await early.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(403)).body.error.code).toBe('HANDOVER_NOT_YOURS');
    expect((await early.api.post('/api/handovers', { from_assignment_id: early.shift.id, items: items('ok') }).expect(400)).body.error.code).toBe('HANDOVER_TOO_EARLY');
    await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(201);
    expect((await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(409)).body.error.code).toBe('HANDOVER_ALREADY');
  });

  it('asks which receiver when two guards take over', async () => {
    const site = await newSite();
    const out = await person(-300, 40, site);
    const a = await person(40, 300, site);
    await person(45, 300, site);
    const res = await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, items: items('ok') }).expect(400);
    expect(res.body.error.code).toBe('HANDOVER_RECEIVER_REQUIRED');
    const h = (await out.api.post('/api/handovers', { from_assignment_id: out.shift.id, to_assignment_id: a.shift.id, items: items('ok') }).expect(201)).body.data;
    expect(h.to_employee_id).toBe(a.employee);
  });

  it('tells the leader and the manager, once, when a guard has been on duty 15 minutes with no accepted handover', async () => {
    const site = await newSite();
    const prev = await person(-480, -20, site);
    const now = await person(-20, 400, site);
    const selfie = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${now.token}`).attach('file', JPEG, 's.jpg').expect(201)).body.data.id;
    await now.api.post('/api/attendance/check-in', { assignment_id: now.shift.id, lat: 21.0286, lng: 105.7768, accuracy_m: 10, device_time: new Date().toISOString(), selfie_file_id: selfie }).expect(201);
    const watcher = app.get(HandoverWatcher);
    const before = await notes(managerUser, 'handover.unconfirmed');
    await watcher.tick(new Date(Date.now() + 5 * 60_000));
    expect(await notes(managerUser, 'handover.unconfirmed')).toBe(before);
    await watcher.tick(new Date(Date.now() + 16 * 60_000));
    await watcher.tick(new Date(Date.now() + 17 * 60_000));
    expect(await notes(managerUser, 'handover.unconfirmed')).toBe(before + 1);
    expect(await notes(leaderUser, 'handover.unconfirmed')).toBeGreaterThanOrEqual(1);
    expect(prev.employee).toBeTruthy();
  });

  it('keeps the checklist editable by site managers only', async () => {
    const g = await person(-60, 300);
    expect((await g.api.get(`/api/sites/${ids.site}/handover-items`).expect(200)).body.data).toEqual(['Chìa khoá kho', 'Bộ đàm']);
    await g.api.put(`/api/sites/${ids.site}/handover-items`, { items: [] }).expect(403);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- handovers`
Expected: FAIL — `Cannot find module '../src/logbook/handover.watcher'`.

- [ ] **Step 3: Người được báo của một mục tiêu**

`backend/src/logbook/site-people.ts`:
```ts
import { DataSource, EntityManager } from 'typeorm';

/** The leader of the team that runs the site, and the manager of its group — who hears about trouble there. */
export async function leaderAndManager(db: DataSource | EntityManager, siteId: string): Promise<string[]> {
  const rows: { id: string }[] = await db.query(
    `SELECT u.id FROM sites s JOIN teams t ON t.id = s.responsible_team_id AND t.deleted_at IS NULL
       JOIN users u ON u.employee_id = t.leader_employee_id AND u.status = 'active' AND u.deleted_at IS NULL
      WHERE s.id = $1
     UNION
     SELECT g.manager_user_id FROM sites s JOIN teams t ON t.id = s.responsible_team_id
       JOIN team_groups g ON g.id = t.team_group_id AND g.deleted_at IS NULL
       JOIN users u ON u.id = g.manager_user_id AND u.status = 'active' AND u.deleted_at IS NULL
      WHERE s.id = $1`,
    [siteId],
  );
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Service, watcher, controller, module**

`backend/src/logbook/handovers.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SitesService } from '../sites/sites.service';
import { HandoverDto, HandoverItemsDto } from './dto';
import { Handover } from './handover.entity';
import { Presence } from './presence';
import { leaderAndManager } from './site-people';

const WINDOW_MS = 2 * 60 * 60_000;

const ROWS = `
  SELECT h.id, h.site_id, s.name AS site_name, h.from_assignment_id, h.from_employee_id, fe.full_name AS from_name,
         h.to_assignment_id, h.to_employee_id, te.full_name AS to_name, h.items, h.notes, h.status, h.submitted_at,
         h.receiver_note, h.answered_at, h.reviewed_at, h.review_note, ru.full_name AS reviewed_by_name,
         COALESCE((SELECT json_agg(f.id ORDER BY f.created_at) FROM files f WHERE f.owner_type = 'handover' AND f.owner_id = h.id AND f.deleted_at IS NULL), '[]') AS file_ids
    FROM handovers h
    JOIN sites s ON s.id = h.site_id
    JOIN employees fe ON fe.id = h.from_employee_id
    LEFT JOIN employees te ON te.id = h.to_employee_id
    LEFT JOIN users ru ON ru.id = h.reviewed_by
   WHERE h.tenant_id = $1`;

@Injectable()
export class HandoversService {
  constructor(
    private readonly ds: DataSource,
    private readonly presence: Presence,
    private readonly scopes: ScopeService,
    private readonly permissions: PermissionService,
    private readonly sites: SitesService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async items(actor: AuthUser, siteId: string): Promise<string[]> {
    if (!(await this.presence.canRead(this.ds.manager, actor, siteId)) && !(await this.scopes.canSeeSite(actor, siteId))) {
      throw new BusinessException('NOT_FOUND');
    }
    const [row] = await this.ds.query(`SELECT handover_items FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantOf(actor)]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return row.handover_items;
  }

  async setItems(actor: AuthUser, siteId: string, dto: HandoverItemsDto): Promise<string[]> {
    await this.sites.writable(actor, siteId);
    const items = [...new Set(dto.items.map((i) => i.trim()).filter(Boolean))];
    await this.ds.query(`UPDATE sites SET handover_items = $2, updated_at = now() WHERE id = $1`, [siteId, JSON.stringify(items)]);
    return items;
  }

  async submit(actor: AuthUser, dto: HandoverDto) {
    const tenantId = tenantOf(actor);
    const id = await this.ds.transaction(async (m) => {
      const [from] = await m.query(
        `SELECT id, site_id, employee_id, planned_end, status FROM shift_assignments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [dto.from_assignment_id, tenantId],
      );
      if (!from || from.status !== 'planned') throw new BusinessException('NOT_FOUND');
      if (!actor.employee_id || from.employee_id !== actor.employee_id) throw new BusinessException('HANDOVER_NOT_YOURS');
      const end = new Date(from.planned_end).getTime();
      if (Math.abs(Date.now() - end) > WINDOW_MS) throw new BusinessException('HANDOVER_TOO_EARLY');
      if ((await m.query(`SELECT 1 FROM handovers WHERE from_assignment_id = $1`, [from.id])).length) throw new BusinessException('HANDOVER_ALREADY');

      const [site] = await m.query(`SELECT name, handover_items FROM sites WHERE id = $1`, [from.site_id]);
      const given = new Set(dto.items.map((i) => i.label.trim()));
      if ((site.handover_items as string[]).some((label) => !given.has(label))) throw new BusinessException('HANDOVER_ITEMS_INCOMPLETE');

      const candidates: { id: string; employee_id: string }[] = await m.query(
        `SELECT id, employee_id FROM shift_assignments
          WHERE site_id = $1 AND status = 'planned' AND employee_id <> $2 AND planned_start BETWEEN $3::timestamptz - interval '2 hours' AND $3::timestamptz + interval '2 hours'
          ORDER BY planned_start`,
        [from.site_id, from.employee_id, from.planned_end],
      );
      let to: { id: string; employee_id: string } | null = null;
      if (dto.to_assignment_id) {
        to = candidates.find((c) => c.id === dto.to_assignment_id) ?? null;
        if (!to) throw new BusinessException('NOT_FOUND');
      } else if (candidates.length === 1) {
        to = candidates[0];
      } else if (candidates.length > 1) {
        throw new BusinessException('HANDOVER_RECEIVER_REQUIRED', candidates.map((c) => c.id));
      }

      for (const fileId of dto.file_ids ?? []) await this.assertOwnPhoto(m, actor, fileId);
      const saved = await m.save(
        m.create(Handover, {
          tenant_id: tenantId, site_id: from.site_id, from_assignment_id: from.id, from_employee_id: from.employee_id,
          to_assignment_id: to?.id ?? null, to_employee_id: to?.employee_id ?? null,
          items: dto.items.map((i) => ({ label: i.label.trim(), status: i.status, ...(i.note?.trim() ? { note: i.note.trim() } : {}) })),
          notes: dto.notes?.trim() || null,
        }),
      );
      for (const fileId of dto.file_ids ?? []) await this.files.claim(m, tenantId, fileId, { type: 'handover', id: saved.id });

      const problems = saved.items.filter((i) => i.status !== 'ok');
      if (problems.length) {
        await this.notifications.notify(tenantId, await leaderAndManager(m, from.site_id), {
          type: 'handover.problem', title: `Giao ca có vấn đề · ${site.name}`,
          body: problems.map((p) => `${p.label}: ${p.status === 'missing' ? 'thiếu' : 'có vấn đề'}${p.note ? ` (${p.note})` : ''}`).join('; '),
          data: { handover_id: saved.id }, priority: 'high', push: true,
        }, m);
      }
      if (to) {
        const receivers: { id: string }[] = await m.query(`SELECT id FROM users WHERE employee_id = $1 AND status = 'active' AND deleted_at IS NULL`, [to.employee_id]);
        await this.notifications.notify(tenantId, receivers.map((r) => r.id), {
          type: 'handover.incoming', title: `Nhận bàn giao ca · ${site.name}`, body: 'Kiểm tra và xác nhận biên bản giao ca',
          data: { handover_id: saved.id }, priority: 'normal', push: true,
        }, m);
      }
      return saved.id;
    });
    return this.one(tenantId, id);
  }

  /** Only the receiver answers, once. Disagreeing needs a reason and alerts the leader and manager. */
  async answer(actor: AuthUser, id: string, accept: boolean, note?: string) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const h = await this.lock(m, tenantId, id);
      if (!actor.employee_id || h.to_employee_id !== actor.employee_id) throw new BusinessException('HANDOVER_NOT_YOURS');
      if (h.status !== 'submitted') throw new BusinessException('HANDOVER_CLOSED');
      const reason = note?.trim() || null;
      if (!accept && !reason) throw new BusinessException('HANDOVER_NOTE_REQUIRED');
      await m.update(Handover, { id }, { status: accept ? 'accepted' : 'disputed', receiver_note: reason, answered_at: new Date() });
      if (!accept) {
        const [site] = await m.query(`SELECT name FROM sites WHERE id = $1`, [h.site_id]);
        await this.notifications.notify(tenantId, await leaderAndManager(m, h.site_id), {
          type: 'handover.disputed', title: `Không đồng ý nhận bàn giao · ${site.name}`, body: reason!,
          data: { handover_id: id }, priority: 'high', push: true,
        }, m);
      }
    });
    return this.one(tenantId, id);
  }

  async review(actor: AuthUser, id: string, note?: string) {
    const tenantId = tenantOf(actor);
    await this.ds.transaction(async (m) => {
      const h = await this.lock(m, tenantId, id);
      if (!(await this.scopes.canSeeSite(actor, h.site_id))) throw new BusinessException('NOT_FOUND');
      await m.update(Handover, { id }, { reviewed_by: actor.id, reviewed_at: new Date(), review_note: note?.trim() || null });
    });
    return this.one(tenantId, id);
  }

  async list(actor: AuthUser, siteId: string, date: string) {
    if (!(await this.presence.canRead(this.ds.manager, actor, siteId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `${ROWS} AND h.site_id = $2
          AND h.submitted_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND h.submitted_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        ORDER BY h.submitted_at DESC`,
      [tenantOf(actor), siteId, date],
    );
  }

  /** Handovers waiting for the caller's answer. */
  async mine(actor: AuthUser) {
    if (!actor.employee_id) return [];
    return this.ds.query(`${ROWS} AND h.to_employee_id = $2 AND h.status = 'submitted' ORDER BY h.submitted_at DESC`, [tenantOf(actor), actor.employee_id]);
  }

  private async lock(m: EntityManager, tenantId: string, id: string): Promise<Handover> {
    const [row] = await m.query(`SELECT id FROM handovers WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return m.findOneByOrFail(Handover, { id });
  }

  private async assertOwnPhoto(m: EntityManager, actor: AuthUser, fileId: string): Promise<void> {
    const rows = await m.query(
      `SELECT 1 FROM files WHERE id = $1 AND tenant_id = $2 AND uploaded_by = $3 AND owner_id IS NULL
          AND mime IN ('image/jpeg', 'image/png') AND deleted_at IS NULL`,
      [fileId, tenantOf(actor), actor.id],
    );
    if (!rows.length) throw new BusinessException('LOGBOOK_PHOTO_INVALID');
  }

  private async one(tenantId: string, id: string) {
    const [row] = await this.ds.query(`${ROWS} AND h.id = $2`, [tenantId, id]);
    return row;
  }
}
```

`backend/src/logbook/handover.watcher.ts`:
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { leaderAndManager } from './site-people';

const TICK_MS = 60_000;

/** A guard 15 minutes into their shift while the shift before theirs has no accepted handover: tell the leader and manager, once. */
@Injectable()
export class HandoverWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Handover');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (getEnv('HANDOVER_TICK', 'on') === 'off') return;
    this.timer = setInterval(() => void this.tick().catch((e: Error) => this.logger.error(`Nhắc giao ca lỗi: ${e.message}`, e.stack)), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    const due: { id: string; tenant_id: string; site_id: string; employee_name: string; site_name: string }[] = await this.ds.query(
      `SELECT x.id, x.tenant_id, x.site_id, e.full_name AS employee_name, s.name AS site_name
         FROM shift_assignments x
         JOIN attendances t ON t.assignment_id = x.id
         JOIN employees e ON e.id = x.employee_id
         JOIN sites s ON s.id = x.site_id
         JOIN clients c ON c.id = s.client_id AND c.management_mode = 'managed'
        WHERE x.status = 'planned' AND x.handover_alerted_at IS NULL
          AND t.check_in_at <= $1::timestamptz - interval '15 minutes' AND t.check_in_at > $1::timestamptz - interval '12 hours'
          AND EXISTS (
                SELECT 1 FROM shift_assignments p
                 WHERE p.site_id = x.site_id AND p.status = 'planned' AND p.employee_id <> x.employee_id AND p.planned_start < x.planned_start
                   AND p.planned_end BETWEEN x.planned_start - interval '2 hours' AND x.planned_start + interval '2 hours'
                   AND NOT EXISTS (SELECT 1 FROM handovers h WHERE h.from_assignment_id = p.id AND h.status = 'accepted'))`,
      [now],
    );
    for (const a of due) {
      const claimed = await this.ds.query(`UPDATE shift_assignments SET handover_alerted_at = $2 WHERE id = $1 AND handover_alerted_at IS NULL RETURNING id`, [a.id, now]);
      const rows = Array.isArray(claimed[0]) ? claimed[0] : claimed;
      if (!rows.length) continue;
      await this.notifications.notify(a.tenant_id, await leaderAndManager(this.ds, a.site_id), {
        type: 'handover.unconfirmed', title: `Chưa nhận bàn giao ca · ${a.site_name}`,
        body: `${a.employee_name} đã vào ca 15 phút nhưng chưa có biên bản giao ca được xác nhận`,
        data: { assignment_id: a.id }, priority: 'high', push: true,
      });
    }
  }
}
```

`backend/src/logbook/handovers.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AnswerDto, HandoverDto, HandoverFilter, HandoverItemsDto } from './dto';
import { HandoversService } from './handovers.service';

@Controller()
export class HandoversController {
  constructor(private readonly handovers: HandoversService) {}

  @Get('sites/:siteId/handover-items')
  items(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.handovers.items(user, siteId);
  }

  @RequirePermission('site.manage')
  @Put('sites/:siteId/handover-items')
  setItems(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: HandoverItemsDto) {
    return this.handovers.setItems(user, siteId, dto);
  }

  @RequirePermission('logbook.write')
  @Post('handovers')
  submit(@CurrentUser() user: AuthUser, @Body() dto: HandoverDto) {
    return this.handovers.submit(user, dto);
  }

  @Post('handovers/:id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    return this.handovers.answer(user, id, true, dto.note);
  }

  @Post('handovers/:id/dispute')
  dispute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    return this.handovers.answer(user, id, false, dto.note);
  }

  @RequirePermission('handover.review')
  @Post('handovers/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    return this.handovers.review(user, id, dto.note);
  }

  @Get('sites/:siteId/handovers')
  list(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Query() filter: HandoverFilter) {
    return this.handovers.list(user, siteId, filter.date);
  }

  @Get('me/handovers')
  mine(@CurrentUser() user: AuthUser) {
    return this.handovers.mine(user);
  }
}
```

`backend/src/logbook/logbook.module.ts`: `imports` thêm `NotificationsModule`, `SitesModule`; `providers` thêm `HandoversService`, `HandoverWatcher`; `controllers` thêm `HandoversController`; `exports` thêm `HandoverWatcher`.

- [ ] **Step 5: Chạy test để thấy đạt, chạy toàn bộ, commit**

Run: `cd backend && npm run test:e2e`
Expected: PASS toàn bộ (gồm `handovers` 5).

```bash
git add backend
git commit -m "feat(backend): shift handovers — site checklist, receiver answers on their own account, leader review, unconfirmed alert"
```

---

### Task 4: Cách ly công ty, dữ liệu demo

**Files:**
- Create: `backend/test/tenancy-08.e2e-spec.ts`
- Modify: `backend/src/scripts/seed-demo.ts`

- [ ] **Step 1: Test cách ly**

`backend/test/tenancy-08.e2e-spec.ts`:
```ts
import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for logbook and handovers (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let apiA: ReturnType<typeof client>;
  const B: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso8-a');
    const b = await createTenantWithAdmin(app, 'iso8-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    const c = (await apiB.post('/api/clients', { code: 'K', name: 'B' }).expect(201)).body.data.id;
    B.site = (await apiB.post('/api/sites', { client_id: c, code: 'S', name: 'B' }).expect(201)).body.data.id;
    B.entry = (await apiB.post(`/api/sites/${B.site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'visitor', visitor_name: 'Khách B' }).expect(201)).body.data.id;
    const e = (await apiB.post('/api/employees', { code: 'E', full_name: 'B' }).expect(201)).body.data.id;
    const [shift] = await ds.query(
      `INSERT INTO shift_assignments (tenant_id, site_id, employee_id, shift_date, planned_start, planned_end)
       VALUES ($1, $2, $3, current_date, now() - interval '8 hours', now()) RETURNING id`,
      [b.tenant.id, B.site, e],
    );
    [{ id: B.handover }] = await ds.query(
      `INSERT INTO handovers (tenant_id, site_id, from_assignment_id, from_employee_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [b.tenant.id, B.site, shift.id, e],
    );
  });
  afterAll(async () => app.close());

  it("answers every read or change of B's book and handovers with 404", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await apiA.get(`/api/sites/${B.site}/logbook?date=${today}`).expect(404);
    await apiA.get(`/api/sites/${B.site}/logbook/inside`).expect(404);
    await apiA.post(`/api/sites/${B.site}/logbook`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), type: 'note', body: 'x' }).expect(404);
    await apiA.post(`/api/logbook/${B.entry}/exit`, { device_time: new Date().toISOString() }).expect(404);
    await apiA.get(`/api/sites/${B.site}/handover-items`).expect(404);
    await apiA.put(`/api/sites/${B.site}/handover-items`, { items: ['x'] }).expect(404);
    await apiA.get(`/api/sites/${B.site}/handovers?date=${today}`).expect(404);
    await apiA.post(`/api/handovers/${B.handover}/review`, {}).expect(404);
    await apiA.post(`/api/handovers/${B.handover}/accept`, {}).expect(404);
  });
});
```

Run: `cd backend && npm run test:e2e -- tenancy-08` → PASS (1).

- [ ] **Step 2: Dữ liệu demo**

Trong `backend/src/scripts/seed-demo.ts`: import `HandoversService` từ `../logbook/handovers.service` và `LogbookService` từ `../logbook/logbook.service`, `randomUUID` từ `crypto`; trước dòng `// The demo week was rostered ahead of time` thêm:
```ts
  await app.get(HandoversService).setItems(actor, toa.id, { items: ['Chìa khoá kho (3 chiếc)', 'Bộ đàm (2 cái)', 'Sổ khách', 'Camera hoạt động bình thường', 'Cửa cuốn tầng hầm đã khoá'] });
  const logbookSvc = app.get(LogbookService);
  const now = () => new Date().toISOString();
  await logbookSvc.write(actor, toa.id, { client_uuid: randomUUID(), device_time: now(), type: 'note', body: 'Văn phòng: BQL báo cắt nước 14h–16h để bảo trì bể ngầm' });
  await logbookSvc.write(actor, toa.id, { client_uuid: randomUUID(), device_time: now(), type: 'visitor', visitor_name: 'Anh Hùng', visitor_org: 'Điện lực Cầu Giấy', meet_whom: 'BQL toà nhà', purpose: 'Kiểm tra công tơ' });
  await logbookSvc.write(actor, toa.id, { client_uuid: randomUUID(), device_time: now(), type: 'vehicle', plate: '29C-456.78', vehicle_kind: 'Xe tải nhỏ', cargo: 'Nước uống giao siêu thị' });
```

Run: reset DB dev rồi `npm run seed:demo` → không lỗi.

- [ ] **Step 3: Chạy toàn bộ, commit**

Run: `cd backend && npm test && npm run test:e2e && npm run build` → PASS.

```bash
git add backend
git commit -m "test(backend): isolation suite for logbook and handovers; demo checklist and logbook lines"
```

---

### Task 5: Web — trang Sổ trực & giao ca, danh mục bàn giao trên trang mục tiêu

**Files:**
- Create: `web/src/app/(app)/so-truc/page.tsx`, `web/src/components/site-handover-items.tsx`
- Modify: `web/src/lib/types.ts`, `web/src/lib/format.ts`, `web/src/components/shell.tsx`, `web/src/app/(app)/muc-tieu/[id]/page.tsx`

- [ ] **Step 1: Kiểu và nhãn**

Cuối `web/src/lib/types.ts`:
```ts
export type LogbookType = 'note' | 'visitor' | 'vehicle' | 'asset' | 'other';

export interface LogbookRow {
  id: string;
  site_id: string;
  type: LogbookType;
  body: string | null;
  data: {
    visitor_name?: string; visitor_org?: string; meet_whom?: string; purpose?: string;
    plate?: string; vehicle_kind?: string; cargo?: string;
    item?: string; quantity?: number; asset_action?: 'received' | 'handed_out' | 'lent' | 'returned'; counterpart?: string;
  };
  occurred_at: string;
  exited_at: string | null;
  captured_offline: boolean;
  author_name: string;
  exited_by_name: string | null;
  files: { id: string; mime: string }[];
}

export interface HandoverRow {
  id: string;
  site_id: string;
  from_name: string;
  to_name: string | null;
  to_employee_id: string | null;
  items: { label: string; status: 'ok' | 'missing' | 'issue'; note?: string }[];
  notes: string | null;
  status: 'submitted' | 'accepted' | 'disputed';
  submitted_at: string;
  receiver_note: string | null;
  answered_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  reviewed_by_name: string | null;
  file_ids: string[];
}
```

Cuối `web/src/lib/format.ts` (thêm `LogbookRow, LogbookType` vào dòng `import type`):
```ts
export const LOGBOOK_TYPE: Record<LogbookType, string> = {
  note: 'Ghi chú',
  visitor: 'Khách ra vào',
  vehicle: 'Xe ra vào',
  asset: 'Tài sản',
  other: 'Khác',
};

const ASSET_ACTION: Record<string, string> = { received: 'nhận', handed_out: 'giao', lent: 'cho mượn', returned: 'trả lại' };

/** One line of the book in plain words. */
export function logbookText(l: LogbookRow): string {
  const d = l.data;
  if (l.type === 'visitor') return [d.visitor_name, d.visitor_org && `(${d.visitor_org})`, d.meet_whom && `gặp ${d.meet_whom}`, d.purpose && `— ${d.purpose}`].filter(Boolean).join(' ');
  if (l.type === 'vehicle') return [d.plate, d.vehicle_kind && `· ${d.vehicle_kind}`, d.cargo && `— ${d.cargo}`].filter(Boolean).join(' ');
  if (l.type === 'asset') return `${ASSET_ACTION[d.asset_action ?? ''] ?? ''} ${d.quantity ?? ''} ${d.item ?? ''}${d.counterpart ? ` — ${d.counterpart}` : ''}`.replace(/\s+/g, ' ').trim();
  return l.body ?? '';
}

export const HANDOVER_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: 'Chờ người nhận xác nhận', tone: 'bg-amber-100 text-amber-800' },
  accepted: { label: 'Người nhận đồng ý', tone: 'bg-teal-100 text-teal-800' },
  disputed: { label: 'Người nhận không đồng ý', tone: 'bg-red-100 text-red-700' },
};
```

`web/src/components/shell.tsx`, `NAV` thêm sau "Vi phạm":
```ts
  { href: '/so-truc', label: 'Sổ trực & giao ca', permission: 'logbook.view' },
```

- [ ] **Step 2: Trang Sổ trực & giao ca**

`web/src/app/(app)/so-truc/page.tsx`:
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { HANDOVER_STATUS, LOGBOOK_TYPE, logbookText, stamp, time } from '@/lib/format';
import { HandoverRow, LogbookRow, SiteRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function LogbookPage() {
  const { can } = useAuth();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [day, setDay] = useState(todayIso());
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LogbookRow[]>([]);
  const [inside, setInside] = useState<LogbookRow[]>([]);
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    const query = new URLSearchParams({ date: day, ...(type ? { type } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
    const [book, in_, hand] = await Promise.all([
      api<LogbookRow[]>(`/sites/${siteId}/logbook?${query}`),
      api<LogbookRow[]>(`/sites/${siteId}/logbook/inside`),
      api<HandoverRow[]>(`/sites/${siteId}/handovers?date=${day}`),
    ]);
    setRows(book);
    setInside(in_);
    setHandovers(hand);
  }, [siteId, day, type, q]);

  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/sites/${siteId}/logbook`, { method: 'POST', json: { client_uuid: crypto.randomUUID(), device_time: new Date().toISOString(), type: 'note', body: note } });
      setNote('');
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Sổ trực & giao ca</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
      </div>
      <ErrorText error={error} />

      {inside.length > 0 && (
        <Card title={`Đang ở trong (${inside.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {inside.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-1.5">
                <span><b>{LOGBOOK_TYPE[l.type]}</b> · {logbookText(l)} <span className="text-slate-400">vào {stamp(l.occurred_at)}</span></span>
                {can('logbook.manage') && (
                  <Button variant="secondary" onClick={() => run(() => api(`/logbook/${l.id}/exit`, { method: 'POST', json: { device_time: new Date().toISOString() } }))}>Ghi giờ ra</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Sổ trực">
        <div className="mb-3 flex flex-wrap gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-44">
            <option value="">Mọi loại</option>
            {Object.entries(LOGBOOK_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm: biển số, tên khách, nội dung…" className="w-72" />
        </div>
        {can('logbook.manage') && (
          <form onSubmit={addNote} className="mb-3 flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú từ văn phòng…" required />
            <Button type="submit">Ghi</Button>
          </form>
        )}
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((l) => (
            <li key={l.id} className="flex gap-3 py-2">
              <span className="w-12 shrink-0 text-slate-500">{time(l.occurred_at)}</span>
              <div className="flex-1">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{LOGBOOK_TYPE[l.type]}</span>
                {logbookText(l)}
                {l.exited_at && <span className="ml-2 text-xs text-slate-500">ra {time(l.exited_at)}</span>}
                <div className="text-xs text-slate-400">{l.author_name}{l.captured_offline ? ' · gửi bù khi mất sóng' : ''}</div>
                {l.files.length > 0 && (
                  <div className="mt-1 flex gap-1">
                    {l.files.map((f) => (
                      <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${f.id}`} alt="" className="h-14 w-14 rounded border border-slate-200 object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
          {!rows.length && <li className="py-6 text-center text-slate-400">Chưa có dòng nào trong ngày</li>}
        </ul>
      </Card>

      <Card title="Giao ca trong ngày">
        <ul className="space-y-3 text-sm">
          {handovers.map((h) => (
            <li key={h.id} className="rounded border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{h.from_name}</b> → <b>{h.to_name ?? 'chưa rõ người nhận'}</b>
                <span className="text-slate-400">{stamp(h.submitted_at)}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${HANDOVER_STATUS[h.status].tone}`}>{HANDOVER_STATUS[h.status].label}</span>
                {h.reviewed_at && <span className="text-xs text-teal-700">Đã duyệt · {h.reviewed_by_name}</span>}
              </div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {h.items.map((i) => (
                  <li key={i.label} className={i.status === 'ok' ? 'text-slate-600' : 'font-medium text-red-700'}>
                    {i.status === 'ok' ? '✓' : '✗'} {i.label}{i.status !== 'ok' && ` — ${i.status === 'missing' ? 'thiếu' : 'có vấn đề'}`}{i.note ? `: ${i.note}` : ''}
                  </li>
                ))}
              </ul>
              {h.notes && <p className="mt-1 text-slate-600">Ghi chú: {h.notes}</p>}
              {h.receiver_note && <p className="mt-1 text-red-700">Người nhận: {h.receiver_note}</p>}
              {h.review_note && <p className="mt-1 text-slate-600">Đội trưởng: {h.review_note}</p>}
              {can('handover.review') && !h.reviewed_at && (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => {
                    const text = window.prompt('Nhận xét khi duyệt (không bắt buộc):');
                    if (text !== null) void run(() => api(`/handovers/${h.id}/review`, { method: 'POST', json: text.trim() ? { note: text.trim() } : {} }));
                  }}
                >
                  Duyệt biên bản
                </Button>
              )}
            </li>
          ))}
          {!handovers.length && <li className="text-slate-400">Chưa có biên bản giao ca nào trong ngày</li>}
        </ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Danh mục bàn giao trên trang mục tiêu**

`web/src/components/site-handover-items.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';

/** What one shift hands to the next at this site; guards tick each line when they hand over. */
export function SiteHandoverItems({ siteId, manage }: { siteId: string; manage: boolean }) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setItems(await api<string[]>(`/sites/${siteId}/handover-items`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function save(next: string[]) {
    setError(null);
    try {
      setItems(await api<string[]>(`/sites/${siteId}/handover-items`, { method: 'PUT', json: { items: next } }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Danh mục bàn giao ca">
      <ul className="mb-2 flex flex-wrap gap-2 text-sm">
        {items.map((i) => (
          <li key={i} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
            {i}
            {manage && <button onClick={() => save(items.filter((x) => x !== i))} className="text-slate-400 hover:text-red-600">×</button>}
          </li>
        ))}
        {!items.length && <li className="text-slate-400">Chưa có — bảo vệ chỉ ghi chú khi giao ca</li>}
      </ul>
      {manage && (
        <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void save([...items, draft.trim()]); setDraft(''); } }} className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="VD: Chìa khoá kho (3 chiếc)" />
          <Button type="submit">Thêm</Button>
        </form>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
```

Trong `web/src/app/(app)/muc-tieu/[id]/page.tsx`: import `SiteHandoverItems` từ `@/components/site-handover-items`; ngay sau `<SitePatrolSchedules ... />` thêm `<SiteHandoverItems siteId={site.id} manage={manage} />`.

- [ ] **Step 4: Build, chạy thử, commit**

Run: `cd web && npm run build` → thành công, có `/so-truc`.

Chạy thử qua `:3000` (giám đốc demo): `GET /api/sites/:toa/logbook?date=hôm nay` có 3 dòng; `/logbook/inside` có khách và xe; `GET /api/sites/:toa/handover-items` có 5 món; trang `/so-truc` 200.

```bash
git add web
git commit -m "feat(web): logbook and handover page, site handover checklist"
```

---

## Self-review (người viết kế hoạch)

- **Phủ spec:** §4.6 sổ trực (5 loại, ảnh tuỳ ý, giờ ra, không sửa/xoá, ai ghi/xem) → Task 2; giao ca (danh mục, người nhận, xác nhận trên tài khoản mình, phản đối có lý do, đội trưởng duyệt, báo khi có vấn đề, báo khi chưa xác nhận 15 phút) → Task 3; M8–M9 (API cho app, offline idempotent) → Task 2–3; T6, W8 → Task 5.
- **Không có chỗ trống:** mọi bước có mã và lệnh cụ thể.
- **Khớp tên:** `Presence.onShift/canWrite/canRead`, `LogbookService.write/exit/list/inside`, `HandoversService.items/setItems/submit/answer/review/list/mine`, `HandoverWatcher.tick`, `leaderAndManager` dùng thống nhất.
- **Việc để sau:** xuất sổ trực ra file (Báo cáo); khách hàng xem sổ (Giai đoạn 2); biên bản giao ca thành vi phạm (nếu chủ dự án muốn).
