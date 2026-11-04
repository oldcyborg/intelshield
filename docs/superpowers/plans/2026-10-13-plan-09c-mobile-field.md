# Plan 09c — App IntelShield: thao tác hiện trường của bảo vệ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bảo vệ làm được việc hiện trường trên app: **tuần tra** (vòng của ca, quét QR bằng trình quét Google, xác nhận GPS có báo khoảng cách, chụp ảnh khi điểm yêu cầu, kết thúc vòng — chạy được khi mất sóng: vòng tải sẵn, lần quét vào hàng đợi, gửi bù đúng giờ quét), **SOS** giữ 2 giây (có hoặc không có GPS), **báo sự cố** kèm ảnh và vị trí, **sổ trực** (ghi khách/xe/tài sản/ghi chú, ghi giờ ra), **giao ca** (người hết ca điền danh mục, người nhận đồng ý/không đồng ý). Mọi lối vào nằm ở thẻ ca trên màn **Ca trực**.

**Architecture:** Backend: sự cố và SOS nhận `client_uuid` để gửi lại không tạo bản trùng; SOS không bắt buộc toạ độ. App: hàng đợi offline (Plan 09a) thêm `timed` (gửi `device_time` = lúc làm, `captured_offline` khi gửi muộn hơn 60 giây), `okCodes` (mã lỗi coi như đã xong) và `meta` (để màn hiện "chờ gửi" đúng điểm); `cached()` giữ bản cuối của danh sách vòng/người trong toà để dùng khi mất sóng; trình quét QR `@capacitor-mlkit/barcode-scanning` (Google code scanner, không cần quyền camera riêng); đọc tem `PTR1.<checkpoint>.<chữ ký>` ngay trên máy để biết điểm nào, máy chủ vẫn kiểm chữ ký.

**Tech Stack:** như Plan 09a + `@capacitor-mlkit/barcode-scanning` 8.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` — §5.1.1 M4–M10, §4.4 (quy tắc vòng), §4.6 (sổ trực, giao ca), §7.4 (offline). Chủ dự án 13/10/2026: làm tiếp phần bảo vệ trên app.

**Khác với spec (có chủ đích):**
- SOS khi mất sóng: lưu hàng đợi, gửi ngay khi có sóng, màn hiện rõ "chưa gửi được — gọi điện cho đội trưởng". Số khẩn cấp của mục tiêu: chưa có trường dữ liệu, làm sau.
- Giao ca và nhận ca cần mạng (cần biết người nhận, biên bản phải đến người kia ngay).
- Phát hiện GPS giả: vẫn chưa có (plugin native riêng).

## Global Constraints

- Mọi quy ước Plan 09a/09b giữ nguyên.
- Lần quét, dòng sổ, sự cố, SOS luôn đi qua hàng đợi (gửi ngay nếu có mạng) với `client_uuid` sinh trên máy; màn hiện ngay "đã lưu, chờ gửi" chứ không chờ mạng.
- Giờ của lần quét/dòng sổ là lúc bảo vệ làm, không phải lúc gửi được.

## Review Focus

1. **Không mất, không trùng**: gửi lại sự cố/SOS/lần quét/dòng sổ cùng `client_uuid` trả kết quả cũ — test ở Task 1–2.
2. **Đúng giờ**: gửi ngay → giờ máy chủ; gửi bù → giờ lúc làm, có cờ khi muộn — test ở Task 2.

---

### Task 1: Backend — sự cố và SOS gửi lại không trùng; SOS không bắt buộc vị trí

**Files:**
- Create: `backend/src/database/migrations/1761300000000-IncidentClientUuid.ts`
- Modify: `backend/src/incidents/incident.entity.ts`, `backend/src/incidents/dto.ts`, `backend/src/incidents/incidents.service.ts`
- Test: `backend/test/incident-replay.e2e-spec.ts`

**Interfaces:**
- Produces: `ReportIncidentDto.client_uuid?`, `SosDto { client_uuid?, lat?, lng?, note? }`; cùng `client_uuid` của chính người báo → trả sự cố đã tạo; của người khác → `409 CONFLICT`; hai bản gửi cùng lúc → một sự cố.

- [ ] **Step 1: Viết test thất bại**

`backend/test/incident-replay.e2e-spec.ts`:
```ts
import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

describe('Incidents — resend from the app (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let g: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'irp');
    const api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'K', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'S', name: 'Toà' }).expect(201)).body.data.id;
    ids.category = (await api.get('/api/incident-categories').expect(200)).body.data[0].id;
    const guard = async (code: string) => {
      const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
      await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
      return client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e })).token);
    };
    g = await guard('G1');
    other = await guard('G2');
  });
  afterAll(async () => app.close());

  it('answers a resent report with the incident it already made', async () => {
    const body = { client_uuid: randomUUID(), site_id: ids.site, category_id: ids.category, description: 'Cửa kho bị cạy' };
    const a = (await g.post('/api/incidents', body).expect(201)).body.data;
    const b = (await g.post('/api/incidents', body).expect(201)).body.data;
    expect(b.id).toBe(a.id);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM incidents WHERE client_uuid = $1`, [body.client_uuid]);
    expect(n).toBe(1);
    await other.post('/api/incidents', body).expect(409);
  });

  it('makes one incident from two copies sent at once', async () => {
    const body = { client_uuid: randomUUID(), site_id: ids.site, category_id: ids.category, description: 'Gửi đôi' };
    const results = await Promise.all([g.post('/api/incidents', body), g.post('/api/incidents', body)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
  });

  it('sends an SOS without a location, and only once', async () => {
    const uuid = randomUUID();
    const sos = (await g.post('/api/incidents/sos', { client_uuid: uuid }).expect(201)).body.data;
    expect(sos).toMatchObject({ is_sos: true, severity: 'critical', lat: null, lng: null });
    expect((await g.post('/api/incidents/sos', { client_uuid: uuid }).expect(201)).body.data.id).toBe(sos.id);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- incident-replay`
Expected: FAIL — `client_uuid` không được phép (400).

- [ ] **Step 3: Migration, entity, DTO**

`backend/src/database/migrations/1761300000000-IncidentClientUuid.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** The app's own id for a report: sending it again (offline queue) never makes a second incident. */
export class IncidentClientUuid1761300000000 implements MigrationInterface {
  name = 'IncidentClientUuid1761300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE incidents ADD COLUMN client_uuid uuid`);
    await q.query(`CREATE UNIQUE INDEX incidents_client_uq ON incidents (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS incidents_client_uq`);
    await q.query(`ALTER TABLE incidents DROP COLUMN IF EXISTS client_uuid`);
  }
}
```

`backend/src/incidents/incident.entity.ts`: thêm cột
```ts
  /** Made on the phone; a resend of the same report returns the incident it made. */
  @Column({ type: 'uuid', nullable: true })
  client_uuid: string | null;
```

`backend/src/incidents/dto.ts`:
- trong `ReportIncidentDto` thêm
```ts
  @IsOptional() @IsUUID()
  client_uuid?: string;
```
- thay `SosDto` bằng
```ts
export class SosDto {
  @IsOptional() @IsUUID()
  client_uuid?: string;

  /** Sent when the phone has a fix; an SOS without one still goes out. */
  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}
```

- [ ] **Step 4: Service**

Trong `backend/src/incidents/incidents.service.ts`:
- `NewIncident` thêm `client_uuid: string | null;`
- đầu `report(...)` (ngay sau `const tenantId = tenantOf(actor);`) thêm:
```ts
    const replay = await this.replayed(actor, dto.client_uuid);
    if (replay) return this.get(actor, replay);
```
  và trong đối tượng truyền cho `this.create(actor, {...})` thêm `client_uuid: dto.client_uuid ?? null,`
- `sos(...)` thay bằng:
```ts
  /** One press: critical, located when the phone could tell, sent. Photos can follow as comments. */
  async sos(actor: AuthUser, dto: SosDto) {
    const replay = await this.replayed(actor, dto.client_uuid);
    if (replay) return this.get(actor, replay);
    const place = await this.fieldPlace(actor, null);
    return this.create(actor, {
      ...place, category_id: null, severity: 'critical', is_sos: true, title: 'SOS — cần hỗ trợ khẩn cấp',
      description: dto.note ?? null, lat: dto.lat ?? null, lng: dto.lng ?? null, source: 'guard_app',
      client_reporter_name: null, client_channel: null, file_ids: [], client_uuid: dto.client_uuid ?? null,
    });
  }
```
- trong `create`, đối tượng `m.create(Incident, {...})` thêm `client_uuid: input.client_uuid,`; bọc lời gọi giao dịch để hai bản gửi cùng lúc trả cùng một sự cố — thay
```ts
    const id = await this.ds.transaction(async (m) => {
```
  bằng
```ts
    let id: string;
    try {
      id = await this.ds.transaction(async (m) => {
```
  và thay phần đóng
```ts
      await this.afterCreate(m, saved);
      return saved.id;
    });
    return this.get(actor, id);
```
  bằng
```ts
      await this.afterCreate(m, saved);
      return saved.id;
      });
    } catch (error) {
      const duplicate = error instanceof QueryFailedError && (error as QueryFailedError & { constraint?: string }).constraint === 'incidents_client_uq';
      const again = duplicate ? await this.replayed(actor, input.client_uuid ?? undefined) : null;
      if (!again) throw error;
      id = again;
    }
    return this.get(actor, id);
```
  (import `QueryFailedError` từ `typeorm`)
- thêm phương thức:
```ts
  /** A report already made from this phone-made id: its incident for the same person, a conflict for anyone else. */
  private async replayed(actor: AuthUser, clientUuid: string | undefined): Promise<string | null> {
    if (!clientUuid) return null;
    const [row] = await this.ds.query(`SELECT id, reported_by FROM incidents WHERE tenant_id = $1 AND client_uuid = $2`, [tenantOf(actor), clientUuid]);
    if (!row) return null;
    if (row.reported_by !== actor.id) throw new BusinessException('CONFLICT');
    return row.id;
  }
```

- [ ] **Step 5: Chạy test để thấy đạt, chạy toàn bộ, migrate, commit**

Run: `cd backend && npm run test:e2e && npm run migration:run`
Expected: PASS toàn bộ (gồm `incident-replay` 3).

```bash
git add backend
git commit -m "feat(backend): incidents and SOS resend safely with a phone-made id; SOS without a location"
```

---

### Task 2: App — hàng đợi ghi đúng giờ làm, đọc tem, khoảng cách, bộ nhớ dùng khi mất sóng, trình quét

**Files:**
- Create: `mobile/src/lib/patrol.ts`, `mobile/src/lib/cache.ts`, `mobile/src/lib/scanner.ts`
- Modify: `mobile/src/lib/queue.ts`
- Test: `mobile/src/lib/patrol.test.ts`, `mobile/src/lib/queue-timed.test.ts`

**Interfaces:**
- Produces:
  - `QueueItem` thêm `meta?: Record<string, string>`, `timed?: boolean`, `okCodes?: string[]`. Mục `timed`: lúc gửi đặt `device_time = created_at`, `captured_offline = (bây giờ − created_at) > 60 s`. Lỗi có mã trong `okCodes` → coi như đã gửi.
  - `parseTag(payload)` → `checkpoint_id | null`; `distanceM(a, b)` (mét); `stopStates(stops, queued)` → mỗi điểm `'done' | 'queued' | 'todo'`; `progress(stops, states)` → `{ done, required }`.
  - `cached<T>(key, fetch)` → `{ data, offline, at }` (mất mạng → bản lưu cuối kèm thời điểm).
  - `scanQr()` → nội dung mã (trình quét Google; lần đầu tải module; trình duyệt: ô nhập để thử).

- [ ] **Step 1: Viết test thất bại**

`mobile/src/lib/patrol.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { distanceM, parseTag, progress, stopStates } from './patrol';

const CP = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('parseTag', () => {
  it('reads the checkpoint out of a printed tag', () => {
    expect(parseTag(`PTR1.${CP}.abcdefghijklmnopqrstuv`)).toBe(CP);
    expect(parseTag(`  PTR1.${CP}.abcdefghijklmnopqrstuv \n`)).toBe(CP);
  });
  it('refuses anything that is not one of our tags', () => {
    expect(parseTag('https://example.com')).toBeNull();
    expect(parseTag(`PTR1.${CP}.short`)).toBeNull();
    expect(parseTag('PTR1.not-a-uuid.abcdefghijklmnopqrstuv')).toBeNull();
  });
});

describe('distanceM', () => {
  it('measures metres between two points', () => {
    expect(distanceM({ lat: 21.028511, lng: 105.776742 }, { lat: 21.028511, lng: 105.776742 })).toBe(0);
    const d = distanceM({ lat: 21.028511, lng: 105.776742 }, { lat: 21.0294, lng: 105.776742 });
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe('stopStates and progress', () => {
  const stops = [
    { checkpoint_id: 'a', required: true, scanned_at: '2026-10-13T01:00:00Z' },
    { checkpoint_id: 'b', required: true, scanned_at: null },
    { checkpoint_id: 'c', required: false, scanned_at: null },
  ];
  it('shows what the server has, what waits on the phone, and what is left', () => {
    const states = stopStates(stops, ['b']);
    expect(states).toEqual({ a: 'done', b: 'queued', c: 'todo' });
    expect(progress(stops, states)).toEqual({ done: 2, required: 2 });
    expect(progress(stops, stopStates(stops, []))).toEqual({ done: 1, required: 2 });
  });
});
```

`mobile/src/lib/queue-timed.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { OfflineQueue } from './queue';

let n = 0;
const fresh = (api: object) => new OfflineQueue(api as never, `timed-queue-${++n}`);

describe('OfflineQueue — when things happened', () => {
  it('sends the moment it was done, and says it was offline only when it went out late', async () => {
    const bodies: Record<string, unknown>[] = [];
    const q = fresh({ request: vi.fn(async (_p: string, init: { json: Record<string, unknown> }) => { bodies.push(init.json); return {}; }), upload: vi.fn() });
    const item = await q.add({ kind: 'scan', label: 'A', path: '/a', json: { x: 1 }, timed: true });
    await q.flush();
    expect(bodies[0]).toEqual({ x: 1, device_time: item.created_at, captured_offline: false });

    const late = fresh({ request: vi.fn(async (_p: string, init: { json: Record<string, unknown> }) => { bodies.push(init.json); return {}; }), upload: vi.fn() });
    const old = await late.add({ kind: 'scan', label: 'B', path: '/b', json: {}, timed: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(old.created_at) + 5 * 60_000));
    await late.flush();
    vi.useRealTimers();
    expect(bodies[1]).toEqual({ device_time: old.created_at, captured_offline: true });
  });

  it('counts "already done" answers as sent', async () => {
    const q = fresh({ request: vi.fn(async () => { throw new ApiError('LOGBOOK_ALREADY_EXITED', 'Đã ghi giờ ra rồi', 409); }), upload: vi.fn() });
    await q.add({ kind: 'exit', label: 'Ra', path: '/x', json: {}, okCodes: ['LOGBOOK_ALREADY_EXITED'] });
    expect(await q.flush()).toEqual({ sent: 1, failed: 0, left: 0 });
  });

  it('keeps what the screen needs to show "waiting" on the right checkpoint', async () => {
    const q = fresh({ request: vi.fn(), upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {}, meta: { round_id: 'r1', checkpoint_id: 'c1' } });
    expect((await q.list())[0].meta).toEqual({ round_id: 'r1', checkpoint_id: 'c1' });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd mobile && npm test`
Expected: FAIL — không có `./patrol`; `timed`/`okCodes` chưa có tác dụng.

- [ ] **Step 3: Hàng đợi**

Trong `mobile/src/lib/queue.ts`:
- `QueueItem` thêm sau `photos?: PhotoSlot[];`:
```ts
  /** For screens: which round/checkpoint/line this is about. */
  meta?: Record<string, string>;
  /** Sent with the moment it was done: device_time, and captured_offline when it goes out more than a minute later. */
  timed?: boolean;
  /** Error codes that mean "already done" — the item counts as sent. */
  okCodes?: string[];
```
- trong `run()`, ngay trước `await this.api.request(item.path, { json });` thêm:
```ts
        if (item.timed) {
          json.device_time = item.created_at;
          json.captured_offline = Date.now() - Date.parse(item.created_at) > ONLINE_MS;
        }
```
- trong `catch (error)` của `run()`, ngay đầu khối thêm:
```ts
        if (error instanceof ApiError && item.okCodes?.includes(error.code)) {
          await this.remove(item.id);
          sent += 1;
          this.emit();
          continue;
        }
```
- cạnh `MAX_SERVER_ERRORS` thêm: `/** Sent within this long of being done: the server's clock counts, as if online. */\nconst ONLINE_MS = 60_000;`

- [ ] **Step 4: Tuần tra, bộ nhớ, trình quét**

`mobile/src/lib/patrol.ts`:
```ts
const TAG = /^PTR1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{22})$/i;

/** The checkpoint a printed tag names. The signature is checked by the server; here it only picks the stop. */
export function parseTag(payload: string): string | null {
  const m = TAG.exec(payload.trim());
  return m ? m[1].toLowerCase() : null;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export type StopState = 'done' | 'queued' | 'todo';

/** Each stop as the guard should see it: confirmed by the server, waiting on this phone, or still to do. */
export function stopStates(stops: { checkpoint_id: string; scanned_at: string | null }[], queuedCheckpoints: string[]): Record<string, StopState> {
  const out: Record<string, StopState> = {};
  for (const s of stops) out[s.checkpoint_id] = s.scanned_at ? 'done' : queuedCheckpoints.includes(s.checkpoint_id) ? 'queued' : 'todo';
  return out;
}

export function progress(stops: { checkpoint_id: string; required: boolean }[], states: Record<string, StopState>) {
  const required = stops.filter((s) => s.required);
  return { done: required.filter((s) => states[s.checkpoint_id] !== 'todo').length, required: required.length };
}
```

`mobile/src/lib/cache.ts`:
```ts
import { Preferences } from '@capacitor/preferences';
import { NetworkError } from './api';

/** The last answer kept on the phone: without signal the guard still sees their rounds and who is inside. */
export async function cached<T>(key: string, fetch: () => Promise<T>): Promise<{ data: T; offline: boolean; at: string }> {
  try {
    const data = await fetch();
    const at = new Date().toISOString();
    await Preferences.set({ key: `cache.${key}`, value: JSON.stringify({ data, at }) });
    return { data, offline: false, at };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const { value } = await Preferences.get({ key: `cache.${key}` });
    if (!value) throw error;
    const saved = JSON.parse(value) as { data: T; at: string };
    return { ...saved, offline: true };
  }
}

/** Sign-out: nothing of the previous person stays. */
export async function clearCache(): Promise<void> {
  const { keys } = await Preferences.keys();
  await Promise.all(keys.filter((k) => k.startsWith('cache.')).map((key) => Preferences.remove({ key })));
}
```

`mobile/src/lib/scanner.ts`:
```ts
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';

/**
 * Read a QR tag with Google's scanner (no camera permission of our own). The first time on a phone the scanner
 * module is downloaded by Google Play services; until then this asks to try again in a moment.
 */
export async function scanQr(): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    const typed = window.prompt('Thử trên trình duyệt: dán nội dung mã QR');
    if (!typed) throw new Error('Đã huỷ quét');
    return typed;
  }
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => undefined);
    throw new Error('Đang tải trình quét mã lần đầu (cần mạng) — chờ vài giây rồi bấm quét lại');
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    const value = barcodes[0]?.rawValue ?? barcodes[0]?.displayValue;
    if (!value) throw new Error('Không đọc được mã — thử lại');
    return value;
  } catch (error) {
    const text = String((error as Error)?.message ?? '').toLowerCase();
    if (text.includes('cancel')) throw new Error('Đã huỷ quét');
    throw error instanceof Error && !text.includes('scan') ? error : new Error('Không quét được mã — thử lại');
  }
}
```

Trong `mobile/src/lib/auth.tsx`, hàm `forget`: thêm `clearCache()` (import từ `./cache`) vào `Promise.all([...])`.

- [ ] **Step 5: Chạy test để thấy đạt, commit**

Run: `cd mobile && npm test && npm run build`
Expected: PASS — `patrol` 4, `queue-timed` 3, cũ 29.

```bash
git add mobile
git commit -m "feat(mobile): queue keeps when things were done, tag reading, distance, last-known cache, Google QR scanner"
```

---

### Task 3: Tuần tra trên app — vòng của tôi, đi vòng

**Files:**
- Create: `mobile/src/screens/MyRounds.tsx`, `mobile/src/screens/RoundRun.tsx`, `mobile/src/lib/rounds.ts`

**Interfaces:**
- Consumes: `GET /api/me/rounds`, `POST /api/patrol/rounds/:id/scans`, `POST /api/patrol/rounds/:id/finish` (qua hàng đợi).
- Produces:
  - `loadMyRounds()` → `{ rounds, offline, at }` qua `cached('rounds')`; `MyRound` (kiểu dữ liệu vòng của tôi).
  - `MyRounds` (`/tuan-tra`): vòng đang mở / sắp tới / đã qua trong ngày; số lần quét còn chờ gửi theo từng vòng; hiện "đang dùng dữ liệu lúc …" khi mất sóng.
  - `RoundRun` (`/tuan-tra/:id`): tiến độ x/y; nút lớn **Quét mã QR** (đọc tem → đúng điểm của vòng → chụp ảnh nếu điểm yêu cầu → lấy vị trí nhanh nếu được → vào hàng đợi); từng điểm: **Xác nhận GPS** (báo khoảng cách, hỏi lại khi ngoài bán kính), **Chụp ảnh** (điểm chỉ xác nhận bằng ảnh); trạng thái điểm đã xác nhận / chờ gửi / chưa; lỗi bị máy chủ từ chối hiện ngay trên màn; **Kết thúc vòng**. Vòng người khác đã nhận: chỉ xem.

- [ ] **Step 1: Dữ liệu vòng**

`mobile/src/lib/rounds.ts`:
```ts
import { cached } from './cache';
import { api } from './client';

export interface RoundStop {
  checkpoint_id: string;
  seq: number;
  required: boolean;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: ('qr' | 'gps' | 'photo' | 'nfc')[];
  photo_required: boolean;
  scanned_at: string | null;
  method: string | null;
  validity: string | null;
  flags: string[];
}

export interface MyRound {
  id: string;
  site_id: string;
  site_name: string;
  route_name: string;
  schedule_name: string;
  expected_start: string;
  expected_end: string;
  status: string;
  late: boolean;
  started_at: string | null;
  ended_at: string | null;
  employee_name: string | null;
  employee_id: string | null;
  mine: boolean;
  required_count: number;
  done_required: number;
  stops: RoundStop[];
}

/** Today's rounds of my shifts, kept on the phone for when there is no signal. */
export async function loadMyRounds() {
  const { data, offline, at } = await cached('rounds', () => api.request<MyRound[]>('/me/rounds'));
  return { rounds: data, offline, at };
}

const MIN = 60_000;
/** Can a scan still count? From 10 minutes before the window to 15 after it (the site's tolerance may be longer). */
export function roundWindow(r: Pick<MyRound, 'expected_start' | 'expected_end' | 'ended_at'>, now = Date.now()): 'early' | 'open' | 'over' {
  if (r.ended_at) return 'over';
  if (now < Date.parse(r.expected_start) - 10 * MIN) return 'early';
  if (now > Date.parse(r.expected_end) + 15 * MIN) return 'over';
  return 'open';
}
```

- [ ] **Step 2: Vòng của tôi**

`mobile/src/screens/MyRounds.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { queue } from '../lib/client';
import { stamp, time } from '../lib/format';
import { ROUND_STATUS } from '../lib/labels';
import { loadMyRounds, MyRound, roundWindow } from '../lib/rounds';

export function MyRounds() {
  const [rounds, setRounds] = useState<MyRound[] | null>(null);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await loadMyRounds();
      setRounds(r.rounds);
      setOfflineAt(r.offline ? r.at : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
    const counts: Record<string, number> = {};
    for (const i of await queue.list()) if (i.meta?.round_id) counts[i.meta.round_id] = (counts[i.meta.round_id] ?? 0) + 1;
    setWaiting(counts);
  }, []);
  useEffect(() => {
    void load();
    const off = queue.subscribe(() => void load());
    return off;
  }, [load]);

  const now = Date.now();
  const groups = [
    { title: 'Đang mở', items: (rounds ?? []).filter((r) => roundWindow(r, now) === 'open') },
    { title: 'Sắp tới', items: (rounds ?? []).filter((r) => roundWindow(r, now) === 'early') },
    { title: 'Đã qua', items: (rounds ?? []).filter((r) => roundWindow(r, now) === 'over') },
  ];

  return (
    <Screen title="Tuần tra" back action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      {offlineAt && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Không có mạng — đang dùng danh sách lúc {stamp(offlineAt)}</p>}
      <ErrorText error={error} />
      {rounds && !rounds.length && <p className="py-10 text-center text-slate-500">Hôm nay ca của bạn không có vòng tuần nào.</p>}
      {groups.map((g) => g.items.length > 0 && (
        <div key={g.title} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-slate-500">{g.title}</h2>
          {g.items.map((r) => (
            <Link key={r.id} to={`/tuan-tra/${r.id}`} className="block">
              <Card className={g.title === 'Đang mở' ? 'border-teal-400' : ''}>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-semibold">{time(r.expected_start)}–{time(r.expected_end)}</span>
                  <Badge tone={ROUND_STATUS[r.status]?.tone ?? ''}>{ROUND_STATUS[r.status]?.label}</Badge>
                </div>
                <div className="text-base">{r.route_name} · {r.site_name}</div>
                <div className="text-sm text-slate-500">
                  {r.mine ? `${r.stops.filter((s) => s.scanned_at).length}/${r.stops.length} điểm` : r.employee_name ? `${r.employee_name} đang đi` : `${r.stops.length} điểm`}
                  {waiting[r.id] ? <span className="text-amber-700"> · {waiting[r.id]} chờ gửi</span> : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ))}
    </Screen>
  );
}
```

- [ ] **Step 3: Đi vòng**

`mobile/src/screens/RoundRun.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorText, Screen } from '../components/ui';
import { queue } from '../lib/client';
import { stamp, time } from '../lib/format';
import { ROUND_STATUS, SCAN_FLAG } from '../lib/labels';
import { Fix, getPosition, takePhoto } from '../lib/native';
import { distanceM, parseTag, progress, StopState, stopStates } from '../lib/patrol';
import { newClientId, QueueItem, storePhoto } from '../lib/queue';
import { loadMyRounds, MyRound, RoundStop, roundWindow } from '../lib/rounds';
import { scanQr } from '../lib/scanner';

/** A position if the phone can give one within a few seconds; a QR scan never waits long for GPS. */
async function quickFix(): Promise<Fix | null> {
  return Promise.race([getPosition().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8_000))]);
}

const STATE_LABEL: Record<StopState, { text: string; tone: string }> = {
  done: { text: '✓ Đã xác nhận', tone: 'text-teal-700' },
  queued: { text: '⏳ Chờ gửi', tone: 'text-amber-700' },
  todo: { text: 'Chưa', tone: 'text-slate-400' },
};

export function RoundRun() {
  const { id } = useParams<{ id: string }>();
  const [round, setRound] = useState<MyRound | null>(null);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [pending, setPending] = useState<QueueItem[]>([]);
  const [refused, setRefused] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await loadMyRounds();
      setRound(r.rounds.find((x) => x.id === id) ?? null);
      setOfflineAt(r.offline ? r.at : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
    setPending((await queue.list()).filter((i) => i.meta?.round_id === id));
    setRefused((await queue.failed()).filter((i) => i.meta?.round_id === id));
  }, [id]);
  useEffect(() => {
    void load();
    return queue.subscribe(() => void load());
  }, [load]);

  if (!round) return <Screen title="Vòng tuần" back><ErrorText error={error ?? (offlineAt ? null : 'Không thấy vòng này trong ca của bạn')} /></Screen>;

  const queuedCps = pending.filter((i) => i.kind === 'scan').map((i) => i.meta!.checkpoint_id);
  const states = stopStates(round.stops, queuedCps);
  const done = progress(round.stops, states);
  const phase = roundWindow(round);
  const takenByOther = Boolean(round.employee_id) && !round.mine;
  const finishing = pending.some((i) => i.kind === 'finish');
  const canAct = phase === 'open' && !takenByOther && !finishing;

  /** Kept on the phone first, then sent: what the guard did is never lost to a dead spot. */
  async function confirm(stop: RoundStop, method: 'qr' | 'gps' | 'photo', fix: Fix | null, payload?: string) {
    let photo: Blob | null = null;
    if (method === 'photo' || stop.photo_required) {
      setNotice(`Chụp ảnh tại ${stop.code} · ${stop.name}`);
      photo = await takePhoto('rear');
    }
    await queue.add({
      kind: 'scan',
      label: `${round!.route_name} ${time(round!.expected_start)} · ${stop.code}`,
      path: `/patrol/rounds/${round!.id}/scans`,
      json: {
        client_uuid: newClientId(), method, checkpoint_id: stop.checkpoint_id, mock_location: false,
        ...(payload ? { qr_payload: payload } : {}),
        ...(fix ? { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m } : {}),
      },
      photos: photo ? [{ field: 'photo_file_id', many: false, files: [await storePhoto(photo)] }] : undefined,
      timed: true,
      meta: { round_id: round!.id, checkpoint_id: stop.checkpoint_id },
    });
    setNotice(`Đã ghi ${stop.code} · ${stop.name}`);
    void queue.flush().then(() => load());
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  const scan = () => act(async () => {
    const payload = await scanQr();
    const cp = parseTag(payload);
    if (!cp) throw new Error('Đây không phải tem điểm tuần tra của công ty');
    const stop = round.stops.find((s) => s.checkpoint_id === cp);
    if (!stop) throw new Error('Mã này không thuộc vòng tuần này');
    if (states[cp] !== 'todo') throw new Error(`${stop.code} đã được xác nhận rồi`);
    if (!stop.allowed_methods.includes('qr')) throw new Error(`${stop.code} không xác nhận bằng QR`);
    setNotice('Đang lấy vị trí…');
    await confirm(stop, 'qr', await quickFix(), payload);
  });

  const byGps = (stop: RoundStop) => act(async () => {
    setNotice('Đang lấy vị trí…');
    const fix = await getPosition();
    if (stop.lat && stop.lng) {
      const d = distanceM({ lat: Number(stop.lat), lng: Number(stop.lng) }, fix);
      if (d > stop.radius_m && !window.confirm(`Bạn đang cách ${stop.code} khoảng ${d} m (cho phép ${stop.radius_m} m). Vẫn xác nhận? Lần quét sẽ bị đánh dấu để đội trưởng xem.`)) {
        setNotice(null);
        return;
      }
    }
    await confirm(stop, 'gps', fix);
  });

  const byPhoto = (stop: RoundStop) => act(async () => confirm(stop, 'photo', await quickFix()));

  const finish = () => act(async () => {
    if (done.done < done.required && !window.confirm(`Còn ${done.required - done.done} điểm bắt buộc chưa xác nhận. Vẫn kết thúc vòng?`)) return;
    await queue.add({ kind: 'finish', label: `Kết thúc vòng ${time(round.expected_start)}`, path: `/patrol/rounds/${round.id}/finish`, json: {}, timed: true, meta: { round_id: round.id } });
    setNotice('Đã ghi kết thúc vòng');
    void queue.flush().then(() => load());
  });

  return (
    <Screen title={`${time(round.expected_start)}–${time(round.expected_end)}`} back>
      {offlineAt && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Không có mạng — vẫn quét bình thường, máy sẽ tự gửi khi có sóng.</p>}
      <Card>
        <div className="flex items-center justify-between">
          <b className="text-lg">{round.route_name}</b>
          <Badge tone={ROUND_STATUS[round.status]?.tone ?? ''}>{ROUND_STATUS[round.status]?.label}</Badge>
        </div>
        <div className="text-slate-600">{round.site_name}</div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-teal-600" style={{ width: `${done.required ? (100 * done.done) / done.required : 0}%` }} /></div>
        <div className="mt-1 text-sm text-slate-500">{done.done}/{done.required} điểm bắt buộc</div>
        {takenByOther && <p className="mt-2 text-amber-700">Vòng này do {round.employee_name} đi.</p>}
        {phase === 'early' && <p className="mt-2 text-slate-600">Chưa đến giờ — mở từ 10 phút trước {time(round.expected_start)}.</p>}
        {phase === 'over' && !round.ended_at && <p className="mt-2 text-red-700">Đã quá giờ của vòng này.</p>}
      </Card>

      <ErrorText error={error} />
      {notice && <p className="rounded-lg bg-teal-50 p-3 text-base text-teal-800">{notice}</p>}
      {refused.map((i) => (
        <p key={i.id} className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Không được nhận: {i.label} — {i.error} (xem ở trang Tôi)</p>
      ))}

      {canAct && round.stops.some((s) => s.allowed_methods.includes('qr')) && (
        <Button onClick={() => void scan()} disabled={busy} className="py-5 text-xl">📷 Quét mã QR</Button>
      )}

      {round.stops.map((s) => {
        const state = states[s.checkpoint_id];
        return (
          <Card key={s.checkpoint_id} className={state === 'todo' ? '' : 'opacity-80'}>
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{s.seq}. {s.code} · {s.name}</span>
              <span className={`text-sm ${STATE_LABEL[state].tone}`}>{STATE_LABEL[state].text}</span>
            </div>
            <div className="text-sm text-slate-500">
              {s.allowed_methods.filter((m) => m !== 'nfc').map((m) => ({ qr: 'QR', gps: 'GPS', photo: 'Ảnh' }[m])).join(' / ')}
              {s.photo_required && ' · cần chụp ảnh'}{!s.required && ' · không bắt buộc'}
              {s.scanned_at && ` · lúc ${time(s.scanned_at)}`}
            </div>
            {s.flags.length > 0 && <div className="text-sm text-red-700">⚠ {s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</div>}
            {canAct && state === 'todo' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {s.allowed_methods.includes('gps') && <Button tone="secondary" disabled={busy} onClick={() => void byGps(s)}>📍 Xác nhận GPS</Button>}
                {s.allowed_methods.includes('photo') && <Button tone="secondary" disabled={busy} onClick={() => void byPhoto(s)}>📸 Chụp ảnh</Button>}
              </div>
            )}
          </Card>
        );
      })}

      {canAct && (round.started_at || pending.length > 0) && (
        <Button tone="secondary" onClick={() => void finish()} disabled={busy}>Kết thúc vòng</Button>
      )}
      {finishing && <p className="text-center text-sm text-amber-700">Đã ghi kết thúc vòng — chờ gửi</p>}
      {offlineAt && <p className="text-center text-xs text-slate-400">Danh sách lúc {stamp(offlineAt)}</p>}
    </Screen>
  );
}
```

- [ ] **Step 4: Commit** (build ở Task 6)

```bash
git add mobile
git commit -m "feat(mobile): patrol on the phone — my rounds, QR via Google scanner, GPS with distance, photos, offline-safe scans and finish"
```

---

### Task 4: Báo sự cố, SOS

**Files:**
- Create: `mobile/src/screens/ReportIncident.tsx`, `mobile/src/components/SosButton.tsx`

**Interfaces:**
- Consumes: `GET /api/incident-categories` (giữ bản cuối), `POST /api/incidents`, `POST /api/incidents/sos` (qua hàng đợi, có `client_uuid`).
- Produces: `ReportIncident` (`/bao-su-co?site=…`: loại, mức độ, mô tả, ≤ 5 ảnh, vị trí tự lấy nếu được; vào hàng đợi rồi gửi; báo "đã gửi" hoặc "đã lưu, chờ gửi"); `SosButton` (giữ 2 giây, vòng tiến độ; lấy vị trí tối đa 8 giây; gửi; nếu chưa gửi được: chữ đỏ lớn "CHƯA GỬI ĐƯỢC — gọi điện ngay cho đội trưởng", máy tự gửi khi có sóng).

- [ ] **Step 1: Báo sự cố**

`mobile/src/screens/ReportIncident.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PhotoStrip } from '../components/PhotoStrip';
import { Button, ErrorText, Field, Screen } from '../components/ui';
import { cached } from '../lib/cache';
import { api, queue } from '../lib/client';
import { SEVERITY } from '../lib/labels';
import { Fix, getPosition } from '../lib/native';
import { newClientId, storePhoto } from '../lib/queue';

interface Category {
  id: string;
  name: string;
  default_severity: string;
}

export function ReportIncident() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const siteId = params.get('site');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [severity, setSeverity] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'sent' | 'waiting' | null>(null);

  useEffect(() => {
    cached('categories', () => api.request<Category[]>('/incident-categories'))
      .then(({ data }) => { setCategories(data); setCategoryId(data[0]?.id ?? ''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được loại sự cố'));
    getPosition().then(setFix).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const item = await queue.add({
        kind: 'incident',
        label: `Sự cố: ${categories.find((c) => c.id === categoryId)?.name ?? ''}`,
        path: '/incidents',
        json: {
          client_uuid: newClientId(), category_id: categoryId, description,
          ...(severity ? { severity } : {}), ...(siteId ? { site_id: siteId } : {}), ...(fix ? { lat: fix.lat, lng: fix.lng } : {}),
        },
        photos: photos.length ? [{ field: 'file_ids', many: true, files: await Promise.all(photos.map(storePhoto)) }] : undefined,
      });
      await queue.flush();
      setDone((await queue.list()).some((i) => i.id === item.id) ? 'waiting' : 'sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen title="Báo sự cố" back>
        <div className="py-8 text-center">
          <div className="text-5xl">{done === 'sent' ? '✅' : '⏳'}</div>
          <p className="mt-3 text-xl font-semibold">{done === 'sent' ? 'Đã báo — đội trưởng đã nhận thông báo' : 'Đã lưu trên máy — sẽ tự gửi khi có sóng'}</p>
          {done === 'waiting' && <p className="mt-2 text-red-700">Việc gấp: gọi điện cho đội trưởng ngay.</p>}
        </div>
        <Button onClick={() => navigate('/')}>Về ca trực</Button>
      </Screen>
    );
  }

  return (
    <Screen title="Báo sự cố" back>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Loại sự cố">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Mức độ">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            <option value="">Theo loại sự cố</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Chuyện gì đang xảy ra?">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
        </Field>
        <Field label="Ảnh (tối đa 5)"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></Field>
        <p className="text-sm text-slate-500">{fix ? `Đã gắn vị trí (±${fix.accuracy_m} m)` : 'Đang lấy vị trí… (không bắt buộc)'}</p>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || !categoryId}>{busy ? 'Đang gửi…' : 'Gửi báo cáo'}</Button>
      </form>
    </Screen>
  );
}
```

- [ ] **Step 2: Nút SOS**

`mobile/src/components/SosButton.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { queue } from '../lib/client';
import { getPosition } from '../lib/native';
import { newClientId } from '../lib/queue';

const HOLD_MS = 2_000;

/** Hold two seconds: an SOS goes out with the position if the phone has one within 8 seconds. */
export function SosButton() {
  const [held, setHeld] = useState(0);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'waiting'>('idle');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setHeld(0);
  };
  useEffect(() => stop, []);

  async function fire() {
    stop();
    setState('sending');
    const fix = await Promise.race([getPosition().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8_000))]);
    const item = await queue.add({ kind: 'sos', label: 'SOS', path: '/incidents/sos', json: { client_uuid: newClientId(), ...(fix ? { lat: fix.lat, lng: fix.lng } : {}) } });
    await queue.flush();
    setState((await queue.list()).some((i) => i.id === item.id) ? 'waiting' : 'sent');
  }

  function start() {
    if (state === 'sending') return;
    const began = Date.now();
    timer.current = setInterval(() => {
      const t = Date.now() - began;
      setHeld(Math.min(1, t / HOLD_MS));
      if (t >= HOLD_MS) void fire();
    }, 50);
  }

  if (state === 'sent' || state === 'waiting') {
    return (
      <div className={`rounded-2xl p-4 text-center ${state === 'sent' ? 'bg-red-50' : 'bg-red-600 text-white'}`}>
        <div className="text-2xl font-bold">{state === 'sent' ? '🚨 ĐÃ GỬI SOS' : '⚠️ CHƯA GỬI ĐƯỢC SOS'}</div>
        <p className="mt-1 text-base">{state === 'sent' ? 'Đội trưởng và quản lý đã được báo. Giữ an toàn, chờ hỗ trợ.' : 'Không có mạng. Máy sẽ tự gửi khi có sóng — GỌI ĐIỆN NGAY cho đội trưởng.'}</p>
        <button onClick={() => setState('idle')} className="mt-2 text-sm underline">Đóng</button>
      </div>
    );
  }

  return (
    <button
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      disabled={state === 'sending'}
      className="relative w-full select-none overflow-hidden rounded-2xl bg-red-600 py-5 text-2xl font-bold text-white shadow-lg active:bg-red-700"
    >
      <span className="absolute inset-y-0 left-0 bg-red-900/40" style={{ width: `${held * 100}%` }} />
      <span className="relative">{state === 'sending' ? 'Đang gửi SOS…' : held > 0 ? 'Giữ tiếp…' : 'SOS — giữ 2 giây'}</span>
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile
git commit -m "feat(mobile): incident report with photos and position, SOS held for two seconds — both queued and safe to resend"
```

---

### Task 5: Sổ trực, giao ca, nhận ca

**Files:**
- Create: `mobile/src/screens/GuardLogbook.tsx`, `mobile/src/screens/GiveHandover.tsx`, `mobile/src/screens/TakeHandover.tsx`

**Interfaces:**
- Consumes: `GET /api/sites/:id/logbook/inside`, `GET /api/sites/:id/logbook?date`, `POST /api/sites/:id/logbook`, `POST /api/logbook/:id/exit` (qua hàng đợi), `GET /api/sites/:id/handover-items`, `POST /api/handovers`, `GET /api/me/handovers`, `POST /api/handovers/:id/accept|dispute`.
- Produces: `GuardLogbook` (`/so-truc/:siteId`: thêm dòng — Khách / Xe / Tài sản / Ghi chú — kèm ảnh; đang ở trong + nút **Ra**; dòng hôm nay; dòng chờ gửi), `GiveHandover` (`/giao-ca/:siteId/:assignmentId`: từng món Đủ / Thiếu / Có vấn đề + ghi chú, ghi chú chung, ảnh; nhiều người nhận → chọn), `TakeHandover` (`/nhan-ca/:id`: xem biên bản và ảnh, **Đồng ý** hoặc **Không đồng ý** kèm lý do).

- [ ] **Step 1: Sổ trực**

`mobile/src/screens/GuardLogbook.tsx`:
```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { PhotoStrip } from '../components/PhotoStrip';
import { Button, Card, ErrorText, Field, Input, Screen } from '../components/ui';
import { cached } from '../lib/cache';
import { api, queue } from '../lib/client';
import { localDate, time } from '../lib/format';
import { LOGBOOK_TYPE } from '../lib/labels';
import { newClientId, QueueItem, storePhoto } from '../lib/queue';

interface Line {
  id: string;
  type: string;
  body: string | null;
  data: Record<string, string | number | undefined>;
  occurred_at: string;
  exited_at: string | null;
  author_name: string;
  files: { id: string }[];
}

type Kind = 'visitor' | 'vehicle' | 'asset' | 'note';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'visitor', label: '🚶 Khách' },
  { key: 'vehicle', label: '🚗 Xe' },
  { key: 'asset', label: '📦 Tài sản' },
  { key: 'note', label: '📝 Ghi chú' },
];
const ASSET_ACTIONS = [
  { value: 'received', label: 'Nhận' },
  { value: 'handed_out', label: 'Giao' },
  { value: 'lent', label: 'Cho mượn' },
  { value: 'returned', label: 'Trả lại' },
];
const EMPTY = { visitor_name: '', visitor_org: '', meet_whom: '', purpose: '', plate: '', vehicle_kind: '', cargo: '', item: '', quantity: '1', asset_action: 'received', counterpart: '', body: '' };

const text = (l: Pick<Line, 'type' | 'data' | 'body'>) => {
  const d = l.data;
  if (l.type === 'visitor') return [d.visitor_name, d.visitor_org && `(${d.visitor_org})`, d.meet_whom && `gặp ${d.meet_whom}`].filter(Boolean).join(' ');
  if (l.type === 'vehicle') return [d.plate, d.vehicle_kind, d.cargo].filter(Boolean).join(' · ');
  if (l.type === 'asset') return [d.item, d.quantity, d.counterpart].filter(Boolean).join(' · ');
  return l.body ?? '';
};

export function GuardLogbook() {
  const { siteId } = useParams<{ siteId: string }>();
  const [inside, setInside] = useState<Line[]>([]);
  const [today, setToday] = useState<Line[]>([]);
  const [waiting, setWaiting] = useState<QueueItem[]>([]);
  const [kind, setKind] = useState<Kind | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        cached(`inside.${siteId}`, () => api.request<Line[]>(`/sites/${siteId}/logbook/inside`)),
        cached(`book.${siteId}`, () => api.request<Line[]>(`/sites/${siteId}/logbook?date=${localDate(0)}`)),
      ]);
      setInside(a.data);
      setToday(b.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
    setWaiting((await queue.list()).filter((i) => i.meta?.site_id === siteId));
  }, [siteId]);
  useEffect(() => {
    void load();
    return queue.subscribe(() => void load());
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const fields: Record<string, unknown> =
        kind === 'visitor' ? { visitor_name: form.visitor_name, visitor_org: form.visitor_org || undefined, meet_whom: form.meet_whom || undefined, purpose: form.purpose || undefined }
          : kind === 'vehicle' ? { plate: form.plate.toUpperCase(), vehicle_kind: form.vehicle_kind || undefined, cargo: form.cargo || undefined }
            : kind === 'asset' ? { item: form.item, quantity: Number(form.quantity) || 1, asset_action: form.asset_action, counterpart: form.counterpart || undefined }
              : { body: form.body };
      if (kind !== 'note' && form.body.trim()) fields.body = form.body.trim();
      const json = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''));
      await queue.add({
        kind: 'logbook',
        label: `Sổ trực: ${LOGBOOK_TYPE[kind]} ${text({ type: kind, data: json as Line['data'], body: (json.body as string) ?? null })}`,
        path: `/sites/${siteId}/logbook`,
        json: { client_uuid: newClientId(), type: kind, ...json },
        photos: photos.length ? [{ field: 'file_ids', many: true, files: await Promise.all(photos.map(storePhoto)) }] : undefined,
        timed: true,
        meta: { site_id: siteId! },
      });
      setKind(null);
      setForm(EMPTY);
      setPhotos([]);
      void queue.flush().then(() => load());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  async function exit(line: Line) {
    await queue.add({
      kind: 'exit', label: `Ra: ${text(line)}`, path: `/logbook/${line.id}/exit`, json: {}, timed: true,
      okCodes: ['LOGBOOK_ALREADY_EXITED'], meta: { site_id: siteId!, line_id: line.id },
    });
    void queue.flush().then(() => load());
  }

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const leaving = new Set(waiting.filter((i) => i.kind === 'exit').map((i) => i.meta!.line_id));

  return (
    <Screen title="Sổ trực" back>
      <ErrorText error={error} />
      {!kind ? (
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => <Button key={k.key} tone="secondary" onClick={() => setKind(k.key)}>{k.label}</Button>)}
        </div>
      ) : (
        <Card>
          <form onSubmit={save} className="space-y-3">
            <b className="text-lg">{KINDS.find((k) => k.key === kind)!.label}</b>
            {kind === 'visitor' && (
              <>
                <Field label="Tên khách"><Input value={form.visitor_name} onChange={set('visitor_name')} required /></Field>
                <Field label="Đơn vị"><Input value={form.visitor_org} onChange={set('visitor_org')} /></Field>
                <Field label="Gặp ai"><Input value={form.meet_whom} onChange={set('meet_whom')} /></Field>
                <Field label="Việc gì"><Input value={form.purpose} onChange={set('purpose')} /></Field>
              </>
            )}
            {kind === 'vehicle' && (
              <>
                <Field label="Biển số"><Input value={form.plate} onChange={set('plate')} required autoCapitalize="characters" /></Field>
                <Field label="Loại xe"><Input value={form.vehicle_kind} onChange={set('vehicle_kind')} placeholder="Xe máy, xe tải…" /></Field>
                <Field label="Hàng hoá"><Input value={form.cargo} onChange={set('cargo')} /></Field>
              </>
            )}
            {kind === 'asset' && (
              <>
                <Field label="Món"><Input value={form.item} onChange={set('item')} required /></Field>
                <div className="grid grid-cols-4 gap-1">
                  {ASSET_ACTIONS.map((a) => (
                    <button key={a.value} type="button" onClick={() => setForm({ ...form, asset_action: a.value })} className={`rounded-lg py-2 text-sm ${form.asset_action === a.value ? 'bg-teal-700 text-white' : 'border border-slate-300'}`}>{a.label}</button>
                  ))}
                </div>
                <Field label="Số lượng"><Input type="number" min={1} value={form.quantity} onChange={set('quantity')} /></Field>
                <Field label="Với ai"><Input value={form.counterpart} onChange={set('counterpart')} /></Field>
              </>
            )}
            <Field label={kind === 'note' ? 'Nội dung' : 'Ghi chú thêm'}>
              <textarea value={form.body} onChange={set('body')} required={kind === 'note'} rows={kind === 'note' ? 4 : 2} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
            </Field>
            <Field label="Ảnh (tuỳ chọn)"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Ghi sổ</Button>
              <Button type="button" tone="secondary" onClick={() => { setKind(null); setPhotos([]); }}>Thôi</Button>
            </div>
          </form>
        </Card>
      )}

      {waiting.filter((i) => i.kind === 'logbook').map((i) => <p key={i.id} className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">⏳ Chờ gửi: {i.label}</p>)}

      {inside.length > 0 && (
        <Card>
          <b>Đang ở trong ({inside.length})</b>
          {inside.map((l) => (
            <div key={l.id} className="flex items-center justify-between border-t border-slate-100 py-2">
              <span className="text-base">{LOGBOOK_TYPE[l.type]} · {text(l)} <span className="text-sm text-slate-400">vào {time(l.occurred_at)}</span></span>
              {leaving.has(l.id) ? <span className="text-sm text-amber-700">chờ gửi</span> : <button onClick={() => void exit(l)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-base">Ra</button>}
            </div>
          ))}
        </Card>
      )}

      <h2 className="pt-2 text-sm font-semibold uppercase text-slate-500">Hôm nay</h2>
      {today.map((l) => (
        <Card key={l.id}>
          <div className="text-sm text-slate-400">{time(l.occurred_at)} · {LOGBOOK_TYPE[l.type]} · {l.author_name}</div>
          <div className="text-base">{text(l)}{l.exited_at && <span className="text-sm text-slate-500"> · ra {time(l.exited_at)}</span>}</div>
          {l.type !== 'note' && l.body && <div className="text-sm text-slate-600">{l.body}</div>}
          {l.files.length > 0 && <div className="mt-2 flex gap-2">{l.files.map((f) => <AuthImage key={f.id} fileId={f.id} className="h-16 w-16" />)}</div>}
        </Card>
      ))}
      {!today.length && <p className="text-center text-slate-400">Chưa có dòng nào hôm nay</p>}
    </Screen>
  );
}
```

- [ ] **Step 2: Giao ca**

`mobile/src/screens/GiveHandover.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { ApiError, NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { time } from '../lib/format';

type Mark = 'ok' | 'missing' | 'issue';
interface Choice {
  assignment_id: string;
  name: string;
  planned_start: string;
}

/** The outgoing guard ticks the site's checklist; the next guard confirms on their own phone. Needs the network. */
export function GiveHandover() {
  const { siteId, assignmentId } = useParams<{ siteId: string; assignmentId: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<string[] | null>(null);
  const [marks, setMarks] = useState<Record<string, { status: Mark; note: string }>>({});
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [uploaded, setUploaded] = useState<{ photos: Blob[]; ids: string[] } | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    api.request<string[]>(`/sites/${siteId}/handover-items`).then((list) => {
      setItems(list);
      setMarks(Object.fromEntries(list.map((l) => [l, { status: 'ok' as Mark, note: '' }])));
    }).catch((e) => setError(e instanceof Error ? e.message : 'Không tải được danh mục bàn giao'));
  }, [siteId]);

  async function submit(to?: string) {
    setBusy(true);
    setError(null);
    try {
      const file_ids = uploaded && uploaded.photos === photos ? uploaded.ids : await uploadAll((b, n) => api.upload(b, n), photos);
      setUploaded({ photos, ids: file_ids });
      const h = await api.request<{ to_name: string | null }>('/handovers', {
        json: {
          from_assignment_id: assignmentId, ...(to ? { to_assignment_id: to } : {}), notes: notes.trim() || undefined, file_ids,
          items: (items ?? []).map((label) => ({ label, status: marks[label].status, ...(marks[label].note.trim() ? { note: marks[label].note.trim() } : {}) })),
        },
      });
      setSent(h.to_name ?? '');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HANDOVER_RECEIVER_REQUIRED') setChoices(e.details as Choice[]);
      else setError(e instanceof NetworkError ? 'Không có mạng — giao ca cần mạng để người nhận thấy ngay.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) {
    return (
      <Screen title="Giao ca" back>
        <div className="py-8 text-center">
          <div className="text-5xl">✅</div>
          <p className="mt-3 text-xl font-semibold">Đã giao ca{sent ? ` cho ${sent}` : ''}</p>
          <p className="text-slate-500">{sent ? 'Người nhận sẽ xác nhận trên máy của họ.' : 'Chưa có người nhận ca — đội trưởng sẽ chọn người nhận.'}</p>
        </div>
        <Button onClick={() => navigate('/')}>Về ca trực</Button>
      </Screen>
    );
  }

  return (
    <Screen title="Giao ca" back>
      <ErrorText error={error} />
      {choices && (
        <Card>
          <b>Có nhiều người nhận ca — chọn người nhận:</b>
          {choices.map((c) => (
            <button key={c.assignment_id} disabled={busy} onClick={() => void submit(c.assignment_id)} className="flex w-full justify-between border-t border-slate-100 py-3 text-left text-lg">
              {c.name}<span className="text-sm text-slate-500">vào {time(c.planned_start)}</span>
            </button>
          ))}
        </Card>
      )}
      {items?.map((label) => (
        <Card key={label}>
          <div className="text-lg font-semibold">{label}</div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {([['ok', 'Đủ'], ['missing', 'Thiếu'], ['issue', 'Có vấn đề']] as [Mark, string][]).map(([v, t]) => (
              <button key={v} type="button" onClick={() => setMarks({ ...marks, [label]: { ...marks[label], status: v } })} className={`rounded-lg py-2 text-base ${marks[label]?.status === v ? (v === 'ok' ? 'bg-teal-700 text-white' : 'bg-red-600 text-white') : 'border border-slate-300'}`}>{t}</button>
            ))}
          </div>
          {marks[label]?.status !== 'ok' && (
            <input value={marks[label].note} onChange={(e) => setMarks({ ...marks, [label]: { ...marks[label], note: e.target.value } })} placeholder="Thiếu gì, hỏng gì…" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          )}
        </Card>
      ))}
      {items && !items.length && <p className="text-slate-500">Mục tiêu chưa có danh mục bàn giao — ghi chú việc cần bàn giao bên dưới.</p>}
      <Card>
        <b>Ghi chú cho ca sau</b>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Việc còn dở, khách hẹn, lưu ý…" className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-base" />
        <div className="mt-2"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></div>
      </Card>
      <Button onClick={() => void submit()} disabled={busy || !items}>{busy ? 'Đang gửi…' : 'Giao ca'}</Button>
    </Screen>
  );
}
```

- [ ] **Step 3: Nhận ca**

`mobile/src/screens/TakeHandover.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { stamp } from '../lib/format';

export interface IncomingHandover {
  id: string;
  site_name: string;
  from_name: string;
  submitted_at: string;
  items: { label: string; status: string; note?: string }[];
  notes: string | null;
  file_ids: string[];
}

export function TakeHandover() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [h, setH] = useState<IncomingHandover | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.request<IncomingHandover[]>('/me/handovers')
      .then((list) => {
        const found = list.find((x) => x.id === id) ?? null;
        setH(found);
        if (!found) setError('Biên bản này không còn chờ bạn xác nhận');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra'));
  }, [id]);

  async function answer(accept: boolean) {
    if (!accept && !reason.trim()) return setError('Ghi lý do không đồng ý');
    setBusy(true);
    setError(null);
    try {
      await api.request(`/handovers/${id}/${accept ? 'accept' : 'dispute'}`, { json: accept ? {} : { note: reason.trim() } });
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (!h) return <Screen title="Nhận ca" back><ErrorText error={error} /></Screen>;
  return (
    <Screen title="Nhận ca" back>
      <Card>
        <div className="text-lg"><b>{h.from_name}</b> giao ca · {h.site_name}</div>
        <div className="text-sm text-slate-400">{stamp(h.submitted_at)}</div>
        {h.items.map((i) => (
          <div key={i.label} className={`border-t border-slate-100 py-2 text-base ${i.status === 'ok' ? '' : 'font-semibold text-red-700'}`}>
            {i.status === 'ok' ? '✓' : '✗'} {i.label}{i.status !== 'ok' && ` — ${i.status === 'missing' ? 'thiếu' : 'có vấn đề'}`}{i.note ? `: ${i.note}` : ''}
          </div>
        ))}
        {h.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2">Ghi chú: {h.notes}</p>}
        {h.file_ids.length > 0 && <div className="mt-2 grid grid-cols-3 gap-2">{h.file_ids.map((f) => <AuthImage key={f} fileId={f} className="aspect-square w-full" />)}</div>}
      </Card>
      <p className="text-slate-600">Kiểm lại từng món trước khi đồng ý.</p>
      <ErrorText error={error} />
      {disputing ? (
        <Card>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Thiếu gì, khác gì so với biên bản?" className="w-full rounded-xl border border-slate-300 p-3 text-base" />
          <div className="mt-2 flex gap-2">
            <Button tone="danger" onClick={() => void answer(false)} disabled={busy}>Gửi — không đồng ý</Button>
            <Button tone="secondary" onClick={() => setDisputing(false)}>Thôi</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void answer(true)} disabled={busy}>Đồng ý nhận ca</Button>
          <Button tone="danger" onClick={() => setDisputing(true)} disabled={busy}>Không đồng ý</Button>
        </div>
      )}
    </Screen>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add mobile
git commit -m "feat(mobile): logbook on the phone with exits and photos, handover checklist, receiving guard accepts or disputes"
```

---

### Task 6: Lối vào trên màn Ca trực; build, APK

**Files:**
- Modify: `mobile/src/screens/Shifts.tsx`, `mobile/src/App.tsx`

**Interfaces:**
- Produces: thẻ ca đang trực (từ 60 phút trước giờ vào tới 2 giờ sau giờ ra) có các nút theo quyền: **Tuần tra** (`patrol.perform`), **Sổ trực** (`logbook.write`), **Giao ca** (`logbook.write`, đã vào ca, trong 2 giờ quanh giờ ra), **Báo sự cố** (`incident.report`); thẻ "Biên bản giao ca chờ bạn xác nhận" từ `GET /me/handovers`; nút **SOS** cuối màn cho người có `incident.report`. Route: `/tuan-tra`, `/tuan-tra/:id`, `/bao-su-co`, `/so-truc/:siteId`, `/giao-ca/:siteId/:assignmentId`, `/nhan-ca/:id` (màn có nút quay lại).

- [ ] **Step 1: Màn Ca trực**

Trong `mobile/src/screens/Shifts.tsx`:
- import `Link` từ `react-router-dom`, `SosButton` từ `../components/SosButton`, `useAuth` từ `../lib/auth`, `IncomingHandover` từ `./TakeHandover`;
- `Shift` thêm `site_id: string;`;
- trong component thêm:
```tsx
  const { can } = useAuth();
  const [incoming, setIncoming] = useState<IncomingHandover[]>([]);
  useEffect(() => {
    api.request<IncomingHandover[]>('/me/handovers').then(setIncoming).catch(() => undefined);
  }, [shifts]);
```
- ngay sau `<ErrorText error={error} />` thêm:
```tsx
      {incoming.map((h) => (
        <Link key={h.id} to={`/nhan-ca/${h.id}`} className="block">
          <Card className="border-amber-400 bg-amber-50">
            <b className="text-lg">📋 {h.from_name} giao ca cho bạn</b>
            <div className="text-base text-amber-800">Kiểm tra và xác nhận biên bản →</div>
          </Card>
        </Link>
      ))}
```
- trong thẻ ca (vòng `live.map`), ngay sau khối nút `step && (...)` thêm:
```tsx
            {now >= new Date(s.planned_start).getTime() - HOUR && now <= new Date(s.planned_end).getTime() + 2 * HOUR && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {can('patrol.perform') && <Link to="/tuan-tra"><Button tone="secondary">🚶 Tuần tra</Button></Link>}
                {can('logbook.write') && <Link to={`/so-truc/${s.site_id}`}><Button tone="secondary">📖 Sổ trực</Button></Link>}
                {can('incident.report') && <Link to={`/bao-su-co?site=${s.site_id}`}><Button tone="secondary">⚠️ Báo sự cố</Button></Link>}
                {can('logbook.write') && a?.check_in_at && Math.abs(now - new Date(s.planned_end).getTime()) <= 2 * HOUR && (
                  <Link to={`/giao-ca/${s.site_id}/${s.id}`}><Button tone="secondary">🔁 Giao ca</Button></Link>
                )}
              </div>
            )}
```
- ngay trước thẻ đóng `</Screen>` thêm:
```tsx
      {can('incident.report') && <div className="pt-4"><SosButton /></div>}
```

- [ ] **Step 2: Route**

Trong `mobile/src/App.tsx`: import `MyRounds`, `RoundRun`, `ReportIncident`, `GuardLogbook`, `GiveHandover`, `TakeHandover` từ `./screens/...`; ngoài nhóm `Layout` thêm:
```tsx
        <Route path="/tuan-tra" element={<MyRounds />} />
        <Route path="/tuan-tra/:id" element={<RoundRun />} />
        <Route path="/bao-su-co" element={<ReportIncident />} />
        <Route path="/so-truc/:siteId" element={<GuardLogbook />} />
        <Route path="/giao-ca/:siteId/:assignmentId" element={<GiveHandover />} />
        <Route path="/nhan-ca/:id" element={<TakeHandover />} />
```
Trong `mobile/src/lib/nav.ts`, `routeFor`: `handover.incoming` mở `/nhan-ca/:handover_id` thay vì `/` (bảo vệ nhận ca có màn riêng):
```ts
  if (data.type === 'handover.incoming' && data.handover_id) return `/nhan-ca/${data.handover_id}`;
```
(đặt trước dòng `if (data.type === 'handover.incoming' || data.type === 'patrol.reminder') return '/';`) và trong `mobile/src/lib/nav.test.ts` đổi kỳ vọng tương ứng thành `expect(routeFor({ handover_id: 'h1', type: 'handover.incoming' }, leader)).toBe('/nhan-ca/h1');`; `patrol.reminder` mở `/tuan-tra`:
```ts
  if (data.type === 'patrol.reminder') return '/tuan-tra';
```
và đổi kỳ vọng `expect(routeFor({ round_id: 'r1', type: 'patrol.reminder' }, leader)).toBe('/tuan-tra');`.

- [ ] **Step 3: Build, test, APK, kiểm tra API, commit**

Run: `cd mobile && npm test && npm run build` → PASS.

Run (APK LAN như Plan 09a):
```bash
cd mobile && VITE_API_BASE=http://<IP>:3001/api MOBILE_DEV=1 npm run build && MOBILE_DEV=1 npx cap sync android
cd android && JAVA_HOME=/d/Apps/AndroidStudio/jbr ./gradlew.bat assembleDebug
```
Expected: `BUILD SUCCESSFUL` (plugin quét mã được Gradle kéo về).

Kiểm tra như app gọi (đội trưởng demo có ca hôm nay): `GET /me/rounds` 200; `POST /incidents/sos` hai lần cùng `client_uuid` → cùng id; `POST /sites/:id/logbook` hai lần cùng `client_uuid` → cùng id.

```bash
git add mobile
git commit -m "feat(mobile): field actions on the shift card, incoming handover banner, SOS on the shifts screen"
```

---

## Self-review (người viết kế hoạch)

- **Phủ spec:** M4–M5 tuần tra → Task 3; M6 báo sự cố, M7 SOS → Task 4; M8 sổ trực, M9 giao ca → Task 5; M10 offline (vòng tải sẵn, hàng đợi, giờ lúc làm, gửi lại không trùng) → Task 1–3, 5; lối vào ở ca → Task 6.
- **Không có chỗ trống:** mọi bước có mã và lệnh cụ thể.
- **Khớp tên:** `queue.add({ timed, okCodes, meta })`, `parseTag/distanceM/stopStates/progress`, `cached/clearCache`, `scanQr`, `loadMyRounds/roundWindow`, các màn đăng ký ở Task 6.
- **Việc để sau:** GPS giả (plugin native); số khẩn cấp của mục tiêu cho SOS offline; giao ca offline.
