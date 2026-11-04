# Plan 01 — Nền móng (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng nền móng chạy được của Patrol: backend NestJS đa tenant với đăng nhập, vai trò, phạm vi, nhóm/đội/đội trưởng, nhân viên, người dùng, nhật ký thao tác; và web quản lý tối thiểu (đăng nhập, tổ chức, nhân viên, người dùng).

**Architecture:** Hai package độc lập như POS: `backend/` (NestJS 11 + TypeORM + PostgreSQL 16, tiền tố `/api`) và `web/` (Next.js 14, gọi `/api/*` qua rewrite nên cookie cùng origin). Mọi bảng nghiệp vụ có `tenant_id` lấy **chỉ từ token**. Route mặc định đóng: guard JWT toàn cục + guard quyền đọc quyền từ DB mỗi request. Phạm vi nhìn thấy dữ liệu suy ra từ `user_scopes` **và** từ cơ cấu tổ chức (quản lý của nhóm, đội trưởng của đội).

**Tech Stack:** Node 20 (Docker) / 22 (máy dev), NestJS 11, TypeORM 0.3.28, PostgreSQL 16 + `btree_gist`, passport-jwt, bcrypt, class-validator, @nestjs/throttler, Jest + supertest (e2e trên PostgreSQL thật), Next.js 14 + Tailwind 3.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` (bản 1.3) — plan này làm **§9 bước 1**. Bước 2 (khách hàng, hợp đồng, điều động) là Plan 02, viết sau khi plan này chạy xong để bám code thật.

**Khác với spec (có chủ đích):**
- Bỏ package `shared/` ở bước này (YAGNI): web lấy danh mục quyền qua API.
- Phạm vi `client` / `site` có trong schema nhưng API chỉ nhận `tenant` / `team_group` / `team`; Plan 02 mở thêm khi có bảng khách hàng.
- Bảng `devices` (một máy cho mỗi bảo vệ) để Plan 03 (app). Ở đây phiên đăng nhập là bảng `sessions`, nhiều phiên mỗi người.
- Đăng nhập bằng SĐT hoặc email **duy nhất toàn hệ thống** (không cần mã công ty). Cái giá: một số điện thoại không thể có tài khoản ở hai công ty cùng lúc.

## Global Constraints

- PostgreSQL 16, `TZ=Asia/Ho_Chi_Minh`; ngày nghiệp vụ tính theo giờ Việt Nam (`todayLocal()`), cột ngày là `date` trả về chuỗi `YYYY-MM-DD`.
- NestJS 11, TypeORM 0.3.28, Node 20 trong Docker.
- Phản hồi API: thành công `{ "data": ... }`, lỗi `{ "error": { "code", "message", "details?" } }`; mã lỗi tiếng Anh, thông điệp tiếng Việt.
- `tenant_id` chỉ lấy từ token — không bao giờ từ body/query/param.
- Guard toàn cục, mặc định đóng: `@Public()` mở hoàn toàn; `@AnyUser()` cho mọi người đã đăng nhập kể cả quản trị nền tảng; `@PlatformOnly()` chỉ quản trị nền tảng; còn lại cần người dùng thuộc tenant và mọi quyền trong `@RequirePermission(...)`.
- Không rẽ nhánh theo mã vai trò trong code nghiệp vụ. Ngoại lệ duy nhất, có ghi chú: vai trò hệ thống `admin` không sửa được và mỗi công ty luôn phải còn ≥ 1 người giữ nó.
- Không ai cấp được quyền hoặc phạm vi vượt quá của chính mình.
- Mọi thao tác ghi quan trọng ghi `audit_logs`.
- Giao diện web tiếng Việt.

## Review Focus

1. **Đoán id để đọc/sửa dữ liệu công ty khác** (GET/PATCH/PUT theo id, gán nhân viên/vai trò/đội của tenant khác) → luôn 404 hoặc `SCOPE_INVALID`, không rò dữ liệu — test ở Task 9 (`tenancy.e2e-spec.ts`).
2. **Leo thang quyền**: HR tự cấp vai trò Quản trị, sửa vai trò có quyền mình không có, đặt lại mật khẩu của người mạnh hơn, quản trị cuối cùng tự gỡ vai trò → 403/400 — test ở Task 6 và Task 8.
3. **Token bị lộ**: refresh token cũ dùng lại, đăng xuất mà access token vẫn chạy, khoá người dùng/công ty mà phiên vẫn sống → 401 ngay — test ở Task 5.
4. **Số điện thoại nhiều dạng** (`+84 912…`, `0912.345.678`, `84912…`) khi tạo và khi đăng nhập; trùng số giữa hai công ty → đăng nhập được và báo trùng đúng — test ở Task 1 (unit), Task 5 và Task 8.
5. **Chuyển đội theo ngày**: chuyển trong cùng ngày vào đội, chuyển hồi tố, ngày tương lai, đội trưởng bị chuyển đi → không chồng lịch, đội trưởng tự gỡ — test ở Task 7.

---

## File Structure

```
.gitignore
README.md                                   hướng dẫn chạy (tiếng Việt)
docker-compose.yml                          PostgreSQL dev, cổng 5433
docker/postgres-init/01-test-db.sql         tạo DB patrol_test
backend/
  package.json  tsconfig.json  tsconfig.build.json  nest-cli.json  .env.example
  src/main.ts                               khởi động
  src/app.setup.ts                          prefix, pipe, filter, cookie — dùng chung main & test
  src/app.module.ts  src/app.controller.ts  (health)
  src/config/env.ts                         đọc biến môi trường
  src/common/identifiers.ts (+spec)         chuẩn hoá SĐT/email
  src/common/date.ts (+spec)                todayLocal, addDays
  src/common/errors/{error-codes,business.exception,all-exceptions.filter,validation}.ts
  src/common/envelope.interceptor.ts        bọc { data }
  src/common/entities/base.entity.ts        TimestampedEntity, TenantEntity
  src/common/tenant-repository.ts           repository luôn lọc tenant_id
  src/database/data-source.ts               cấu hình TypeORM + CLI
  src/database/migrations/1760227200000-Foundation.ts
  src/tenants/   tenant.entity, tenants.service, platform-tenants.controller, dto, module
  src/users/     user.entity, users.service, users.controller, dto, module
  src/auth/      session.entity, auth-user, decorators, password, cookies, jwt.strategy,
                 jwt-auth.guard, auth.service, auth.controller, dto, module
  src/access/    permissions (danh mục + vai trò mẫu), role.entity, scope.types,
                 permission.service, scope.service, access.service, permission.guard,
                 roles.service, roles.controller, dto, module
  src/audit/     audit-log.entity, audit.service, module
  src/employees/ employee.entity, employees.service, employees.controller, dto, module
  src/org/       team-group.entity, team.entity, team-member.entity, org.service,
                 org.controller, dto, module
  src/scripts/   create-platform-admin.ts, seed-demo.ts
  test/          jest-e2e.json, test-env.ts, helpers.ts, *.e2e-spec.ts
web/
  package.json  next.config.mjs  tsconfig.json  tailwind.config.ts  postcss.config.mjs
  src/app/layout.tsx  globals.css  dang-nhap/page.tsx
  src/app/(app)/layout.tsx  page.tsx  to-chuc/page.tsx  nhan-vien/page.tsx
  src/app/(app)/nguoi-dung/page.tsx  doi-mat-khau/page.tsx
  src/lib/api.ts  auth.tsx  types.ts
  src/components/ui.tsx  shell.tsx
```

---

### Task 1: Khung repo, PostgreSQL dev, tiện ích chuẩn hoá

**Files:**
- Create: `.gitignore`, `docker-compose.yml`, `docker/postgres-init/01-test-db.sql`
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/nest-cli.json`, `backend/.env.example`
- Create: `backend/src/config/env.ts`, `backend/src/common/identifiers.ts`, `backend/src/common/date.ts`
- Test: `backend/src/common/identifiers.spec.ts`, `backend/src/common/date.spec.ts`

**Interfaces:**
- Produces: `getEnv(name, fallback?)`, `getSecretEnv(name, fallback, min=32)`, `jwtSecret()`, `accessTtlSeconds()`, `refreshTtlDays()`, `bcryptRounds()`; `normalizePhone(raw): string`, `normalizeEmail(raw): string`, `parseIdentifier(raw): { phone: string } | { email: string }`, `PHONE_PATTERN`; `todayLocal(now?: Date): string`, `addDays(isoDate: string, days: number): string`.

- [ ] **Step 1: Tạo file gốc**

`.gitignore`:
```
node_modules/
dist/
.next/
coverage/
.env
uploads/
*.tsbuildinfo
```

`docker-compose.yml`:
```yaml
# Chỉ dùng khi phát triển trên máy. Bản chạy VPS ở deploy/ (Plan 09).
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: patrol
      POSTGRES_PASSWORD: patrol
      POSTGRES_DB: patrol
      TZ: Asia/Ho_Chi_Minh
      PGTZ: Asia/Ho_Chi_Minh
    ports:
      - '5433:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro

volumes:
  pgdata:
```

`docker/postgres-init/01-test-db.sql`:
```sql
-- Test e2e chạy trên DB riêng, xoá sạch mỗi lần — không bao giờ đụng DB đang dùng thử.
CREATE DATABASE patrol_test OWNER patrol;
```

- [ ] **Step 2: Tạo cấu hình backend**

`backend/package.json`:
```json
{
  "name": "patrol-backend",
  "version": "0.1.0",
  "private": true,
  "license": "UNLICENSED",
  "scripts": {
    "build": "nest build",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "typeorm": "ts-node ./node_modules/typeorm/cli.js -d src/database/data-source.ts",
    "migration:run": "npm run typeorm migration:run",
    "migration:revert": "npm run typeorm migration:revert",
    "migration:run:prod": "node ./node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run",
    "create-platform-admin": "ts-node src/scripts/create-platform-admin.ts",
    "seed:demo": "ts-node src/scripts/seed-demo.ts",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/core": "^11.0.1",
    "@nestjs/jwt": "^11.0.2",
    "@nestjs/passport": "^11.0.5",
    "@nestjs/platform-express": "^11.0.1",
    "@nestjs/throttler": "^6.4.0",
    "@nestjs/typeorm": "^11.0.0",
    "bcrypt": "^6.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.1",
    "cookie-parser": "^1.4.7",
    "dotenv": "^16.4.5",
    "helmet": "^8.1.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pg": "^8.20.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.28"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.1",
    "@types/bcrypt": "^6.0.0",
    "@types/cookie-parser": "^1.4.10",
    "@types/express": "^5.0.0",
    "@types/jest": "^30.0.0",
    "@types/node": "^22.0.0",
    "@types/passport-jwt": "^4.0.1",
    "@types/supertest": "^7.0.0",
    "jest": "^30.0.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.3"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "testEnvironment": "node"
  }
}
```

`backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "baseUrl": "./",
    "sourceMap": true,
    "incremental": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "useUnknownInCatchVariables": false,
    "forceConsistentCasingInFileNames": true
  }
}
```

`backend/tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"] }
```

`backend/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

`backend/.env.example`:
```
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=patrol
DB_PASSWORD=patrol
DB_DATABASE=patrol
JWT_SECRET=dev-access-secret-change-me-0123456789
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_DAYS=30
BCRYPT_ROUNDS=12
LOGIN_RATE_LIMIT=10
# Chỉ cần khi app di động gọi thẳng API (Plan 03). Không bao giờ để "*".
CORS_ORIGIN=
PLATFORM_ADMIN_EMAIL=
PLATFORM_ADMIN_PASSWORD=
```

- [ ] **Step 3: Cài thư viện và khởi động PostgreSQL**

Run:
```bash
cd backend && npm install && cp .env.example .env && cd .. && docker compose up -d postgres
```
Expected: `npm install` không lỗi; `docker compose ps` thấy `postgres` trạng thái `running`.

- [ ] **Step 4: Viết test thất bại cho tiện ích**

`backend/src/common/identifiers.spec.ts`:
```ts
import { normalizePhone, parseIdentifier, PHONE_PATTERN } from './identifiers';

describe('normalizePhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['(091) 234-5678', '0912345678'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('leaves a short number starting with 84 alone', () => {
    expect(normalizePhone('8412')).toBe('8412');
  });

  it('PHONE_PATTERN accepts 10–11 digit local numbers only', () => {
    expect(PHONE_PATTERN.test('0912345678')).toBe(true);
    expect(PHONE_PATTERN.test('912345678')).toBe(false);
    expect(PHONE_PATTERN.test('09123')).toBe(false);
  });
});

describe('parseIdentifier', () => {
  it('treats anything with @ as an email, lower-cased', () => {
    expect(parseIdentifier('  An.Nguyen@Example.COM ')).toEqual({ email: 'an.nguyen@example.com' });
  });
  it('treats the rest as a phone number', () => {
    expect(parseIdentifier('+84912345678')).toEqual({ phone: '0912345678' });
  });
});
```

`backend/src/common/date.spec.ts`:
```ts
import { addDays, todayLocal } from './date';

describe('todayLocal', () => {
  it('uses Vietnam time, not UTC', () => {
    // 18:30 UTC on the 12th is 01:30 on the 13th in Hanoi.
    expect(todayLocal(new Date('2026-10-12T18:30:00Z'))).toBe('2026-10-13');
    expect(todayLocal(new Date('2026-10-12T16:59:00Z'))).toBe('2026-10-12');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
```

- [ ] **Step 5: Chạy test để thấy thất bại**

Run: `cd backend && npx jest src/common`
Expected: FAIL — `Cannot find module './identifiers'` và `'./date'`.

- [ ] **Step 6: Viết code**

`backend/src/config/env.ts`:
```ts
const isProduction = () => process.env.NODE_ENV === 'production';

export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

/** A secret with a dev fallback that refuses to start production with a weak value. */
export function getSecretEnv(name: string, fallback: string, minLengthInProduction = 32): string {
  const value = getEnv(name, isProduction() ? undefined : fallback);
  if (isProduction() && value.length < minLengthInProduction) {
    throw new Error(`${name} must be at least ${minLengthInProduction} characters in production`);
  }
  return value;
}

export const DEV_JWT_SECRET = 'dev-access-secret-change-me-0123456789';
export const jwtSecret = () => getSecretEnv('JWT_SECRET', DEV_JWT_SECRET);
export const accessTtlSeconds = () => parseInt(getEnv('JWT_ACCESS_TTL_SECONDS', '900'), 10);
export const refreshTtlDays = () => parseInt(getEnv('JWT_REFRESH_TTL_DAYS', '30'), 10);
export const bcryptRounds = () => parseInt(getEnv('BCRYPT_ROUNDS', '12'), 10);
```

`backend/src/common/identifiers.ts`:
```ts
/** Vietnamese local format: 0 followed by 9–10 digits. */
export const PHONE_PATTERN = /^0\d{9,10}$/;

/**
 * Guards type their number however their phone shows it. Store and compare one
 * form only, or "+84 912…" and "0912…" become two different accounts.
 */
export function normalizePhone(raw: string): string {
  let phone = raw.replace(/[\s.\-()]/g, '');
  if (phone.startsWith('+84')) phone = '0' + phone.slice(3);
  else if (phone.startsWith('84') && phone.length === 11) phone = '0' + phone.slice(2);
  return phone;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseIdentifier(raw: string): { phone: string } | { email: string } {
  const value = raw.trim();
  return value.includes('@') ? { email: normalizeEmail(value) } : { phone: normalizePhone(value) };
}
```

`backend/src/common/date.ts`:
```ts
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Today's date in Vietnam as YYYY-MM-DD, whatever the server clock's zone is. */
export function todayLocal(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Calendar arithmetic on a YYYY-MM-DD string, free of time-zone drift. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
```

- [ ] **Step 7: Chạy test để thấy đạt**

Run: `cd backend && npx jest src/common`
Expected: PASS — 2 suites, 11 tests.

- [ ] **Step 8: Commit**

```bash
git add .gitignore docker-compose.yml docker backend
git commit -m "chore: scaffold backend, dev postgres, identifier and date utils"
```

---

### Task 2: Khởi động ứng dụng, khuôn phản hồi & lỗi, bộ test e2e

**Files:**
- Create: `backend/src/common/errors/error-codes.ts`, `business.exception.ts`, `all-exceptions.filter.ts`, `validation.ts`
- Create: `backend/src/common/envelope.interceptor.ts`
- Create: `backend/src/database/data-source.ts`
- Create: `backend/src/app.setup.ts`, `backend/src/app.module.ts`, `backend/src/app.controller.ts`, `backend/src/main.ts`
- Create: `backend/test/jest-e2e.json`, `backend/test/test-env.ts`, `backend/test/helpers.ts`
- Test: `backend/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: `getEnv` (Task 1).
- Produces: `ERROR_CODES`, `ErrorCode`; `class BusinessException(code: ErrorCode, details?: unknown)` với thuộc tính `code`, `details`; `buildDataSourceOptions(): DataSourceOptions`; `configureApp(app: NestExpressApplication): void`; test helpers `createTestApp(): Promise<{ app: NestExpressApplication; ds: DataSource }>`, `server(app)`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/jest-e2e.json`:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "roots": ["<rootDir>/test"],
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "testEnvironment": "node",
  "testTimeout": 30000,
  "setupFiles": ["<rootDir>/test/test-env.ts"]
}
```

`backend/test/test-env.ts`:
```ts
// Runs before any application module is imported, so these win over backend/.env
// (dotenv never overrides a variable that is already set).
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST_TEST ?? 'localhost';
process.env.DB_PORT = process.env.DB_PORT_TEST ?? '5433';
process.env.DB_USERNAME = process.env.DB_USERNAME_TEST ?? 'patrol';
process.env.DB_PASSWORD = process.env.DB_PASSWORD_TEST ?? 'patrol';
process.env.DB_DATABASE = process.env.DB_DATABASE_TEST ?? 'patrol_test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef';
process.env.BCRYPT_ROUNDS = '4';
process.env.LOGIN_RATE_LIMIT = '1000';
```

`backend/test/helpers.ts`:
```ts
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { buildDataSourceOptions } from '../src/database/data-source';

/** Wipe the test database, replay every migration, and boot the real app. */
export async function createTestApp(): Promise<{ app: NestExpressApplication; ds: DataSource }> {
  const bootstrap = new DataSource(buildDataSourceOptions());
  await bootstrap.initialize();
  await bootstrap.query('DROP SCHEMA public CASCADE');
  await bootstrap.query('CREATE SCHEMA public');
  await bootstrap.runMigrations();
  await bootstrap.destroy();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, ds: app.get(DataSource) };
}

export const server = (app: NestExpressApplication) => app.getHttpServer();
```

`backend/test/health.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp, server } from './helpers';

describe('App shell (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(async () => app.close());

  it('wraps success in { data }', async () => {
    const res = await request(server(app)).get('/api/health').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('answers unknown routes with the error envelope', async () => {
    const res = await request(server(app)).get('/api/khong-co').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu' } });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- health`
Expected: FAIL — `Cannot find module '../src/app.module'`.

- [ ] **Step 3: Viết code**

`backend/src/common/errors/error-codes.ts`:
```ts
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, message: 'Dữ liệu không hợp lệ' },
  AUTH_INVALID_CREDENTIALS: { status: 401, message: 'Sai tài khoản hoặc mật khẩu' },
  AUTH_UNAUTHENTICATED: { status: 401, message: 'Bạn cần đăng nhập' },
  AUTH_REFRESH_INVALID: { status: 401, message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' },
  AUTH_FORBIDDEN: { status: 403, message: 'Bạn không có quyền thực hiện thao tác này' },
  AUTH_TENANT_SUSPENDED: { status: 403, message: 'Tài khoản công ty đang bị tạm khoá' },
  AUTH_WRONG_PASSWORD: { status: 400, message: 'Mật khẩu hiện tại không đúng' },
  NOT_FOUND: { status: 404, message: 'Không tìm thấy dữ liệu' },
  RATE_LIMITED: { status: 429, message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút' },
  TENANT_CODE_TAKEN: { status: 409, message: 'Mã công ty đã tồn tại' },
  USER_IDENTIFIER_REQUIRED: { status: 400, message: 'Cần số điện thoại hoặc email' },
  USER_IDENTIFIER_TAKEN: { status: 409, message: 'Số điện thoại hoặc email đã được dùng' },
  USER_EMPLOYEE_TAKEN: { status: 409, message: 'Nhân viên này đã có tài khoản' },
  USER_CANNOT_LOCK_SELF: { status: 400, message: 'Không thể tự khoá tài khoản của mình' },
  LAST_ADMIN: { status: 400, message: 'Công ty phải còn ít nhất một người Quản trị' },
  ROLE_ESCALATION: { status: 403, message: 'Không thể cấp quyền hoặc phạm vi vượt quá của bạn' },
  ROLE_CODE_TAKEN: { status: 409, message: 'Mã vai trò đã tồn tại' },
  ROLE_ADMIN_LOCKED: { status: 400, message: 'Không sửa được vai trò Quản trị' },
  SCOPE_INVALID: { status: 400, message: 'Phạm vi không hợp lệ' },
  EMPLOYEE_CODE_TAKEN: { status: 409, message: 'Mã nhân viên đã tồn tại' },
  EMPLOYEE_INACTIVE: { status: 400, message: 'Nhân viên đã nghỉ việc' },
  ORG_GROUP_NOT_EMPTY: { status: 409, message: 'Nhóm còn đội, không xoá được' },
  ORG_TEAM_NOT_EMPTY: { status: 409, message: 'Đội còn thành viên, không xoá được' },
  ORG_LEADER_NOT_MEMBER: { status: 400, message: 'Đội trưởng phải là thành viên hiện tại của đội' },
  ORG_MEMBERSHIP_CONFLICT: { status: 409, message: 'Nhân viên đã thuộc một đội khác sau ngày này' },
  ORG_DATE_IN_FUTURE: { status: 400, message: 'Ngày không được ở tương lai' },
  INTERNAL_ERROR: { status: 500, message: 'Lỗi hệ thống, vui lòng thử lại' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
```

`backend/src/common/errors/business.exception.ts`:
```ts
import { HttpException } from '@nestjs/common';
import { ERROR_CODES, ErrorCode } from './error-codes';

/** The only exception business code throws. Status and Vietnamese message come from the code. */
export class BusinessException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
  ) {
    super(ERROR_CODES[code].message, ERROR_CODES[code].status);
  }
}
```

`backend/src/common/errors/validation.ts`:
```ts
import { ValidationError } from 'class-validator';

export function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => `${path}: ${message}`);
    return [...own, ...flattenValidationErrors(error.children ?? [], path)];
  });
}
```

`backend/src/common/errors/all-exceptions.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BusinessException } from './business.exception';
import { ERROR_CODES } from './error-codes';

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

const CODE_BY_STATUS: Record<number, keyof typeof ERROR_CODES> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_UNAUTHENTICATED',
  403: 'AUTH_FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

export function toErrorBody(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof BusinessException) {
    const error: ErrorBody['error'] = { code: exception.code, message: exception.message };
    if (exception.details !== undefined) error.details = exception.details;
    return { status: exception.getStatus(), body: { error } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = CODE_BY_STATUS[status];
    return code
      ? { status, body: { error: { code, message: ERROR_CODES[code].message } } }
      : { status, body: { error: { code: `HTTP_${status}`, message: exception.message } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: ERROR_CODES.INTERNAL_ERROR.message } } };
}

/**
 * Unexpected errors are logged with their stack but never echoed: SQL messages
 * leak table names and data.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    if (response.headersSent) {
      response.end();
      return;
    }
    const { status, body } = toErrorBody(exception);
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(status).json(body);
  }
}
```

`backend/src/common/envelope.interceptor.ts`:
```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<{ data: unknown }> {
    return next.handle().pipe(map((data: unknown) => ({ data: data ?? null })));
  }
}
```

`backend/src/database/data-source.ts`:
```ts
import 'dotenv/config';
import { types } from 'pg';
import { DataSource, DataSourceOptions } from 'typeorm';
import { getEnv } from '../config/env';

// PostgreSQL `date` (OID 1082) stays a plain YYYY-MM-DD string. As a JS Date it
// would shift by the server's UTC offset and a shift on the 13th lands on the 12th.
types.setTypeParser(1082, (value: string) => value);

export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: getEnv('DB_HOST', 'localhost'),
    port: parseInt(getEnv('DB_PORT', '5433'), 10),
    username: getEnv('DB_USERNAME', 'patrol'),
    password: getEnv('DB_PASSWORD', 'patrol'),
    database: getEnv('DB_DATABASE', 'patrol'),
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    synchronize: false,
    logging: false,
  };
}

export default new DataSource(buildDataSourceOptions());
```

`backend/src/app.setup.ts`:
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { BusinessException } from './common/errors/business.exception';
import { flattenValidationErrors } from './common/errors/validation';

/** Everything main.ts and the e2e tests must configure identically. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  // nginx on the same host is the only proxy; trust it for the client IP (rate limiting).
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cookieParser());

  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGIN must list explicit origins: cookies are sent with credentials');
  }
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BusinessException('VALIDATION_FAILED', flattenValidationErrors(errors)),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
```

`backend/src/app.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
```

`backend/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { buildDataSourceOptions } from './database/data-source';

@Module({
  imports: [TypeOrmModule.forRootAsync({ useFactory: buildDataSourceOptions })],
  controllers: [AppController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor }],
})
export class AppModule {}
```

`backend/src/main.ts`:
```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { getEnv } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  await app.listen(parseInt(getEnv('PORT', '3001'), 10));
}
void bootstrap();
```

Tạo thư mục migrations rỗng để TypeORM không báo thiếu: `mkdir -p backend/src/database/migrations`.

- [ ] **Step 4: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- health`
Expected: PASS — 2 tests. (Nếu báo `ECONNREFUSED 5433`: chạy `docker compose up -d postgres` rồi thử lại.)

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): app bootstrap, response envelope, error filter, e2e harness"
```

---

### Task 3: Schema nền móng (migration + entity)

**Files:**
- Create: `backend/src/database/migrations/1760227200000-Foundation.ts`
- Create: `backend/src/common/entities/base.entity.ts`, `backend/src/common/tenant-repository.ts`
- Create: `backend/src/tenants/tenant.entity.ts`, `backend/src/users/user.entity.ts`, `backend/src/auth/session.entity.ts`
- Create: `backend/src/access/role.entity.ts`, `backend/src/access/scope.types.ts`
- Create: `backend/src/employees/employee.entity.ts`
- Create: `backend/src/org/team-group.entity.ts`, `backend/src/org/team.entity.ts`, `backend/src/org/team-member.entity.ts`
- Create: `backend/src/audit/audit-log.entity.ts`
- Test: `backend/test/schema.e2e-spec.ts`

**Interfaces:**
- Consumes: `BusinessException` (Task 2).
- Produces: entity classes `Tenant`, `User` (+ `UserType`), `Session`, `Role`, `RolePermission`, `UserRole`, `UserScope`, `Employee`, `TeamGroup`, `Team`, `TeamMember`, `AuditLog`; `ScopeType`, `ScopeInput`; `class TenantRepository<T extends TenantEntity>` với `find(tenantId, options?)`, `findOne(tenantId, where)`, `get(tenantId, id)` (ném `NOT_FOUND`), `create(tenantId, data)`, `update(tenantId, id, patch)`, `softDelete(tenantId, id)`; helper `where<T>(obj)`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/schema.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTestApp } from './helpers';

describe('Foundation schema (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  async function seedTenantEmployeeTeams() {
    const [tenant] = await ds.query(`INSERT INTO tenants (code, name) VALUES ('s1', 'S1') RETURNING id`);
    const [employee] = await ds.query(
      `INSERT INTO employees (tenant_id, code, full_name) VALUES ($1, 'NV1', 'An') RETURNING id`,
      [tenant.id],
    );
    const [teamA] = await ds.query(`INSERT INTO teams (tenant_id, name) VALUES ($1, 'A') RETURNING id`, [tenant.id]);
    const [teamB] = await ds.query(`INSERT INTO teams (tenant_id, name) VALUES ($1, 'B') RETURNING id`, [tenant.id]);
    return { tenantId: tenant.id as string, employeeId: employee.id as string, teamA: teamA.id as string, teamB: teamB.id as string };
  }

  it('creates every foundation table', async () => {
    const rows: { table_name: string }[] = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const table of [
      'tenants', 'users', 'sessions', 'roles', 'role_permissions', 'user_roles', 'user_scopes',
      'employees', 'team_groups', 'teams', 'team_members', 'audit_logs',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('refuses two team memberships that overlap in time', async () => {
    const s = await seedTenantEmployeeTeams();
    await ds.query(
      `INSERT INTO team_members (tenant_id, team_id, employee_id, start_date, end_date) VALUES ($1, $2, $3, '2026-01-01', '2026-03-31')`,
      [s.tenantId, s.teamA, s.employeeId],
    );
    await expect(
      ds.query(
        `INSERT INTO team_members (tenant_id, team_id, employee_id, start_date) VALUES ($1, $2, $3, '2026-03-31')`,
        [s.tenantId, s.teamB, s.employeeId],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
    // The day after is fine.
    await ds.query(
      `INSERT INTO team_members (tenant_id, team_id, employee_id, start_date) VALUES ($1, $2, $3, '2026-04-01')`,
      [s.tenantId, s.teamB, s.employeeId],
    );
  });

  it('requires a tenant for every user except the platform admin', async () => {
    await expect(
      ds.query(`INSERT INTO users (user_type, full_name, phone, password_hash) VALUES ('staff', 'X', '0911111111', 'h')`),
    ).rejects.toMatchObject({ code: '23514' });
    await ds.query(
      `INSERT INTO users (user_type, full_name, email, password_hash) VALUES ('platform_admin', 'P', 'p@x.vn', 'h')`,
    );
  });

  it('keeps phone numbers unique across companies', async () => {
    const [t1] = await ds.query(`INSERT INTO tenants (code, name) VALUES ('u1', 'U1') RETURNING id`);
    const [t2] = await ds.query(`INSERT INTO tenants (code, name) VALUES ('u2', 'U2') RETURNING id`);
    await ds.query(
      `INSERT INTO users (tenant_id, user_type, full_name, phone, password_hash) VALUES ($1, 'guard', 'A', '0922222222', 'h')`,
      [t1.id],
    );
    await expect(
      ds.query(
        `INSERT INTO users (tenant_id, user_type, full_name, phone, password_hash) VALUES ($1, 'guard', 'B', '0922222222', 'h')`,
        [t2.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- schema`
Expected: FAIL — `relation "tenants" does not exist`.

- [ ] **Step 3: Viết migration**

`backend/src/database/migrations/1760227200000-Foundation.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Foundation1760227200000 implements MigrationInterface {
  name = 'Foundation1760227200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    await q.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(40) NOT NULL UNIQUE,
        name varchar(200) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE employees (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        code varchar(30) NOT NULL,
        full_name varchar(200) NOT NULL,
        phone varchar(20),
        position varchar(50) NOT NULL DEFAULT 'guard',
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX employees_tenant_code_uq ON employees (tenant_id, lower(code)) WHERE deleted_at IS NULL`);

    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES tenants(id),
        user_type varchar(20) NOT NULL CHECK (user_type IN ('platform_admin', 'staff', 'guard', 'client_user')),
        full_name varchar(200) NOT NULL,
        phone varchar(20),
        email varchar(200),
        password_hash varchar(100) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
        employee_id uuid REFERENCES employees(id),
        must_change_password boolean NOT NULL DEFAULT false,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT users_tenant_matches_type CHECK ((user_type = 'platform_admin') = (tenant_id IS NULL)),
        CONSTRAINT users_identifier_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
      )`);
    await q.query(`CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX users_employee_uq ON users (employee_id) WHERE deleted_at IS NULL AND employee_id IS NOT NULL`);

    await q.query(`
      CREATE TABLE sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        device_label varchar(200),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
      )`);
    await q.query(`CREATE INDEX sessions_user_idx ON sessions (user_id)`);

    await q.query(`
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        code varchar(50) NOT NULL,
        name varchar(100) NOT NULL,
        is_system boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX roles_tenant_code_uq ON roles (tenant_id, code) WHERE deleted_at IS NULL`);
    await q.query(`
      CREATE TABLE role_permissions (
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission varchar(80) NOT NULL,
        PRIMARY KEY (role_id, permission)
      )`);
    await q.query(`
      CREATE TABLE user_roles (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      )`);

    await q.query(`
      CREATE TABLE team_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        name varchar(100) NOT NULL,
        manager_user_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`
      CREATE TABLE teams (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        name varchar(100) NOT NULL,
        team_group_id uuid REFERENCES team_groups(id),
        leader_employee_id uuid REFERENCES employees(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )`);
    await q.query(`
      CREATE TABLE team_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        team_id uuid NOT NULL REFERENCES teams(id),
        employee_id uuid NOT NULL REFERENCES employees(id),
        start_date date NOT NULL,
        end_date date,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT team_members_dates CHECK (end_date IS NULL OR end_date >= start_date),
        CONSTRAINT team_members_no_overlap EXCLUDE USING gist (
          employee_id WITH =,
          daterange(start_date, end_date, '[]') WITH &&
        )
      )`);
    await q.query(`CREATE INDEX team_members_team_idx ON team_members (team_id)`);

    await q.query(`
      CREATE TABLE user_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope_type varchar(20) NOT NULL CHECK (scope_type IN ('tenant', 'team_group', 'team', 'client', 'site')),
        scope_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT user_scopes_shape CHECK ((scope_type = 'tenant') = (scope_id IS NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX user_scopes_uq ON user_scopes (user_id, scope_type, scope_id) NULLS NOT DISTINCT`);

    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES tenants(id),
        actor_user_id uuid REFERENCES users(id),
        action varchar(80) NOT NULL,
        entity_type varchar(50) NOT NULL,
        entity_id uuid,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'audit_logs', 'user_scopes', 'team_members', 'teams', 'team_groups', 'user_roles',
      'role_permissions', 'roles', 'sessions', 'users', 'employees', 'tenants',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
```

- [ ] **Step 4: Viết entity và repository**

`backend/src/common/entities/base.entity.ts`:
```ts
import { Column, CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export abstract class TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

export abstract class TenantEntity extends TimestampedEntity {
  @Column('uuid')
  tenant_id: string;
}
```

`backend/src/common/tenant-repository.ts`:
```ts
import { DeepPartial, FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
import { TenantEntity } from './entities/base.entity';
import { BusinessException } from './errors/business.exception';

/** Typed escape hatch for building `where` objects on a generic entity. */
export const where = <T>(value: object) => value as unknown as FindOptionsWhere<T>;

/**
 * A repository that cannot forget the tenant. Every read adds `tenant_id`, every
 * write sets it, and a row of another tenant is indistinguishable from a missing one.
 */
export class TenantRepository<T extends TenantEntity> {
  constructor(readonly raw: Repository<T>) {}

  private scoped(tenantId: string, filter?: FindOptionsWhere<T> | FindOptionsWhere<T>[]) {
    const add = (w: FindOptionsWhere<T>) => where<T>({ ...w, tenant_id: tenantId });
    return Array.isArray(filter) ? filter.map(add) : add(filter ?? where<T>({}));
  }

  find(tenantId: string, options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.raw.find({ ...options, where: this.scoped(tenantId, options.where) });
  }

  findOne(tenantId: string, filter: FindOptionsWhere<T>): Promise<T | null> {
    return this.raw.findOne({ where: this.scoped(tenantId, filter) });
  }

  async get(tenantId: string, id: string): Promise<T> {
    const entity = await this.findOne(tenantId, where<T>({ id }));
    if (!entity) throw new BusinessException('NOT_FOUND');
    return entity;
  }

  create(tenantId: string, data: DeepPartial<T>): Promise<T> {
    return this.raw.save(this.raw.create({ ...data, tenant_id: tenantId } as DeepPartial<T>));
  }

  async update(tenantId: string, id: string, patch: DeepPartial<T>): Promise<T> {
    const entity = await this.get(tenantId, id);
    this.raw.merge(entity, patch);
    entity.tenant_id = tenantId; // a patch can never move a row to another tenant
    return this.raw.save(entity);
  }

  /** Only for entities with a @DeleteDateColumn. */
  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.get(tenantId, id);
    await this.raw.softDelete(where<T>({ id, tenant_id: tenantId }));
  }
}
```

`backend/src/tenants/tenant.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TimestampedEntity } from '../common/entities/base.entity';

@Entity('tenants')
export class Tenant extends TimestampedEntity {
  @Column({ length: 40, unique: true })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'suspended';

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  settings: Record<string, unknown>;
}
```

`backend/src/users/user.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TimestampedEntity } from '../common/entities/base.entity';

export type UserType = 'platform_admin' | 'staff' | 'guard' | 'client_user';

@Entity('users')
export class User extends TimestampedEntity {
  @Column({ type: 'uuid', nullable: true })
  tenant_id: string | null;

  @Column({ type: 'varchar', length: 20 })
  user_type: UserType;

  @Column({ length: 200 })
  full_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  @Column({ length: 100, select: false })
  password_hash: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'locked';

  @Column({ type: 'uuid', nullable: true })
  employee_id: string | null;

  @Column({ default: false })
  must_change_password: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/auth/session.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  user_id: string;

  @Column({ length: 64 })
  token_hash: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  device_label: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz' })
  last_used_at: Date;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;
}
```

`backend/src/access/scope.types.ts`:
```ts
export type ScopeType = 'tenant' | 'team_group' | 'team' | 'client' | 'site';

export interface ScopeInput {
  scope_type: ScopeType;
  scope_id?: string | null;
}
```

`backend/src/access/role.entity.ts`:
```ts
import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';
import { ScopeType } from './scope.types';

@Entity('roles')
export class Role extends TenantEntity {
  @Column({ length: 50 })
  code: string;

  @Column({ length: 100 })
  name: string;

  @Column({ default: false })
  is_system: boolean;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}

@Entity('role_permissions')
export class RolePermission {
  @PrimaryColumn('uuid')
  role_id: string;

  @PrimaryColumn({ length: 80 })
  permission: string;
}

@Entity('user_roles')
export class UserRole {
  @PrimaryColumn('uuid')
  user_id: string;

  @PrimaryColumn('uuid')
  role_id: string;
}

@Entity('user_scopes')
export class UserScope {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  tenant_id: string;

  @Column('uuid')
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  scope_type: ScopeType;

  @Column({ type: 'uuid', nullable: true })
  scope_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
```

`backend/src/employees/employee.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('employees')
export class Employee extends TenantEntity {
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  full_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ length: 50, default: 'guard' })
  position: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'inactive';

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/org/team-group.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('team_groups')
export class TeamGroup extends TenantEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  manager_user_id: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/org/team.entity.ts`:
```ts
import { Column, DeleteDateColumn, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

@Entity('teams')
export class Team extends TenantEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  team_group_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  leader_employee_id: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
```

`backend/src/org/team-member.entity.ts`:
```ts
import { Column, Entity } from 'typeorm';
import { TenantEntity } from '../common/entities/base.entity';

/** One row per stay in a team. The database refuses overlapping stays for one employee. */
@Entity('team_members')
export class TeamMember extends TenantEntity {
  @Column('uuid')
  team_id: string;

  @Column('uuid')
  employee_id: string;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;
}
```

`backend/src/audit/audit-log.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  actor_user_id: string | null;

  @Column({ length: 80 })
  action: string;

  @Column({ length: 50 })
  entity_type: string;

  @Column({ type: 'uuid', nullable: true })
  entity_id: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  data: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
```

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- schema`
Expected: PASS — 4 tests.

- [ ] **Step 6: Chạy migration trên DB dev**

Run: `cd backend && npm run migration:run`
Expected: `Migration Foundation1760227200000 has been executed successfully.`

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): foundation schema — tenants, users, sessions, roles, scopes, org, audit"
```

---
### Task 4: Danh mục quyền, phạm vi, nhật ký, tạo công ty (tầng service)

**Files:**
- Create: `backend/src/access/permissions.ts`, `backend/src/access/permission.service.ts`, `backend/src/access/scope.service.ts`, `backend/src/access/access.module.ts`
- Create: `backend/src/auth/auth-user.ts`, `backend/src/auth/password.ts`
- Create: `backend/src/audit/audit.service.ts`, `backend/src/audit/audit.module.ts`
- Create: `backend/src/users/users.service.ts`, `backend/src/users/users.module.ts`
- Create: `backend/src/tenants/dto.ts`, `backend/src/tenants/tenants.service.ts`, `backend/src/tenants/tenants.module.ts`
- Modify: `backend/src/app.module.ts`, `backend/test/helpers.ts`
- Test: `backend/test/tenant-bootstrap.e2e-spec.ts`

**Interfaces:**
- Consumes: entity của Task 3, `BusinessException`, `normalizePhone/normalizeEmail/PHONE_PATTERN`, `bcryptRounds`.
- Produces:
  - `PERMISSIONS: Record<Permission, string>`, `type Permission`, `ALL_PERMISSIONS: Permission[]`, `ROLE_TEMPLATES`, `ADMIN_ROLE_CODE = 'admin'`.
  - `interface AuthUser { id; tenant_id: string | null; user_type: UserType; employee_id: string | null; session_id: string }`, `tenantOf(user): string` (ném `AUTH_FORBIDDEN` nếu không thuộc tenant).
  - `hashPassword(p): Promise<string>`, `verifyPassword(p, hash): Promise<boolean>`, `sha256(s): string`, `randomSecret(): string`.
  - `PermissionService.permissionsOf(userId): Promise<Set<string>>`, `.has(userId, perms[]): Promise<boolean>`.
  - `type TeamVisibility = { all: true } | { all: false; teamIds: string[] }`; `ScopeService.hasTenantScope(user)`, `.assertTenantScope(user)`, `.teamVisibility(user)`, `.canSeeTeam(user, teamId)`.
  - `AuditService.record(m: EntityManager | null, entry: AuditEntry): Promise<void>`.
  - `interface NewUserInput`; `UsersService.insertUser(m, tenantId, input): Promise<User>` (không kiểm quyền — chỉ dùng khi khởi tạo hoặc sau khi đã kiểm); các hàm `checkedPhone`, `assertIdentifiersFree`, `assertEmployeeFree`, `replaceRoles`, `replaceScopes` export từ `users.service.ts`.
  - `TenantsService.createTenant(dto: CreateTenantDto, actor: AuthUser | null): Promise<{ tenant: Tenant; admin_user_id: string }>`.
  - Test helper `uniquePhone(): string`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `backend/test/helpers.ts`:
```ts
let phoneSeq = 0;
/** A fresh valid number per call. Each spec file gets a wiped database, so a counter is enough. */
export const uniquePhone = () => `09${String(++phoneSeq).padStart(8, '0')}`;
```

`backend/test/tenant-bootstrap.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { ALL_PERMISSIONS } from '../src/access/permissions';
import { PermissionService } from '../src/access/permission.service';
import { ScopeService } from '../src/access/scope.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { createTestApp } from './helpers';

describe('Tenant bootstrap (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let tenants: TenantsService;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    tenants = app.get(TenantsService);
  });
  afterAll(async () => app.close());

  const admin = (phone: string) => ({ full_name: 'Giám đốc', phone, password: 'Admin@12345' });

  it('creates the company with its six system roles and an all-powerful admin', async () => {
    const { tenant, admin_user_id } = await tenants.createTenant(
      { code: 'alpha', name: 'Alpha', admin: admin('+84 901 000 001') },
      null,
    );

    const roles: { code: string }[] = await ds.query(`SELECT code FROM roles WHERE tenant_id = $1 ORDER BY code`, [tenant.id]);
    expect(roles.map((r) => r.code)).toEqual(['accountant', 'admin', 'guard', 'hr', 'manager', 'team_leader']);

    const [user] = await ds.query(`SELECT phone, user_type FROM users WHERE id = $1`, [admin_user_id]);
    expect(user).toEqual({ phone: '0901000001', user_type: 'staff' });

    const permissions = await app.get(PermissionService).permissionsOf(admin_user_id);
    expect([...permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());

    const visibility = await app.get(ScopeService).teamVisibility({
      id: admin_user_id, tenant_id: tenant.id, user_type: 'staff', employee_id: null, session_id: 'n/a',
    });
    expect(visibility).toEqual({ all: true });

    const audit = await ds.query(`SELECT action FROM audit_logs WHERE tenant_id = $1`, [tenant.id]);
    expect(audit).toEqual([{ action: 'tenant.create' }]);
  });

  it('refuses a duplicate company code', async () => {
    await expect(
      tenants.createTenant({ code: 'alpha', name: 'Alpha 2', admin: admin('0901000002') }, null),
    ).rejects.toMatchObject({ code: 'TENANT_CODE_TAKEN' });
  });

  it('rolls the whole company back when the admin phone is already used', async () => {
    await expect(
      tenants.createTenant({ code: 'beta', name: 'Beta', admin: admin('0901.000.001') }, null),
    ).rejects.toMatchObject({ code: 'USER_IDENTIFIER_TAKEN' });
    expect(await ds.query(`SELECT 1 FROM tenants WHERE code = 'beta'`)).toHaveLength(0);
  });

  it('rejects a malformed phone number', async () => {
    await expect(
      tenants.createTenant({ code: 'gamma', name: 'Gamma', admin: admin('12345') }, null),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- tenant-bootstrap`
Expected: FAIL — `Cannot find module '../src/access/permissions'`.

- [ ] **Step 3: Viết danh mục quyền, người dùng xác thực, mật khẩu**

`backend/src/access/permissions.ts`:
```ts
/**
 * Every permission the API checks. Adding one later needs a migration that grants
 * it to the system roles of existing companies — templates only seed new ones.
 */
export const PERMISSIONS = {
  'tenant.settings.manage': 'Cài đặt công ty',
  'user.view': 'Xem người dùng',
  'user.manage': 'Tạo, sửa, khoá người dùng',
  'role.view': 'Xem vai trò',
  'role.manage': 'Tạo, sửa vai trò',
  'org.view': 'Xem nhóm, đội',
  'org.manage': 'Quản lý nhóm, đội, thành viên',
  'employee.view': 'Xem nhân viên',
  'employee.manage': 'Thêm, sửa nhân viên',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** The one role defined by identity: it cannot be edited and a company always keeps a holder. */
export const ADMIN_ROLE_CODE = 'admin';

export const ROLE_TEMPLATES: { code: string; name: string; permissions: Permission[] }[] = [
  { code: ADMIN_ROLE_CODE, name: 'Quản trị (giám đốc)', permissions: ALL_PERMISSIONS },
  { code: 'manager', name: 'Quản lý', permissions: ['user.view', 'org.view', 'employee.view'] },
  { code: 'team_leader', name: 'Đội trưởng', permissions: ['org.view', 'employee.view'] },
  { code: 'guard', name: 'Bảo vệ', permissions: [] },
  {
    code: 'hr',
    name: 'HR (nhân sự)',
    permissions: ['user.view', 'user.manage', 'role.view', 'org.view', 'org.manage', 'employee.view', 'employee.manage'],
  },
  { code: 'accountant', name: 'Kế toán', permissions: ['employee.view'] },
];
```

`backend/src/auth/auth-user.ts`:
```ts
import { BusinessException } from '../common/errors/business.exception';
import { UserType } from '../users/user.entity';

/** What a request knows about its caller. Re-read from the database on every request. */
export interface AuthUser {
  id: string;
  tenant_id: string | null;
  user_type: UserType;
  employee_id: string | null;
  session_id: string;
}

/** The caller's company. Guards already refuse tenant routes to platform admins; this is the belt. */
export function tenantOf(user: AuthUser): string {
  if (!user.tenant_id) throw new BusinessException('AUTH_FORBIDDEN');
  return user.tenant_id;
}
```

`backend/src/auth/password.ts`:
```ts
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { bcryptRounds } from '../config/env';

export const hashPassword = (password: string) => bcrypt.hash(password, bcryptRounds());
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
/** Refresh secrets are 256 random bits: a fast hash is enough, bcrypt would only cost time. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');
```

- [ ] **Step 4: Viết dịch vụ quyền, phạm vi, nhật ký**

`backend/src/access/permission.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Permissions come from the database on every call — never from the token, never cached. */
@Injectable()
export class PermissionService {
  constructor(private readonly ds: DataSource) {}

  async permissionsOf(userId: string): Promise<Set<string>> {
    const rows: { permission: string }[] = await this.ds.query(
      `SELECT DISTINCT rp.permission
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
         JOIN role_permissions rp ON rp.role_id = r.id
        WHERE ur.user_id = $1`,
      [userId],
    );
    return new Set(rows.map((r) => r.permission));
  }

  async has(userId: string, permissions: string[]): Promise<boolean> {
    const held = await this.permissionsOf(userId);
    return permissions.every((p) => held.has(p));
  }
}
```

`backend/src/access/scope.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';

export type TeamVisibility = { all: true } | { all: false; teamIds: string[] };

/**
 * Which teams a person may see. Comes from two places: explicit `user_scopes`
 * rows, and the organisation itself — a group's manager sees its teams, a team's
 * leader sees that team — so naming someone leader is enough, no extra grant.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly ds: DataSource) {}

  async hasTenantScope(user: AuthUser): Promise<boolean> {
    const rows = await this.ds.query(
      `SELECT 1 FROM user_scopes WHERE user_id = $1 AND scope_type = 'tenant' LIMIT 1`,
      [user.id],
    );
    return rows.length > 0;
  }

  async assertTenantScope(user: AuthUser): Promise<void> {
    if (!(await this.hasTenantScope(user))) throw new BusinessException('AUTH_FORBIDDEN');
  }

  async teamVisibility(user: AuthUser): Promise<TeamVisibility> {
    if (await this.hasTenantScope(user)) return { all: true };
    const rows: { id: string }[] = await this.ds.query(
      `SELECT t.id FROM teams t
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL AND (
              t.id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'team')
           OR t.team_group_id IN (SELECT scope_id FROM user_scopes WHERE user_id = $2 AND scope_type = 'team_group')
           OR t.team_group_id IN (SELECT g.id FROM team_groups g WHERE g.manager_user_id = $2 AND g.deleted_at IS NULL)
           OR ($3::uuid IS NOT NULL AND t.leader_employee_id = $3::uuid))`,
      [user.tenant_id, user.id, user.employee_id],
    );
    return { all: false, teamIds: rows.map((r) => r.id) };
  }

  async canSeeTeam(user: AuthUser, teamId: string): Promise<boolean> {
    const visibility = await this.teamVisibility(user);
    return visibility.all || visibility.teamIds.includes(teamId);
  }
}
```

`backend/src/access/access.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { ScopeService } from './scope.service';

@Module({
  providers: [PermissionService, ScopeService],
  exports: [PermissionService, ScopeService],
})
export class AccessModule {}
```

`backend/src/audit/audit.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  data?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly ds: DataSource) {}

  /** Pass the transaction's manager so the log entry commits or rolls back with the change. */
  async record(m: EntityManager | null, entry: AuditEntry): Promise<void> {
    await (m ?? this.ds.manager).insert(AuditLog, {
      ...entry,
      entity_id: entry.entity_id ?? null,
      data: entry.data ?? {},
    });
  }
}
```

`backend/src/audit/audit.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
```

- [ ] **Step 5: Viết tạo người dùng (tầng thấp) và tạo công ty**

`backend/src/users/users.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UserRole, UserScope } from '../access/role.entity';
import { ScopeInput } from '../access/scope.types';
import { hashPassword } from '../auth/password';
import { BusinessException } from '../common/errors/business.exception';
import { normalizeEmail, normalizePhone, PHONE_PATTERN } from '../common/identifiers';
import { User } from './user.entity';

export interface NewUserInput {
  user_type: 'staff' | 'guard';
  full_name: string;
  phone?: string | null;
  email?: string | null;
  password: string;
  employee_id?: string | null;
  role_ids: string[];
  scopes: ScopeInput[];
  must_change_password?: boolean;
}

@Injectable()
export class UsersService {
  /**
   * Writes a user with roles and scopes. Checks identity rules only, not who is
   * asking: callers either bootstrap a company or have already passed AccessService.
   */
  async insertUser(m: EntityManager, tenantId: string, input: NewUserInput): Promise<User> {
    const phone = input.phone ? checkedPhone(input.phone) : null;
    const email = input.email ? normalizeEmail(input.email) : null;
    if (!phone && !email) throw new BusinessException('USER_IDENTIFIER_REQUIRED');
    await assertIdentifiersFree(m, phone, email, null);
    if (input.employee_id) await assertEmployeeFree(m, input.employee_id, null);

    const user = await m.save(
      m.create(User, {
        tenant_id: tenantId,
        user_type: input.user_type,
        full_name: input.full_name,
        phone,
        email,
        password_hash: await hashPassword(input.password),
        employee_id: input.employee_id ?? null,
        must_change_password: input.must_change_password ?? false,
      }),
    );
    await replaceRoles(m, user.id, input.role_ids);
    await replaceScopes(m, tenantId, user.id, input.scopes);
    return user;
  }
}

export function checkedPhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!PHONE_PATTERN.test(phone)) {
    throw new BusinessException('VALIDATION_FAILED', ['phone: Số điện thoại không hợp lệ']);
  }
  return phone;
}

export async function assertIdentifiersFree(
  m: EntityManager,
  phone: string | null,
  email: string | null,
  exceptUserId: string | null,
): Promise<void> {
  if (!phone && !email) return;
  const qb = m
    .createQueryBuilder(User, 'u')
    .where('(u.phone = :phone OR lower(u.email) = :email)', { phone: phone ?? '', email: email ?? '' });
  if (exceptUserId) qb.andWhere('u.id <> :id', { id: exceptUserId });
  if (await qb.getExists()) throw new BusinessException('USER_IDENTIFIER_TAKEN');
}

export async function assertEmployeeFree(m: EntityManager, employeeId: string, exceptUserId: string | null) {
  const qb = m.createQueryBuilder(User, 'u').where('u.employee_id = :employeeId', { employeeId });
  if (exceptUserId) qb.andWhere('u.id <> :id', { id: exceptUserId });
  if (await qb.getExists()) throw new BusinessException('USER_EMPLOYEE_TAKEN');
}

export async function replaceRoles(m: EntityManager, userId: string, roleIds: string[]) {
  await m.delete(UserRole, { user_id: userId });
  const unique = [...new Set(roleIds)];
  if (unique.length) await m.insert(UserRole, unique.map((role_id) => ({ user_id: userId, role_id })));
}

export async function replaceScopes(m: EntityManager, tenantId: string, userId: string, scopes: ScopeInput[]) {
  await m.delete(UserScope, { user_id: userId });
  const seen = new Set<string>();
  for (const scope of scopes) {
    const key = `${scope.scope_type}:${scope.scope_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await m.insert(UserScope, {
      tenant_id: tenantId,
      user_id: userId,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id ?? null,
    });
  }
}
```

`backend/src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({ providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

`backend/src/tenants/dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class TenantAdminDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  full_name: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsString() @MinLength(8) @MaxLength(100)
  password: string;
}

export class CreateTenantDto {
  @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: 'code: chữ thường, số, gạch nối; 2–40 ký tự' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @ValidateNested() @Type(() => TenantAdminDto)
  admin: TenantAdminDto;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @IsOptional() @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}
```

`backend/src/tenants/tenants.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ADMIN_ROLE_CODE, ROLE_TEMPLATES } from '../access/permissions';
import { Role, RolePermission } from '../access/role.entity';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { UsersService } from '../users/users.service';
import { CreateTenantDto } from './dto';
import { Tenant } from './tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    private readonly ds: DataSource,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /** A company, its system roles and its first admin — all or nothing. */
  async createTenant(dto: CreateTenantDto, actor: AuthUser | null): Promise<{ tenant: Tenant; admin_user_id: string }> {
    return this.ds.transaction(async (m) => {
      if (await m.exists(Tenant, { where: { code: dto.code } })) {
        throw new BusinessException('TENANT_CODE_TAKEN');
      }
      const tenant = await m.save(m.create(Tenant, { code: dto.code, name: dto.name, settings: {} }));

      let adminRoleId: string | null = null;
      for (const template of ROLE_TEMPLATES) {
        const role = await m.save(
          m.create(Role, { tenant_id: tenant.id, code: template.code, name: template.name, is_system: true }),
        );
        if (template.permissions.length) {
          await m.insert(RolePermission, template.permissions.map((permission) => ({ role_id: role.id, permission })));
        }
        if (template.code === ADMIN_ROLE_CODE) adminRoleId = role.id;
      }
      if (!adminRoleId) throw new Error('ROLE_TEMPLATES must contain the admin role');

      const admin = await this.users.insertUser(m, tenant.id, {
        user_type: 'staff',
        full_name: dto.admin.full_name,
        phone: dto.admin.phone ?? null,
        email: dto.admin.email ?? null,
        password: dto.admin.password,
        role_ids: [adminRoleId],
        scopes: [{ scope_type: 'tenant' }],
      });

      await this.audit.record(m, {
        tenant_id: tenant.id,
        actor_user_id: actor?.id ?? null,
        action: 'tenant.create',
        entity_type: 'tenant',
        entity_id: tenant.id,
        data: { code: tenant.code },
      });
      return { tenant, admin_user_id: admin.id };
    });
  }
}
```

`backend/src/tenants/tenants.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { TenantsService } from './tenants.service';

@Module({
  imports: [UsersModule, AuditModule],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
```

`backend/src/app.module.ts` (thay toàn bộ):
```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from './access/access.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { buildDataSourceOptions } from './database/data-source';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: buildDataSourceOptions }),
    AuditModule,
    AccessModule,
    UsersModule,
    TenantsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor }],
})
export class AppModule {}
```

- [ ] **Step 6: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- tenant-bootstrap`
Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): permission catalog, scope resolution, audit, tenant bootstrap"
```

---

### Task 5: Đăng nhập, phiên, token, guard toàn cục

**Files:**
- Create: `backend/src/auth/decorators.ts`, `cookies.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`, `dto.ts`, `auth.service.ts`, `auth.controller.ts`, `auth.module.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/app.controller.ts`, `backend/test/helpers.ts`
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthUser`, `password.ts`, `parseIdentifier`, `PermissionService`, `ScopeService`, `TenantsService.createTenant`, `jwtSecret/accessTtlSeconds/refreshTtlDays`.
- Produces:
  - Decorators: `Public()`, `AnyUser()`, `PlatformOnly()`, `RequirePermission(...p: Permission[])`, `CurrentUser()`; metadata keys `IS_PUBLIC_KEY`, `ANY_USER_KEY`, `PLATFORM_ONLY_KEY`, `REQUIRED_PERMISSION_KEY`.
  - Routes: `POST /api/auth/login` `{identifier, password, device_label?}`; `POST /api/auth/refresh` `{refresh_token?}` (hoặc cookie); `POST /api/auth/logout`; `GET /api/auth/me` → `{ user: Profile, permissions: string[], team_visibility: { all: boolean, team_ids: string[] } }`; `POST /api/auth/change-password` `{current_password, new_password}`.
  - Header `X-Client: mobile` → token trả trong body; không có header → chỉ đặt cookie httpOnly `access_token` (path `/`) và `refresh_token` (path `/api/auth`).
  - `interface Profile { id, tenant_id, user_type, full_name, phone, email, employee_id, must_change_password }`.
  - Test helpers `login(app, identifier, password): Promise<string>`, `createTenantWithAdmin(app, code)` → `{ tenant, adminUserId, phone, password, token }`, `client(app, token)` → `{ get, post, patch, put, delete }`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/test/helpers.ts` (đầu file thêm `import request from 'supertest';` và `import { TenantsService } from '../src/tenants/tenants.service';`):
```ts
export async function login(app: NestExpressApplication, identifier: string, password: string): Promise<string> {
  const res = await request(server(app))
    .post('/api/auth/login')
    .set('X-Client', 'mobile')
    .send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.access_token as string;
}

export async function createTenantWithAdmin(app: NestExpressApplication, code: string) {
  const phone = uniquePhone();
  const password = 'Admin@12345';
  const { tenant, admin_user_id } = await app.get(TenantsService).createTenant(
    { code, name: `Công ty ${code}`, admin: { full_name: `Giám đốc ${code}`, phone, password } },
    null,
  );
  return { tenant, adminUserId: admin_user_id, phone, password, token: await login(app, phone, password) };
}

/** supertest with a bearer token already attached. */
export function client(app: NestExpressApplication, token: string) {
  const s = server(app);
  const auth = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request(s).get(url).set(auth),
    post: (url: string, body: object = {}) => request(s).post(url).set(auth).send(body),
    patch: (url: string, body: object = {}) => request(s).patch(url).set(auth).send(body),
    put: (url: string, body: object = {}) => request(s).put(url).set(auth).send(body),
    delete: (url: string) => request(s).delete(url).set(auth),
  };
}
```

`backend/test/auth.e2e-spec.ts`:
```ts
import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, login, server } from './helpers';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  const loginMobile = (identifier: string, password: string) =>
    request(server(app)).post('/api/auth/login').set('X-Client', 'mobile').send({ identifier, password });

  it('accepts the phone number in whatever format the guard types it', async () => {
    const t = await createTenantWithAdmin(app, 'auth-fmt');
    const res = await loginMobile(t.phone.replace(/^0/, '+84 '), t.password).expect(200);
    expect(res.body.data.access_token).toEqual(expect.any(String));
    expect(res.body.data.refresh_token).toMatch(/^[0-9a-f-]{36}\./);
    expect(res.body.data.user).toMatchObject({ tenant_id: t.tenant.id, phone: t.phone, user_type: 'staff' });
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const t = await createTenantWithAdmin(app, 'auth-wrong');
    const wrong = await loginMobile(t.phone, 'not-the-password').expect(401);
    const unknown = await loginMobile('0999999999', 'whatever1').expect(401);
    expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(unknown.body).toEqual(wrong.body);
  });

  it('keeps tokens out of the body for the web and sets httpOnly cookies instead', async () => {
    const t = await createTenantWithAdmin(app, 'auth-web');
    const res = await request(server(app)).post('/api/auth/login').send({ identifier: t.phone, password: t.password }).expect(200);
    expect(res.body.data.access_token).toBeUndefined();
    expect(res.body.data.refresh_token).toBeUndefined();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('access_token='));
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));
    expect(access).toContain('HttpOnly');
    expect(refresh).toContain('Path=/api/auth');
    await request(server(app)).get('/api/auth/me').set('Cookie', access!.split(';')[0]).expect(200);
  });

  it('rotates the refresh token and kills the session when an old one comes back', async () => {
    const t = await createTenantWithAdmin(app, 'auth-rot');
    const first = (await loginMobile(t.phone, t.password).expect(200)).body.data;
    const refresh = (token: string) =>
      request(server(app)).post('/api/auth/refresh').set('X-Client', 'mobile').send({ refresh_token: token });

    const second = (await refresh(first.refresh_token).expect(200)).body.data;
    expect(second.refresh_token).not.toBe(first.refresh_token);

    const replay = await refresh(first.refresh_token).expect(401);
    expect(replay.body.error.code).toBe('AUTH_REFRESH_INVALID');
    // The legitimate holder is logged out too: we cannot tell which copy is the thief's.
    await refresh(second.refresh_token).expect(401);
    await client(app, second.access_token).get('/api/auth/me').expect(401);
  });

  it('makes the access token useless right after logout', async () => {
    const t = await createTenantWithAdmin(app, 'auth-out');
    await client(app, t.token).post('/api/auth/logout').expect(200);
    const res = await client(app, t.token).get('/api/auth/me').expect(401);
    expect(res.body.error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('shuts out a suspended company and a locked user immediately', async () => {
    const t = await createTenantWithAdmin(app, 'auth-susp');
    await ds.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [t.tenant.id]);
    await client(app, t.token).get('/api/auth/me').expect(401);
    const res = await loginMobile(t.phone, t.password).expect(403);
    expect(res.body.error.code).toBe('AUTH_TENANT_SUSPENDED');

    const u = await createTenantWithAdmin(app, 'auth-lock');
    await ds.query(`UPDATE users SET status = 'locked' WHERE id = $1`, [u.adminUserId]);
    await client(app, u.token).get('/api/auth/me').expect(401);
    await loginMobile(u.phone, u.password).expect(401);
  });

  it('reports permissions and company-wide visibility in /me', async () => {
    const t = await createTenantWithAdmin(app, 'auth-me');
    const res = await client(app, t.token).get('/api/auth/me').expect(200);
    expect(res.body.data.permissions).toContain('org.manage');
    expect(res.body.data.team_visibility).toEqual({ all: true, team_ids: [] });
    expect(res.body.data.user.full_name).toBe('Giám đốc auth-me');
  });

  it('changing the password ends every other session', async () => {
    const t = await createTenantWithAdmin(app, 'auth-pw');
    const other = await login(app, t.phone, t.password);
    const wrong = await client(app, t.token)
      .post('/api/auth/change-password', { current_password: 'nope-nope', new_password: 'NewPass@123' })
      .expect(400);
    expect(wrong.body.error.code).toBe('AUTH_WRONG_PASSWORD');
    await client(app, t.token)
      .post('/api/auth/change-password', { current_password: t.password, new_password: 'NewPass@123' })
      .expect(200);
    await client(app, other).get('/api/auth/me').expect(401);
    await client(app, t.token).get('/api/auth/me').expect(200);
    await login(app, t.phone, 'NewPass@123');
  });

  it('still lets anyone reach the health check', async () => {
    await request(server(app)).get('/api/health').expect(200);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- auth`
Expected: FAIL — `login failed: 404`.

- [ ] **Step 3: Viết decorator, cookie, DTO**

`backend/src/auth/decorators.ts`:
```ts
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Permission } from '../access/permissions';
import { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const ANY_USER_KEY = 'anyUser';
export const PLATFORM_ONLY_KEY = 'platformOnly';
export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/** No token at all. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
/** Any signed-in account, platform admins included (own profile, logout, password). */
export const AnyUser = () => SetMetadata(ANY_USER_KEY, true);
/** Platform admins only. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY_KEY, true);
/**
 * Every listed permission is required. Always a permission, never a role:
 * a company that wants accountants to see teams grants `org.view`, it does not wait for a release.
 */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSION_KEY, permissions);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user;
});
```

`backend/src/auth/cookies.ts`:
```ts
import type { Request, Response } from 'express';
import { accessTtlSeconds, refreshTtlDays } from '../config/env';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

const base = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' });

export function setAuthCookies(res: Response, tokens: TokenPair): void {
  res.cookie('access_token', tokens.access_token, { ...base(), path: '/', maxAge: accessTtlSeconds() * 1000 });
  // Only the auth routes ever see the refresh token.
  res.cookie('refresh_token', tokens.refresh_token, {
    ...base(),
    path: '/api/auth',
    maxAge: refreshTtlDays() * 86_400_000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', { ...base(), path: '/' });
  res.clearCookie('refresh_token', { ...base(), path: '/api/auth' });
}

/** The app asks for tokens in the body; a browser never gets them where scripts could read them. */
export const isMobileClient = (req: Request) => req.headers['x-client'] === 'mobile';
```

`backend/src/auth/dto.ts`:
```ts
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  identifier: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  password: string;

  @IsOptional() @IsString() @MaxLength(200)
  device_label?: string;
}

export class RefreshDto {
  @IsOptional() @IsString() @MaxLength(500)
  refresh_token?: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  current_password: string;

  @IsString() @MinLength(8) @MaxLength(100)
  new_password: string;
}
```

- [ ] **Step 4: Viết strategy, guard, service, controller, module**

`backend/src/auth/jwt.strategy.ts`:
```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DataSource } from 'typeorm';
import { jwtSecret } from '../config/env';
import { AuthUser } from './auth-user';

export interface JwtPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly ds: DataSource) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies as Record<string, string> | undefined)?.access_token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  /**
   * One query per request decides whether the token still means anything: the
   * session is open, the user active, the company not suspended. Logout, locking
   * and suspension therefore take effect on the next request, not at token expiry.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const rows: Omit<AuthUser, 'session_id'>[] = await this.ds.query(
      `SELECT u.id, u.tenant_id, u.user_type, u.employee_id
         FROM users u
         JOIN sessions s ON s.id = $2 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
         LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
          AND (u.tenant_id IS NULL OR t.status = 'active')`,
      [payload.sub, payload.sid],
    );
    if (!rows.length) throw new UnauthorizedException();
    return { ...rows[0], session_id: payload.sid };
  }
}
```

`backend/src/auth/jwt-auth.guard.ts`:
```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { BusinessException } from '../common/errors/business.exception';
import { IS_PUBLIC_KEY } from './decorators';

/** Global: every route needs a valid token unless it says @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T): T {
    if (err || !user) throw new BusinessException('AUTH_UNAUTHENTICATED');
    return user;
  }
}
```

`backend/src/auth/auth.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { IsNull, Not, Repository } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { BusinessException } from '../common/errors/business.exception';
import { parseIdentifier } from '../common/identifiers';
import { refreshTtlDays } from '../config/env';
import { Tenant } from '../tenants/tenant.entity';
import { User, UserType } from '../users/user.entity';
import { AuthUser } from './auth-user';
import { TokenPair } from './cookies';
import { ChangePasswordDto, LoginDto } from './dto';
import { JwtPayload } from './jwt.strategy';
import { hashPassword, randomSecret, sha256, verifyPassword } from './password';
import { Session } from './session.entity';

export interface Profile {
  id: string;
  tenant_id: string | null;
  user_type: UserType;
  full_name: string;
  phone: string | null;
  email: string | null;
  employee_id: string | null;
  must_change_password: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly jwt: JwtService,
    private readonly permissions: PermissionService,
    private readonly scopes: ScopeService,
  ) {}

  async login(dto: LoginDto): Promise<TokenPair & { user: Profile }> {
    const identifier = parseIdentifier(dto.identifier);
    const qb = this.users.createQueryBuilder('u').addSelect('u.password_hash');
    if ('email' in identifier) qb.where('lower(u.email) = :email', { email: identifier.email });
    else qb.where('u.phone = :phone', { phone: identifier.phone });
    const user = await qb.getOne();

    if (!user || user.status !== 'active' || !(await verifyPassword(dto.password, user.password_hash))) {
      throw new BusinessException('AUTH_INVALID_CREDENTIALS');
    }
    await this.assertTenantActive(user.tenant_id);

    const tokens = await this.openSession(user.id, dto.device_label ?? null);
    await this.users.update(user.id, { last_login_at: new Date() });
    return { ...tokens, user: await this.profile(user.id) };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret || !isUUID(sessionId)) throw new BusinessException('AUTH_REFRESH_INVALID');

    const session = await this.sessions.findOneBy({ id: sessionId });
    if (!session || session.revoked_at || session.expires_at <= new Date()) {
      throw new BusinessException('AUTH_REFRESH_INVALID');
    }
    if (session.token_hash !== sha256(secret)) {
      // A rotated-out token came back: two parties hold this session. End it for both.
      await this.sessions.update(session.id, { revoked_at: new Date() });
      throw new BusinessException('AUTH_REFRESH_INVALID');
    }
    const user = await this.users.findOneBy({ id: session.user_id });
    if (!user || user.status !== 'active') throw new BusinessException('AUTH_REFRESH_INVALID');
    await this.assertTenantActive(user.tenant_id);
    return this.issue(session, randomSecret());
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId, revoked_at: IsNull() }, { revoked_at: new Date() });
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const row = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.id = :id', { id: user.id })
      .getOne();
    if (!row || !(await verifyPassword(dto.current_password, row.password_hash))) {
      throw new BusinessException('AUTH_WRONG_PASSWORD');
    }
    await this.users.update(user.id, { password_hash: await hashPassword(dto.new_password), must_change_password: false });
    await this.sessions.update(
      { user_id: user.id, id: Not(user.session_id), revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  async me(user: AuthUser) {
    const profile = await this.profile(user.id);
    if (!user.tenant_id) return { user: profile, permissions: [], team_visibility: { all: false, team_ids: [] } };
    const [permissions, visibility] = await Promise.all([
      this.permissions.permissionsOf(user.id),
      this.scopes.teamVisibility(user),
    ]);
    return {
      user: profile,
      permissions: [...permissions].sort(),
      team_visibility: visibility.all ? { all: true, team_ids: [] } : { all: false, team_ids: visibility.teamIds },
    };
  }

  private async profile(userId: string): Promise<Profile> {
    const u = await this.users.findOneByOrFail({ id: userId });
    return {
      id: u.id,
      tenant_id: u.tenant_id,
      user_type: u.user_type,
      full_name: u.full_name,
      phone: u.phone,
      email: u.email,
      employee_id: u.employee_id,
      must_change_password: u.must_change_password,
    };
  }

  private async assertTenantActive(tenantId: string | null): Promise<void> {
    if (!tenantId) return;
    const tenant = await this.tenants.findOneBy({ id: tenantId });
    if (!tenant || tenant.status !== 'active') throw new BusinessException('AUTH_TENANT_SUSPENDED');
  }

  private async openSession(userId: string, deviceLabel: string | null): Promise<TokenPair> {
    const session = await this.sessions.save(
      this.sessions.create({
        user_id: userId,
        device_label: deviceLabel,
        token_hash: '',
        last_used_at: new Date(),
        expires_at: this.refreshExpiry(),
      }),
    );
    return this.issue(session, randomSecret());
  }

  /** Refresh token = "<session id>.<secret>"; only the secret's hash is stored. */
  private async issue(session: Session, secret: string): Promise<TokenPair> {
    await this.sessions.update(session.id, {
      token_hash: sha256(secret),
      last_used_at: new Date(),
      expires_at: this.refreshExpiry(),
    });
    const payload: JwtPayload = { sub: session.user_id, sid: session.id };
    return { access_token: await this.jwt.signAsync(payload), refresh_token: `${session.id}.${secret}` };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + refreshTtlDays() * 86_400_000);
  }
}
```

`backend/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { BusinessException } from '../common/errors/business.exception';
import { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { clearAuthCookies, isMobileClient, setAuthCookies } from './cookies';
import { AnyUser, CurrentUser, Public } from './decorators';
import { ChangePasswordDto, LoginDto, RefreshDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    setAuthCookies(res, result);
    return isMobileClient(req) ? result : { user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refresh_token ?? (req.cookies as Record<string, string> | undefined)?.refresh_token;
    if (!token) throw new BusinessException('AUTH_REFRESH_INVALID');
    const tokens = await this.auth.refresh(token);
    setAuthCookies(res, tokens);
    return isMobileClient(req) ? tokens : { ok: true };
  }

  @AnyUser()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.session_id);
    clearAuthCookies(res);
    return { ok: true };
  }

  @AnyUser()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @AnyUser()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto);
    return { ok: true };
  }
}
```

`backend/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from '../access/access.module';
import { accessTtlSeconds, jwtSecret } from '../config/env';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { Session } from './session.entity';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: jwtSecret(), signOptions: { expiresIn: accessTtlSeconds() } }),
    }),
    TypeOrmModule.forFeature([User, Session, Tenant]),
    AccessModule,
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
```

`backend/src/app.controller.ts` (thay toàn bộ):
```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
```

`backend/src/app.module.ts` (thay toàn bộ):
```ts
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from './access/access.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { getEnv } from './config/env';
import { buildDataSourceOptions } from './database/data-source';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: buildDataSourceOptions }),
    // Applied only where @UseGuards(ThrottlerGuard) says so — today, the login route.
    ThrottlerModule.forRootAsync({
      useFactory: () => [{ ttl: 60_000, limit: parseInt(getEnv('LOGIN_RATE_LIMIT', '10'), 10) }],
    }),
    AuditModule,
    AccessModule,
    UsersModule,
    TenantsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- auth health`
Expected: PASS — `auth.e2e-spec.ts` 9 tests, `health.e2e-spec.ts` 2 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): login, refresh rotation with reuse detection, logout, me, change password"
```

---

### Task 6: Guard quyền, API vai trò, API quản trị nền tảng

**Files:**
- Create: `backend/src/access/permission.guard.ts`, `backend/src/access/dto.ts`, `backend/src/access/roles.service.ts`, `backend/src/access/roles.controller.ts`
- Create: `backend/src/tenants/platform-tenants.controller.ts`
- Modify: `backend/src/access/access.module.ts`, `backend/src/tenants/tenants.service.ts`, `backend/src/tenants/tenants.module.ts`, `backend/src/app.module.ts`, `backend/test/helpers.ts`
- Test: `backend/test/access.e2e-spec.ts`

**Interfaces:**
- Consumes: decorators & metadata keys (Task 5), `PermissionService`, `AuditService`, `TenantsService`, `UsersService.insertUser`.
- Produces:
  - `PermissionGuard` (APP_GUARD thứ hai, sau `JwtAuthGuard`).
  - `interface RoleView { id; code; name; is_system: boolean; permissions: string[] }`; `RolesService.list(tenantId)`, `.create(actor, dto)`, `.setPermissions(actor, id, permissions)`.
  - Routes: `GET /api/permissions` → `[{code, label}]`; `GET /api/roles`; `POST /api/roles` `{code, name, permissions}`; `PUT /api/roles/:id/permissions` `{permissions}`; `GET|POST /api/platform/tenants`, `PATCH /api/platform/tenants/:id` `{name?, status?}`.
  - `TenantsService.list()`, `.update(id, dto, actor)`.
  - Test helpers `createUserWithRoles(app, tenantId, roleCodes, scopes?, extra?)` → `{ user, phone, password, token }`, `createPlatformAdmin(app)` → `{ email, password, token }`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/test/helpers.ts` (đầu file thêm `import { ScopeInput } from '../src/access/scope.types';`, `import { hashPassword } from '../src/auth/password';`, `import { NewUserInput, UsersService } from '../src/users/users.service';`):
```ts
/** A user straight into the database with the given system or custom roles. */
export async function createUserWithRoles(
  app: NestExpressApplication,
  tenantId: string,
  roleCodes: string[],
  scopes: ScopeInput[] = [{ scope_type: 'tenant' }],
  extra: Partial<NewUserInput> = {},
) {
  const ds = app.get(DataSource);
  const roles: { id: string }[] = await ds.query(
    `SELECT id FROM roles WHERE tenant_id = $1 AND code = ANY($2) AND deleted_at IS NULL`,
    [tenantId, roleCodes],
  );
  if (roles.length !== roleCodes.length) throw new Error(`unknown role in ${roleCodes.join(',')}`);
  const phone = uniquePhone();
  const password = 'Passw0rd!x';
  const user = await ds.transaction((m) =>
    app.get(UsersService).insertUser(m, tenantId, {
      user_type: 'staff',
      full_name: `Người dùng ${phone}`,
      phone,
      password,
      role_ids: roles.map((r) => r.id),
      scopes,
      ...extra,
    }),
  );
  return { user, phone, password, token: await login(app, phone, password) };
}

export async function createPlatformAdmin(app: NestExpressApplication) {
  const email = `root${uniquePhone()}@patrol.vn`;
  const password = 'Platform@12345';
  await app.get(DataSource).query(
    `INSERT INTO users (user_type, full_name, email, password_hash) VALUES ('platform_admin', 'Quản trị nền tảng', $1, $2)`,
    [email, await hashPassword(password)],
  );
  return { email, password, token: await login(app, email, password) };
}
```

`backend/test/access.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import {
  client, createPlatformAdmin, createTenantWithAdmin, createTestApp, createUserWithRoles, login, uniquePhone,
} from './helpers';

describe('Access control (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  const roleId = async (tenantId: string, code: string): Promise<string> =>
    (await ds.query(`SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`, [tenantId, code]))[0].id;

  it('keeps platform routes for platform admins and tenant routes for tenants', async () => {
    const t = await createTenantWithAdmin(app, 'acc-split');
    const root = await createPlatformAdmin(app);

    expect((await client(app, t.token).get('/api/platform/tenants').expect(403)).body.error.code).toBe('AUTH_FORBIDDEN');
    await client(app, root.token).get('/api/roles').expect(403);
    await client(app, root.token).get('/api/auth/me').expect(200);
  });

  it('lets the platform admin open a company whose admin can sign in at once', async () => {
    const root = await createPlatformAdmin(app);
    const phone = uniquePhone();
    const res = await client(app, root.token)
      .post('/api/platform/tenants', {
        code: 'acc-new',
        name: 'Công ty Mới',
        admin: { full_name: 'GĐ Mới', phone, password: 'Admin@12345' },
      })
      .expect(201);
    expect(res.body.data.tenant.code).toBe('acc-new');

    const token = await login(app, phone, 'Admin@12345');
    const roles = await client(app, token).get('/api/roles').expect(200);
    expect(roles.body.data).toHaveLength(6);
    const list = await client(app, root.token).get('/api/platform/tenants').expect(200);
    expect(list.body.data.map((x: { code: string }) => x.code)).toContain('acc-new');
  });

  it('suspends a company from the platform', async () => {
    const t = await createTenantWithAdmin(app, 'acc-susp');
    const root = await createPlatformAdmin(app);
    await client(app, root.token).patch(`/api/platform/tenants/${t.tenant.id}`, { status: 'suspended' }).expect(200);
    await client(app, t.token).get('/api/auth/me').expect(401);
  });

  it('closes a route to a signed-in user without the permission', async () => {
    const t = await createTenantWithAdmin(app, 'acc-guard');
    const guard = await createUserWithRoles(app, t.tenant.id, ['guard'], [], { user_type: 'guard' });
    expect((await client(app, guard.token).get('/api/roles').expect(403)).body.error.code).toBe('AUTH_FORBIDDEN');
    await client(app, guard.token).get('/api/auth/me').expect(200);
  });

  it('never lets a role editor grant or strip permissions they do not hold', async () => {
    const t = await createTenantWithAdmin(app, 'acc-esc');
    await client(app, t.token)
      .post('/api/roles', { code: 'role_editor', name: 'Biên tập vai trò', permissions: ['role.view', 'role.manage', 'org.view'] })
      .expect(201);
    const editor = await createUserWithRoles(app, t.tenant.id, ['role_editor']);
    const guardRole = await roleId(t.tenant.id, 'guard');
    const managerRole = await roleId(t.tenant.id, 'manager');

    const ok = await client(app, editor.token).put(`/api/roles/${guardRole}/permissions`, { permissions: ['org.view'] }).expect(200);
    expect(ok.body.data.permissions).toEqual(['org.view']);

    const grant = await client(app, editor.token)
      .put(`/api/roles/${guardRole}/permissions`, { permissions: ['employee.manage'] })
      .expect(403);
    expect(grant.body.error.code).toBe('ROLE_ESCALATION');

    // The manager role holds user.view, which the editor lacks: they may not touch it at all.
    await client(app, editor.token).put(`/api/roles/${managerRole}/permissions`, { permissions: ['org.view'] }).expect(403);

    await client(app, editor.token)
      .post('/api/roles', { code: 'too_strong', name: 'X', permissions: ['user.manage'] })
      .expect(403);
  });

  it('protects the admin role and validates permission codes', async () => {
    const t = await createTenantWithAdmin(app, 'acc-admin');
    const adminRole = await roleId(t.tenant.id, 'admin');
    const locked = await client(app, t.token).put(`/api/roles/${adminRole}/permissions`, { permissions: [] }).expect(400);
    expect(locked.body.error.code).toBe('ROLE_ADMIN_LOCKED');

    const bad = await client(app, t.token)
      .post('/api/roles', { code: 'x_role', name: 'X', permissions: ['foo.bar'] })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');

    await client(app, t.token).post('/api/roles', { code: 'dup_role', name: 'A', permissions: [] }).expect(201);
    const dup = await client(app, t.token).post('/api/roles', { code: 'dup_role', name: 'B', permissions: [] }).expect(409);
    expect(dup.body.error.code).toBe('ROLE_CODE_TAKEN');
  });

  it('lists the permission catalog with Vietnamese labels', async () => {
    const t = await createTenantWithAdmin(app, 'acc-cat');
    const res = await client(app, t.token).get('/api/permissions').expect(200);
    expect(res.body.data).toContainEqual({ code: 'org.manage', label: 'Quản lý nhóm, đội, thành viên' });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- access`
Expected: FAIL — `/api/platform/tenants` và `/api/roles` trả 404.

- [ ] **Step 3: Viết guard quyền**

`backend/src/access/permission.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser } from '../auth/auth-user';
import { ANY_USER_KEY, IS_PUBLIC_KEY, PLATFORM_ONLY_KEY, REQUIRED_PERMISSION_KEY } from '../auth/decorators';
import { BusinessException } from '../common/errors/business.exception';
import { PermissionService } from './permission.service';

/**
 * Runs after JwtAuthGuard. Platform admins and tenant users live on separate
 * routes; a tenant route without @RequirePermission is open to any user of
 * that tenant, never to a platform admin.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) throw new BusinessException('AUTH_UNAUTHENTICATED');
    if (this.reflector.getAllAndOverride<boolean>(ANY_USER_KEY, targets)) return true;

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, targets)) {
      if (user.user_type !== 'platform_admin') throw new BusinessException('AUTH_FORBIDDEN');
      return true;
    }

    if (!user.tenant_id) throw new BusinessException('AUTH_FORBIDDEN');
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSION_KEY, targets) ?? [];
    if (required.length && !(await this.permissions.has(user.id, required))) {
      throw new BusinessException('AUTH_FORBIDDEN');
    }
    return true;
  }
}
```

- [ ] **Step 4: Viết API vai trò**

`backend/src/access/dto.ts`:
```ts
import { IsArray, IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ALL_PERMISSIONS } from './permissions';

export class SetPermissionsDto {
  @IsArray() @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: string[];
}

export class CreateRoleDto extends SetPermissionsDto {
  @Matches(/^[a-z][a-z0-9_]{1,49}$/, { message: 'code: chữ thường, số, gạch dưới; bắt đầu bằng chữ' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;
}
```

`backend/src/access/roles.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { CreateRoleDto } from './dto';
import { PermissionService } from './permission.service';
import { ADMIN_ROLE_CODE } from './permissions';
import { Role, RolePermission } from './role.entity';

export interface RoleView {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  permissions: string[];
}

@Injectable()
export class RolesService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<RoleView[]> {
    return this.query(tenantId, null);
  }

  async create(actor: AuthUser, dto: CreateRoleDto): Promise<RoleView> {
    const tenantId = tenantOf(actor);
    await this.assertHolds(actor, dto.permissions);
    const role = await this.ds.transaction(async (m) => {
      if (await m.exists(Role, { where: { tenant_id: tenantId, code: dto.code } })) {
        throw new BusinessException('ROLE_CODE_TAKEN');
      }
      const created = await m.save(m.create(Role, { tenant_id: tenantId, code: dto.code, name: dto.name, is_system: false }));
      await this.writePermissions(m, created.id, dto.permissions);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'role.create', entity_type: 'role',
        entity_id: created.id, data: { code: dto.code, permissions: dto.permissions },
      });
      return created;
    });
    return this.one(tenantId, role.id);
  }

  async setPermissions(actor: AuthUser, id: string, permissions: string[]): Promise<RoleView> {
    const tenantId = tenantOf(actor);
    const role = await this.ds.getRepository(Role).findOneBy({ id, tenant_id: tenantId });
    if (!role) throw new BusinessException('NOT_FOUND');
    if (role.is_system && role.code === ADMIN_ROLE_CODE) throw new BusinessException('ROLE_ADMIN_LOCKED');

    const before: { permission: string }[] = await this.ds.query(
      `SELECT permission FROM role_permissions WHERE role_id = $1`,
      [id],
    );
    // To edit a role you must hold everything it grants, before and after the edit.
    // Otherwise HR could strip the manager role of permissions HR was never given.
    await this.assertHolds(actor, [...before.map((r) => r.permission), ...permissions]);

    await this.ds.transaction(async (m) => {
      await m.delete(RolePermission, { role_id: id });
      await this.writePermissions(m, id, permissions);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'role.permissions', entity_type: 'role', entity_id: id,
        data: { before: before.map((r) => r.permission), after: permissions },
      });
    });
    return this.one(tenantId, id);
  }

  private async one(tenantId: string, id: string): Promise<RoleView> {
    const [role] = await this.query(tenantId, id);
    if (!role) throw new BusinessException('NOT_FOUND');
    return role;
  }

  private query(tenantId: string, id: string | null): Promise<RoleView[]> {
    return this.ds.query(
      `SELECT r.id, r.code, r.name, r.is_system,
              COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND ($2::uuid IS NULL OR r.id = $2::uuid)
        GROUP BY r.id
        ORDER BY r.is_system DESC, r.name`,
      [tenantId, id],
    );
  }

  private async assertHolds(actor: AuthUser, permissions: string[]): Promise<void> {
    const held = await this.permissions.permissionsOf(actor.id);
    if (permissions.some((p) => !held.has(p))) throw new BusinessException('ROLE_ESCALATION');
  }

  private async writePermissions(m: EntityManager, roleId: string, permissions: string[]): Promise<void> {
    const unique = [...new Set(permissions)];
    if (unique.length) await m.insert(RolePermission, unique.map((permission) => ({ role_id: roleId, permission })));
  }
}
```

`backend/src/access/roles.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CreateRoleDto, SetPermissionsDto } from './dto';
import { PERMISSIONS } from './permissions';
import { RolesService } from './roles.service';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('role.view')
  @Get('permissions')
  catalog() {
    return Object.entries(PERMISSIONS).map(([code, label]) => ({ code, label }));
  }

  @RequirePermission('role.view')
  @Get('roles')
  list(@CurrentUser() user: AuthUser) {
    return this.roles.list(tenantOf(user));
  }

  @RequirePermission('role.manage')
  @Post('roles')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user, dto);
  }

  @RequirePermission('role.manage')
  @Put('roles/:id/permissions')
  setPermissions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPermissionsDto) {
    return this.roles.setPermissions(user, id, dto.permissions);
  }
}
```

`backend/src/access/access.module.ts` (thay toàn bộ):
```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PermissionGuard } from './permission.guard';
import { PermissionService } from './permission.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { ScopeService } from './scope.service';

@Module({
  imports: [AuditModule],
  providers: [PermissionService, ScopeService, RolesService, PermissionGuard],
  controllers: [RolesController],
  exports: [PermissionService, ScopeService, PermissionGuard],
})
export class AccessModule {}
```

- [ ] **Step 5: Viết API quản trị nền tảng**

Trong `backend/src/tenants/tenants.service.ts`, đổi dòng import dto thành `import { CreateTenantDto, UpdateTenantDto } from './dto';` rồi thêm hai phương thức vào class:
```ts
  list() {
    return this.ds.query(
      `SELECT t.id, t.code, t.name, t.status, t.created_at,
              (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS user_count
         FROM tenants t
        ORDER BY t.created_at DESC`,
    );
  }

  async update(id: string, dto: UpdateTenantDto, actor: AuthUser): Promise<Tenant> {
    const repo = this.ds.getRepository(Tenant);
    const tenant = await repo.findOneBy({ id });
    if (!tenant) throw new BusinessException('NOT_FOUND');
    if (dto.name !== undefined) tenant.name = dto.name;
    if (dto.status !== undefined) tenant.status = dto.status;
    const saved = await repo.save(tenant);
    // Suspension needs no session clean-up: JwtStrategy checks the company on every request.
    await this.audit.record(null, {
      tenant_id: id, actor_user_id: actor.id, action: 'tenant.update', entity_type: 'tenant', entity_id: id,
      data: { ...dto },
    });
    return saved;
  }
```

`backend/src/tenants/platform-tenants.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, PlatformOnly } from '../auth/decorators';
import { CreateTenantDto, UpdateTenantDto } from './dto';
import { TenantsService } from './tenants.service';

@PlatformOnly()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(dto, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto, user);
  }
}
```

`backend/src/tenants/tenants.module.ts` (thay toàn bộ):
```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [UsersModule, AuditModule],
  providers: [TenantsService],
  controllers: [PlatformTenantsController],
  exports: [TenantsService],
})
export class TenantsModule {}
```

Trong `backend/src/app.module.ts`: thêm `import { PermissionGuard } from './access/permission.guard';` và thêm provider **ngay sau** dòng `JwtAuthGuard` (thứ tự quan trọng — JWT chạy trước):
```ts
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
```

- [ ] **Step 6: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e`
Expected: PASS — toàn bộ suite (health, schema, tenant-bootstrap, auth, access).

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): permission guard, role management with escalation checks, platform tenants API"
```

---

### Task 7: Nhân viên, nhóm, đội, thành viên đội

**Files:**
- Create: `backend/src/employees/dto.ts`, `employees.service.ts`, `employees.controller.ts`, `employees.module.ts`
- Create: `backend/src/org/dto.ts`, `org.service.ts`, `org.controller.ts`, `org.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/org.e2e-spec.ts`

**Interfaces:**
- Consumes: `TenantRepository`, `ScopeService` (`teamVisibility`, `canSeeTeam`, `assertTenantScope`), `AuditService`, `todayLocal`, `addDays`, `normalizePhone`, entity `Employee/TeamGroup/Team/TeamMember`.
- Produces:
  - `interface EmployeeView { id; code; full_name; phone; position; status; team: { id; name } | null }`; `EmployeesService.list(actor)`, `.get(actor, id)` (404 nếu ngoài phạm vi), `.create(actor, dto)`, `.update(actor, id, dto)`.
  - `interface TeamRow { id; name; team_group_id; leader_employee_id; leader_name; member_count }`, `GroupRow { id; name; manager_user_id; manager_name }`, `ChartNode { group: GroupRow | null; teams: TeamRow[] }`, `MemberRow { id; employee_id; code; full_name; phone; start_date; is_leader }`.
  - `OrgService.teams(actor)`, `.chart(actor)`, `.members(actor, teamId)`, `.createGroup/updateGroup/deleteGroup`, `.createTeam/updateTeam/deleteTeam`, `.addMember(actor, teamId, { employee_id, start_date? })`, `.leave(actor, teamId, employeeId, { left_on? })`.
  - Routes: `GET|POST /api/employees`, `GET|PATCH /api/employees/:id`; `GET /api/org/chart`, `GET /api/org/teams`, `GET /api/org/teams/:id/members`, `POST|PATCH|DELETE /api/org/groups[/:id]`, `POST|PATCH|DELETE /api/org/teams[/:id]`, `POST /api/org/teams/:id/members`, `POST /api/org/teams/:id/members/:employeeId/leave`.
  - Quy ước ngày: `start_date` = ngày đầu tiên ở đội mới; `left_on` = ngày đầu tiên **không còn** ở đội; `end_date` lưu = ngày cuối cùng còn ở đội.

- [ ] **Step 1: Viết test thất bại**

`backend/test/org.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Organisation (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let tenantId: string;
  let api: ReturnType<typeof client>;
  const today = todayLocal();

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'org');
    tenantId = admin.tenant.id;
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newEmployee = async (code: string) =>
    (await api.post('/api/employees', { code, full_name: `Bảo vệ ${code}` }).expect(201)).body.data;
  const newTeam = async (name: string, team_group_id?: string) =>
    (await api.post('/api/org/teams', team_group_id ? { name, team_group_id } : { name }).expect(201)).body.data;
  const join = (teamId: string, employeeId: string, start_date?: string) =>
    api.post(`/api/org/teams/${teamId}/members`, start_date ? { employee_id: employeeId, start_date } : { employee_id: employeeId });
  const memberIds = async (teamId: string): Promise<string[]> =>
    (await api.get(`/api/org/teams/${teamId}/members`).expect(200)).body.data.map((m: { employee_id: string }) => m.employee_id);
  const history = (employeeId: string) =>
    ds.query(`SELECT team_id, start_date, end_date FROM team_members WHERE employee_id = $1 ORDER BY start_date`, [employeeId]);

  it('refuses duplicate employee codes regardless of case', async () => {
    await newEmployee('BV-001');
    const dup = await api.post('/api/employees', { code: 'bv-001', full_name: 'X' }).expect(409);
    expect(dup.body.error.code).toBe('EMPLOYEE_CODE_TAKEN');
  });

  it('names a leader only from the current members', async () => {
    const team = await newTeam('Đội Leader');
    const a = await newEmployee('L-A');
    const b = await newEmployee('L-B');
    await join(team.id, a.id).expect(201);
    const bad = await api.patch(`/api/org/teams/${team.id}`, { leader_employee_id: b.id }).expect(400);
    expect(bad.body.error.code).toBe('ORG_LEADER_NOT_MEMBER');
    const ok = await api.patch(`/api/org/teams/${team.id}`, { leader_employee_id: a.id }).expect(200);
    expect(ok.body.data.leader_employee_id).toBe(a.id);
    const members = (await api.get(`/api/org/teams/${team.id}/members`).expect(200)).body.data;
    expect(members[0]).toMatchObject({ employee_id: a.id, is_leader: true });
  });

  it('moves a guard between teams: the old stay ends the day before and leadership is dropped', async () => {
    const t1 = await newTeam('Đội 1');
    const t2 = await newTeam('Đội 2');
    const e = await newEmployee('MV-1');
    const monthAgo = addDays(today, -30);
    await join(t1.id, e.id, monthAgo).expect(201);
    await api.patch(`/api/org/teams/${t1.id}`, { leader_employee_id: e.id }).expect(200);

    await join(t2.id, e.id).expect(201);
    expect(await history(e.id)).toEqual([
      { team_id: t1.id, start_date: monthAgo, end_date: addDays(today, -1) },
      { team_id: t2.id, start_date: today, end_date: null },
    ]);
    const [team1] = await ds.query(`SELECT leader_employee_id FROM teams WHERE id = $1`, [t1.id]);
    expect(team1.leader_employee_id).toBeNull();
    expect(await memberIds(t1.id)).not.toContain(e.id);
    expect(await memberIds(t2.id)).toContain(e.id);
    const view = (await api.get(`/api/employees/${e.id}`).expect(200)).body.data;
    expect(view.team).toEqual({ id: t2.id, name: 'Đội 2' });
  });

  it('corrects a same-day mistake instead of leaving a zero-length stay', async () => {
    const wrong = await newTeam('Đội nhầm');
    const right = await newTeam('Đội đúng');
    const e = await newEmployee('SD-1');
    await join(wrong.id, e.id).expect(201);
    await join(right.id, e.id).expect(201);
    expect(await history(e.id)).toEqual([{ team_id: right.id, start_date: today, end_date: null }]);
  });

  it('refuses a transfer that would rewrite later history, and dates in the future', async () => {
    const t1 = await newTeam('Đội X');
    const t2 = await newTeam('Đội Y');
    const e = await newEmployee('CF-1');
    await join(t1.id, e.id).expect(201);
    const conflict = await join(t2.id, e.id, addDays(today, -5)).expect(409);
    expect(conflict.body.error.code).toBe('ORG_MEMBERSHIP_CONFLICT');
    const future = await join(t2.id, e.id, addDays(today, 1)).expect(400);
    expect(future.body.error.code).toBe('ORG_DATE_IN_FUTURE');
  });

  it('takes a guard out of a team, and drops a same-day join entirely', async () => {
    const team = await newTeam('Đội Rời');
    const e = await newEmployee('LV-1');
    const f = await newEmployee('LV-2');
    await join(team.id, e.id, addDays(today, -10)).expect(201);
    await api.post(`/api/org/teams/${team.id}/members/${e.id}/leave`).expect(200);
    expect(await history(e.id)).toEqual([
      { team_id: team.id, start_date: addDays(today, -10), end_date: addDays(today, -1) },
    ]);
    await join(team.id, f.id).expect(201);
    await api.post(`/api/org/teams/${team.id}/members/${f.id}/leave`).expect(200);
    expect(await history(f.id)).toEqual([]);
    expect(await memberIds(team.id)).toEqual([]);
  });

  it('limits a team leader to their team and a group manager to their group', async () => {
    const manager = await createUserWithRoles(app, tenantId, ['manager'], []);
    const group = (await api.post('/api/org/groups', { name: 'Nhóm Bắc', manager_user_id: manager.user.id }).expect(201)).body.data;
    const north1 = await newTeam('Bắc 1', group.id);
    const north2 = await newTeam('Bắc 2', group.id);
    const south = await newTeam('Nam 1');
    const lead = await newEmployee('TL-1');
    const g1 = await newEmployee('TL-2');
    const g2 = await newEmployee('TL-3');
    await join(south.id, lead.id).expect(201);
    await join(south.id, g1.id).expect(201);
    await join(north1.id, g2.id).expect(201);
    await api.patch(`/api/org/teams/${south.id}`, { leader_employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, tenantId, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    const asLeader = client(app, leader.token);

    const leaderTeams = (await asLeader.get('/api/org/teams').expect(200)).body.data;
    expect(leaderTeams.map((t: { id: string }) => t.id)).toEqual([south.id]);
    const leaderStaff = (await asLeader.get('/api/employees').expect(200)).body.data;
    expect(leaderStaff.map((x: { id: string }) => x.id).sort()).toEqual([lead.id, g1.id].sort());
    await asLeader.get(`/api/employees/${g2.id}`).expect(404);
    await asLeader.get(`/api/org/teams/${north1.id}/members`).expect(404);

    const asManager = client(app, manager.token);
    const managerTeams = (await asManager.get('/api/org/teams').expect(200)).body.data;
    expect(managerTeams.map((t: { id: string }) => t.id).sort()).toEqual([north1.id, north2.id].sort());
    const chart = (await asManager.get('/api/org/chart').expect(200)).body.data;
    expect(chart).toHaveLength(1);
    expect(chart[0].group.id).toBe(group.id);
  });

  it('keeps organisation changes for org.manage holders with company-wide scope', async () => {
    const lead = await newEmployee('W-1');
    const team = await newTeam('Đội W');
    await join(team.id, lead.id).expect(201);
    await api.patch(`/api/org/teams/${team.id}`, { leader_employee_id: lead.id }).expect(200);
    const leader = await createUserWithRoles(app, tenantId, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });
    await client(app, leader.token).post('/api/org/teams', { name: 'Đội lậu' }).expect(403);

    // HR limited to one team holds org.manage but not company-wide scope.
    const hr = await createUserWithRoles(app, tenantId, ['hr'], [{ scope_type: 'team', scope_id: team.id }]);
    const res = await client(app, hr.token).post('/api/org/teams', { name: 'Đội lậu 2' }).expect(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    await client(app, hr.token).post('/api/employees', { code: 'HR-X', full_name: 'X' }).expect(403);
  });

  it('will not delete a team with members or a group with teams', async () => {
    const group = (await api.post('/api/org/groups', { name: 'Nhóm Xoá' }).expect(201)).body.data;
    const team = await newTeam('Đội Xoá', group.id);
    const e = await newEmployee('DEL-1');
    await join(team.id, e.id, addDays(today, -3)).expect(201);
    expect((await api.delete(`/api/org/teams/${team.id}`).expect(409)).body.error.code).toBe('ORG_TEAM_NOT_EMPTY');
    expect((await api.delete(`/api/org/groups/${group.id}`).expect(409)).body.error.code).toBe('ORG_GROUP_NOT_EMPTY');
    await api.post(`/api/org/teams/${team.id}/members/${e.id}/leave`).expect(200);
    await api.delete(`/api/org/teams/${team.id}`).expect(200);
    await api.delete(`/api/org/groups/${group.id}`).expect(200);
  });

  it('refuses to put an inactive employee in a team', async () => {
    const e = await newEmployee('IN-1');
    const team = await newTeam('Đội IN');
    await api.patch(`/api/employees/${e.id}`, { status: 'inactive' }).expect(200);
    expect((await join(team.id, e.id).expect(400)).body.error.code).toBe('EMPLOYEE_INACTIVE');
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- org`
Expected: FAIL — `POST /api/employees` trả 404.

- [ ] **Step 3: Viết module nhân viên**

`backend/src/employees/dto.ts`:
```ts
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const POSITIONS = ['guard', 'team_leader', 'supervisor', 'office'] as const;

export class CreateEmployeeDto {
  @Matches(/^[A-Za-z0-9._-]{1,30}$/, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  full_name: string;

  @IsOptional() @Matches(/^[+\d\s.()-]{9,20}$/, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string;

  @IsOptional() @IsIn(POSITIONS)
  position?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @Matches(/^[A-Za-z0-9._-]{1,30}$/, { message: 'code: chữ, số, dấu chấm, gạch; tối đa 30 ký tự' })
  code?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  full_name?: string;

  @IsOptional() @Matches(/^[+\d\s.()-]{9,20}$/, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string | null;

  @IsOptional() @IsIn(POSITIONS)
  position?: string;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
```

`backend/src/employees/employees.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { normalizePhone } from '../common/identifiers';
import { TenantRepository } from '../common/tenant-repository';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto';
import { Employee } from './employee.entity';

export interface EmployeeView {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  position: string;
  status: 'active' | 'inactive';
  team: { id: string; name: string } | null;
}

/** "Currently a member of one of these teams", as a filter on alias `e`. */
const IN_VISIBLE_TEAMS = `EXISTS (
  SELECT 1 FROM team_members tm
   WHERE tm.employee_id = e.id AND tm.team_id IN (:...teamIds)
     AND tm.start_date <= :today AND (tm.end_date IS NULL OR tm.end_date >= :today))`;

@Injectable()
export class EmployeesService {
  private readonly repo: TenantRepository<Employee>;

  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {
    this.repo = new TenantRepository(ds.getRepository(Employee));
  }

  async list(actor: AuthUser): Promise<EmployeeView[]> {
    const qb = await this.visibleQuery(actor);
    if (!qb) return [];
    return this.withTeams(await qb.orderBy('e.full_name', 'ASC').getMany());
  }

  /** 404 both for another company's employee and for one outside the caller's teams. */
  async get(actor: AuthUser, id: string): Promise<EmployeeView> {
    const qb = await this.visibleQuery(actor);
    const employee = qb ? await qb.andWhere('e.id = :id', { id }).getOne() : null;
    if (!employee) throw new BusinessException('NOT_FOUND');
    return (await this.withTeams([employee]))[0];
  }

  async create(actor: AuthUser, dto: CreateEmployeeDto): Promise<EmployeeView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.assertCodeFree(tenantId, dto.code, null);
    const employee = await this.repo.create(tenantId, {
      code: dto.code,
      full_name: dto.full_name,
      phone: dto.phone ? normalizePhone(dto.phone) : null,
      position: dto.position ?? 'guard',
    });
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.create', entity_type: 'employee',
      entity_id: employee.id, data: { code: dto.code },
    });
    return this.get(actor, employee.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateEmployeeDto): Promise<EmployeeView> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    await this.repo.get(tenantId, id);
    if (dto.code !== undefined) await this.assertCodeFree(tenantId, dto.code, id);
    const patch: DeepPartial<Employee> = {};
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.full_name !== undefined) patch.full_name = dto.full_name;
    if (dto.phone !== undefined) patch.phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.status !== undefined) patch.status = dto.status;
    await this.repo.update(tenantId, id, patch);
    await this.audit.record(null, {
      tenant_id: tenantId, actor_user_id: actor.id, action: 'employee.update', entity_type: 'employee',
      entity_id: id, data: { ...dto },
    });
    return this.get(actor, id);
  }

  private async visibleQuery(actor: AuthUser) {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.teamVisibility(actor);
    const qb = this.ds.getRepository(Employee).createQueryBuilder('e').where('e.tenant_id = :tenantId', { tenantId });
    if (visibility.all) return qb;
    if (!visibility.teamIds.length) return null;
    return qb.andWhere(IN_VISIBLE_TEAMS, { teamIds: visibility.teamIds, today: todayLocal() });
  }

  private async assertCodeFree(tenantId: string, code: string, exceptId: string | null): Promise<void> {
    const qb = this.ds
      .getRepository(Employee)
      .createQueryBuilder('e')
      .where('e.tenant_id = :tenantId AND lower(e.code) = lower(:code)', { tenantId, code });
    if (exceptId) qb.andWhere('e.id <> :exceptId', { exceptId });
    if (await qb.getExists()) throw new BusinessException('EMPLOYEE_CODE_TAKEN');
  }

  private async withTeams(employees: Employee[]): Promise<EmployeeView[]> {
    if (!employees.length) return [];
    const rows: { employee_id: string; id: string; name: string }[] = await this.ds.query(
      `SELECT tm.employee_id, t.id, t.name
         FROM team_members tm JOIN teams t ON t.id = tm.team_id
        WHERE tm.employee_id = ANY($1::uuid[]) AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)`,
      [employees.map((e) => e.id), todayLocal()],
    );
    const teamOf = new Map(rows.map((r) => [r.employee_id, { id: r.id, name: r.name }]));
    return employees.map((e) => ({
      id: e.id,
      code: e.code,
      full_name: e.full_name,
      phone: e.phone,
      position: e.position,
      status: e.status,
      team: teamOf.get(e.id) ?? null,
    }));
  }
}
```

`backend/src/employees/employees.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermission('employee.view')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.employees.list(user);
  }

  @RequirePermission('employee.view')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(user, id);
  }

  @RequirePermission('employee.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(user, dto);
  }

  @RequirePermission('employee.manage')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(user, id, dto);
  }
}
```

`backend/src/employees/employees.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [EmployeesService],
  controllers: [EmployeesController],
  exports: [EmployeesService],
})
export class EmployeesModule {}
```

- [ ] **Step 4: Viết module tổ chức**

`backend/src/org/dto.ts`:
```ts
import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateGroupDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsUUID()
  manager_user_id?: string;
}

export class UpdateGroupDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  /** null removes the manager. */
  @IsOptional() @IsUUID()
  manager_user_id?: string | null;
}

export class CreateTeamDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsOptional() @IsUUID()
  team_group_id?: string;
}

export class UpdateTeamDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  name?: string;

  @IsOptional() @IsUUID()
  team_group_id?: string | null;

  @IsOptional() @IsUUID()
  leader_employee_id?: string | null;
}

export class AddMemberDto {
  @IsUUID()
  employee_id: string;

  /** First day in the new team. Defaults to today. */
  @IsOptional() @Matches(ISO_DATE, { message: 'start_date: định dạng YYYY-MM-DD' })
  start_date?: string;
}

export class LeaveTeamDto {
  /** First day no longer in the team. Defaults to today. */
  @IsOptional() @Matches(ISO_DATE, { message: 'left_on: định dạng YYYY-MM-DD' })
  left_on?: string;
}
```

`backend/src/org/org.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { AddMemberDto, CreateGroupDto, CreateTeamDto, LeaveTeamDto, UpdateGroupDto, UpdateTeamDto } from './dto';
import { TeamGroup } from './team-group.entity';
import { TeamMember } from './team-member.entity';
import { Team } from './team.entity';

export interface TeamRow {
  id: string;
  name: string;
  team_group_id: string | null;
  leader_employee_id: string | null;
  leader_name: string | null;
  member_count: number;
}

export interface GroupRow {
  id: string;
  name: string;
  manager_user_id: string | null;
  manager_name: string | null;
}

export interface ChartNode {
  group: GroupRow | null;
  teams: TeamRow[];
}

export interface MemberRow {
  id: string;
  employee_id: string;
  code: string;
  full_name: string;
  phone: string | null;
  start_date: string;
  is_leader: boolean;
}

interface Stay {
  id: string;
  team_id: string;
  start_date: string;
}

@Injectable()
export class OrgService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async teams(actor: AuthUser): Promise<TeamRow[]> {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.teamVisibility(actor);
    if (!visibility.all && !visibility.teamIds.length) return [];
    const params: unknown[] = [tenantId, todayLocal()];
    let filter = '';
    if (!visibility.all) {
      params.push(visibility.teamIds);
      filter = 'AND t.id = ANY($3::uuid[])';
    }
    return this.ds.query(
      `SELECT t.id, t.name, t.team_group_id, t.leader_employee_id, le.full_name AS leader_name,
              (SELECT count(*)::int FROM team_members tm
                WHERE tm.team_id = t.id AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)) AS member_count
         FROM teams t
         LEFT JOIN employees le ON le.id = t.leader_employee_id
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL ${filter}
        ORDER BY t.name`,
      params,
    );
  }

  /** Groups with their teams, then the teams that belong to no group. */
  async chart(actor: AuthUser): Promise<ChartNode[]> {
    const tenantId = tenantOf(actor);
    const [teams, visibility] = await Promise.all([this.teams(actor), this.scopes.teamVisibility(actor)]);
    const groups: GroupRow[] = await this.ds.query(
      `SELECT g.id, g.name, g.manager_user_id, u.full_name AS manager_name
         FROM team_groups g LEFT JOIN users u ON u.id = g.manager_user_id
        WHERE g.tenant_id = $1 AND g.deleted_at IS NULL
        ORDER BY g.name`,
      [tenantId],
    );
    const nodes: ChartNode[] = groups
      .map((group) => ({ group, teams: teams.filter((t) => t.team_group_id === group.id) }))
      .filter((node) => visibility.all || node.teams.length > 0);
    const ungrouped = teams.filter((t) => !t.team_group_id);
    if (ungrouped.length) nodes.push({ group: null, teams: ungrouped });
    return nodes;
  }

  async members(actor: AuthUser, teamId: string): Promise<MemberRow[]> {
    const tenantId = tenantOf(actor);
    await this.teamRepo().get(tenantId, teamId);
    if (!(await this.scopes.canSeeTeam(actor, teamId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `SELECT tm.id, tm.employee_id, e.code, e.full_name, e.phone, tm.start_date,
              COALESCE(t.leader_employee_id = e.id, false) AS is_leader
         FROM team_members tm
         JOIN employees e ON e.id = tm.employee_id
         JOIN teams t ON t.id = tm.team_id
        WHERE tm.team_id = $1 AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)
        ORDER BY is_leader DESC, e.full_name`,
      [teamId, todayLocal()],
    );
  }

  async createGroup(actor: AuthUser, dto: CreateGroupDto): Promise<TeamGroup> {
    const tenantId = await this.writer(actor);
    if (dto.manager_user_id) await this.assertStaffUser(tenantId, dto.manager_user_id);
    const group = await this.groupRepo().create(tenantId, { name: dto.name, manager_user_id: dto.manager_user_id ?? null });
    await this.log(actor, 'org.group.create', 'team_group', group.id, { ...dto });
    return group;
  }

  async updateGroup(actor: AuthUser, id: string, dto: UpdateGroupDto): Promise<TeamGroup> {
    const tenantId = await this.writer(actor);
    await this.groupRepo().get(tenantId, id);
    if (dto.manager_user_id) await this.assertStaffUser(tenantId, dto.manager_user_id);
    const patch: DeepPartial<TeamGroup> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.manager_user_id !== undefined) patch.manager_user_id = dto.manager_user_id;
    const group = await this.groupRepo().update(tenantId, id, patch);
    await this.log(actor, 'org.group.update', 'team_group', id, { ...dto });
    return group;
  }

  async deleteGroup(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = await this.writer(actor);
    await this.groupRepo().get(tenantId, id);
    const used = await this.ds.query(`SELECT 1 FROM teams WHERE team_group_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    if (used.length) throw new BusinessException('ORG_GROUP_NOT_EMPTY');
    await this.groupRepo().softDelete(tenantId, id);
    await this.log(actor, 'org.group.delete', 'team_group', id, {});
    return { ok: true };
  }

  async createTeam(actor: AuthUser, dto: CreateTeamDto): Promise<Team> {
    const tenantId = await this.writer(actor);
    if (dto.team_group_id) await this.groupRepo().get(tenantId, dto.team_group_id);
    const team = await this.teamRepo().create(tenantId, { name: dto.name, team_group_id: dto.team_group_id ?? null });
    await this.log(actor, 'org.team.create', 'team', team.id, { ...dto });
    return team;
  }

  async updateTeam(actor: AuthUser, id: string, dto: UpdateTeamDto): Promise<Team> {
    const tenantId = await this.writer(actor);
    await this.teamRepo().get(tenantId, id);
    if (dto.team_group_id) await this.groupRepo().get(tenantId, dto.team_group_id);
    if (dto.leader_employee_id) {
      const stay = await this.stayOn(this.ds.manager, dto.leader_employee_id, todayLocal());
      if (!stay || stay.team_id !== id) throw new BusinessException('ORG_LEADER_NOT_MEMBER');
    }
    const patch: DeepPartial<Team> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.team_group_id !== undefined) patch.team_group_id = dto.team_group_id;
    if (dto.leader_employee_id !== undefined) patch.leader_employee_id = dto.leader_employee_id;
    const team = await this.teamRepo().update(tenantId, id, patch);
    await this.log(actor, 'org.team.update', 'team', id, { ...dto });
    return team;
  }

  async deleteTeam(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = await this.writer(actor);
    await this.teamRepo().get(tenantId, id);
    const used = await this.ds.query(
      `SELECT 1 FROM team_members WHERE team_id = $1 AND (end_date IS NULL OR end_date >= $2) LIMIT 1`,
      [id, todayLocal()],
    );
    if (used.length) throw new BusinessException('ORG_TEAM_NOT_EMPTY');
    await this.teamRepo().softDelete(tenantId, id);
    await this.log(actor, 'org.team.delete', 'team', id, {});
    return { ok: true };
  }

  /**
   * Puts an employee in a team from `start_date`. Their current stay elsewhere
   * ends the day before; a stay that began that same day is corrected in place.
   * History after `start_date` is never rewritten.
   */
  async addMember(actor: AuthUser, teamId: string, dto: AddMemberDto) {
    const tenantId = await this.writer(actor);
    const today = todayLocal();
    const startDate = dto.start_date ?? today;
    if (startDate > today) throw new BusinessException('ORG_DATE_IN_FUTURE');

    return this.ds.transaction(async (m) => {
      await this.teamRepo(m).get(tenantId, teamId);
      const employee = await this.lockEmployee(m, tenantId, dto.employee_id);
      if (employee.status !== 'active') throw new BusinessException('EMPLOYEE_INACTIVE');

      const later = await m.query(`SELECT 1 FROM team_members WHERE employee_id = $1 AND start_date > $2 LIMIT 1`, [
        employee.id,
        startDate,
      ]);
      if (later.length) throw new BusinessException('ORG_MEMBERSHIP_CONFLICT');

      const current = await this.stayOn(m, employee.id, startDate);
      if (current?.team_id === teamId) {
        return { id: current.id, team_id: teamId, employee_id: employee.id, start_date: current.start_date };
      }

      let stayId: string;
      if (current && current.start_date === startDate) {
        await m.query(`UPDATE team_members SET team_id = $2, updated_at = now() WHERE id = $1`, [current.id, teamId]);
        stayId = current.id;
      } else {
        if (current) {
          await m.query(`UPDATE team_members SET end_date = $2, updated_at = now() WHERE id = $1`, [
            current.id,
            addDays(startDate, -1),
          ]);
        }
        const row = await m.save(
          m.create(TeamMember, { tenant_id: tenantId, team_id: teamId, employee_id: employee.id, start_date: startDate, end_date: null }),
        );
        stayId = row.id;
      }
      // A leader who moves away stops leading the team they left.
      if (current) await this.dropLeader(m, current.team_id, employee.id);

      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'org.member.add', entity_type: 'team', entity_id: teamId,
        data: { employee_id: employee.id, start_date: startDate, from_team_id: current?.team_id ?? null },
      });
      return { id: stayId, team_id: teamId, employee_id: employee.id, start_date: startDate };
    });
  }

  /** Ends a stay so that `left_on` is the first day out. A stay that would end before it began is removed. */
  async leave(actor: AuthUser, teamId: string, employeeId: string, dto: LeaveTeamDto): Promise<{ ok: true }> {
    const tenantId = await this.writer(actor);
    const today = todayLocal();
    const leftOn = dto.left_on ?? today;
    if (leftOn > today) throw new BusinessException('ORG_DATE_IN_FUTURE');

    return this.ds.transaction(async (m) => {
      await this.teamRepo(m).get(tenantId, teamId);
      await this.lockEmployee(m, tenantId, employeeId);
      const [stay]: { id: string; start_date: string }[] = await m.query(
        `SELECT id, start_date FROM team_members
          WHERE team_id = $1 AND employee_id = $2 AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3)`,
        [teamId, employeeId, leftOn],
      );
      if (!stay) throw new BusinessException('NOT_FOUND');

      const endDate = addDays(leftOn, -1);
      if (endDate < stay.start_date) await m.query(`DELETE FROM team_members WHERE id = $1`, [stay.id]);
      else await m.query(`UPDATE team_members SET end_date = $2, updated_at = now() WHERE id = $1`, [stay.id, endDate]);
      await this.dropLeader(m, teamId, employeeId);

      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'org.member.leave', entity_type: 'team', entity_id: teamId,
        data: { employee_id: employeeId, left_on: leftOn },
      });
      return { ok: true as const };
    });
  }

  /** Organisation changes need org.manage (checked by the guard) and company-wide scope. */
  private async writer(actor: AuthUser): Promise<string> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    return tenantId;
  }

  private async stayOn(m: EntityManager, employeeId: string, date: string): Promise<Stay | null> {
    const [stay]: Stay[] = await m.query(
      `SELECT id, team_id, start_date FROM team_members
        WHERE employee_id = $1 AND start_date <= $2 AND (end_date IS NULL OR end_date >= $2)`,
      [employeeId, date],
    );
    return stay ?? null;
  }

  /** Row lock on the employee: two simultaneous transfers of one person queue up instead of racing. */
  private async lockEmployee(m: EntityManager, tenantId: string, employeeId: string): Promise<{ id: string; status: string }> {
    const [employee]: { id: string; status: string }[] = await m.query(
      `SELECT id, status FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [employeeId, tenantId],
    );
    if (!employee) throw new BusinessException('NOT_FOUND');
    return employee;
  }

  private async dropLeader(m: EntityManager, teamId: string, employeeId: string): Promise<void> {
    await m.query(`UPDATE teams SET leader_employee_id = NULL, updated_at = now() WHERE id = $1 AND leader_employee_id = $2`, [
      teamId,
      employeeId,
    ]);
  }

  private async assertStaffUser(tenantId: string, userId: string): Promise<void> {
    const rows = await this.ds.query(
      `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND user_type = 'staff' AND status = 'active' AND deleted_at IS NULL`,
      [userId, tenantId],
    );
    if (!rows.length) throw new BusinessException('NOT_FOUND');
  }

  private log(actor: AuthUser, action: string, entityType: string, entityId: string, data: Record<string, unknown>) {
    return this.audit.record(null, {
      tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: entityType, entity_id: entityId, data,
    });
  }

  private groupRepo(m: EntityManager = this.ds.manager) {
    return new TenantRepository(m.getRepository(TeamGroup));
  }

  private teamRepo(m: EntityManager = this.ds.manager) {
    return new TenantRepository(m.getRepository(Team));
  }
}
```

`backend/src/org/org.controller.ts`:
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AddMemberDto, CreateGroupDto, CreateTeamDto, LeaveTeamDto, UpdateGroupDto, UpdateTeamDto } from './dto';
import { OrgService } from './org.service';

@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @RequirePermission('org.view')
  @Get('chart')
  chart(@CurrentUser() user: AuthUser) {
    return this.org.chart(user);
  }

  @RequirePermission('org.view')
  @Get('teams')
  teams(@CurrentUser() user: AuthUser) {
    return this.org.teams(user);
  }

  @RequirePermission('org.view')
  @Get('teams/:id/members')
  members(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.members(user, id);
  }

  @RequirePermission('org.manage')
  @Post('groups')
  createGroup(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.org.createGroup(user, dto);
  }

  @RequirePermission('org.manage')
  @Patch('groups/:id')
  updateGroup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto) {
    return this.org.updateGroup(user, id, dto);
  }

  @RequirePermission('org.manage')
  @Delete('groups/:id')
  deleteGroup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.deleteGroup(user, id);
  }

  @RequirePermission('org.manage')
  @Post('teams')
  createTeam(@CurrentUser() user: AuthUser, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(user, dto);
  }

  @RequirePermission('org.manage')
  @Patch('teams/:id')
  updateTeam(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    return this.org.updateTeam(user, id, dto);
  }

  @RequirePermission('org.manage')
  @Delete('teams/:id')
  deleteTeam(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.deleteTeam(user, id);
  }

  @RequirePermission('org.manage')
  @Post('teams/:id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.org.addMember(user, id, dto);
  }

  @RequirePermission('org.manage')
  @Post('teams/:id/members/:employeeId/leave')
  @HttpCode(200)
  leave(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: LeaveTeamDto,
  ) {
    return this.org.leave(user, id, employeeId, dto);
  }
}
```

`backend/src/org/org.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
```

Trong `backend/src/app.module.ts`: thêm `import { EmployeesModule } from './employees/employees.module';`, `import { OrgModule } from './org/org.module';` và thêm `EmployeesModule, OrgModule,` vào cuối mảng `imports`.

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e -- org`
Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): employees, groups, teams and dated team membership with scoped visibility"
```

---

### Task 8: API người dùng (tạo, sửa, khoá, đặt lại mật khẩu) với chống leo thang

**Files:**
- Create: `backend/src/access/access.service.ts`, `backend/src/users/dto.ts`, `backend/src/users/users.controller.ts`
- Modify: `backend/src/access/access.module.ts`, `backend/src/users/users.service.ts`, `backend/src/users/users.module.ts`
- Test: `backend/test/users.e2e-spec.ts`

**Interfaces:**
- Consumes: `PermissionService`, `ScopeService`, `EmployeesService.get`, `AuditService`, các hàm export của `users.service.ts` (Task 4), `ADMIN_ROLE_CODE`.
- Produces:
  - `AccessService.assertCanGrant(actor, roleIds, scopes)`, `.assertCanManageUser(actor, targetUserId)`.
  - `interface UserView { id; full_name; phone; email; user_type; status; employee_id; must_change_password; last_login_at; roles: {id, code, name}[]; scopes: {scope_type, scope_id}[] }`; `UserRow` = `UserView` không có `scopes`, `must_change_password`.
  - `UsersService.list(actor)`, `.get(actor, id)`, `.create(actor, dto)`, `.update(actor, id, dto)`, `.resetPassword(actor, id, newPassword)`; `insertUser` giữ nguyên chữ ký.
  - Routes: `GET /api/users`, `GET /api/users/:id`, `POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-password` `{new_password}`.

- [ ] **Step 1: Viết test thất bại**

`backend/test/users.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, login, uniquePhone } from './helpers';

describe('Users (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let roles: Record<string, string>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'usr');
    api = client(app, admin.token);
    const list = (await api.get('/api/roles').expect(200)).body.data as { id: string; code: string }[];
    roles = Object.fromEntries(list.map((r) => [r.code, r.id]));
  });
  afterAll(async () => app.close());

  const tid = () => admin.tenant.id;
  const newEmployee = async (code: string) =>
    (await api.post('/api/employees', { code, full_name: `Bảo vệ ${code}` }).expect(201)).body.data;
  const userBody = (extra: object = {}) => ({
    user_type: 'staff', full_name: 'Người mới', phone: uniquePhone(), password: 'Passw0rd!', role_ids: [], scopes: [], ...extra,
  });

  it('lets HR open a guard account that must change its password', async () => {
    const hr = await createUserWithRoles(app, tid(), ['hr']);
    const team = (await api.post('/api/org/teams', { name: 'Đội U' }).expect(201)).body.data;
    const emp = await newEmployee('U-1');
    const res = await client(app, hr.token)
      .post('/api/users', {
        user_type: 'guard', full_name: 'Bảo vệ U1', phone: '0911 222 333', password: 'Guard@1234',
        employee_id: emp.id, role_ids: [roles.guard], scopes: [{ scope_type: 'team', scope_id: team.id }],
      })
      .expect(201);
    expect(res.body.data).toMatchObject({ phone: '0911222333', user_type: 'guard', employee_id: emp.id, must_change_password: true });
    expect(res.body.data.roles.map((r: { code: string }) => r.code)).toEqual(['guard']);
    expect(res.body.data.scopes).toEqual([{ scope_type: 'team', scope_id: team.id }]);

    const token = await login(app, '0911222333', 'Guard@1234');
    expect((await client(app, token).get('/api/auth/me').expect(200)).body.data.user.must_change_password).toBe(true);
  });

  it('stops HR from handing out the admin role or touching the admin account', async () => {
    const hr = await createUserWithRoles(app, tid(), ['hr']);
    const asHr = client(app, hr.token);
    const esc = await asHr.post('/api/users', userBody({ role_ids: [roles.admin], scopes: [{ scope_type: 'tenant' }] })).expect(403);
    expect(esc.body.error.code).toBe('ROLE_ESCALATION');
    await asHr.post(`/api/users/${admin.adminUserId}/reset-password`, { new_password: 'Hacked@123' }).expect(403);
    await asHr.patch(`/api/users/${admin.adminUserId}`, { status: 'locked' }).expect(403);
  });

  it('stops a team-scoped user from granting company-wide scope', async () => {
    const team = (await api.post('/api/org/teams', { name: 'Đội hẹp' }).expect(201)).body.data;
    const narrowHr = await createUserWithRoles(app, tid(), ['hr'], [{ scope_type: 'team', scope_id: team.id }]);
    const res = await client(app, narrowHr.token).post('/api/users', userBody({ scopes: [{ scope_type: 'tenant' }] })).expect(403);
    expect(res.body.error.code).toBe('ROLE_ESCALATION');
  });

  it("resetting a password ends that user's sessions and forces a change", async () => {
    const guard = await createUserWithRoles(app, tid(), ['guard'], [], { user_type: 'guard' });
    await api.post(`/api/users/${guard.user.id}/reset-password`, { new_password: 'Reset@1234' }).expect(200);
    await client(app, guard.token).get('/api/auth/me').expect(401);
    const fresh = await login(app, guard.phone, 'Reset@1234');
    expect((await client(app, fresh).get('/api/auth/me').expect(200)).body.data.user.must_change_password).toBe(true);
  });

  it('locking a user takes effect on their very next request', async () => {
    const guard = await createUserWithRoles(app, tid(), ['guard'], [], { user_type: 'guard' });
    await api.patch(`/api/users/${guard.user.id}`, { status: 'locked' }).expect(200);
    await client(app, guard.token).get('/api/auth/me').expect(401);
  });

  it('keeps at least one admin in the company and refuses self-locking', async () => {
    const last = await api.patch(`/api/users/${admin.adminUserId}`, { role_ids: [roles.manager] }).expect(400);
    expect(last.body.error.code).toBe('LAST_ADMIN');
    const self = await api.patch(`/api/users/${admin.adminUserId}`, { status: 'locked' }).expect(400);
    expect(self.body.error.code).toBe('USER_CANNOT_LOCK_SELF');

    const second = await createUserWithRoles(app, tid(), ['admin']);
    await client(app, second.token).patch(`/api/users/${second.user.id}`, { role_ids: [roles.manager] }).expect(200);
  });

  it('refuses a phone already used in any company, in any format, and an employee already linked', async () => {
    const other = await createTenantWithAdmin(app, 'usr-other');
    const dup = await api.post('/api/users', userBody({ phone: other.phone.replace(/^0/, '+84') })).expect(409);
    expect(dup.body.error.code).toBe('USER_IDENTIFIER_TAKEN');

    const emp = await newEmployee('U-DUP');
    await api.post('/api/users', userBody({ user_type: 'guard', employee_id: emp.id })).expect(201);
    const taken = await api.post('/api/users', userBody({ user_type: 'guard', employee_id: emp.id })).expect(409);
    expect(taken.body.error.code).toBe('USER_EMPLOYEE_TAKEN');
  });

  it('will not leave an account with neither phone nor email', async () => {
    const guard = await createUserWithRoles(app, tid(), ['guard'], [], { user_type: 'guard' });
    const res = await api.patch(`/api/users/${guard.user.id}`, { phone: null }).expect(400);
    expect(res.body.error.code).toBe('USER_IDENTIFIER_REQUIRED');
  });

  it('lists users with their roles and never their password hash', async () => {
    const res = await api.get('/api/users').expect(200);
    const me = res.body.data.find((u: { id: string }) => u.id === admin.adminUserId);
    expect(me.roles.map((r: { code: string }) => r.code)).toContain('admin');
    expect(me).not.toHaveProperty('password_hash');
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- users`
Expected: FAIL — `POST /api/users` trả 404.

- [ ] **Step 3: Viết AccessService**

`backend/src/access/access.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { PermissionService } from './permission.service';
import { ScopeService } from './scope.service';
import { ScopeInput } from './scope.types';

/** The rule behind every grant: you can only hand out what you already hold. */
@Injectable()
export class AccessService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionService,
    private readonly scopes: ScopeService,
  ) {}

  async assertCanGrant(actor: AuthUser, roleIds: string[], scopes: ScopeInput[]): Promise<void> {
    const tenantId = tenantOf(actor);
    const unique = [...new Set(roleIds)];
    if (unique.length) {
      const found: { id: string }[] = await this.ds.query(
        `SELECT id FROM roles WHERE tenant_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
        [tenantId, unique],
      );
      if (found.length !== unique.length) throw new BusinessException('NOT_FOUND');
      const granted: { permission: string }[] = await this.ds.query(
        `SELECT DISTINCT permission FROM role_permissions WHERE role_id = ANY($1::uuid[])`,
        [unique],
      );
      const held = await this.permissions.permissionsOf(actor.id);
      if (granted.some((g) => !held.has(g.permission))) throw new BusinessException('ROLE_ESCALATION');
    }

    if (!scopes.length) return;
    const visibility = await this.scopes.teamVisibility(actor);
    for (const scope of scopes) {
      if (scope.scope_type === 'tenant') {
        if (scope.scope_id) throw new BusinessException('SCOPE_INVALID');
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else if (scope.scope_type === 'team') {
        if (!scope.scope_id || !(await this.exists('teams', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all && !visibility.teamIds.includes(scope.scope_id)) throw new BusinessException('ROLE_ESCALATION');
      } else if (scope.scope_type === 'team_group') {
        if (!scope.scope_id || !(await this.exists('team_groups', scope.scope_id, tenantId))) {
          throw new BusinessException('SCOPE_INVALID');
        }
        if (!visibility.all) throw new BusinessException('ROLE_ESCALATION');
      } else {
        // client and site scopes arrive with Plan 02, together with the tables they point at.
        throw new BusinessException('SCOPE_INVALID');
      }
    }
  }

  /** Nobody changes, locks or resets an account that holds more than they do. */
  async assertCanManageUser(actor: AuthUser, targetUserId: string): Promise<void> {
    if (targetUserId === actor.id) return;
    const [held, target] = await Promise.all([
      this.permissions.permissionsOf(actor.id),
      this.permissions.permissionsOf(targetUserId),
    ]);
    if ([...target].some((p) => !held.has(p))) throw new BusinessException('ROLE_ESCALATION');
    const targetUser = { id: targetUserId, tenant_id: actor.tenant_id, user_type: 'staff' as const, employee_id: null, session_id: '' };
    if ((await this.scopes.hasTenantScope(targetUser)) && !(await this.scopes.hasTenantScope(actor))) {
      throw new BusinessException('ROLE_ESCALATION');
    }
  }

  private async exists(table: 'teams' | 'team_groups', id: string, tenantId: string): Promise<boolean> {
    const rows = await this.ds.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, tenantId]);
    return rows.length > 0;
  }
}
```

`backend/src/access/access.module.ts` (thay toàn bộ):
```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccessService } from './access.service';
import { PermissionGuard } from './permission.guard';
import { PermissionService } from './permission.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { ScopeService } from './scope.service';

@Module({
  imports: [AuditModule],
  providers: [PermissionService, ScopeService, AccessService, RolesService, PermissionGuard],
  controllers: [RolesController],
  exports: [PermissionService, ScopeService, AccessService, PermissionGuard],
})
export class AccessModule {}
```

- [ ] **Step 4: Viết DTO, service, controller người dùng**

`backend/src/users/dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested,
} from 'class-validator';

const PHONE = /^[+\d\s.()-]{9,20}$/;

export class ScopeInputDto {
  @IsIn(['tenant', 'team_group', 'team'])
  scope_type: 'tenant' | 'team_group' | 'team';

  @IsOptional() @IsUUID()
  scope_id?: string;
}

export class CreateUserDto {
  @IsIn(['staff', 'guard'])
  user_type: 'staff' | 'guard';

  @IsString() @IsNotEmpty() @MaxLength(200)
  full_name: string;

  @IsOptional() @Matches(PHONE, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsString() @MinLength(8) @MaxLength(100)
  password: string;

  @IsOptional() @IsUUID()
  employee_id?: string;

  @IsArray() @IsUUID('all', { each: true })
  role_ids: string[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => ScopeInputDto)
  scopes: ScopeInputDto[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  full_name?: string;

  @IsOptional() @Matches(PHONE, { message: 'phone: số điện thoại không hợp lệ' })
  phone?: string | null;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string | null;

  @IsOptional() @IsIn(['active', 'locked'])
  status?: 'active' | 'locked';

  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  role_ids?: string[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ScopeInputDto)
  scopes?: ScopeInputDto[];
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(100)
  new_password: string;
}
```

`backend/src/users/users.service.ts` (thay toàn bộ — giữ nguyên `insertUser` và các hàm export của Task 4, thêm constructor và các phương thức API):
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccessService } from '../access/access.service';
import { ADMIN_ROLE_CODE } from '../access/permissions';
import { UserRole, UserScope } from '../access/role.entity';
import { ScopeInput } from '../access/scope.types';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { hashPassword } from '../auth/password';
import { BusinessException } from '../common/errors/business.exception';
import { normalizeEmail, normalizePhone, PHONE_PATTERN } from '../common/identifiers';
import { EmployeesService } from '../employees/employees.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { User, UserType } from './user.entity';

export interface NewUserInput {
  user_type: 'staff' | 'guard';
  full_name: string;
  phone?: string | null;
  email?: string | null;
  password: string;
  employee_id?: string | null;
  role_ids: string[];
  scopes: ScopeInput[];
  must_change_password?: boolean;
}

export interface UserRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  user_type: UserType;
  status: 'active' | 'locked';
  employee_id: string | null;
  last_login_at: Date | null;
  roles: { id: string; code: string; name: string }[];
}

export interface UserView extends UserRow {
  must_change_password: boolean;
  scopes: { scope_type: string; scope_id: string | null }[];
}

const USER_ROWS = `
  SELECT u.id, u.full_name, u.phone, u.email, u.user_type, u.status, u.employee_id, u.last_login_at,
         COALESCE(json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name)
                  FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
   WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND ($2::uuid IS NULL OR u.id = $2::uuid)
   GROUP BY u.id
   ORDER BY u.full_name`;

@Injectable()
export class UsersService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}

  list(actor: AuthUser): Promise<UserRow[]> {
    return this.ds.query(USER_ROWS, [tenantOf(actor), null]);
  }

  async get(actor: AuthUser, id: string): Promise<UserView> {
    const [row]: UserRow[] = await this.ds.query(USER_ROWS, [tenantOf(actor), id]);
    if (!row) throw new BusinessException('NOT_FOUND');
    const [{ must_change_password }] = await this.ds.query(`SELECT must_change_password FROM users WHERE id = $1`, [id]);
    const scopes = await this.ds.query(
      `SELECT scope_type, scope_id FROM user_scopes WHERE user_id = $1 ORDER BY scope_type, scope_id`,
      [id],
    );
    return { ...row, must_change_password, scopes };
  }

  /** Accounts created by someone else start with a password the owner must replace. */
  async create(actor: AuthUser, dto: CreateUserDto): Promise<UserView> {
    const tenantId = tenantOf(actor);
    await this.access.assertCanGrant(actor, dto.role_ids, dto.scopes);
    if (dto.employee_id) await this.employees.get(actor, dto.employee_id);
    const user = await this.ds.transaction(async (m) => {
      const created = await this.insertUser(m, tenantId, { ...dto, must_change_password: true });
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'user.create', entity_type: 'user', entity_id: created.id,
        data: { user_type: dto.user_type, role_ids: dto.role_ids, scopes: dto.scopes },
      });
      return created;
    });
    return this.get(actor, user.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto): Promise<UserView> {
    const tenantId = tenantOf(actor);
    await this.get(actor, id); // 404 before anything reveals the account exists
    await this.access.assertCanManageUser(actor, id);
    if (dto.role_ids || dto.scopes) await this.access.assertCanGrant(actor, dto.role_ids ?? [], dto.scopes ?? []);
    if (id === actor.id && dto.status === 'locked') throw new BusinessException('USER_CANNOT_LOCK_SELF');

    await this.ds.transaction(async (m) => {
      const current = await m.findOneByOrFail(User, { id, tenant_id: tenantId });
      const phone = dto.phone === undefined ? current.phone : dto.phone ? checkedPhone(dto.phone) : null;
      const email = dto.email === undefined ? current.email : dto.email ? normalizeEmail(dto.email) : null;
      if (!phone && !email) throw new BusinessException('USER_IDENTIFIER_REQUIRED');
      if (dto.phone !== undefined || dto.email !== undefined) await assertIdentifiersFree(m, phone, email, id);

      const patch: Partial<User> = { phone, email };
      if (dto.full_name !== undefined) patch.full_name = dto.full_name;
      if (dto.status !== undefined) patch.status = dto.status;
      await m.update(User, { id, tenant_id: tenantId }, patch);
      if (dto.role_ids) await replaceRoles(m, id, dto.role_ids);
      if (dto.scopes) await replaceScopes(m, tenantId, id, dto.scopes);
      if (dto.status === 'locked') await revokeSessions(m, id);
      await assertTenantKeepsAdmin(m, tenantId);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'user.update', entity_type: 'user', entity_id: id,
        data: { ...dto },
      });
    });
    return this.get(actor, id);
  }

  async resetPassword(actor: AuthUser, id: string, newPassword: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.get(actor, id);
    await this.access.assertCanManageUser(actor, id);
    await this.ds.transaction(async (m) => {
      await m.update(User, { id, tenant_id: tenantId }, { password_hash: await hashPassword(newPassword), must_change_password: true });
      await revokeSessions(m, id);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'user.reset_password', entity_type: 'user', entity_id: id,
      });
    });
    return { ok: true };
  }

  /**
   * Writes a user with roles and scopes. Checks identity rules only, not who is
   * asking: callers either bootstrap a company or have already passed AccessService.
   */
  async insertUser(m: EntityManager, tenantId: string, input: NewUserInput): Promise<User> {
    const phone = input.phone ? checkedPhone(input.phone) : null;
    const email = input.email ? normalizeEmail(input.email) : null;
    if (!phone && !email) throw new BusinessException('USER_IDENTIFIER_REQUIRED');
    await assertIdentifiersFree(m, phone, email, null);
    if (input.employee_id) await assertEmployeeFree(m, input.employee_id, null);

    const user = await m.save(
      m.create(User, {
        tenant_id: tenantId,
        user_type: input.user_type,
        full_name: input.full_name,
        phone,
        email,
        password_hash: await hashPassword(input.password),
        employee_id: input.employee_id ?? null,
        must_change_password: input.must_change_password ?? false,
      }),
    );
    await replaceRoles(m, user.id, input.role_ids);
    await replaceScopes(m, tenantId, user.id, input.scopes);
    return user;
  }
}

export function checkedPhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!PHONE_PATTERN.test(phone)) {
    throw new BusinessException('VALIDATION_FAILED', ['phone: Số điện thoại không hợp lệ']);
  }
  return phone;
}

export async function assertIdentifiersFree(
  m: EntityManager,
  phone: string | null,
  email: string | null,
  exceptUserId: string | null,
): Promise<void> {
  if (!phone && !email) return;
  const qb = m
    .createQueryBuilder(User, 'u')
    .where('(u.phone = :phone OR lower(u.email) = :email)', { phone: phone ?? '', email: email ?? '' });
  if (exceptUserId) qb.andWhere('u.id <> :id', { id: exceptUserId });
  if (await qb.getExists()) throw new BusinessException('USER_IDENTIFIER_TAKEN');
}

export async function assertEmployeeFree(m: EntityManager, employeeId: string, exceptUserId: string | null) {
  const qb = m.createQueryBuilder(User, 'u').where('u.employee_id = :employeeId', { employeeId });
  if (exceptUserId) qb.andWhere('u.id <> :id', { id: exceptUserId });
  if (await qb.getExists()) throw new BusinessException('USER_EMPLOYEE_TAKEN');
}

export async function replaceRoles(m: EntityManager, userId: string, roleIds: string[]) {
  await m.delete(UserRole, { user_id: userId });
  const unique = [...new Set(roleIds)];
  if (unique.length) await m.insert(UserRole, unique.map((role_id) => ({ user_id: userId, role_id })));
}

export async function replaceScopes(m: EntityManager, tenantId: string, userId: string, scopes: ScopeInput[]) {
  await m.delete(UserScope, { user_id: userId });
  const seen = new Set<string>();
  for (const scope of scopes) {
    const key = `${scope.scope_type}:${scope.scope_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await m.insert(UserScope, {
      tenant_id: tenantId,
      user_id: userId,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id ?? null,
    });
  }
}

async function revokeSessions(m: EntityManager, userId: string): Promise<void> {
  await m.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

/**
 * The admin role is the one role defined by identity (see permissions.ts): a
 * company with no active admin could never manage roles again. Runs inside the
 * transaction so the offending change rolls back.
 */
async function assertTenantKeepsAdmin(m: EntityManager, tenantId: string): Promise<void> {
  const [{ count }]: { count: number }[] = await m.query(
    `SELECT count(*)::int AS count
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
        AND r.code = $2 AND r.is_system AND r.deleted_at IS NULL`,
    [tenantId, ADMIN_ROLE_CODE],
  );
  if (count === 0) throw new BusinessException('LAST_ADMIN');
}
```

`backend/src/users/users.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission('user.view')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user);
  }

  @RequirePermission('user.view')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user, id);
  }

  @RequirePermission('user.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user, dto);
  }

  @RequirePermission('user.manage')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(user, id, dto);
  }

  @RequirePermission('user.manage')
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(user, id, dto.new_password);
  }
}
```

`backend/src/users/users.module.ts` (thay toàn bộ):
```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { EmployeesModule } from '../employees/employees.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AccessModule, EmployeesModule, AuditModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: Chạy test để thấy đạt**

Run: `cd backend && npm run test:e2e`
Expected: PASS — toàn bộ suite, gồm `users.e2e-spec.ts` 9 tests.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): users API with grant and manage checks, last-admin and self-lock guards"
```

---

### Task 9: Bộ test cách ly công ty, script khởi tạo, hướng dẫn chạy

**Files:**
- Create: `backend/src/scripts/create-platform-admin.ts`, `backend/src/scripts/seed-demo.ts`
- Create: `README.md`
- Test: `backend/test/tenancy.e2e-spec.ts`

**Interfaces:**
- Consumes: mọi route của Task 5–8; `TenantsService`, `EmployeesService`, `OrgService`, `UsersService`.
- Produces: `npm run create-platform-admin` (đọc `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`), `npm run seed:demo` (công ty `demo`, tài khoản `0900000001 / Demo@123456`).

- [ ] **Step 1: Viết test cách ly**

`backend/test/tenancy.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, uniquePhone } from './helpers';

/** Company A must not be able to read, change or wire in anything of company B. */
describe('Tenant isolation (e2e)', () => {
  let app: NestExpressApplication;
  let a: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let b: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let apiA: ReturnType<typeof client>;
  const B: Record<'employee' | 'group' | 'team' | 'role', string> = { employee: '', group: '', team: '', role: '' };
  let aTeam: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    a = await createTenantWithAdmin(app, 'iso-a');
    b = await createTenantWithAdmin(app, 'iso-b');
    apiA = client(app, a.token);
    const apiB = client(app, b.token);
    B.employee = (await apiB.post('/api/employees', { code: 'B-1', full_name: 'Nhân viên B' }).expect(201)).body.data.id;
    B.group = (await apiB.post('/api/org/groups', { name: 'Nhóm B' }).expect(201)).body.data.id;
    B.team = (await apiB.post('/api/org/teams', { name: 'Đội B', team_group_id: B.group }).expect(201)).body.data.id;
    await apiB.post(`/api/org/teams/${B.team}/members`, { employee_id: B.employee }).expect(201);
    B.role = (await apiB.post('/api/roles', { code: 'b_role', name: 'B', permissions: [] }).expect(201)).body.data.id;
    aTeam = (await apiA.post('/api/org/teams', { name: 'Đội A' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const newUser = (extra: object) => ({
    user_type: 'staff', full_name: 'X', phone: uniquePhone(), password: 'Passw0rd!', role_ids: [], scopes: [], ...extra,
  });

  it('answers every read or write of a B record with 404', async () => {
    for (const url of [`/api/employees/${B.employee}`, `/api/users/${b.adminUserId}`, `/api/org/teams/${B.team}/members`]) {
      expect((await apiA.get(url).expect(404)).body.error.code).toBe('NOT_FOUND');
    }
    await apiA.patch(`/api/employees/${B.employee}`, { full_name: 'Hack' }).expect(404);
    await apiA.patch(`/api/org/teams/${B.team}`, { name: 'Hack' }).expect(404);
    await apiA.patch(`/api/org/groups/${B.group}`, { name: 'Hack' }).expect(404);
    await apiA.delete(`/api/org/teams/${B.team}`).expect(404);
    await apiA.post(`/api/org/teams/${B.team}/members/${B.employee}/leave`).expect(404);
    await apiA.put(`/api/roles/${B.role}/permissions`, { permissions: [] }).expect(404);
    await apiA.patch(`/api/users/${b.adminUserId}`, { full_name: 'Hack' }).expect(404);
    await apiA.post(`/api/users/${b.adminUserId}/reset-password`, { new_password: 'Hacked@123' }).expect(404);
  });

  it("refuses to wire B's records into A's", async () => {
    await apiA.post(`/api/org/teams/${aTeam}/members`, { employee_id: B.employee }).expect(404);
    await apiA.post('/api/org/teams', { name: 'X', team_group_id: B.group }).expect(404);
    await apiA.post('/api/org/groups', { name: 'X', manager_user_id: b.adminUserId }).expect(404);
    await apiA.post('/api/users', newUser({ role_ids: [B.role] })).expect(404);
    await apiA.post('/api/users', newUser({ user_type: 'guard', employee_id: B.employee })).expect(404);
    const scope = await apiA.post('/api/users', newUser({ scopes: [{ scope_type: 'team', scope_id: B.team }] })).expect(400);
    expect(scope.body.error.code).toBe('SCOPE_INVALID');
  });

  it("keeps B out of A's lists", async () => {
    const ids = async (url: string): Promise<string[]> =>
      (await apiA.get(url).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(await ids('/api/employees')).not.toContain(B.employee);
    expect(await ids('/api/users')).not.toContain(b.adminUserId);
    expect(await ids('/api/org/teams')).not.toContain(B.team);
    expect(await ids('/api/roles')).not.toContain(B.role);
  });

  it('rejects a tenant_id smuggled into a request body', async () => {
    const res = await apiA.post('/api/employees', { code: 'SMUG', full_name: 'X', tenant_id: b.tenant.id }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
```

- [ ] **Step 2: Chạy test**

Run: `cd backend && npm run test:e2e -- tenancy`
Expected: PASS — 4 tests. Nếu một dòng nào trả 200/201 thay vì 404: đó là lỗ hổng thật — sửa service tương ứng để đọc qua `tenantOf(actor)`/`TenantRepository` trước khi đi tiếp, không sửa test.

- [ ] **Step 3: Viết script**

`backend/src/scripts/create-platform-admin.ts`:
```ts
import 'dotenv/config';
import dataSource from '../database/data-source';
import { hashPassword } from '../auth/password';
import { normalizeEmail } from '../common/identifiers';

/** Creates the one account that can open companies. Run once per server. */
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    console.error('Cần đặt PLATFORM_ADMIN_EMAIL và PLATFORM_ADMIN_PASSWORD (ít nhất 12 ký tự) trong backend/.env');
    process.exit(1);
  }
  await dataSource.initialize();
  const existing = await dataSource.query(`SELECT 1 FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`, [
    normalizeEmail(email),
  ]);
  if (existing.length) {
    console.log(`Đã có tài khoản ${email}, không tạo lại.`);
  } else {
    await dataSource.query(
      `INSERT INTO users (user_type, full_name, email, password_hash) VALUES ('platform_admin', 'Quản trị nền tảng', $1, $2)`,
      [normalizeEmail(email), await hashPassword(password)],
    );
    console.log(`Đã tạo quản trị nền tảng ${email}`);
  }
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`backend/src/scripts/seed-demo.ts`:
```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AuthUser } from '../auth/auth-user';
import { EmployeesService, EmployeeView } from '../employees/employees.service';
import { OrgService } from '../org/org.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';

const PASSWORD = 'Demo@123456';

/** A small company to click through by hand. Safe to run twice. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const ds = app.get(DataSource);
  if ((await ds.query(`SELECT 1 FROM tenants WHERE code = 'demo'`)).length) {
    console.log('Đã có công ty demo, không tạo lại.');
    await app.close();
    return;
  }

  const { tenant, admin_user_id } = await app.get(TenantsService).createTenant(
    { code: 'demo', name: 'Công ty Bảo vệ Demo', admin: { full_name: 'Giám đốc Demo', phone: '0900000001', password: PASSWORD } },
    null,
  );
  const actor: AuthUser = { id: admin_user_id, tenant_id: tenant.id, user_type: 'staff', employee_id: null, session_id: 'seed' };
  const users = app.get(UsersService);
  const org = app.get(OrgService);
  const employees = app.get(EmployeesService);
  const role = async (code: string): Promise<string> =>
    (await ds.query(`SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`, [tenant.id, code]))[0].id;

  const manager = await users.create(actor, {
    user_type: 'staff', full_name: 'Trần Quản Lý', phone: '0900000002', password: PASSWORD,
    role_ids: [await role('manager')], scopes: [],
  });
  await users.create(actor, {
    user_type: 'staff', full_name: 'Lê Nhân Sự', phone: '0900000003', password: PASSWORD,
    role_ids: [await role('hr')], scopes: [{ scope_type: 'tenant' }],
  });

  const group = await org.createGroup(actor, { name: 'Nhóm Hà Nội', manager_user_id: manager.id });
  const teamA = await org.createTeam(actor, { name: 'Đội Toà nhà CT1', team_group_id: group.id });
  const teamB = await org.createTeam(actor, { name: 'Đội Kho Long Biên', team_group_id: group.id });

  const names = ['Nguyễn Văn An', 'Phạm Văn Bình', 'Hoàng Văn Cường', 'Đỗ Văn Dũng', 'Vũ Văn Em', 'Bùi Văn Phúc'];
  const staff: EmployeeView[] = [];
  for (const [i, full_name] of names.entries()) {
    const n = String(i + 1).padStart(2, '0');
    staff.push(await employees.create(actor, { code: `BV0${n}`, full_name, phone: `09100000${n}` }));
  }
  for (const [i, e] of staff.entries()) await org.addMember(actor, i < 3 ? teamA.id : teamB.id, { employee_id: e.id });
  await org.updateTeam(actor, teamA.id, { leader_employee_id: staff[0].id });
  await org.updateTeam(actor, teamB.id, { leader_employee_id: staff[3].id });
  await users.create(actor, {
    user_type: 'guard', full_name: staff[0].full_name, phone: '0910000001', password: PASSWORD,
    employee_id: staff[0].id, role_ids: [await role('team_leader')], scopes: [],
  });

  console.log('Đã tạo công ty demo. Đăng nhập (mật khẩu chung Demo@123456):');
  console.log('  Giám đốc            0900000001');
  console.log('  Quản lý Nhóm HN     0900000002');
  console.log('  HR                  0900000003');
  console.log('  Đội trưởng CT1      0910000001');
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Chạy thử script trên DB dev**

Run:
```bash
cd backend && npm run migration:run && npm run seed:demo && npm run seed:demo
```
Expected: lần đầu in danh sách 4 tài khoản; lần hai in `Đã có công ty demo, không tạo lại.`

- [ ] **Step 5: Viết README**

`README.md`:
````markdown
# Patrol — Quản lý tuần tra bảo vệ

Thiết kế: `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md`.
Kế hoạch: `docs/superpowers/plans/`.

## Cần cài trên máy

- Node.js 20 trở lên
- Docker Desktop (đang chạy)

## Chạy lần đầu

```bash
docker compose up -d postgres          # PostgreSQL ở cổng 5433

cd backend
npm install
cp .env.example .env
npm run migration:run
npm run seed:demo                      # công ty demo để bấm thử
npm run start:dev                      # API ở http://localhost:3001/api

# cửa sổ khác
cd web
npm install
npm run dev                            # web ở http://localhost:3000
```

Đăng nhập web bằng `0900000001` / `Demo@123456` (giám đốc). Các tài khoản demo khác được in ra khi chạy `seed:demo`.

## Kiểm thử

```bash
cd backend
npm test            # unit
npm run test:e2e    # e2e trên DB patrol_test (tự xoá sạch mỗi lần)
```

## Quản trị nền tảng (mở công ty mới)

Đặt `PLATFORM_ADMIN_EMAIL` và `PLATFORM_ADMIN_PASSWORD` trong `backend/.env`, rồi `npm run create-platform-admin`.
Tài khoản này gọi `POST /api/platform/tenants` để tạo công ty kèm giám đốc đầu tiên.
````

- [ ] **Step 6: Chạy toàn bộ test backend**

Run: `cd backend && npm test && npm run test:e2e && npm run build`
Expected: unit PASS, e2e PASS (8 suite), build không lỗi.

- [ ] **Step 7: Commit**

```bash
git add backend README.md
git commit -m "test(backend): tenant isolation suite; platform admin and demo seed scripts; README"
```

---

### Task 10: Web — khung Next.js, đăng nhập, vỏ ứng dụng

**Files:**
- Create: `web/package.json`, `web/next.config.mjs`, `web/tsconfig.json`, `web/tailwind.config.ts`, `web/postcss.config.mjs`
- Create: `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/app/dang-nhap/page.tsx`
- Create: `web/src/app/(app)/layout.tsx`, `web/src/app/(app)/page.tsx`, `web/src/app/(app)/doi-mat-khau/page.tsx`
- Create: `web/src/lib/api.ts`, `web/src/lib/auth.tsx`, `web/src/lib/types.ts`
- Create: `web/src/components/ui.tsx`, `web/src/components/shell.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/login|refresh|logout|change-password`, `GET /api/auth/me` (Task 5).
- Produces:
  - `api<T>(path, init?: RequestInit & { json?: unknown }): Promise<T>` — gọi `/api${path}`, bóc `{data}`, ném `ApiError(code, message, status)`; tự refresh một lần khi 401 (một lời gọi refresh dùng chung cho mọi request đang chờ).
  - `useAuth(): { me: Me; can(permission): boolean; reload(); logout() }` trong `AuthProvider`.
  - UI: `Button` (`variant: primary|secondary|danger`), `Input`, `Select`, `Field`, `Card`, `ErrorText`, `errorMessage(e)`.
  - Kiểu: `Profile`, `Me`, `Employee`, `TeamRow`, `GroupRow`, `ChartNode`, `Member`, `RoleView`, `UserRow`, `UserView`.

Web chưa có test tự động ở plan này: logic nằm ở backend (đã test), web chỉ hiển thị. Mỗi task web kiểm bằng `npm run build` (kiểm kiểu) và một kịch bản bấm tay cụ thể.

- [ ] **Step 1: Tạo cấu hình**

`web/package.json`:
```json
{
  "name": "patrol-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "next": "^14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.7.3"
  }
}
```

`web/next.config.mjs`:
```js
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Same origin for the browser: auth cookies stay first-party and no CORS is needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`web/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

`web/postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

Run: `cd web && npm install`
Expected: cài xong không lỗi.

- [ ] **Step 2: Viết lớp gọi API, kiểu dữ liệu, ngữ cảnh đăng nhập**

`web/src/lib/types.ts`:
```ts
export interface Profile {
  id: string;
  tenant_id: string | null;
  user_type: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  employee_id: string | null;
  must_change_password: boolean;
}

export interface Me {
  user: Profile;
  permissions: string[];
  team_visibility: { all: boolean; team_ids: string[] };
}

export interface Employee {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  position: string;
  status: 'active' | 'inactive';
  team: { id: string; name: string } | null;
}

export interface TeamRow {
  id: string;
  name: string;
  team_group_id: string | null;
  leader_employee_id: string | null;
  leader_name: string | null;
  member_count: number;
}

export interface GroupRow {
  id: string;
  name: string;
  manager_user_id: string | null;
  manager_name: string | null;
}

export interface ChartNode {
  group: GroupRow | null;
  teams: TeamRow[];
}

export interface Member {
  id: string;
  employee_id: string;
  code: string;
  full_name: string;
  phone: string | null;
  start_date: string;
  is_leader: boolean;
}

export interface RoleView {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  permissions: string[];
}

export interface UserRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  user_type: 'staff' | 'guard' | 'platform_admin' | 'client_user';
  status: 'active' | 'locked';
  employee_id: string | null;
  last_login_at: string | null;
  roles: { id: string; code: string; name: string }[];
}

export interface UserView extends UserRow {
  must_change_password: boolean;
  scopes: { scope_type: string; scope_id: string | null }[];
}
```

`web/src/lib/api.ts`:
```ts
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const NO_REFRESH = ['/auth/login', '/auth/refresh'];
let refreshing: Promise<boolean> | null = null;

/**
 * One refresh for every request that hit 401 at the same moment. Two parallel
 * refreshes would present the same token twice, and the backend treats a reused
 * refresh token as theft and ends the session.
 */
function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  retry = true,
): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (res.status === 401 && retry && !NO_REFRESH.includes(path)) {
    if (await refreshOnce()) return api<T>(path, init, false);
    if (typeof window !== 'undefined' && window.location.pathname !== '/dang-nhap') {
      window.location.href = '/dang-nhap';
    }
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Có lỗi xảy ra', res.status);
  }
  return body.data as T;
}
```

`web/src/lib/auth.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { Me } from './types';

interface AuthState {
  me: Me;
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  const reload = useCallback(async () => {
    setMe(await api<Me>('/auth/me'));
  }, []);

  useEffect(() => {
    reload().catch(() => router.replace('/dang-nhap'));
  }, [reload, router]);

  const can = useCallback((permission: string) => Boolean(me?.permissions.includes(permission)), [me]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/dang-nhap');
  }, [router]);

  if (!me) return <div className="p-8 text-slate-500">Đang tải…</div>;
  return <AuthContext.Provider value={{ me, can, reload, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 3: Viết thành phần giao diện và vỏ ứng dụng**

`web/src/components/ui.tsx`:
```tsx
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const BUTTON = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800',
  secondary: 'border border-slate-300 bg-white hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    />
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm ${className}`} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm ${className}`} />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-sm text-red-600">{error}</p> : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Có lỗi xảy ra';
}
```

`web/src/components/shell.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

const NAV: { href: string; label: string; permission?: string }[] = [
  { href: '/', label: 'Tổng quan' },
  { href: '/to-chuc', label: 'Tổ chức', permission: 'org.view' },
  { href: '/nhan-vien', label: 'Nhân viên', permission: 'employee.view' },
  { href: '/nguoi-dung', label: 'Người dùng', permission: 'user.view' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-slate-900 text-slate-100">
        <div className="px-4 py-5 text-lg font-semibold">Patrol</div>
        <nav className="space-y-1 px-2">
          {NAV.filter((item) => !item.permission || can(item.permission)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm ${pathname === item.href ? 'bg-teal-700' : 'hover:bg-slate-800'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 py-3 text-sm">
          <span>{me.user.full_name}</span>
          <Link href="/doi-mat-khau" className="text-teal-700 hover:underline">
            Đổi mật khẩu
          </Link>
          <button onClick={logout} className="text-slate-500 hover:text-slate-900">
            Đăng xuất
          </button>
        </header>
        {me.user.must_change_password && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
            Bạn đang dùng mật khẩu do người khác đặt.{' '}
            <Link href="/doi-mat-khau" className="font-medium underline">
              Đổi mật khẩu ngay
            </Link>
            .
          </div>
        )}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Viết các trang**

`web/src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-slate-50 text-slate-900;
}
```

`web/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Patrol — Quản lý bảo vệ' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

`web/src/app/dang-nhap/page.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Button, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', json: { identifier, password, device_label: 'web' } });
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-lg font-semibold">Đăng nhập Patrol</h1>
        <Field label="Số điện thoại hoặc email">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus required />
        </Field>
        <Field label="Mật khẩu">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
      </form>
    </div>
  );
}
```

`web/src/app/(app)/layout.tsx`:
```tsx
import { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { AuthProvider } from '@/lib/auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
```

`web/src/app/(app)/page.tsx`:
```tsx
'use client';

import { Card } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { me } = useAuth();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Xin chào, {me.user.full_name}</h1>
      <Card title="Phạm vi của bạn">
        <p className="text-sm text-slate-600">
          {me.team_visibility.all ? 'Toàn công ty' : `${me.team_visibility.team_ids.length} đội`}
        </p>
      </Card>
      <p className="text-sm text-slate-500">Hợp đồng, điều động, tuần tra và sự cố sẽ có ở các bước tiếp theo.</p>
    </div>
  );
}
```

`web/src/app/(app)/doi-mat-khau/page.tsx`:
```tsx
'use client';

import { FormEvent, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ChangePasswordPage() {
  const { reload } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('Hai lần nhập mật khẩu mới không khớp');
      return;
    }
    try {
      await api('/auth/change-password', { method: 'POST', json: { current_password: current, new_password: next } });
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="max-w-md">
      <Card title="Đổi mật khẩu">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Mật khẩu hiện tại">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="Mật khẩu mới (ít nhất 8 ký tự)">
            <Input type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <ErrorText error={error} />
          {done && <p className="text-sm text-teal-700">Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.</p>}
          <Button type="submit">Lưu</Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Kiểm tra build**

Run: `cd web && npm run build`
Expected: `Compiled successfully`, không lỗi kiểu.

- [ ] **Step 6: Bấm thử**

Chạy `cd backend && npm run start:dev` và `cd web && npm run dev`. Mở http://localhost:3000:
1. Bị chuyển về `/dang-nhap`. Đăng nhập sai mật khẩu → hiện "Sai tài khoản hoặc mật khẩu".
2. Đăng nhập `0900000001 / Demo@123456` → về Tổng quan, thấy "Xin chào, Giám đốc Demo", menu có Tổ chức, Nhân viên, Người dùng; **không** có dải vàng nhắc đổi mật khẩu (giám đốc tự đặt mật khẩu khi tạo công ty).
3. Đăng nhập `0900000002` (quản lý): dải vàng nhắc đổi mật khẩu hiện ra; đổi mật khẩu → dải biến mất.
4. Bấm Đăng xuất → về `/dang-nhap`; bấm Back của trình duyệt → lại bị đưa về `/dang-nhap`.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(web): Next.js shell, login, auth context with single-flight refresh, change password"
```

---

### Task 11: Web — Tổ chức (nhóm, đội, thành viên) và Nhân viên

**Files:**
- Create: `web/src/app/(app)/nhan-vien/page.tsx`
- Create: `web/src/app/(app)/to-chuc/page.tsx`

**Interfaces:**
- Consumes: `GET|POST /api/employees`, `PATCH /api/employees/:id`; `GET /api/org/chart`, `GET /api/org/teams/:id/members`, `POST|PATCH|DELETE /api/org/groups`, `POST|PATCH|DELETE /api/org/teams`, `POST /api/org/teams/:id/members`, `POST /api/org/teams/:id/members/:employeeId/leave`; `GET /api/users` (chọn quản lý nhóm, chỉ khi có `user.view`).
- Produces: trang `/nhan-vien`, `/to-chuc`.

- [ ] **Step 1: Viết trang Nhân viên**

`web/src/app/(app)/nhan-vien/page.tsx`:
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Employee } from '@/lib/types';

const EMPTY = { code: '', full_name: '', phone: '' };

export default function EmployeesPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<Employee[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<Employee[]>('/employees'));
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
      await api('/employees', {
        method: 'POST',
        json: { code: form.code, full_name: form.full_name, ...(form.phone ? { phone: form.phone } : {}) },
      });
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleStatus(employee: Employee) {
    setError(null);
    try {
      await api(`/employees/${employee.id}`, {
        method: 'PATCH',
        json: { status: employee.status === 'active' ? 'inactive' : 'active' },
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Nhân viên</h1>
      {can('employee.manage') && (
        <Card title="Thêm nhân viên">
          <form onSubmit={create} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
            <Field label="Mã nhân viên">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </Field>
            <Field label="Họ tên">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </Field>
            <Field label="Số điện thoại">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
              <th>Họ tên</th>
              <th>Điện thoại</th>
              <th>Đội</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="py-2 font-mono">{e.code}</td>
                <td>{e.full_name}</td>
                <td>{e.phone ?? '—'}</td>
                <td>{e.team?.name ?? <span className="text-slate-400">Chưa vào đội</span>}</td>
                <td>{e.status === 'active' ? 'Đang làm' : <span className="text-slate-400">Đã nghỉ</span>}</td>
                <td className="text-right">
                  {can('employee.manage') && (
                    <Button variant="secondary" onClick={() => toggleStatus(e)}>
                      {e.status === 'active' ? 'Cho nghỉ' : 'Đi làm lại'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Chưa có nhân viên nào trong phạm vi của bạn
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Viết trang Tổ chức**

`web/src/app/(app)/to-chuc/page.tsx`:
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ChartNode, Employee, Member, TeamRow, UserRow } from '@/lib/types';

export default function OrgPage() {
  const { can } = useAuth();
  const manage = can('org.manage');
  const [chart, setChart] = useState<ChartNode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [staff, setStaff] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<TeamRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamGroup, setTeamGroup] = useState('');
  const [joinEmployee, setJoinEmployee] = useState('');
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
    const nextChart = await api<ChartNode[]>('/org/chart');
    setChart(nextChart);
    if (can('employee.view')) setEmployees(await api<Employee[]>('/employees'));
    if (manage && can('user.view')) setStaff((await api<UserRow[]>('/users')).filter((u) => u.user_type === 'staff'));
    return nextChart;
  }, [can, manage]);

  const openTeam = useCallback(async (team: TeamRow) => {
    setSelected(team);
    setMembers(await api<Member[]>(`/org/teams/${team.id}/members`));
  }, []);

  /** Reload everything, keeping the open team open with fresh numbers. */
  const refresh = useCallback(async () => {
    const nextChart = await load();
    if (selected) {
      const fresh = nextChart.flatMap((n) => n.teams).find((t) => t.id === selected.id);
      if (fresh) await openTeam(fresh);
      else setSelected(null);
    }
  }, [load, openTeam, selected]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const groups = chart.flatMap((n) => (n.group ? [n.group] : []));
  const available = employees.filter((e) => e.status === 'active' && e.team?.id !== selected?.id);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/org/groups', { method: 'POST', json: { name: groupName } });
      setGroupName('');
      await refresh();
    });
  }

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/org/teams', { method: 'POST', json: { name: teamName, ...(teamGroup ? { team_group_id: teamGroup } : {}) } });
      setTeamName('');
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tổ chức</h1>
      <ErrorText error={error} />

      {manage && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Thêm nhóm">
            <form onSubmit={createGroup} className="flex items-end gap-2">
              <Field label="Tên nhóm">
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} required />
              </Field>
              <Button type="submit">Thêm</Button>
            </form>
          </Card>
          <Card title="Thêm đội">
            <form onSubmit={createTeam} className="flex items-end gap-2">
              <Field label="Tên đội">
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
              </Field>
              <Field label="Thuộc nhóm">
                <Select value={teamGroup} onChange={(e) => setTeamGroup(e.target.value)}>
                  <option value="">— Không thuộc nhóm —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </Field>
              <Button type="submit">Thêm</Button>
            </form>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {chart.map((node) => (
            <Card
              key={node.group?.id ?? 'ungrouped'}
              title={node.group ? `Nhóm: ${node.group.name}` : 'Đội không thuộc nhóm'}
              actions={
                node.group && manage ? (
                  <div className="flex items-center gap-2">
                    {can('user.view') && (
                      <Select
                        value={node.group.manager_user_id ?? ''}
                        onChange={(e) =>
                          run(async () => {
                            await api(`/org/groups/${node.group!.id}`, {
                              method: 'PATCH',
                              json: { manager_user_id: e.target.value || null },
                            });
                            await refresh();
                          })
                        }
                      >
                        <option value="">— Chưa có quản lý —</option>
                        {staff.map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name}</option>
                        ))}
                      </Select>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() =>
                        run(async () => {
                          await api(`/org/groups/${node.group!.id}`, { method: 'DELETE' });
                          await refresh();
                        })
                      }
                    >
                      Xoá
                    </Button>
                  </div>
                ) : node.group?.manager_name ? (
                  <span className="text-sm text-slate-500">Quản lý: {node.group.manager_name}</span>
                ) : null
              }
            >
              <ul className="divide-y divide-slate-100">
                {node.teams.map((team) => (
                  <li key={team.id}>
                    <button
                      onClick={() => run(() => openTeam(team))}
                      className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-slate-50 ${
                        selected?.id === team.id ? 'bg-teal-50' : ''
                      }`}
                    >
                      <span className="font-medium">{team.name}</span>
                      <span className="text-slate-500">
                        {team.leader_name ? `Đội trưởng: ${team.leader_name} · ` : ''}
                        {team.member_count} người
                      </span>
                    </button>
                  </li>
                ))}
                {!node.teams.length && <li className="py-2 text-sm text-slate-400">Chưa có đội</li>}
              </ul>
            </Card>
          ))}
          {!chart.length && <p className="text-sm text-slate-400">Chưa có nhóm hay đội nào trong phạm vi của bạn.</p>}
        </div>

        {selected && (
          <Card
            title={`Đội ${selected.name}`}
            actions={
              manage ? (
                <Button
                  variant="danger"
                  onClick={() =>
                    run(async () => {
                      await api(`/org/teams/${selected.id}`, { method: 'DELETE' });
                      setSelected(null);
                      await refresh();
                    })
                  }
                >
                  Xoá đội
                </Button>
              ) : undefined
            }
          >
            {manage && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(`/org/teams/${selected.id}/members`, { method: 'POST', json: { employee_id: joinEmployee } });
                    setJoinEmployee('');
                    await refresh();
                  });
                }}
                className="mb-3 flex items-end gap-2"
              >
                <Field label="Thêm / chuyển nhân viên vào đội (từ hôm nay)">
                  <Select value={joinEmployee} onChange={(e) => setJoinEmployee(e.target.value)} required>
                    <option value="">— Chọn nhân viên —</option>
                    {available.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} · {e.full_name}
                        {e.team ? ` (đang ở ${e.team.name})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit">Thêm</Button>
              </form>
            )}
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2">Nhân viên</th>
                  <th>Vào đội từ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="py-2">
                      {m.full_name} <span className="font-mono text-slate-400">{m.code}</span>
                      {m.is_leader && <span className="ml-2 rounded bg-teal-100 px-1.5 text-xs text-teal-800">Đội trưởng</span>}
                    </td>
                    <td>{m.start_date}</td>
                    <td className="space-x-2 text-right">
                      {manage && !m.is_leader && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(async () => {
                              await api(`/org/teams/${selected.id}`, { method: 'PATCH', json: { leader_employee_id: m.employee_id } });
                              await refresh();
                            })
                          }
                        >
                          Làm đội trưởng
                        </Button>
                      )}
                      {manage && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(async () => {
                              await api(`/org/teams/${selected.id}/members/${m.employee_id}/leave`, { method: 'POST', json: {} });
                              await refresh();
                            })
                          }
                        >
                          Rời đội
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!members.length && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-slate-400">Đội chưa có thành viên</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Kiểm tra build**

Run: `cd web && npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Bấm thử**

Đăng nhập giám đốc demo:
1. **Nhân viên**: thấy 6 nhân viên BV001–BV006 kèm đội. Thêm `BV007 / Ngô Văn Giang` → xuất hiện, cột Đội "Chưa vào đội". Thêm lại `bv007` → báo "Mã nhân viên đã tồn tại".
2. **Tổ chức**: thấy "Nhóm: Nhóm Hà Nội" với hai đội, quản lý Trần Quản Lý. Mở "Đội Toà nhà CT1" → 3 người, Nguyễn Văn An có nhãn Đội trưởng.
3. Thêm BV007 vào CT1 → số người thành 4. Chuyển Đỗ Văn Dũng (đội trưởng Kho Long Biên) sang CT1 → mở lại Kho Long Biên: không còn đội trưởng.
4. Bấm "Xoá đội" khi đội còn người → báo "Đội còn thành viên, không xoá được".

Đăng nhập đội trưởng `0910000001`: menu chỉ có Tổng quan, Tổ chức, Nhân viên; Tổ chức chỉ thấy đội CT1, không có nút thêm/xoá; Nhân viên chỉ thấy người trong CT1.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): organisation chart with team membership, employees list"
```

---

### Task 12: Web — Người dùng (tạo tài khoản, vai trò, phạm vi, khoá, đặt lại mật khẩu)

**Files:**
- Create: `web/src/app/(app)/nguoi-dung/page.tsx`

**Interfaces:**
- Consumes: `GET|POST /api/users`, `GET|PATCH /api/users/:id`, `POST /api/users/:id/reset-password`, `GET /api/roles` (cần `role.view`), `GET /api/org/chart`, `GET /api/employees`.
- Produces: trang `/nguoi-dung`.

- [ ] **Step 1: Viết trang**

`web/src/app/(app)/nguoi-dung/page.tsx`:
```tsx
'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ChartNode, Employee, RoleView, UserRow, UserView } from '@/lib/types';

/** One scope per account in this screen: "tenant", "team_group:<id>", "team:<id>" or "" (only what the org chart gives). */
type ScopeKey = string;

const toScopes = (key: ScopeKey) => {
  if (!key) return [];
  if (key === 'tenant') return [{ scope_type: 'tenant' }];
  const [scope_type, scope_id] = key.split(':');
  return [{ scope_type, scope_id }];
};

const fromScopes = (scopes: UserView['scopes']): ScopeKey => {
  const first = scopes[0];
  if (!first) return '';
  return first.scope_type === 'tenant' ? 'tenant' : `${first.scope_type}:${first.scope_id}`;
};

const EMPTY = {
  full_name: '',
  phone: '',
  email: '',
  password: '',
  user_type: 'staff' as 'staff' | 'guard',
  employee_id: '',
  role_ids: [] as string[],
  scope: '' as ScopeKey,
};

export default function UsersPage() {
  const { can, me } = useAuth();
  const manage = can('user.manage');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [chart, setChart] = useState<ChartNode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<{ id: string; role_ids: string[]; scope: ScopeKey } | null>(null);
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
    setUsers(await api<UserRow[]>('/users'));
    if (can('role.view')) setRoles(await api<RoleView[]>('/roles'));
    if (can('org.view')) setChart(await api<ChartNode[]>('/org/chart'));
    if (can('employee.view')) setEmployees(await api<Employee[]>('/employees'));
  }, [can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const scopeOptions = [
    { key: '', label: '— Chỉ theo cơ cấu tổ chức (đội trưởng, quản lý nhóm) —' },
    ...(me.team_visibility.all ? [{ key: 'tenant', label: 'Toàn công ty' }] : []),
    ...chart.flatMap((n) => (n.group && me.team_visibility.all ? [{ key: `team_group:${n.group.id}`, label: `Nhóm ${n.group.name}` }] : [])),
    ...chart.flatMap((n) => n.teams.map((t) => ({ key: `team:${t.id}`, label: `Đội ${t.name}` }))),
  ];
  const linkedEmployees = new Set(users.map((u) => u.employee_id).filter(Boolean));

  async function create(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/users', {
        method: 'POST',
        json: {
          user_type: form.user_type,
          full_name: form.full_name,
          password: form.password,
          role_ids: form.role_ids,
          scopes: toScopes(form.scope),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.email ? { email: form.email } : {}),
          ...(form.employee_id ? { employee_id: form.employee_id } : {}),
        },
      });
      setForm(EMPTY);
      await load();
    });
  }

  async function startEdit(user: UserRow) {
    await run(async () => {
      const detail = await api<UserView>(`/users/${user.id}`);
      setEditing({ id: user.id, role_ids: detail.roles.map((r) => r.id), scope: fromScopes(detail.scopes) });
    });
  }

  async function saveEdit() {
    if (!editing) return;
    await run(async () => {
      await api(`/users/${editing.id}`, {
        method: 'PATCH',
        json: { role_ids: editing.role_ids, scopes: toScopes(editing.scope) },
      });
      setEditing(null);
      await load();
    });
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const roleBoxes = (selected: string[], onChange: (next: string[]) => void) => (
    <div className="flex flex-wrap gap-3">
      {roles.map((r) => (
        <label key={r.id} className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={selected.includes(r.id)} onChange={() => onChange(toggle(selected, r.id))} />
          {r.name}
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Người dùng</h1>
      <ErrorText error={error} />

      {manage && (
        <Card title="Tạo tài khoản">
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Họ tên">
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </Field>
              <Field label="Số điện thoại">
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Mật khẩu ban đầu (người dùng sẽ phải đổi)">
                <Input minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </Field>
              <Field label="Loại tài khoản">
                <Select
                  value={form.user_type}
                  onChange={(e) => setForm({ ...form, user_type: e.target.value as 'staff' | 'guard' })}
                >
                  <option value="staff">Văn phòng (quản lý, HR, kế toán)</option>
                  <option value="guard">Bảo vệ / đội trưởng</option>
                </Select>
              </Field>
              <Field label="Gắn với nhân viên">
                <Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                  <option value="">— Không —</option>
                  {employees
                    .filter((e) => !linkedEmployees.has(e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>{e.code} · {e.full_name}</option>
                    ))}
                </Select>
              </Field>
            </div>
            <Field label="Vai trò">{roleBoxes(form.role_ids, (role_ids) => setForm({ ...form, role_ids }))}</Field>
            <Field label="Phạm vi được xem">
              <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                {scopeOptions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-slate-500">
              Cần số điện thoại hoặc email. Không cấp được vai trò hay phạm vi rộng hơn của chính bạn.
            </p>
            <Button type="submit">Tạo tài khoản</Button>
          </form>
        </Card>
      )}

      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2">Họ tên</th>
              <th>Đăng nhập</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 align-top">
                <td className="py-2">{u.full_name}</td>
                <td>{u.phone ?? u.email}</td>
                <td>
                  {editing?.id === u.id ? (
                    <div className="space-y-2">
                      {roleBoxes(editing.role_ids, (role_ids) => setEditing({ ...editing, role_ids }))}
                      <Select value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })}>
                        {scopeOptions.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </Select>
                      <div className="space-x-2">
                        <Button onClick={saveEdit}>Lưu</Button>
                        <Button variant="secondary" onClick={() => setEditing(null)}>Huỷ</Button>
                      </div>
                    </div>
                  ) : (
                    u.roles.map((r) => r.name).join(', ') || <span className="text-slate-400">Chưa có</span>
                  )}
                </td>
                <td>{u.status === 'active' ? 'Hoạt động' : <span className="text-red-600">Đã khoá</span>}</td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  {manage && editing?.id !== u.id && (
                    <>
                      {can('role.view') && (
                        <Button variant="secondary" onClick={() => startEdit(u)}>Sửa quyền</Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const password = window.prompt(`Mật khẩu mới cho ${u.full_name} (ít nhất 8 ký tự):`);
                          if (password) {
                            void run(async () => {
                              await api(`/users/${u.id}/reset-password`, { method: 'POST', json: { new_password: password } });
                              window.alert('Đã đặt lại mật khẩu. Người dùng phải đổi khi đăng nhập.');
                            });
                          }
                        }}
                      >
                        Đặt lại mật khẩu
                      </Button>
                      {u.id !== me.user.id && (
                        <Button
                          variant={u.status === 'active' ? 'danger' : 'secondary'}
                          onClick={() =>
                            run(async () => {
                              await api(`/users/${u.id}`, {
                                method: 'PATCH',
                                json: { status: u.status === 'active' ? 'locked' : 'active' },
                              });
                              await load();
                            })
                          }
                        >
                          {u.status === 'active' ? 'Khoá' : 'Mở khoá'}
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Kiểm tra build**

Run: `cd web && npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 3: Bấm thử**

Đăng nhập giám đốc demo, vào **Người dùng**:
1. Tạo tài khoản bảo vệ cho BV002 (Phạm Văn Bình): loại "Bảo vệ", gắn nhân viên BV002, vai trò "Bảo vệ", phạm vi "Đội Toà nhà CT1" → xuất hiện trong danh sách. Đăng nhập bằng số đó trong cửa sổ ẩn danh → thấy dải vàng nhắc đổi mật khẩu.
2. "Sửa quyền" của Trần Quản Lý → thêm vai trò HR → Lưu → cột vai trò cập nhật.
3. Bỏ vai trò Quản trị của chính mình → báo "Công ty phải còn ít nhất một người Quản trị".
4. Khoá tài khoản BV002 vừa tạo → cửa sổ ẩn danh bấm sang trang khác → bị đưa về đăng nhập.

Đăng nhập HR `0900000003`: tạo tài khoản và tick "Quản trị (giám đốc)" → báo "Không thể cấp quyền hoặc phạm vi vượt quá của bạn".

- [ ] **Step 4: Chạy lại toàn bộ kiểm thử**

Run: `cd backend && npm test && npm run test:e2e && cd ../web && npm run build`
Expected: tất cả PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): user accounts with roles, scopes, lock and password reset"
```

---

## Sau plan này

- **Plan 02** (spec §9 bước 2): khách hàng, hồ sơ nhân viên đầy đủ (giấy tờ, chứng chỉ), hợp đồng & dòng giá, cảnh báo hết hạn, điều động bảo vệ (`deployments`), phạm vi `client`; migration thêm quyền `client.*`, `contract.*`, `deployment.*` vào vai trò hệ thống của các công ty đã có.
- Triển khai VPS (`deploy/`, Dockerfile, nginx, sao lưu) để ở Plan 09 theo spec, nhưng có thể kéo lên ngay sau Plan 02 nếu muốn dùng thật sớm.

---

## Bổ sung 12/10/2026 — quản lý điều chuyển bảo vệ trong phạm vi của mình

Chủ dự án: *"người quản lý có thể điều chỉnh bảo vệ theo tổ đội mình quản lý"*. Áp dụng khi thực hiện:

- Thêm quyền `org.member.manage` — "Điều chuyển bảo vệ giữa các đội trong phạm vi". Vai trò mẫu `manager` và `hr` có quyền này (`admin` có sẵn vì có mọi quyền).
- `POST /api/org/teams/:id/members`, `POST /api/org/teams/:id/members/:employeeId/leave` và đặt đội trưởng (`PATCH /api/org/teams/:id` chỉ với `leader_employee_id`) cần `org.member.manage` thay cho `org.manage`, và:
  - người thao tác phải **thấy đội đích** (`ScopeService.canSeeTeam`);
  - khi chuyển, **đội hiện tại** của nhân viên cũng phải trong phạm vi; nhân viên chưa thuộc đội nào chỉ người có phạm vi toàn công ty mới xếp được.
- Tạo/sửa tên/xoá nhóm và đội vẫn cần `org.manage` + phạm vi toàn công ty.
- Test thêm ở Task 7: quản lý nhóm chuyển người giữa hai đội trong nhóm → 201; kéo người từ đội ngoài nhóm → 404; xếp người chưa có đội → 403; đặt đội trưởng đội trong nhóm → 200, đội ngoài nhóm → 404.
