# Plan 03 — Mục tiêu, chốt gác, điểm tuần tra, tuyến, tem QR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Với mỗi khách công ty quản lý, khai báo được các mục tiêu (toà nhà, kho…), chốt gác, điểm tuần tra (phương thức QR/GPS/ảnh, toạ độ, bán kính), tuyến tuần tra có thứ tự, và in tem QR có chữ ký để dán tại điểm — nền cho ca trực, chấm công và tuần tra ở Plan 04–05.

**Architecture:** Module `sites` trong backend gồm ba service (`SitesService`, `CheckpointsService`, `RoutesService`) chia chung quy tắc "được ghi khi thấy mục tiêu". Phạm vi mục tiêu suy từ phạm vi khách (Plan 02), phạm vi `site`, và đội phụ trách mục tiêu. Mã QR = `PTR1.<checkpoint_id>.<HMAC>` với bí mật riêng từng điểm: không tự tạo được mã giả; in lại tem = đổi bí mật, tem cũ hết hiệu lực. Trang in tem nằm ngoài vỏ ứng dụng để in sạch.

**Tech Stack:** như Plan 01–02. Web thêm `qrcode` (vẽ SVG phía trình duyệt).

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` — §4.2 (`sites`, `posts`, `checkpoints`, `routes`, `route_checkpoints`), §5.2 W2–W4 (phần mục tiêu, điểm, tuyến, in tem), §7.3 (QR có chữ ký), §9 bước 3 (nửa đầu). Ca trực, chấm công, thiết bị và app di động là **Plan 04**.

**Khác với spec (có chủ đích):**
- Spec để "in tem QR (PDF A4)". Ở đây là trang in HTML (trình duyệt → In → Lưu PDF): không thêm thư viện PDF phía server, kết quả như nhau.
- Khách `self_managed` không có mục tiêu ở Giai đoạn 1 (§3.3a) → tạo mục tiêu cho khách này bị từ chối.

## Global Constraints

- Mọi quy ước Plan 01–02 giữ nguyên.
- Toạ độ `numeric(9,6)`, nhận vào là số, trả ra là chuỗi; bán kính mét, số nguyên.
- `qr_secret` **không bao giờ** rời backend qua API; chỉ payload đã ký được trả cho trang in tem (cần `site.manage`).
- Quyền mới `site.view`, `site.manage` thêm cho vai trò hệ thống của cả công ty đã có (migration).

## Review Focus

1. **Tem QR giả hoặc cũ**: payload sửa một ký tự, payload của điểm thuộc công ty khác, tem in trước khi đổi bí mật → không nhận — test ở Task 2.
2. **Tuyến lẫn điểm**: thêm điểm của mục tiêu khác (cùng hoặc khác công ty), một điểm hai lần, tuyến rỗng → từ chối — test ở Task 3.
3. **Phạm vi**: đội trưởng thấy mục tiêu đội mình phụ trách nhưng không sửa được; quản lý chỉ cấu hình mục tiêu của khách mình thấy — test ở Task 1.
4. **Điểm GPS không toạ độ**: chọn phương thức GPS mà không nhập toạ độ → từ chối, kể cả khi sửa sau — test ở Task 2.
5. **Khách tự quản lý**: không tạo được mục tiêu — test ở Task 1.

---

### Task 1: Schema, quyền, phạm vi mục tiêu, API mục tiêu và chốt gác

**Files:**
- Create: `backend/src/database/migrations/1760500000000-SitesCheckpointsRoutes.ts`
- Create: `backend/src/sites/site.entity.ts` (Site, Post), `backend/src/sites/checkpoint.entity.ts`, `backend/src/sites/route.entity.ts` (Route, RouteCheckpoint)
- Create: `backend/src/sites/dto.ts`, `backend/src/sites/sites.service.ts`, `backend/src/sites/sites.controller.ts`, `backend/src/sites/sites.module.ts`
- Modify: `backend/src/access/permissions.ts`, `backend/src/access/scope.service.ts`, `backend/src/access/access.service.ts`, `backend/src/users/dto.ts`, `backend/src/common/errors/error-codes.ts`, `backend/src/app.module.ts`, `backend/test/users.e2e-spec.ts`
- Test: `backend/test/sites.e2e-spec.ts`

**Interfaces:**
- Consumes: `ScopeService.clientVisibility/teamVisibility/canSeeClient`, `ClientsService.getForWrite`, `TenantRepository`, `AuditService`.
- Produces:
  - Quyền `site.view`, `site.manage`. Vai trò mẫu: `manager` + `site.view`, `site.manage`; `team_leader`, `hr`, `accountant` + `site.view`.
  - `type SiteVisibility = { all: true } | { all: false; siteIds: string[] }`; `ScopeService.siteVisibility(user)`, `.canSeeSite(user, siteId)`. Thấy mục tiêu khi: phạm vi toàn công ty; hoặc thấy khách của nó; hoặc có phạm vi `site`; hoặc đội phụ trách mục tiêu nằm trong các đội mình thấy.
  - `AccessService.assertCanGrant` nhận `scope_type: 'site'` (chỉ người có phạm vi toàn công ty).
  - `SitesService.list(actor, { client_id? })`, `.get(actor, id)` → `SiteDetail`, `.create`, `.update`, `.addPost`, `.updatePost`, `.removePost`, `.writable(actor, siteId, m?)` → `Site` (404 nếu không thấy).
  - `interface SiteRow { id; client_id; client_name; code; name; address; lat; lng; geofence_radius_m; responsible_team_id; responsible_team_name; status; note; checkpoint_count; route_count }`; `SiteDetail extends SiteRow { posts: { id; name; note }[] }`.
  - Routes: `GET /api/sites?client_id`, `GET /api/sites/:id`, `POST /api/sites`, `PATCH /api/sites/:id`, `POST /api/sites/:id/posts`, `PATCH|DELETE /api/posts/:id`.
  - Mã lỗi: `SITE_CODE_TAKEN`, `SITE_CLIENT_SELF_MANAGED`, `CHECKPOINT_CODE_TAKEN`, `CHECKPOINT_GPS_NEEDS_LOCATION`, `ROUTE_EMPTY`, `ROUTE_DUPLICATE_CHECKPOINT`, `ROUTE_FOREIGN_CHECKPOINT`, `QR_INVALID`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/sites.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Sites (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'site');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newClient = async (extra: object = {}) =>
    (await api.post('/api/clients', { code: `SK${++seq}`, name: `Khách ${seq}`, ...extra }).expect(201)).body.data;
  const newSite = async (clientId: string, extra: object = {}) =>
    (await api.post('/api/sites', { client_id: clientId, code: `MT${++seq}`, name: `Mục tiêu ${seq}`, ...extra }).expect(201)).body.data;

  it('gives every system role of existing companies the new permissions', async () => {
    const rows: { code: string; permission: string }[] = await ds.query(
      `SELECT r.code, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND rp.permission LIKE 'site.%' ORDER BY r.code, rp.permission`,
      [admin.tenant.id],
    );
    expect(rows.filter((r) => r.code === 'manager').map((r) => r.permission)).toEqual(['site.manage', 'site.view']);
    expect(rows.filter((r) => r.code === 'team_leader').map((r) => r.permission)).toEqual(['site.view']);
    expect(rows.filter((r) => r.code === 'guard')).toEqual([]);
  });

  it('creates a site with coordinates, a geofence and posts', async () => {
    const c = await newClient();
    const site = await newSite(c.id, { address: '1 Mễ Trì', lat: 21.012345, lng: 105.78, geofence_radius_m: 200 });
    expect(site).toMatchObject({ client_name: c.name, lat: '21.012345', lng: '105.780000', geofence_radius_m: 200, posts: [] });
    await api.post(`/api/sites/${site.id}/posts`, { name: 'Cổng chính' }).expect(201);
    const post = (await api.post(`/api/sites/${site.id}/posts`, { name: 'Cổng sau' }).expect(201)).body.data;
    await api.delete(`/api/posts/${post.id}`).expect(200);
    const detail = (await api.get(`/api/sites/${site.id}`).expect(200)).body.data;
    expect(detail.posts.map((p: { name: string }) => p.name)).toEqual(['Cổng chính']);
    expect((await api.post('/api/sites', { client_id: c.id, code: site.code.toLowerCase(), name: 'Trùng' }).expect(409)).body.error.code).toBe('SITE_CODE_TAKEN');
  });

  it('refuses sites for clients who run their own operations', async () => {
    const c = await newClient({ management_mode: 'self_managed' });
    const res = await api.post('/api/sites', { client_id: c.id, code: 'SELF', name: 'X' }).expect(400);
    expect(res.body.error.code).toBe('SITE_CLIENT_SELF_MANAGED');
  });

  it('shows a team leader the sites their team looks after, read-only', async () => {
    const team = (await api.post('/api/org/teams', { name: `Đội ${++seq}` }).expect(201)).body.data;
    const lead = (await api.post('/api/employees', { code: `L${++seq}`, full_name: 'Đội trưởng' }).expect(201)).body.data;
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: lead.id }).expect(201);
    await api.put(`/api/org/teams/${team.id}/leader`, { employee_id: lead.id }).expect(200);
    const c = await newClient();
    const mine = await newSite(c.id, { responsible_team_id: team.id });
    const other = await newSite(c.id);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    const asLeader = client(app, leader.token);

    const list = (await asLeader.get('/api/sites').expect(200)).body.data;
    expect(list.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    expect(list[0].responsible_team_name).toBe(team.name);
    await asLeader.get(`/api/sites/${other.id}`).expect(404);
    await asLeader.patch(`/api/sites/${mine.id}`, { name: 'Đổi' }).expect(403);
  });

  it('lets an account manager configure only the sites of their clients', async () => {
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    const theirs = await newClient({ account_manager_id: manager.user.id });
    const notTheirs = await newClient();
    const asManager = client(app, manager.token);
    const site = (await asManager.post('/api/sites', { client_id: theirs.id, code: `AM${++seq}`, name: 'Của tôi' }).expect(201)).body.data;
    await asManager.patch(`/api/sites/${site.id}`, { geofence_radius_m: 120 }).expect(200);
    await asManager.post('/api/sites', { client_id: notTheirs.id, code: `NO${++seq}`, name: 'Không' }).expect(404);
  });

  it('refuses a responsible team from outside the company and out-of-range values', async () => {
    const c = await newClient();
    await api.post('/api/sites', { client_id: c.id, code: `BAD${++seq}`, name: 'X', responsible_team_id: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await api.post('/api/sites', { client_id: c.id, code: `BAD${++seq}`, name: 'X', lat: 95, lng: 105 }).expect(400);
    await api.post('/api/sites', { client_id: c.id, code: `BAD${++seq}`, name: 'X', geofence_radius_m: 5 }).expect(400);
  });
});
```

Trong `backend/test/users.e2e-spec.ts`, vai trò `scoped_admin` phải giữ mọi quyền của vai trò `manager` (vì vai trò này vừa có thêm quyền): đổi danh sách quyền thành
`['user.view', 'user.manage', 'org.view', 'org.member.manage', 'employee.view', 'client.view', 'deployment.view', 'site.view', 'site.manage']`.

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- sites`
Expected: FAIL — không có quyền `site.%`; `POST /api/sites` 404.

- [ ] **Step 3: Viết migration và entity**

`backend/src/database/migrations/1760500000000-SitesCheckpointsRoutes.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const GRANTS: [string, string][] = [
  ['admin', 'site.view'], ['admin', 'site.manage'],
  ['manager', 'site.view'], ['manager', 'site.manage'],
  ['team_leader', 'site.view'], ['hr', 'site.view'], ['accountant', 'site.view'],
];

export class SitesCheckpointsRoutes1760500000000 implements MigrationInterface {
  name = 'SitesCheckpointsRoutes1760500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE sites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        client_id uuid NOT NULL REFERENCES clients(id),
        code varchar(30) NOT NULL,
        name varchar(200) NOT NULL,
        address varchar(300),
        lat numeric(9, 6) CHECK (lat BETWEEN -90 AND 90),
        lng numeric(9, 6) CHECK (lng BETWEEN -180 AND 180),
        geofence_radius_m integer NOT NULL DEFAULT 150 CHECK (geofence_radius_m BETWEEN 20 AND 2000),
        responsible_team_id uuid REFERENCES teams(id),
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT sites_coordinates_pair CHECK ((lat IS NULL) = (lng IS NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX sites_tenant_code_uq ON sites (tenant_id, lower(code)) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX sites_client_idx ON sites (client_id)`);

    await q.query(`
      CREATE TABLE posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        name varchar(100) NOT NULL,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);

    await q.query(`
      CREATE TABLE checkpoints (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        code varchar(30) NOT NULL,
        name varchar(200) NOT NULL,
        lat numeric(9, 6) CHECK (lat BETWEEN -90 AND 90),
        lng numeric(9, 6) CHECK (lng BETWEEN -180 AND 180),
        radius_m integer NOT NULL DEFAULT 30 CHECK (radius_m BETWEEN 5 AND 500),
        allowed_methods text[] NOT NULL DEFAULT '{qr}',
        qr_secret varchar(64) NOT NULL,
        require_photo boolean NOT NULL DEFAULT false,
        instructions text,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT checkpoints_methods CHECK (cardinality(allowed_methods) > 0 AND allowed_methods <@ ARRAY['qr', 'gps', 'photo', 'nfc']),
        CONSTRAINT checkpoints_coordinates_pair CHECK ((lat IS NULL) = (lng IS NULL)),
        CONSTRAINT checkpoints_gps_needs_location CHECK (NOT ('gps' = ANY(allowed_methods)) OR lat IS NOT NULL)
      )`);
    await q.query(`CREATE UNIQUE INDEX checkpoints_site_code_uq ON checkpoints (site_id, lower(code)) WHERE deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE routes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        site_id uuid NOT NULL REFERENCES sites(id),
        name varchar(100) NOT NULL,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`
      CREATE TABLE route_checkpoints (
        route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        checkpoint_id uuid NOT NULL REFERENCES checkpoints(id),
        seq integer NOT NULL CHECK (seq > 0),
        required boolean NOT NULL DEFAULT true,
        PRIMARY KEY (route_id, seq),
        CONSTRAINT route_checkpoints_once UNIQUE (route_id, checkpoint_id)
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
    await q.query(`DELETE FROM role_permissions WHERE permission LIKE 'site.%'`);
    await q.query(`DELETE FROM user_scopes WHERE scope_type = 'site'`);
    for (const table of ['route_checkpoints', 'routes', 'checkpoints', 'posts', 'sites']) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
```

`backend/src/sites/site.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('sites')
export class Site extends TenantEntity {
  @Column('uuid')
  client_id: string;

  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  /** numeric(9,6) — a string from pg, a number on the way in. */
  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column('int', { default: 150 })
  geofence_radius_m: number;

  @Column({ type: 'uuid', nullable: true })
  responsible_team_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}

@Entity('posts')
export class Post extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/sites/checkpoint.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

export const CHECK_METHODS = ['qr', 'gps', 'photo', 'nfc'] as const;
export type CheckMethod = (typeof CHECK_METHODS)[number];

@Entity('checkpoints')
export class Checkpoint extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lng: string | null;

  @Column('int', { default: 30 })
  radius_m: number;

  @Column({ type: 'text', array: true, default: () => `'{qr}'` })
  allowed_methods: CheckMethod[];

  /** Signs this checkpoint's QR tags. Never leaves the backend. */
  @Column({ length: 64, select: false })
  qr_secret: string;

  @Column({ default: false })
  require_photo: boolean;

  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/sites/route.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('routes')
export class Route extends TenantEntity {
  @Column('uuid')
  site_id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}

/** Checkpoint `seq` of a route. Replaced as a whole when the route is edited. */
@Entity('route_checkpoints')
export class RouteCheckpoint {
  @PrimaryColumn('uuid')
  route_id: string;

  @PrimaryColumn('int')
  seq: number;

  @Column('uuid')
  checkpoint_id: string;

  @Column({ default: true })
  required: boolean;
}
```

- [ ] **Step 4: Quyền, phạm vi mục tiêu, mã lỗi**

Trong `backend/src/access/permissions.ts`: thêm vào `PERMISSIONS` sau `'deployment.manage'`:
```ts
  'site.view': 'Xem mục tiêu, điểm tuần tra, tuyến',
  'site.manage': 'Cấu hình mục tiêu, điểm tuần tra, tuyến',
```
và trong `ROLE_TEMPLATES`: `manager` thêm `'site.view', 'site.manage'`; `team_leader`, `hr`, `accountant` thêm `'site.view'`.

Trong `backend/src/access/scope.service.ts`, thêm kiểu `export type SiteVisibility = { all: true } | { all: false; siteIds: string[] };` và:
```ts
  /** Sites of visible clients, sites scoped to the person, and sites their visible teams look after. */
  async siteVisibility(user: AuthUser): Promise<SiteVisibility> {
    const [teams, clients] = await Promise.all([this.teamVisibility(user), this.clientVisibility(user)]);
    if (teams.all || clients.all) return { all: true };
    const rows: { id: string }[] = await this.ds.query(
      `SELECT s.id FROM sites s
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND (
              s.client_id = ANY($2::uuid[])
           OR s.id IN (SELECT scope_id FROM user_scopes WHERE user_id = $3 AND scope_type = 'site')
           OR s.responsible_team_id = ANY($4::uuid[]))`,
      [user.tenant_id, clients.clientIds, user.id, teams.teamIds],
    );
    return { all: false, siteIds: rows.map((r) => r.id) };
  }

  async canSeeSite(user: AuthUser, siteId: string): Promise<boolean> {
    const visibility = await this.siteVisibility(user);
    return visibility.all || visibility.siteIds.includes(siteId);
  }
```

Trong `backend/src/access/access.service.ts`, nhánh `else` cuối của `assertCanGrant` thành:
```ts
      } else if (scope.scope_type === 'site') {
        if (!scope.scope_id || !(await this.exists('sites', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else {
        throw new BusinessException('SCOPE_INVALID');
      }
```
`exists` nhận thêm `'sites'`; trong `assertCanManageUser`, truy vấn cuối thành `scope_type IN ('team_group', 'client', 'site')`.

Trong `backend/src/users/dto.ts`: `ScopeInputDto.scope_type` nhận thêm `'site'`.

Thêm vào `ERROR_CODES` (trước `CONFLICT`):
```ts
  SITE_CODE_TAKEN: { status: 409, message: 'Mã mục tiêu đã tồn tại' },
  SITE_CLIENT_SELF_MANAGED: { status: 400, message: 'Khách tự quản lý không khai báo mục tiêu trên hệ thống' },
  CHECKPOINT_CODE_TAKEN: { status: 409, message: 'Mã điểm tuần tra đã tồn tại ở mục tiêu này' },
  CHECKPOINT_GPS_NEEDS_LOCATION: { status: 400, message: 'Điểm dùng GPS cần có toạ độ' },
  ROUTE_EMPTY: { status: 400, message: 'Tuyến cần ít nhất một điểm tuần tra' },
  ROUTE_DUPLICATE_CHECKPOINT: { status: 400, message: 'Một điểm chỉ xuất hiện một lần trong tuyến' },
  ROUTE_FOREIGN_CHECKPOINT: { status: 400, message: 'Tuyến chỉ gồm các điểm đang hoạt động của chính mục tiêu này' },
  QR_INVALID: { status: 400, message: 'Mã QR không hợp lệ hoặc đã được in lại' },
```

- [ ] **Step 5: Viết DTO, service, controller, module**

`backend/src/sites/dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { CHECK_METHODS, CheckMethod } from './checkpoint.entity';

const CODE = /^[A-Za-z0-9._-]{1,30}$/;
const CODE_MESSAGE = { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' };

export class CreateSiteDto {
  @IsUUID()
  client_id: string;

  @Matches(CODE, CODE_MESSAGE)
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsInt() @Min(20) @Max(2000)
  geofence_radius_m?: number;

  @IsOptional() @IsUUID()
  responsible_team_id?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateSiteDto {
  @IsOptional() @Matches(CODE, CODE_MESSAGE)
  code?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsLatitude()
  lat?: number | null;

  @IsOptional() @IsLongitude()
  lng?: number | null;

  @IsOptional() @IsInt() @Min(20) @Max(2000)
  geofence_radius_m?: number;

  @IsOptional() @IsUUID()
  responsible_team_id?: string | null;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
}

export class PostDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class CreateCheckpointDto {
  @Matches(CODE, CODE_MESSAGE)
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsInt() @Min(5) @Max(500)
  radius_m?: number;

  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(CHECK_METHODS, { each: true })
  allowed_methods?: CheckMethod[];

  @IsOptional() @IsBoolean()
  require_photo?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  instructions?: string;
}

export class UpdateCheckpointDto {
  @IsOptional() @Matches(CODE, CODE_MESSAGE)
  code?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsLatitude()
  lat?: number | null;

  @IsOptional() @IsLongitude()
  lng?: number | null;

  @IsOptional() @IsInt() @Min(5) @Max(500)
  radius_m?: number;

  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(CHECK_METHODS, { each: true })
  allowed_methods?: CheckMethod[];

  @IsOptional() @IsBoolean()
  require_photo?: boolean;

  @IsOptional() @IsString() @MaxLength(2000)
  instructions?: string | null;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class RouteStopDto {
  @IsUUID()
  checkpoint_id: string;

  @IsOptional() @IsBoolean()
  required?: boolean;
}

export class RouteDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RouteStopDto)
  checkpoints: RouteStopDto[];
}

export class ResolveQrDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  payload: string;
}
```

`backend/src/sites/sites.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { CreateSiteDto, PostDto, UpdateSiteDto } from './dto';
import { Post, Site } from './site.entity';

export interface SiteRow {
  id: string;
  client_id: string;
  client_name: string;
  code: string;
  name: string;
  address: string | null;
  lat: string | null;
  lng: string | null;
  geofence_radius_m: number;
  responsible_team_id: string | null;
  responsible_team_name: string | null;
  status: 'active' | 'inactive';
  note: string | null;
  checkpoint_count: number;
  route_count: number;
}

export interface SiteDetail extends SiteRow {
  posts: { id: string; name: string; note: string | null }[];
}

const SITE_ROWS = `
  SELECT s.id, s.client_id, c.name AS client_name, s.code, s.name, s.address, s.lat, s.lng, s.geofence_radius_m,
         s.responsible_team_id, t.name AS responsible_team_name, s.status, s.note,
         (SELECT count(*)::int FROM checkpoints k WHERE k.site_id = s.id AND k.deleted_at IS NULL) AS checkpoint_count,
         (SELECT count(*)::int FROM routes r WHERE r.site_id = s.id AND r.deleted_at IS NULL) AS route_count
    FROM sites s
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN teams t ON t.id = s.responsible_team_id
   WHERE s.tenant_id = $1 AND s.deleted_at IS NULL`;

@Injectable()
export class SitesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, filter: { client_id?: string }): Promise<SiteRow[]> {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.siteVisibility(actor);
    if (!visibility.all && !visibility.siteIds.length) return [];
    const params: unknown[] = [tenantId];
    let sql = SITE_ROWS;
    if (!visibility.all) {
      params.push(visibility.siteIds);
      sql += ` AND s.id = ANY($${params.length}::uuid[])`;
    }
    if (filter.client_id) {
      params.push(filter.client_id);
      sql += ` AND s.client_id = $${params.length}`;
    }
    return this.ds.query(`${sql} ORDER BY c.name, s.name`, params);
  }

  async get(actor: AuthUser, id: string): Promise<SiteDetail> {
    const tenantId = tenantOf(actor);
    const [row]: SiteRow[] = await this.ds.query(`${SITE_ROWS} AND s.id = $2`, [tenantId, id]);
    if (!row || !(await this.scopes.canSeeSite(actor, id))) throw new BusinessException('NOT_FOUND');
    const posts = await this.ds.query(
      `SELECT id, name, note FROM posts WHERE site_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    );
    return { ...row, posts };
  }

  async create(actor: AuthUser, dto: CreateSiteDto): Promise<SiteDetail> {
    const tenantId = tenantOf(actor);
    if (!(await this.scopes.canSeeClient(actor, dto.client_id))) throw new BusinessException('NOT_FOUND');
    const [clientRow] = await this.ds.query(
      `SELECT management_mode FROM clients WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [dto.client_id, tenantId],
    );
    if (!clientRow) throw new BusinessException('NOT_FOUND');
    if (clientRow.management_mode !== 'managed') throw new BusinessException('SITE_CLIENT_SELF_MANAGED');
    await this.assertCodeFree(tenantId, dto.code, null);
    if (dto.responsible_team_id) await this.assertTeam(actor, dto.responsible_team_id);
    const site = await new TenantRepository(this.ds.getRepository(Site)).create(tenantId, {
      ...dto,
      lat: dto.lat === undefined ? null : String(dto.lat),
      lng: dto.lng === undefined ? null : String(dto.lng),
    });
    await this.log(actor, 'site.create', site.id, { code: dto.code, client_id: dto.client_id });
    return this.get(actor, site.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateSiteDto): Promise<SiteDetail> {
    const tenantId = tenantOf(actor);
    await this.writable(actor, id);
    if (dto.code !== undefined) await this.assertCodeFree(tenantId, dto.code, id);
    if (dto.responsible_team_id) await this.assertTeam(actor, dto.responsible_team_id);
    const patch: DeepPartial<Site> = { ...dto } as DeepPartial<Site>;
    if (dto.lat !== undefined) patch.lat = dto.lat === null ? null : String(dto.lat);
    if (dto.lng !== undefined) patch.lng = dto.lng === null ? null : String(dto.lng);
    await new TenantRepository(this.ds.getRepository(Site)).update(tenantId, id, patch);
    await this.log(actor, 'site.update', id, { ...dto });
    return this.get(actor, id);
  }

  async addPost(actor: AuthUser, siteId: string, dto: PostDto) {
    const tenantId = tenantOf(actor);
    await this.writable(actor, siteId);
    const post = await new TenantRepository(this.ds.getRepository(Post)).create(tenantId, { site_id: siteId, name: dto.name, note: dto.note ?? null });
    await this.log(actor, 'site.post.add', siteId, { post_id: post.id, name: dto.name });
    return { id: post.id, name: post.name, note: post.note };
  }

  async updatePost(actor: AuthUser, postId: string, dto: PostDto) {
    const tenantId = tenantOf(actor);
    const posts = new TenantRepository(this.ds.getRepository(Post));
    const post = await posts.get(tenantId, postId);
    await this.writable(actor, post.site_id);
    const saved = await posts.update(tenantId, postId, { name: dto.name, note: dto.note ?? null });
    return { id: saved.id, name: saved.name, note: saved.note };
  }

  async removePost(actor: AuthUser, postId: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const posts = new TenantRepository(this.ds.getRepository(Post));
    const post = await posts.get(tenantId, postId);
    await this.writable(actor, post.site_id);
    await posts.softDelete(tenantId, postId);
    await this.log(actor, 'site.post.remove', post.site_id, { post_id: postId });
    return { ok: true };
  }

  /** The site, if the caller may configure it: site.manage (checked by the guard) and sight of the site. */
  async writable(actor: AuthUser, siteId: string, m: EntityManager = this.ds.manager): Promise<Site> {
    const site = await new TenantRepository(m.getRepository(Site)).get(tenantOf(actor), siteId);
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    return site;
  }

  private async assertCodeFree(tenantId: string, code: string, exceptId: string | null) {
    const rows = await this.ds.query(
      `SELECT 1 FROM sites WHERE tenant_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [tenantId, code, exceptId],
    );
    if (rows.length) throw new BusinessException('SITE_CODE_TAKEN');
  }

  private async assertTeam(actor: AuthUser, teamId: string) {
    const rows = await this.ds.query(`SELECT 1 FROM teams WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [teamId, tenantOf(actor)]);
    if (!rows.length) throw new BusinessException('NOT_FOUND');
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'site', entity_id: id, data });
  }
}
```

`backend/src/sites/sites.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CreateSiteDto, PostDto, UpdateSiteDto } from './dto';
import { SitesService } from './sites.service';

class SiteFilter {
  @IsOptional() @IsUUID()
  client_id?: string;
}

@Controller()
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @RequirePermission('site.view')
  @Get('sites')
  list(@CurrentUser() user: AuthUser, @Query() filter: SiteFilter) {
    return this.sites.list(user, filter);
  }

  @RequirePermission('site.view')
  @Get('sites/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.get(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSiteDto) {
    return this.sites.create(user, dto);
  }

  @RequirePermission('site.manage')
  @Patch('sites/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSiteDto) {
    return this.sites.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/posts')
  addPost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto) {
    return this.sites.addPost(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Patch('posts/:id')
  updatePost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto) {
    return this.sites.updatePost(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('posts/:id')
  removePost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.removePost(user, id);
  }
}
```

`backend/src/sites/sites.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [SitesService],
  controllers: [SitesController],
  exports: [SitesService],
})
export class SitesModule {}
```

Trong `backend/src/app.module.ts`: import `SitesModule`, thêm vào cuối `imports`.

- [ ] **Step 6: Chạy test để thấy đạt, chạy toàn bộ**

Run: `cd backend && npm run test:e2e`
Expected: PASS — `sites` 6 tests, các suite cũ xanh (kể cả `users` sau khi sửa vai trò `scoped_admin`).

Run: `npm run migration:run` → `SitesCheckpointsRoutes1760500000000 has been executed successfully.`

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): sites and posts with site-level visibility"
```

---

### Task 2: Điểm tuần tra và mã QR có chữ ký

**Files:**
- Create: `backend/src/sites/qr.ts`, `backend/src/sites/qr.spec.ts`, `backend/src/sites/checkpoints.service.ts`, `backend/src/sites/checkpoints.controller.ts`
- Modify: `backend/src/sites/sites.module.ts`
- Test: `backend/test/checkpoints.e2e-spec.ts`

**Interfaces:**
- Consumes: `SitesService.writable`, `ScopeService.canSeeSite/siteVisibility`, `TenantRepository`, `AuditService`.
- Produces:
  - `QR_PREFIX = 'PTR1'`; `newQrSecret(): string`; `qrPayload(secret, checkpointId): string`; `parseQr(payload): { checkpointId; signature } | null`; `qrMatches(secret, checkpointId, signature): boolean` (so sánh thời gian hằng).
  - `interface CheckpointView { id; site_id; code; name; lat; lng; radius_m; allowed_methods; require_photo; instructions; status }` (không có `qr_secret`).
  - `CheckpointsService.list(actor, siteId)`, `.create(actor, siteId, dto)`, `.update(actor, id, dto)`, `.rotateQr(actor, id)`, `.qrSheet(actor, siteId)` → `{ site: { id, code, name, client_name }, tags: { id, code, name, payload }[] }` (chỉ điểm `active`), `.resolve(actor, payload)` → `CheckpointView & { site_name }` (ném `QR_INVALID`).
  - Routes: `GET|POST /api/sites/:id/checkpoints`, `PATCH /api/checkpoints/:id`, `POST /api/checkpoints/:id/rotate-qr`, `GET /api/sites/:id/qr-sheet` (`site.manage`), `POST /api/checkpoints/resolve-qr` `{payload}` (`site.view`).

- [ ] **Step 1: Viết test thất bại**

`backend/src/sites/qr.spec.ts`:
```ts
import { newQrSecret, parseQr, qrMatches, qrPayload } from './qr';

const ID = '3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60';

describe('QR tags', () => {
  it('round-trips a signed payload', () => {
    const secret = newQrSecret();
    const payload = qrPayload(secret, ID);
    expect(payload).toMatch(/^PTR1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    const parsed = parseQr(payload)!;
    expect(parsed.checkpointId).toBe(ID);
    expect(qrMatches(secret, parsed.checkpointId, parsed.signature)).toBe(true);
  });

  it('rejects a tampered signature, another secret, and junk', () => {
    const secret = newQrSecret();
    const parsed = parseQr(qrPayload(secret, ID))!;
    const flipped = (parsed.signature[0] === 'A' ? 'B' : 'A') + parsed.signature.slice(1);
    expect(qrMatches(secret, ID, flipped)).toBe(false);
    expect(qrMatches(newQrSecret(), ID, parsed.signature)).toBe(false);
    expect(parseQr('https://example.com')).toBeNull();
    expect(parseQr(`PTR1.not-a-uuid.${parsed.signature}`)).toBeNull();
    expect(parseQr(`PTR1.${ID}.short`)).toBeNull();
  });
});
```

`backend/test/checkpoints.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Checkpoints and QR (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let api: ReturnType<typeof client>;
  let siteId: string;
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'cp');
    api = client(app, admin.token);
    const c = (await api.post('/api/clients', { code: 'CPK', name: 'Khách CP' }).expect(201)).body.data;
    siteId = (await api.post('/api/sites', { client_id: c.id, code: 'CPS', name: 'Toà CP' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const newCheckpoint = async (extra: object = {}) =>
    (await api.post(`/api/sites/${siteId}/checkpoints`, { code: `P${++seq}`, name: `Điểm ${seq}`, ...extra }).expect(201)).body.data;

  it('creates QR checkpoints by default and never exposes the secret', async () => {
    const cp = await newCheckpoint();
    expect(cp).toMatchObject({ allowed_methods: ['qr'], radius_m: 30, require_photo: false, status: 'active' });
    expect(cp).not.toHaveProperty('qr_secret');
    const list = (await api.get(`/api/sites/${siteId}/checkpoints`).expect(200)).body.data;
    expect(JSON.stringify(list)).not.toContain('qr_secret');
  });

  it('requires a location for GPS checkpoints, also when edited later', async () => {
    const bad = await api.post(`/api/sites/${siteId}/checkpoints`, { code: `G${++seq}`, name: 'GPS', allowed_methods: ['gps'] }).expect(400);
    expect(bad.body.error.code).toBe('CHECKPOINT_GPS_NEEDS_LOCATION');
    const gps = await newCheckpoint({ allowed_methods: ['gps', 'photo'], lat: 21.03, lng: 105.85, radius_m: 25 });
    expect(gps.lat).toBe('21.030000');
    await api.patch(`/api/checkpoints/${gps.id}`, { lat: null, lng: null }).expect(400);
    const qrOnly = await newCheckpoint();
    await api.patch(`/api/checkpoints/${qrOnly.id}`, { allowed_methods: ['gps'] }).expect(400);
  });

  it('prints signed tags that resolve to their checkpoint, until the tag is re-printed', async () => {
    const cp = await newCheckpoint({ name: 'Cầu thang bộ tầng 1' });
    const sheet = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data;
    expect(sheet.site).toMatchObject({ id: siteId, name: 'Toà CP', client_name: 'Khách CP' });
    const tag = sheet.tags.find((t: { id: string }) => t.id === cp.id);
    expect(tag.payload).toMatch(/^PTR1\./);

    const resolved = (await api.post('/api/checkpoints/resolve-qr', { payload: tag.payload }).expect(201)).body.data;
    expect(resolved).toMatchObject({ id: cp.id, name: 'Cầu thang bộ tầng 1', site_name: 'Toà CP' });

    await api.post(`/api/checkpoints/${cp.id}/rotate-qr`).expect(201);
    expect((await api.post('/api/checkpoints/resolve-qr', { payload: tag.payload }).expect(400)).body.error.code).toBe('QR_INVALID');
    const fresh = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data.tags.find((t: { id: string }) => t.id === cp.id);
    await api.post('/api/checkpoints/resolve-qr', { payload: fresh.payload }).expect(201);
  });

  it('leaves inactive checkpoints off the sheet and refuses their tags', async () => {
    const cp = await newCheckpoint();
    const tag = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data.tags.find((t: { id: string }) => t.id === cp.id);
    await api.patch(`/api/checkpoints/${cp.id}`, { status: 'inactive' }).expect(200);
    const sheet = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data;
    expect(sheet.tags.map((t: { id: string }) => t.id)).not.toContain(cp.id);
    await api.post('/api/checkpoints/resolve-qr', { payload: tag.payload }).expect(400);
  });

  it("rejects another company's tag and a forged one", async () => {
    const other = await createTenantWithAdmin(app, 'cp-other');
    const apiB = client(app, other.token);
    const cB = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data;
    const sB = (await apiB.post('/api/sites', { client_id: cB.id, code: 'BS', name: 'B' }).expect(201)).body.data;
    const cpB = (await apiB.post(`/api/sites/${sB.id}/checkpoints`, { code: 'BP', name: 'B' }).expect(201)).body.data;
    const tagB = (await apiB.get(`/api/sites/${sB.id}/qr-sheet`).expect(200)).body.data.tags[0].payload;
    expect(cpB.id).toBeTruthy();
    await api.post('/api/checkpoints/resolve-qr', { payload: tagB }).expect(400);

    const cp = await newCheckpoint();
    const [row] = await ds.query(`SELECT id FROM checkpoints WHERE id = $1`, [cp.id]);
    await api.post('/api/checkpoints/resolve-qr', { payload: `PTR1.${row.id}.AAAAAAAAAAAAAAAAAAAAAA` }).expect(400);
  });

  it('refuses a duplicate code within the site', async () => {
    await newCheckpoint({ code: 'DUP-1' });
    const res = await api.post(`/api/sites/${siteId}/checkpoints`, { code: 'dup-1', name: 'X' }).expect(409);
    expect(res.body.error.code).toBe('CHECKPOINT_CODE_TAKEN');
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npx jest src/sites && npm run test:e2e -- checkpoints`
Expected: FAIL — `Cannot find module './qr'`; e2e `POST /api/sites/:id/checkpoints` 404.

- [ ] **Step 3: Viết code**

`backend/src/sites/qr.ts`:
```ts
import { isUUID } from 'class-validator';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * A printed tag reads `PTR1.<checkpoint id>.<signature>`. The signature is an
 * HMAC under a secret only the backend knows, so nobody can print a tag for a
 * checkpoint they invented; re-printing rotates the secret and kills old tags.
 * A photo of a genuine tag still scans — GPS, photos and timing catch that (spec §7.3).
 */
export const QR_PREFIX = 'PTR1';
const SIGNATURE_LENGTH = 22; // 132 bits of base64url

export const newQrSecret = () => randomBytes(32).toString('hex');

export function qrSignature(secret: string, checkpointId: string): string {
  return createHmac('sha256', secret).update(checkpointId).digest('base64url').slice(0, SIGNATURE_LENGTH);
}

export function qrPayload(secret: string, checkpointId: string): string {
  return `${QR_PREFIX}.${checkpointId}.${qrSignature(secret, checkpointId)}`;
}

export function parseQr(payload: string): { checkpointId: string; signature: string } | null {
  const parts = payload.trim().split('.');
  if (parts.length !== 3 || parts[0] !== QR_PREFIX || !isUUID(parts[1]) || parts[2].length !== SIGNATURE_LENGTH) return null;
  return { checkpointId: parts[1], signature: parts[2] };
}

export function qrMatches(secret: string, checkpointId: string, signature: string): boolean {
  const expected = Buffer.from(qrSignature(secret, checkpointId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

`backend/src/sites/checkpoints.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { Checkpoint, CheckMethod } from './checkpoint.entity';
import { CreateCheckpointDto, UpdateCheckpointDto } from './dto';
import { newQrSecret, parseQr, qrMatches, qrPayload } from './qr';
import { SitesService } from './sites.service';

export interface CheckpointView {
  id: string;
  site_id: string;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  require_photo: boolean;
  instructions: string | null;
  status: 'active' | 'inactive';
}

const view = (c: Checkpoint): CheckpointView => ({
  id: c.id, site_id: c.site_id, code: c.code, name: c.name, lat: c.lat, lng: c.lng, radius_m: c.radius_m,
  allowed_methods: c.allowed_methods, require_photo: c.require_photo, instructions: c.instructions, status: c.status,
});

@Injectable()
export class CheckpointsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<CheckpointView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    const rows = await this.repo().find(tenantOf(actor), { where: { site_id: siteId }, order: { code: 'ASC' } });
    return rows.map(view);
  }

  async create(actor: AuthUser, siteId: string, dto: CreateCheckpointDto): Promise<CheckpointView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    const methods = dto.allowed_methods ?? ['qr'];
    assertLocation(methods, dto.lat ?? null);
    await this.assertCodeFree(siteId, dto.code, null);
    const saved = await this.repo().create(tenantId, {
      site_id: siteId, code: dto.code, name: dto.name,
      lat: dto.lat === undefined ? null : String(dto.lat), lng: dto.lng === undefined ? null : String(dto.lng),
      radius_m: dto.radius_m ?? 30, allowed_methods: methods, require_photo: dto.require_photo ?? false,
      instructions: dto.instructions ?? null, qr_secret: newQrSecret(),
    });
    await this.log(actor, 'checkpoint.create', saved.id, { site_id: siteId, code: dto.code });
    return view(await this.repo().get(tenantId, saved.id));
  }

  async update(actor: AuthUser, id: string, dto: UpdateCheckpointDto): Promise<CheckpointView> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    const methods = dto.allowed_methods ?? current.allowed_methods;
    const lat = dto.lat !== undefined ? dto.lat : current.lat;
    assertLocation(methods, lat);
    if (dto.code !== undefined) await this.assertCodeFree(current.site_id, dto.code, id);
    const patch: DeepPartial<Checkpoint> = { ...dto } as DeepPartial<Checkpoint>;
    if (dto.lat !== undefined) patch.lat = dto.lat === null ? null : String(dto.lat);
    if (dto.lng !== undefined) patch.lng = dto.lng === null ? null : String(dto.lng);
    await this.repo().update(tenantId, id, patch);
    await this.log(actor, 'checkpoint.update', id, { ...dto });
    return view(await this.repo().get(tenantId, id));
  }

  /** New secret: every tag printed before stops scanning. */
  async rotateQr(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const current = await this.repo().get(tenantId, id);
    await this.sites.writable(actor, current.site_id);
    await this.ds.getRepository(Checkpoint).update({ id, tenant_id: tenantId }, { qr_secret: newQrSecret() });
    await this.log(actor, 'checkpoint.rotate_qr', id, {});
    return { ok: true };
  }

  async qrSheet(actor: AuthUser, siteId: string) {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    const [site] = await this.ds.query(
      `SELECT s.id, s.code, s.name, c.name AS client_name FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.id = $1`,
      [siteId],
    );
    const rows: { id: string; code: string; name: string; qr_secret: string }[] = await this.ds.query(
      `SELECT id, code, name, qr_secret FROM checkpoints
        WHERE tenant_id = $1 AND site_id = $2 AND deleted_at IS NULL AND status = 'active' ORDER BY code`,
      [tenantId, siteId],
    );
    return { site, tags: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, payload: qrPayload(r.qr_secret, r.id) })) };
  }

  /** What a scanned tag points at — only an active checkpoint of the caller's company with a current signature. */
  async resolve(actor: AuthUser, payload: string): Promise<CheckpointView & { site_name: string }> {
    const tenantId = tenantOf(actor);
    const parsed = parseQr(payload);
    if (!parsed) throw new BusinessException('QR_INVALID');
    const [row]: { qr_secret: string; site_name: string }[] = await this.ds.query(
      `SELECT k.qr_secret, s.name AS site_name FROM checkpoints k JOIN sites s ON s.id = k.site_id
        WHERE k.id = $1 AND k.tenant_id = $2 AND k.deleted_at IS NULL AND k.status = 'active' AND s.deleted_at IS NULL`,
      [parsed.checkpointId, tenantId],
    );
    if (!row || !qrMatches(row.qr_secret, parsed.checkpointId, parsed.signature)) throw new BusinessException('QR_INVALID');
    const checkpoint = view(await this.repo().get(tenantId, parsed.checkpointId));
    if (!(await this.scopes.canSeeSite(actor, checkpoint.site_id))) throw new BusinessException('QR_INVALID');
    return { ...checkpoint, site_name: row.site_name };
  }

  private repo() {
    return new TenantRepository(this.ds.getRepository(Checkpoint));
  }

  private async assertCodeFree(siteId: string, code: string, exceptId: string | null) {
    const rows = await this.ds.query(
      `SELECT 1 FROM checkpoints WHERE site_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [siteId, code, exceptId],
    );
    if (rows.length) throw new BusinessException('CHECKPOINT_CODE_TAKEN');
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'checkpoint', entity_id: id, data });
  }
}

function assertLocation(methods: CheckMethod[], lat: number | string | null): void {
  if (methods.includes('gps') && (lat === null || lat === undefined)) throw new BusinessException('CHECKPOINT_GPS_NEEDS_LOCATION');
}
```

`backend/src/sites/checkpoints.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CheckpointsService } from './checkpoints.service';
import { CreateCheckpointDto, ResolveQrDto, UpdateCheckpointDto } from './dto';

@Controller()
export class CheckpointsController {
  constructor(private readonly checkpoints: CheckpointsService) {}

  @RequirePermission('site.view')
  @Get('sites/:id/checkpoints')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkpoints.list(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/checkpoints')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCheckpointDto) {
    return this.checkpoints.create(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Get('sites/:id/qr-sheet')
  qrSheet(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkpoints.qrSheet(user, id);
  }

  @RequirePermission('site.view')
  @Post('checkpoints/resolve-qr')
  resolve(@CurrentUser() user: AuthUser, @Body() dto: ResolveQrDto) {
    return this.checkpoints.resolve(user, dto.payload);
  }

  @RequirePermission('site.manage')
  @Patch('checkpoints/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCheckpointDto) {
    return this.checkpoints.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Post('checkpoints/:id/rotate-qr')
  rotate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkpoints.rotateQr(user, id);
  }
}
```

Route `checkpoints/resolve-qr` phải khai báo **trước** `checkpoints/:id` — trong controller trên đã đúng thứ tự (hai route khác phương thức nên không đụng nhau, nhưng giữ thói quen này).

Trong `backend/src/sites/sites.module.ts`: thêm `CheckpointsService` vào `providers` và `exports`, `CheckpointsController` vào `controllers`.

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npx jest src/sites && npm run test:e2e -- checkpoints`
Expected: PASS — unit 2, e2e 6.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): checkpoints with signed, rotatable QR tags"
```

---

### Task 3: Tuyến tuần tra

**Files:**
- Create: `backend/src/sites/routes.service.ts`, `backend/src/sites/routes.controller.ts`
- Modify: `backend/src/sites/sites.module.ts`
- Test: `backend/test/routes.e2e-spec.ts`

**Interfaces:**
- Consumes: `SitesService.writable`, `ScopeService.canSeeSite`, `TenantRepository`.
- Produces:
  - `interface RouteView { id; site_id; name; note; checkpoints: { checkpoint_id; code; name; seq; required }[] }`.
  - `RoutesService.list(actor, siteId)`, `.create(actor, siteId, dto)`, `.replace(actor, routeId, dto)`, `.remove(actor, routeId)`.
  - Routes: `GET|POST /api/sites/:id/routes`, `PUT|DELETE /api/routes/:id`. Thứ tự điểm = thứ tự trong mảng `checkpoints`; `required` mặc định `true`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/routes.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Patrol routes (e2e)', () => {
  let app: NestExpressApplication;
  let api: ReturnType<typeof client>;
  let siteId: string;
  let otherSiteId: string;
  let seq = 0;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'rt');
    api = client(app, admin.token);
    const c = (await api.post('/api/clients', { code: 'RK', name: 'Khách R' }).expect(201)).body.data;
    siteId = (await api.post('/api/sites', { client_id: c.id, code: 'RS1', name: 'Toà 1' }).expect(201)).body.data.id;
    otherSiteId = (await api.post('/api/sites', { client_id: c.id, code: 'RS2', name: 'Toà 2' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const cp = async (site = siteId) =>
    (await api.post(`/api/sites/${site}/checkpoints`, { code: `C${++seq}`, name: `Điểm ${seq}` }).expect(201)).body.data;

  it('keeps the checkpoints in the order given, with optional stops', async () => {
    const [a, b, c] = [await cp(), await cp(), await cp()];
    const route = (
      await api
        .post(`/api/sites/${siteId}/routes`, {
          name: 'Vòng 1',
          checkpoints: [{ checkpoint_id: c.id }, { checkpoint_id: a.id, required: false }, { checkpoint_id: b.id }],
        })
        .expect(201)
    ).body.data;
    expect(route.checkpoints.map((s: { checkpoint_id: string; seq: number; required: boolean }) => [s.checkpoint_id, s.seq, s.required])).toEqual([
      [c.id, 1, true], [a.id, 2, false], [b.id, 3, true],
    ]);
    const listed = (await api.get(`/api/sites/${siteId}/routes`).expect(200)).body.data;
    expect(listed.find((r: { id: string }) => r.id === route.id).checkpoints).toHaveLength(3);
  });

  it('replaces the stops of a route as a whole', async () => {
    const [a, b] = [await cp(), await cp()];
    const route = (await api.post(`/api/sites/${siteId}/routes`, { name: 'Vòng 2', checkpoints: [{ checkpoint_id: a.id }] }).expect(201)).body.data;
    const res = await api.put(`/api/routes/${route.id}`, { name: 'Vòng 2b', checkpoints: [{ checkpoint_id: b.id }, { checkpoint_id: a.id }] }).expect(200);
    expect(res.body.data).toMatchObject({ name: 'Vòng 2b' });
    expect(res.body.data.checkpoints.map((s: { checkpoint_id: string }) => s.checkpoint_id)).toEqual([b.id, a.id]);
  });

  it('refuses empty routes, repeated stops, other sites and inactive checkpoints', async () => {
    const a = await cp();
    const foreign = await cp(otherSiteId);
    const off = await cp();
    await api.patch(`/api/checkpoints/${off.id}`, { status: 'inactive' }).expect(200);
    const post = (checkpoints: object[]) => api.post(`/api/sites/${siteId}/routes`, { name: 'X', checkpoints });
    expect((await post([]).expect(400)).body.error.code).toBe('ROUTE_EMPTY');
    expect((await post([{ checkpoint_id: a.id }, { checkpoint_id: a.id }]).expect(400)).body.error.code).toBe('ROUTE_DUPLICATE_CHECKPOINT');
    expect((await post([{ checkpoint_id: foreign.id }]).expect(400)).body.error.code).toBe('ROUTE_FOREIGN_CHECKPOINT');
    expect((await post([{ checkpoint_id: off.id }]).expect(400)).body.error.code).toBe('ROUTE_FOREIGN_CHECKPOINT');
  });

  it('deletes a route', async () => {
    const a = await cp();
    const route = (await api.post(`/api/sites/${siteId}/routes`, { name: 'Xoá', checkpoints: [{ checkpoint_id: a.id }] }).expect(201)).body.data;
    await api.delete(`/api/routes/${route.id}`).expect(200);
    const listed = (await api.get(`/api/sites/${siteId}/routes`).expect(200)).body.data;
    expect(listed.map((r: { id: string }) => r.id)).not.toContain(route.id);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- routes`
Expected: FAIL — `POST /api/sites/:id/routes` 404.

- [ ] **Step 3: Viết code**

`backend/src/sites/routes.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { RouteDto } from './dto';
import { Route, RouteCheckpoint } from './route.entity';
import { SitesService } from './sites.service';

export interface RouteView {
  id: string;
  site_id: string;
  name: string;
  note: string | null;
  checkpoints: { checkpoint_id: string; code: string; name: string; seq: number; required: boolean }[];
}

const ROUTE_ROWS = `
  SELECT r.id, r.site_id, r.name, r.note,
         COALESCE(json_agg(json_build_object('checkpoint_id', k.id, 'code', k.code, 'name', k.name, 'seq', rc.seq, 'required', rc.required)
                  ORDER BY rc.seq) FILTER (WHERE rc.route_id IS NOT NULL), '[]') AS checkpoints
    FROM routes r
    LEFT JOIN route_checkpoints rc ON rc.route_id = r.id
    LEFT JOIN checkpoints k ON k.id = rc.checkpoint_id
   WHERE r.tenant_id = $1 AND r.deleted_at IS NULL`;

@Injectable()
export class RoutesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly sites: SitesService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, siteId: string): Promise<RouteView[]> {
    if (!(await this.scopes.canSeeSite(actor, siteId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(`${ROUTE_ROWS} AND r.site_id = $2 GROUP BY r.id ORDER BY r.name`, [tenantOf(actor), siteId]);
  }

  async create(actor: AuthUser, siteId: string, dto: RouteDto): Promise<RouteView> {
    const tenantId = tenantOf(actor);
    await this.sites.writable(actor, siteId);
    const id = await this.ds.transaction(async (m) => {
      const route = await new TenantRepository(m.getRepository(Route)).create(tenantId, { site_id: siteId, name: dto.name, note: dto.note ?? null });
      await this.writeStops(m, tenantId, siteId, route.id, dto);
      return route.id;
    });
    await this.log(actor, 'route.create', id, { site_id: siteId, name: dto.name });
    return this.one(tenantId, id);
  }

  async replace(actor: AuthUser, routeId: string, dto: RouteDto): Promise<RouteView> {
    const tenantId = tenantOf(actor);
    const route = await new TenantRepository(this.ds.getRepository(Route)).get(tenantId, routeId);
    await this.sites.writable(actor, route.site_id);
    await this.ds.transaction(async (m) => {
      await m.update(Route, { id: routeId }, { name: dto.name, note: dto.note ?? null });
      await m.delete(RouteCheckpoint, { route_id: routeId });
      await this.writeStops(m, tenantId, route.site_id, routeId, dto);
    });
    await this.log(actor, 'route.replace', routeId, { name: dto.name, stops: dto.checkpoints.length });
    return this.one(tenantId, routeId);
  }

  async remove(actor: AuthUser, routeId: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    const repo = new TenantRepository(this.ds.getRepository(Route));
    const route = await repo.get(tenantId, routeId);
    await this.sites.writable(actor, route.site_id);
    await repo.softDelete(tenantId, routeId);
    await this.log(actor, 'route.remove', routeId, {});
    return { ok: true };
  }

  /** Stops must be active checkpoints of this very site, each once, at least one. */
  private async writeStops(m: EntityManager, tenantId: string, siteId: string, routeId: string, dto: RouteDto) {
    if (!dto.checkpoints.length) throw new BusinessException('ROUTE_EMPTY');
    const ids = dto.checkpoints.map((s) => s.checkpoint_id);
    if (new Set(ids).size !== ids.length) throw new BusinessException('ROUTE_DUPLICATE_CHECKPOINT');
    const valid = await m.query(
      `SELECT id FROM checkpoints WHERE tenant_id = $1 AND site_id = $2 AND deleted_at IS NULL AND status = 'active' AND id = ANY($3::uuid[])`,
      [tenantId, siteId, ids],
    );
    if (valid.length !== ids.length) throw new BusinessException('ROUTE_FOREIGN_CHECKPOINT');
    await m.insert(
      RouteCheckpoint,
      dto.checkpoints.map((s, i) => ({ route_id: routeId, checkpoint_id: s.checkpoint_id, seq: i + 1, required: s.required ?? true })),
    );
  }

  private async one(tenantId: string, id: string): Promise<RouteView> {
    const [row] = await this.ds.query(`${ROUTE_ROWS} AND r.id = $2 GROUP BY r.id`, [tenantId, id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }

  private log(actor: AuthUser, action: string, id: string, data: Record<string, unknown>) {
    return this.audit.record(null, { tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: 'route', entity_id: id, data });
  }
}
```

`backend/src/sites/routes.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { RouteDto } from './dto';
import { RoutesService } from './routes.service';

@Controller()
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @RequirePermission('site.view')
  @Get('sites/:id/routes')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.routes.list(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/routes')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RouteDto) {
    return this.routes.create(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Put('routes/:id')
  replace(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RouteDto) {
    return this.routes.replace(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('routes/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.routes.remove(user, id);
  }
}
```

Trong `backend/src/sites/sites.module.ts`: thêm `RoutesService` (providers, exports) và `RoutesController` (controllers).

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- routes`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): ordered patrol routes made of a site's active checkpoints"
```

---

### Task 4: Bộ test cách ly cho mục tiêu, điểm, tuyến; dữ liệu demo

**Files:**
- Modify: `backend/src/scripts/seed-demo.ts`
- Test: `backend/test/tenancy-03.e2e-spec.ts`

**Interfaces:**
- Consumes: mọi route của Task 1–3.
- Produces: seed demo có 2 mục tiêu ở "Toà nhà CT1 Mỹ Đình" (có toạ độ), 5 điểm, 1 tuyến.

- [ ] **Step 1: Viết test**

`backend/test/tenancy-03.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Tenant isolation for sites, checkpoints, routes (e2e)', () => {
  let app: NestExpressApplication;
  let apiA: ReturnType<typeof client>;
  const B: Record<'client' | 'site' | 'checkpoint' | 'route' | 'post', string> = { client: '', site: '', checkpoint: '', route: '', post: '' };
  let aSite: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const a = await createTenantWithAdmin(app, 'iso3-a');
    const b = await createTenantWithAdmin(app, 'iso3-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    B.client = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data.id;
    B.site = (await apiB.post('/api/sites', { client_id: B.client, code: 'BS', name: 'B' }).expect(201)).body.data.id;
    B.post = (await apiB.post(`/api/sites/${B.site}/posts`, { name: 'Cổng B' }).expect(201)).body.data.id;
    B.checkpoint = (await apiB.post(`/api/sites/${B.site}/checkpoints`, { code: 'BP', name: 'B' }).expect(201)).body.data.id;
    B.route = (await apiB.post(`/api/sites/${B.site}/routes`, { name: 'B', checkpoints: [{ checkpoint_id: B.checkpoint }] }).expect(201)).body.data.id;
    const aClient = (await apiA.post('/api/clients', { code: 'AK', name: 'A' }).expect(201)).body.data.id;
    aSite = (await apiA.post('/api/sites', { client_id: aClient, code: 'AS', name: 'A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  it("answers every read or write of B's records with 404", async () => {
    await apiA.get(`/api/sites/${B.site}`).expect(404);
    await apiA.patch(`/api/sites/${B.site}`, { name: 'x' }).expect(404);
    await apiA.get(`/api/sites/${B.site}/checkpoints`).expect(404);
    await apiA.get(`/api/sites/${B.site}/routes`).expect(404);
    await apiA.get(`/api/sites/${B.site}/qr-sheet`).expect(404);
    await apiA.post(`/api/sites/${B.site}/checkpoints`, { code: 'X', name: 'X' }).expect(404);
    await apiA.patch(`/api/checkpoints/${B.checkpoint}`, { name: 'x' }).expect(404);
    await apiA.post(`/api/checkpoints/${B.checkpoint}/rotate-qr`).expect(404);
    await apiA.put(`/api/routes/${B.route}`, { name: 'x', checkpoints: [] }).expect(404);
    await apiA.delete(`/api/routes/${B.route}`).expect(404);
    await apiA.delete(`/api/posts/${B.post}`).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post('/api/sites', { client_id: B.client, code: 'X', name: 'X' }).expect(404);
    const res = await apiA.post(`/api/sites/${aSite}/routes`, { name: 'X', checkpoints: [{ checkpoint_id: B.checkpoint }] }).expect(400);
    expect(res.body.error.code).toBe('ROUTE_FOREIGN_CHECKPOINT');
  });

  it("keeps B out of A's lists", async () => {
    const ids = (await apiA.get('/api/sites').expect(200)).body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual([aSite]);
  });
});
```

- [ ] **Step 2: Chạy test**

Run: `cd backend && npm run test:e2e -- tenancy-03`
Expected: PASS — 3 tests (Task 1–3 đã đúng; nếu một dòng trả 200/201, sửa service trước khi đi tiếp).

- [ ] **Step 3: Thêm mục tiêu vào dữ liệu demo**

Trong `backend/src/scripts/seed-demo.ts`, import `SitesService`, `CheckpointsService`, `RoutesService` từ `../sites/...` và thêm trước dòng `console.log('Đã tạo công ty demo...`:
```ts
  const sitesSvc = app.get(SitesService);
  const checkpointsSvc = app.get(CheckpointsService);
  const routesSvc = app.get(RoutesService);
  const toa = await sitesSvc.create(actor, {
    client_id: ct1.id, code: 'CT1-A', name: 'Toà A — Khu nhà ở', address: 'Mỹ Đình, Nam Từ Liêm, Hà Nội',
    lat: 21.028511, lng: 105.776742, geofence_radius_m: 150, responsible_team_id: teamA.id,
  });
  await sitesSvc.addPost(actor, toa.id, { name: 'Chốt cổng chính' });
  await sitesSvc.create(actor, { client_id: ct1.id, code: 'CT1-HAM', name: 'Hầm để xe B1', responsible_team_id: teamA.id });
  const points = [
    ['P01', 'Sảnh lễ tân tầng 1'], ['P02', 'Cầu thang bộ tầng 1 — A1'], ['P03', 'Lối thoát hiểm hầm B1'],
    ['P04', 'Thang máy khu cư dân'], ['P05', 'Sân sau toà nhà'],
  ];
  const created = [];
  for (const [code, name] of points) created.push(await checkpointsSvc.create(actor, toa.id, { code, name }));
  await routesSvc.create(actor, toa.id, { name: 'Vòng tuần tra tầng 1 & hầm', checkpoints: created.map((c) => ({ checkpoint_id: c.id })) });
```
(khai báo `const created: { id: string }[] = [];` để TypeScript không suy ra `any[]`).

Run: `cd .. && docker compose exec -T postgres psql -q -U patrol -d patrol -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && cd backend && npm run migration:run && npm run seed:demo`
Expected: in danh sách tài khoản demo, không lỗi.

- [ ] **Step 4: Chạy toàn bộ, commit**

Run: `cd backend && npm test && npm run test:e2e && npm run build`
Expected: PASS toàn bộ.

```bash
git add backend
git commit -m "test(backend): isolation suite for sites, checkpoints, routes; demo sites"
```

---

### Task 5: Web — mục tiêu, chốt, điểm tuần tra, tuyến

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/components/shell.tsx`, `web/src/app/(app)/khach-hang/[id]/page.tsx`
- Create: `web/src/app/(app)/muc-tieu/page.tsx`, `web/src/app/(app)/muc-tieu/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET|POST /api/sites`, `GET|PATCH /api/sites/:id`, `POST /api/sites/:id/posts`, `DELETE /api/posts/:id`, `GET|POST /api/sites/:id/checkpoints`, `PATCH /api/checkpoints/:id`, `POST /api/checkpoints/:id/rotate-qr`, `GET|POST /api/sites/:id/routes`, `PUT|DELETE /api/routes/:id`, `GET /api/org/teams`.
- Produces: kiểu `SiteRow`, `SiteDetail`, `CheckpointView`, `RouteView`; trang `/muc-tieu`, `/muc-tieu/[id]`; thẻ "Mục tiêu" trên trang khách hàng; mục menu "Mục tiêu" (`site.view`).

- [ ] **Step 1: Kiểu dữ liệu và menu**

Thêm vào `web/src/lib/types.ts`:
```ts
export interface SiteRow {
  id: string;
  client_id: string;
  client_name: string;
  code: string;
  name: string;
  address: string | null;
  lat: string | null;
  lng: string | null;
  geofence_radius_m: number;
  responsible_team_id: string | null;
  responsible_team_name: string | null;
  status: 'active' | 'inactive';
  note: string | null;
  checkpoint_count: number;
  route_count: number;
}

export interface SiteDetail extends SiteRow {
  posts: { id: string; name: string; note: string | null }[];
}

export type CheckMethod = 'qr' | 'gps' | 'photo' | 'nfc';

export interface CheckpointView {
  id: string;
  site_id: string;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  require_photo: boolean;
  instructions: string | null;
  status: 'active' | 'inactive';
}

export interface RouteView {
  id: string;
  site_id: string;
  name: string;
  note: string | null;
  checkpoints: { checkpoint_id: string; code: string; name: string; seq: number; required: boolean }[];
}
```

Trong `web/src/components/shell.tsx`, thêm vào `NAV` sau mục Hợp đồng: `{ href: '/muc-tieu', label: 'Mục tiêu', permission: 'site.view' },`.

- [ ] **Step 2: Danh sách mục tiêu**

`web/src/app/(app)/muc-tieu/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { SiteRow } from '@/lib/types';

export default function SitesPage() {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SiteRow[]>('/sites').then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Mục tiêu</h1>
      <p className="text-sm text-slate-500">Thêm mục tiêu mới từ trang của từng khách hàng.</p>
      <ErrorText error={error} />
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Mã</th><th>Mục tiêu</th><th>Khách hàng</th><th>Đội phụ trách</th><th className="text-right">Điểm</th><th className="text-right">Tuyến</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-2 font-mono">{s.code}</td>
                <td><Link href={`/muc-tieu/${s.id}`} className="font-medium text-teal-700 hover:underline">{s.name}</Link></td>
                <td>{s.client_name}</td>
                <td>{s.responsible_team_name ?? '—'}</td>
                <td className="text-right">{s.checkpoint_count}</td>
                <td className="text-right">{s.route_count}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Chưa có mục tiêu nào trong phạm vi của bạn</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Thẻ "Mục tiêu" trên trang khách hàng**

Trong `web/src/app/(app)/khach-hang/[id]/page.tsx`:
- import thêm `SiteRow` từ `@/lib/types`;
- thêm state `const [sites, setSites] = useState<SiteRow[]>([]);` và `const [siteForm, setSiteForm] = useState({ code: '', name: '', address: '' });`;
- trong `load`: `if (can('site.view')) setSites(await api<SiteRow[]>(`/sites?client_id=${id}`));`;
- thêm thẻ sau thẻ "Thông tin":
```tsx
      {can('site.view') && clientRow.management_mode === 'managed' && (
        <Card title={`Mục tiêu (${sites.length})`}>
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {sites.map((s) => (
              <li key={s.id} className="flex justify-between py-2">
                <Link href={`/muc-tieu/${s.id}`} className="font-medium text-teal-700 hover:underline">{s.name}</Link>
                <span className="text-slate-500">{s.checkpoint_count} điểm · {s.route_count} tuyến · {s.responsible_team_name ?? 'chưa có đội phụ trách'}</span>
              </li>
            ))}
            {!sites.length && <li className="py-2 text-slate-400">Chưa có mục tiêu</li>}
          </ul>
          {can('site.manage') && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api('/sites', { method: 'POST', json: { client_id: id, code: siteForm.code, name: siteForm.name, ...(siteForm.address ? { address: siteForm.address } : {}) } });
                  setSiteForm({ code: '', name: '', address: '' });
                  await load();
                });
              }}
              className="grid grid-cols-1 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-4"
            >
              <Field label="Mã mục tiêu"><Input value={siteForm.code} onChange={(e) => setSiteForm({ ...siteForm, code: e.target.value })} required /></Field>
              <Field label="Tên"><Input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} required /></Field>
              <Field label="Địa chỉ"><Input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} /></Field>
              <Button type="submit">Thêm mục tiêu</Button>
            </form>
          )}
        </Card>
      )}
```

- [ ] **Step 4: Trang chi tiết mục tiêu**

`web/src/app/(app)/muc-tieu/[id]/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CheckMethod, CheckpointView, RouteView, SiteDetail, TeamRow } from '@/lib/types';

const METHOD_LABEL: Record<CheckMethod, string> = { qr: 'QR', gps: 'GPS', photo: 'Chụp ảnh', nfc: 'NFC' };
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export default function SitePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const manage = can('site.manage');
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>([]);
  const [routes, setRoutes] = useState<RouteView[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [info, setInfo] = useState({ name: '', address: '', lat: '', lng: '', geofence_radius_m: '150', responsible_team_id: '' });
  const [postName, setPostName] = useState('');
  const [cp, setCp] = useState({ code: '', name: '', lat: '', lng: '', radius_m: '30', methods: ['qr'] as CheckMethod[], require_photo: false });
  const [draftRoute, setDraftRoute] = useState<{ id: string | null; name: string; stops: { checkpoint_id: string; required: boolean }[] } | null>(null);
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
    const s = await api<SiteDetail>(`/sites/${id}`);
    setSite(s);
    setInfo({
      name: s.name, address: s.address ?? '', lat: s.lat ?? '', lng: s.lng ?? '',
      geofence_radius_m: String(s.geofence_radius_m), responsible_team_id: s.responsible_team_id ?? '',
    });
    setCheckpoints(await api<CheckpointView[]>(`/sites/${id}/checkpoints`));
    setRoutes(await api<RouteView[]>(`/sites/${id}/routes`));
    if (manage && can('org.view')) setTeams(await api<TeamRow[]>('/org/teams'));
  }, [id, manage, can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  if (!site) return <ErrorText error={error} />;
  const active = checkpoints.filter((c) => c.status === 'active');
  const nameOf = (cid: string) => checkpoints.find((c) => c.id === cid)?.name ?? '?';

  async function saveInfo(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/sites/${id}`, {
        method: 'PATCH',
        json: {
          name: info.name, address: info.address || null, lat: num(info.lat), lng: num(info.lng),
          geofence_radius_m: Number(info.geofence_radius_m), responsible_team_id: info.responsible_team_id || null,
        },
      });
      await load();
    });
  }

  async function addCheckpoint(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/sites/${id}/checkpoints`, {
        method: 'POST',
        json: {
          code: cp.code, name: cp.name, radius_m: Number(cp.radius_m), allowed_methods: cp.methods, require_photo: cp.require_photo,
          ...(cp.lat && cp.lng ? { lat: Number(cp.lat), lng: Number(cp.lng) } : {}),
        },
      });
      setCp({ ...cp, code: '', name: '', lat: '', lng: '' });
      await load();
    });
  }

  async function saveRoute() {
    if (!draftRoute) return;
    await run(async () => {
      const json = { name: draftRoute.name, checkpoints: draftRoute.stops };
      if (draftRoute.id) await api(`/routes/${draftRoute.id}`, { method: 'PUT', json });
      else await api(`/sites/${id}/routes`, { method: 'POST', json });
      setDraftRoute(null);
      await load();
    });
  }

  const moveStop = (index: number, delta: number) => {
    if (!draftRoute) return;
    const stops = [...draftRoute.stops];
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    [stops[index], stops[target]] = [stops[target], stops[index]];
    setDraftRoute({ ...draftRoute, stops });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href={`/khach-hang/${site.client_id}`} className="text-sm text-slate-500 hover:underline">← {site.client_name}</Link>
        <h1 className="text-xl font-semibold">{site.name}</h1>
        <span className="font-mono text-sm text-slate-400">{site.code}</span>
        {manage && (
          <a href={`/in-tem/${site.id}`} target="_blank" rel="noreferrer" className="ml-auto text-sm font-medium text-teal-700 hover:underline">
            In tem QR ↗
          </a>
        )}
      </div>
      <ErrorText error={error} />

      <Card title="Thông tin mục tiêu">
        <form onSubmit={saveInfo} className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
          <Field label="Tên"><Input value={info.name} disabled={!manage} onChange={(e) => setInfo({ ...info, name: e.target.value })} required /></Field>
          <Field label="Địa chỉ"><Input value={info.address} disabled={!manage} onChange={(e) => setInfo({ ...info, address: e.target.value })} /></Field>
          <Field label="Đội phụ trách">
            <Select value={info.responsible_team_id} disabled={!manage} onChange={(e) => setInfo({ ...info, responsible_team_id: e.target.value })}>
              <option value="">{site.responsible_team_name ?? '— Chưa có —'}</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Vĩ độ (lat)"><Input value={info.lat} disabled={!manage} placeholder="21.028511" onChange={(e) => setInfo({ ...info, lat: e.target.value })} /></Field>
          <Field label="Kinh độ (lng)"><Input value={info.lng} disabled={!manage} placeholder="105.776742" onChange={(e) => setInfo({ ...info, lng: e.target.value })} /></Field>
          <Field label="Bán kính vào ca (m)"><Input type="number" min={20} max={2000} value={info.geofence_radius_m} disabled={!manage} onChange={(e) => setInfo({ ...info, geofence_radius_m: e.target.value })} /></Field>
          {manage && <Button type="submit">Lưu</Button>}
        </form>
        <p className="mt-2 text-xs text-slate-500">Lấy toạ độ: mở Google Maps, nhấn giữ vào vị trí toà nhà, chép hai số hiện ra.</p>
      </Card>

      <Card title="Chốt gác">
        <ul className="mb-2 flex flex-wrap gap-2 text-sm">
          {site.posts.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
              {p.name}
              {manage && <button onClick={() => run(async () => { await api(`/posts/${p.id}`, { method: 'DELETE' }); await load(); })} className="text-slate-400 hover:text-red-600">×</button>}
            </li>
          ))}
          {!site.posts.length && <li className="text-slate-400">Chưa có chốt gác</li>}
        </ul>
        {manage && (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/sites/${id}/posts`, { method: 'POST', json: { name: postName } }); setPostName(''); await load(); }); }} className="flex items-end gap-2">
            <Field label="Thêm chốt"><Input value={postName} onChange={(e) => setPostName(e.target.value)} required /></Field>
            <Button type="submit">Thêm</Button>
          </form>
        )}
      </Card>

      <Card title={`Điểm tuần tra (${active.length})`}>
        <table className="mb-3 w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">Mã</th><th>Tên</th><th>Phương thức</th><th>Vị trí</th><th /></tr></thead>
          <tbody>
            {checkpoints.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${c.status === 'inactive' ? 'text-slate-400' : ''}`}>
                <td className="py-2 font-mono">{c.code}</td>
                <td>{c.name}</td>
                <td>{c.allowed_methods.map((m) => METHOD_LABEL[m]).join(', ')}{c.require_photo ? ' · bắt buộc ảnh' : ''}</td>
                <td>{c.lat ? `${c.lat}, ${c.lng} (±${c.radius_m}m)` : '—'}</td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  {manage && (
                    <>
                      <Button variant="secondary" onClick={() => {
                        if (window.confirm(`In lại tem cho "${c.name}"? Tem cũ sẽ không quét được nữa.`)) {
                          void run(async () => { await api(`/checkpoints/${c.id}/rotate-qr`, { method: 'POST' }); });
                        }
                      }}>Đổi mã</Button>
                      <Button variant="secondary" onClick={() => run(async () => { await api(`/checkpoints/${c.id}`, { method: 'PATCH', json: { status: c.status === 'active' ? 'inactive' : 'active' } }); await load(); })}>
                        {c.status === 'active' ? 'Ngừng' : 'Dùng lại'}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!checkpoints.length && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Chưa có điểm tuần tra</td></tr>}
          </tbody>
        </table>
        {manage && (
          <form onSubmit={addCheckpoint} className="grid grid-cols-2 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-4">
            <Field label="Mã điểm"><Input value={cp.code} onChange={(e) => setCp({ ...cp, code: e.target.value })} required /></Field>
            <Field label="Tên điểm"><Input value={cp.name} onChange={(e) => setCp({ ...cp, name: e.target.value })} required /></Field>
            <Field label="Vĩ độ (nếu dùng GPS)"><Input value={cp.lat} onChange={(e) => setCp({ ...cp, lat: e.target.value })} /></Field>
            <Field label="Kinh độ"><Input value={cp.lng} onChange={(e) => setCp({ ...cp, lng: e.target.value })} /></Field>
            <Field label="Phương thức">
              <div className="flex flex-wrap gap-3 text-sm">
                {(Object.keys(METHOD_LABEL) as CheckMethod[]).map((m) => (
                  <label key={m} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={cp.methods.includes(m)}
                      onChange={() => setCp({ ...cp, methods: cp.methods.includes(m) ? cp.methods.filter((x) => x !== m) : [...cp.methods, m] })}
                    />
                    {METHOD_LABEL[m]}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Bán kính (m)"><Input type="number" min={5} max={500} value={cp.radius_m} onChange={(e) => setCp({ ...cp, radius_m: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cp.require_photo} onChange={(e) => setCp({ ...cp, require_photo: e.target.checked })} /> Bắt buộc chụp ảnh</label>
            <Button type="submit">Thêm điểm</Button>
          </form>
        )}
      </Card>

      <Card
        title="Tuyến tuần tra"
        actions={manage && !draftRoute ? <Button variant="secondary" onClick={() => setDraftRoute({ id: null, name: '', stops: [] })}>Tạo tuyến</Button> : undefined}
      >
        <ul className="space-y-2 text-sm">
          {routes.map((r) => (
            <li key={r.id} className="rounded border border-slate-200 p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.name}</span>
                {manage && (
                  <span className="space-x-2">
                    <Button variant="secondary" onClick={() => setDraftRoute({ id: r.id, name: r.name, stops: r.checkpoints.map((s) => ({ checkpoint_id: s.checkpoint_id, required: s.required })) })}>Sửa</Button>
                    <Button variant="secondary" onClick={() => run(async () => { await api(`/routes/${r.id}`, { method: 'DELETE' }); await load(); })}>Xoá</Button>
                  </span>
                )}
              </div>
              <ol className="mt-1 list-decimal pl-5 text-slate-600">
                {r.checkpoints.map((s) => <li key={s.seq}>{s.name}{s.required ? '' : ' (không bắt buộc)'}</li>)}
              </ol>
            </li>
          ))}
          {!routes.length && !draftRoute && <li className="text-slate-400">Chưa có tuyến</li>}
        </ul>

        {draftRoute && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <Field label="Tên tuyến"><Input value={draftRoute.name} onChange={(e) => setDraftRoute({ ...draftRoute, name: e.target.value })} /></Field>
            <ol className="space-y-1 text-sm">
              {draftRoute.stops.map((s, i) => (
                <li key={s.checkpoint_id} className="flex items-center gap-2">
                  <span className="w-6 text-right text-slate-400">{i + 1}.</span>
                  <span className="flex-1">{nameOf(s.checkpoint_id)}</span>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={s.required} onChange={() => setDraftRoute({ ...draftRoute, stops: draftRoute.stops.map((x, j) => (j === i ? { ...x, required: !x.required } : x)) })} />
                    bắt buộc
                  </label>
                  <button onClick={() => moveStop(i, -1)} className="px-1 text-slate-500">↑</button>
                  <button onClick={() => moveStop(i, 1)} className="px-1 text-slate-500">↓</button>
                  <button onClick={() => setDraftRoute({ ...draftRoute, stops: draftRoute.stops.filter((_, j) => j !== i) })} className="px-1 text-red-600">×</button>
                </li>
              ))}
            </ol>
            <Select
              value=""
              onChange={(e) => e.target.value && setDraftRoute({ ...draftRoute, stops: [...draftRoute.stops, { checkpoint_id: e.target.value, required: true }] })}
            >
              <option value="">+ Thêm điểm vào cuối tuyến</option>
              {active.filter((c) => !draftRoute.stops.some((s) => s.checkpoint_id === c.id)).map((c) => (
                <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
              ))}
            </Select>
            <div className="space-x-2">
              <Button onClick={saveRoute} disabled={!draftRoute.name || !draftRoute.stops.length}>Lưu tuyến</Button>
              <Button variant="secondary" onClick={() => setDraftRoute(null)}>Huỷ</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Kiểm tra build**

Run: `cd web && npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): sites with posts, checkpoints and route builder"
```

---

### Task 6: Web — trang in tem QR

**Files:**
- Create: `web/src/app/in-tem/[siteId]/page.tsx`
- Modify: `web/package.json` (thêm `qrcode`, dev `@types/qrcode`)

**Interfaces:**
- Consumes: `GET /api/sites/:id/qr-sheet`, `AuthProvider`.
- Produces: trang `/in-tem/[siteId]` — nằm **ngoài** nhóm `(app)` nên không có menu/thanh trên; lưới tem 3 cột × 4 hàng mỗi trang A4; mỗi tem có QR, tên điểm, mã điểm, tên mục tiêu, dòng "Quét bằng ứng dụng Patrol".

- [ ] **Step 1: Cài thư viện**

Run: `cd web && npm install qrcode && npm install -D @types/qrcode`
Expected: cài xong không lỗi.

- [ ] **Step 2: Viết trang**

`web/src/app/in-tem/[siteId]/page.tsx`:
```tsx
'use client';

import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';

interface Sheet {
  site: { id: string; code: string; name: string; client_name: string };
  tags: { id: string; code: string; name: string; payload: string }[];
}

function Tags() {
  const { siteId } = useParams<{ siteId: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const data = await api<Sheet>(`/sites/${siteId}/qr-sheet`);
      // Error correction H: a tag stays readable with a scratch or a bit of tape over it.
      const pairs = await Promise.all(
        data.tags.map(async (t) => [t.id, await QRCode.toString(t.payload, { type: 'svg', errorCorrectionLevel: 'H', margin: 1 })] as const),
      );
      setSvgs(Object.fromEntries(pairs));
      setSheet(data);
    })().catch((e) => setError(e instanceof Error ? e.message : 'Không tải được danh sách tem'));
  }, [siteId]);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!sheet) return <p className="p-8 text-slate-500">Đang tạo tem…</p>;

  return (
    <div className="mx-auto max-w-[210mm] p-4 print:p-0">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="no-print mb-4 flex items-center justify-between rounded bg-amber-50 p-3 text-sm text-amber-900">
        <span>
          {sheet.tags.length} tem cho <b>{sheet.site.name}</b> ({sheet.site.client_name}). Dán tem ở nơi khô, ngang tầm mắt; mỗi tem chỉ dán đúng điểm của nó.
        </span>
        <button onClick={() => window.print()} className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white">In / Lưu PDF</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {sheet.tags.map((t) => (
          <div key={t.id} className="flex break-inside-avoid flex-col items-center rounded border-2 border-slate-800 p-3 text-center" style={{ height: '64mm' }}>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{sheet.site.name}</div>
            <div className="h-[36mm] w-[36mm]" dangerouslySetInnerHTML={{ __html: svgs[t.id] ?? '' }} />
            <div className="mt-1 text-sm font-semibold leading-tight">{t.name}</div>
            <div className="font-mono text-xs text-slate-600">{t.code}</div>
            <div className="mt-auto text-[9px] text-slate-400">Quét bằng ứng dụng Patrol</div>
          </div>
        ))}
      </div>
      {!sheet.tags.length && <p className="text-slate-500">Mục tiêu chưa có điểm tuần tra đang hoạt động.</p>}
    </div>
  );
}

export default function PrintTagsPage() {
  return (
    <AuthProvider>
      <Tags />
    </AuthProvider>
  );
}
```

`dangerouslySetInnerHTML` ở đây an toàn: chuỗi SVG do thư viện `qrcode` sinh từ payload `PTR1.<uuid>.<base64url>` — không có dữ liệu người dùng nào đi vào SVG.

- [ ] **Step 3: Kiểm tra build và chạy thử**

Run: `cd web && npm run build`
Expected: `Compiled successfully`; route `/in-tem/[siteId]` xuất hiện.

Chạy thử: đăng nhập giám đốc demo → Mục tiêu → "Toà A — Khu nhà ở" → In tem QR: 5 tem, quét một tem bằng camera điện thoại (app quét QR bất kỳ) đọc ra chuỗi bắt đầu `PTR1.`; dán chuỗi đó vào `POST /api/checkpoints/resolve-qr` trả đúng tên điểm. Bấm "Đổi mã" ở một điểm → tải lại trang in → tem đó có mã mới; chuỗi cũ trả `QR_INVALID`.

- [ ] **Step 4: Chạy toàn bộ kiểm thử, commit**

Run: `cd backend && npm test && npm run test:e2e && cd ../web && npm run build`
Expected: tất cả PASS.

```bash
git add web
git commit -m "feat(web): printable signed QR tags per site"
```

---

## Sau plan này

- **Plan 04**: mẫu ca, xếp ca (chỉ cho bảo vệ đang được điều động tới khách của mục tiêu), đổi ca/trực thay; bảng `devices` (một máy mỗi bảo vệ, HR duyệt đổi máy); chấm công vào/ra ca (selfie + GPS + kiểm tra geofence `sites.geofence_radius_m`); app di động Capacitor 8 (đăng nhập, ca hôm nay, vào/ra ca) — build APK trên Codemagic như POS.
- **Plan 05**: lịch tuần tra, vòng tuần, check-in điểm (dùng `CheckpointsService.resolve` + toạ độ/bán kính điểm), hàng đợi offline.
