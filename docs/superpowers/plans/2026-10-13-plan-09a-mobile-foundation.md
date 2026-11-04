# Plan 09a — App IntelShield (Android): nền móng, đăng nhập, ca trực, vào/ra ca, thông báo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Android **IntelShield** (`io.github.oldcyborg.intelshield`) cho bảo vệ, đội trưởng, quản lý: đăng nhập bằng SĐT + mật khẩu gắn với máy (máy mới chờ HR duyệt), đổi mật khẩu lần đầu; xem ca hôm qua/hôm nay/ngày mai; vào ca / ra ca bằng **selfie camera trước + GPS**; hộp thông báo và nhận thông báo đẩy (FCM khi có `google-services.json`); hàng đợi gửi bù khi mất sóng (nền cho tuần tra, sự cố, sổ trực ở Plan 09b); build được APK trên máy này.

**Architecture:** Thư mục mới `mobile/`: React 18 + Vite SPA + Tailwind, bọc Capacitor 8 (Android trước; iOS sau). Gọi API bằng Bearer với `X-Client: mobile` (token trong body, refresh một luồng), lưu phiên bằng `@capacitor/preferences`. Ảnh chụp bằng `@capacitor/camera` (chỉ camera, không thư viện), nén ≤ 1280 px. Hàng đợi offline trong IndexedDB (`idb-keyval`), gửi lần lượt theo thứ tự, ảnh tải lên trước rồi gắn id. Backend chỉ cần thêm origin của app vào CORS.

**Tech Stack:** React 18.3, react-router-dom 6, Vite 6, Tailwind 3.4, TypeScript 5.7, Capacitor 8 (core, android, app, camera, device, geolocation, network, preferences, push-notifications), idb-keyval, Vitest + fake-indexeddb. Build Android bằng JDK 21 của Android Studio (`D:\Apps\AndroidStudio\jbr`) và Android SDK có sẵn.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` — §2 (mobile/), §5.1.1 M1–M3, M10–M11, §5.1.4, §7.4. Chủ dự án 13/10/2026: tên app **IntelShield**, appId có `intelshield`; **Android trước**, chưa cần Codemagic.

**Khác với spec (có chủ đích):**
- Capacitor 8 (như POS hiện tại) thay vì 7.
- Chưa phát hiện GPS giả trên Android (Capacitor không trả cờ này) — gửi `mock_location: false`; plugin riêng làm sau.
- Vào/ra ca cần mạng (backend tính giờ theo máy chủ và đòi selfie mới trong 10 phút); hàng đợi offline dùng cho tuần tra, sự cố, sổ trực (Plan 09b).
- Kiểm tra khuôn mặt trên máy (ML Kit) để sau.

## Global Constraints

- Không có mật khẩu, token hay khoá nào trong mã nguồn; `google-services.json` không commit.
- Mọi lời gọi API qua `src/lib/api.ts`; lỗi hiển thị bằng `message` tiếng Việt từ backend.
- Chỉ chụp ảnh bằng camera (không chọn từ thư viện) cho selfie và ảnh bằng chứng.
- Chữ tiếng Việt, cỡ chữ lớn, nút to (bảo vệ dùng ngoài trời, máy đời thấp).

## Review Focus

1. **Phiên đăng nhập**: refresh một luồng (không gửi trùng refresh token), máy chờ duyệt / bị thu hồi hiện đúng màn hình, đăng xuất xoá sạch — test ở Task 2.
2. **Hàng đợi offline**: đúng thứ tự, không mất mục khi lỗi mạng, bỏ mục bị từ chối (4xx) nhưng giữ lại để xem — test ở Task 2.

---

### Task 1: Khung dự án `mobile/`, Capacitor Android, CORS backend

**Files:**
- Create: `mobile/package.json`, `mobile/tsconfig.json`, `mobile/vite.config.ts`, `mobile/index.html`, `mobile/postcss.config.js`, `mobile/tailwind.config.js`, `mobile/capacitor.config.ts`, `mobile/.env.example`, `mobile/.gitignore`, `mobile/src/main.tsx`, `mobile/src/index.css`, `mobile/src/config.ts`, `mobile/src/vite-env.d.ts`, `mobile/README.md`
- Modify: `backend/.env.example`, `.gitignore`

- [ ] **Step 1: Tệp dự án**

`mobile/package.json`:
```json
{
  "name": "intelshield-mobile",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "android:sync": "npm run build && npx cap sync android",
    "android:apk": "npm run android:sync && cd android && gradlew.bat assembleDebug"
  },
  "dependencies": {
    "@capacitor/android": "^8.5.0",
    "@capacitor/app": "^8.1.1",
    "@capacitor/camera": "^8.2.0",
    "@capacitor/core": "^8.5.0",
    "@capacitor/device": "^8.0.3",
    "@capacitor/geolocation": "^8.2.0",
    "@capacitor/network": "^8.0.1",
    "@capacitor/preferences": "^8.0.1",
    "@capacitor/push-notifications": "^8.1.2",
    "idb-keyval": "^6.2.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^8.5.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "fake-indexeddb": "^6.0.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

`mobile/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src", "capacitor.config.ts", "vite.config.ts"]
}
```

`mobile/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', target: 'es2020' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

`mobile/index.html`:
```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f766e" />
    <title>IntelShield</title>
  </head>
  <body class="bg-slate-50">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`mobile/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`mobile/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

`mobile/capacitor.config.ts`:
```ts
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * IntelShield — one app for guards, team leaders and managers; screens follow permissions.
 * MOBILE_DEV=1 builds a test APK that may call a plain-HTTP backend on the office LAN;
 * a release build only talks to the HTTPS backend.
 */
const dev = process.env.MOBILE_DEV === '1';

const config: CapacitorConfig = {
  appId: 'io.github.oldcyborg.intelshield',
  appName: 'IntelShield',
  webDir: 'dist',
  android: {
    allowMixedContent: dev,
  },
  server: {
    androidScheme: 'https',
    cleartext: dev,
  },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
```

`mobile/.env.example`:
```
# Địa chỉ API. Máy thật trong mạng LAN: http://<IP máy chạy backend>:3001/api (build bằng MOBILE_DEV=1).
# Bản phát hành: https://<tên miền>/api
VITE_API_BASE=http://localhost:3001/api
```

`mobile/.gitignore`:
```
node_modules
dist
.env
android/app/google-services.json
android/app/build
android/build
android/.gradle
android/local.properties
android/app/release
*.keystore
*.jks
```

`mobile/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`mobile/src/config.ts`:
```ts
/** Where the backend lives. Set at build time (VITE_API_BASE); no trailing slash. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:3001/api').replace(/\/$/, '');
export const APP_VERSION = '0.1.0';
```

`mobile/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { -webkit-tap-highlight-color: transparent; font-size: 17px; }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
.safe-top { padding-top: env(safe-area-inset-top); }
```

`mobile/src/main.tsx` (tạm, Task 3 thay bằng app thật):
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="p-6 text-xl font-semibold text-teal-800">IntelShield</div>
  </React.StrictMode>,
);
```

`mobile/README.md`:
````md
# IntelShield — app di động

Một app cho bảo vệ, đội trưởng, quản lý (giao diện theo quyền). React + Vite + Capacitor 8.

## Chạy thử trên trình duyệt
```bash
cp .env.example .env          # VITE_API_BASE=http://localhost:3001/api
npm install
npm run dev                   # http://localhost:5173 — backend cần CORS_ORIGIN có http://localhost:5173
```

## Build APK thử (Android)
```bash
# máy này: JDK của Android Studio
set JAVA_HOME=D:\Apps\AndroidStudio\jbr
# trỏ API vào máy chạy backend trong LAN, cho phép HTTP
set VITE_API_BASE=http://192.168.1.10:3001/api
set MOBILE_DEV=1
npm run android:apk           # → android/app/build/outputs/apk/debug/app-debug.apk
```
Backend cần `CORS_ORIGIN` có `https://localhost` (origin của app Android).

## Thông báo đẩy
Tải `google-services.json` của dự án Firebase (gói `io.github.oldcyborg.intelshield`) vào `android/app/`.
Không commit tệp này. Thiếu tệp: app vẫn chạy, chỉ không nhận thông báo đẩy (hộp thông báo trong app vẫn có).
````

Gốc kho `.gitignore` thêm: `mobile/node_modules`, `mobile/dist`, `mobile/.env`.

`backend/.env.example`: thay dòng `CORS_ORIGIN=` bằng
```
# Web quản lý, app Android (https://localhost), Vite khi phát triển app (http://localhost:5173)
CORS_ORIGIN=http://localhost:3000,https://localhost,http://localhost:5173
```

- [ ] **Step 2: Cài, build web, thêm Android**

Run:
```bash
cd mobile && npm install && npm run build && npx cap add android
```
Expected: `dist/` có `index.html`; thư mục `mobile/android/` được tạo.

- [ ] **Step 3: Quyền Android**

Trong `mobile/android/app/src/main/AndroidManifest.xml`, ngay sau dòng `<uses-permission android:name="android.permission.INTERNET" />` thêm:
```xml
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
```

- [ ] **Step 4: Build APK thử**

Run (Git Bash):
```bash
cd mobile/android && JAVA_HOME=/d/Apps/AndroidStudio/jbr ./gradlew.bat assembleDebug
```
Expected: `BUILD SUCCESSFUL`, có `app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 5: Commit**

```bash
git add mobile .gitignore backend/.env.example
git commit -m "feat(mobile): IntelShield app skeleton — Vite, React, Tailwind, Capacitor 8 Android"
```

---

### Task 2: Thư viện lõi — API, phiên, hàng đợi offline, thiết bị, camera, GPS, đẩy

**Files:**
- Create: `mobile/src/lib/api.ts`, `mobile/src/lib/session.ts`, `mobile/src/lib/queue.ts`, `mobile/src/lib/device.ts`, `mobile/src/lib/native.ts`, `mobile/src/lib/push.ts`, `mobile/src/lib/format.ts`, `mobile/src/lib/client.ts`
- Test: `mobile/src/lib/api.test.ts`, `mobile/src/lib/queue.test.ts`

**Interfaces:**
- Produces:
  - `class ApiClient(base, store: TokenStore, fetchFn?)` — `.request<T>(path, { method?, json?, body? })`, `.upload(blob, name) → { id }`, `.login(identifier, password, device) → user`, `.logout()`, `.onSignedOut`; `ApiError { code, message, status, details }`, `NetworkError`.
  - Refresh một luồng: nhiều yêu cầu cùng gặp 401 chỉ gửi một lần refresh; yêu cầu mang token cũ sau khi đã refresh thì dùng luôn token mới (không gửi lại refresh token cũ — backend coi là đánh cắp).
  - `class OfflineQueue(api, dbName?)` — `.add({ kind, label, path, json, photos? })`, `.list()`, `.failed()`, `.flush()` → `{ sent, failed, left }`, `.retry(id)`, `.discard(id)`, `.subscribe(fn)`. Ảnh lưu dạng `{ type, data: ArrayBuffer }`; tải lên trước, nhớ id đã tải để gửi lại không tải trùng; lỗi mạng/5xx dừng và giữ nguyên; 4xx chuyển sang danh sách lỗi kèm thông báo.
  - `getDeviceInfo()` → `{ device_id, platform, label }`; `takePhoto('front' | 'rear')` → `Blob`; `getPosition()` → `{ lat, lng, accuracy_m }`; `registerPush(api, onTap)`.
  - `client.ts`: `api` (dùng Preferences) và `queue` dùng chung toàn app.

- [ ] **Step 1: Viết test thất bại**

`mobile/src/lib/api.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, NetworkError, Session, TokenStore } from './api';

class MemoryStore implements TokenStore {
  constructor(public value: Session | null) {}
  async get() { return this.value; }
  async set(s: Session | null) { this.value = s; }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiClient', () => {
  it('sends Bearer and X-Client: mobile, and unwraps {data}', async () => {
    const fetchFn = vi.fn(async () => json(200, { data: { ok: 1 } }));
    const api = new ApiClient('http://x/api', new MemoryStore({ access_token: 'A', refresh_token: 'R' }), fetchFn);
    expect(await api.request('/me')).toEqual({ ok: 1 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://x/api/me');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer A', 'X-Client': 'mobile' });
  });

  it('refreshes once for many requests that hit 401 together, then retries them', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    let refreshes = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return json(200, { data: { access_token: 'new', refresh_token: 'R2' } });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, { data: url }) : json(401, { error: { code: 'AUTH_UNAUTHENTICATED', message: 'x' } });
    });
    const api = new ApiClient('http://x/api', store, fetchFn);
    const results = await Promise.all([api.request('/a'), api.request('/b'), api.request('/c')]);
    expect(results).toEqual(['http://x/api/a', 'http://x/api/b', 'http://x/api/c']);
    expect(refreshes).toBe(1);
    expect(store.value).toEqual({ access_token: 'new', refresh_token: 'R2' });
  });

  it('does not send an old refresh token again after someone else refreshed', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    const sent: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        sent.push(JSON.parse(String(init?.body)).refresh_token);
        return json(200, { data: { access_token: 'new', refresh_token: 'R2' } });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, { data: 1 }) : json(401, { error: { code: 'X', message: 'x' } });
    });
    const api = new ApiClient('http://x/api', store, fetchFn);
    await api.request('/a');
    // A request that read the old token before the refresh finished gets a 401 now:
    store.value = { access_token: 'new', refresh_token: 'R2' };
    await (api as unknown as { refresh: (used: string) => Promise<boolean> }).refresh('R1');
    expect(sent).toEqual(['R1']);
  });

  it('signs out when the refresh is refused', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh') ? json(401, { error: { code: 'AUTH_REFRESH_INVALID', message: 'x' } }) : json(401, { error: { code: 'X', message: 'x' } }));
    const api = new ApiClient('http://x/api', store, fetchFn);
    const signedOut = vi.fn();
    api.onSignedOut = signedOut;
    await expect(api.request('/a')).rejects.toBeInstanceOf(ApiError);
    expect(store.value).toBeNull();
    expect(signedOut).toHaveBeenCalled();
  });

  it('turns error envelopes into ApiError and a dead network into NetworkError', async () => {
    const api = new ApiClient('http://x/api', new MemoryStore(null), vi.fn(async () => json(400, { error: { code: 'DEVICE_PENDING', message: 'Máy chờ duyệt', details: [1] } })));
    await expect(api.request('/auth/login', { json: {} })).rejects.toMatchObject({ code: 'DEVICE_PENDING', message: 'Máy chờ duyệt', status: 400, details: [1] });
    const offline = new ApiClient('http://x/api', new MemoryStore(null), vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(offline.request('/x')).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps the tokens from login and forgets them on logout', async () => {
    const store = new MemoryStore(null);
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/auth/login') ? json(200, { data: { access_token: 'A', refresh_token: 'R', user: { id: 'u' } } }) : json(200, { data: { ok: true } }));
    const api = new ApiClient('http://x/api', store, fetchFn);
    expect(await api.login('0900', 'pw', { device_id: 'd1', platform: 'android', label: 'Pixel' })).toEqual({ id: 'u' });
    expect(store.value).toEqual({ access_token: 'A', refresh_token: 'R' });
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ identifier: '0900', password: 'pw', device_id: 'd1', platform: 'android', device_label: 'Pixel' });
    await api.logout();
    expect(store.value).toBeNull();
  });
});
```

`mobile/src/lib/queue.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './api';
import { OfflineQueue } from './queue';

let n = 0;
const fresh = (api: object) => new OfflineQueue(api as never, `test-queue-${++n}`);
const photo = () => ({ type: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff]).buffer });

describe('OfflineQueue', () => {
  it('sends in the order things happened', async () => {
    const sent: string[] = [];
    const q = fresh({ request: vi.fn(async (path: string) => { sent.push(path); return {}; }), upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    await q.add({ kind: 'scan', label: 'B', path: '/b', json: {} });
    expect(await q.flush()).toEqual({ sent: 2, failed: 0, left: 0 });
    expect(sent).toEqual(['/a', '/b']);
    expect(await q.list()).toEqual([]);
  });

  it('stops at the first network failure and keeps everything', async () => {
    const request = vi.fn(async () => { throw new NetworkError(); });
    const q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    await q.add({ kind: 'scan', label: 'B', path: '/b', json: {} });
    expect(await q.flush()).toEqual({ sent: 0, failed: 0, left: 2 });
    expect(request).toHaveBeenCalledTimes(1);
    expect((await q.list()).map((i) => i.label)).toEqual(['A', 'B']);
  });

  it('sets aside what the server refuses, with its reason, and goes on', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/bad') throw new ApiError('PATROL_ROUND_CLOSED', 'Đã quá giờ của vòng tuần này', 409);
      return {};
    });
    const q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'Bad', path: '/bad', json: {} });
    await q.add({ kind: 'scan', label: 'Good', path: '/good', json: {} });
    expect(await q.flush()).toEqual({ sent: 1, failed: 1, left: 0 });
    const [f] = await q.failed();
    expect(f).toMatchObject({ label: 'Bad', error: 'Đã quá giờ của vòng tuần này' });
    await q.discard(f.id);
    expect(await q.failed()).toEqual([]);
  });

  it('waits on server errors (5xx) like on a dead network', async () => {
    const q = fresh({ request: vi.fn(async () => { throw new ApiError('INTERNAL_ERROR', 'x', 500); }), upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    expect(await q.flush()).toEqual({ sent: 0, failed: 0, left: 1 });
  });

  it('uploads photos first, once, and puts their ids where they belong', async () => {
    let fail = true;
    const bodies: Record<string, unknown>[] = [];
    const upload = vi.fn(async () => ({ id: `f${upload.mock.calls.length}` }));
    const request = vi.fn(async (_path: string, init: { json: Record<string, unknown> }) => {
      if (fail) throw new NetworkError();
      bodies.push(init.json);
      return {};
    });
    const q = fresh({ request, upload });
    await q.add({ kind: 'incident', label: 'Sự cố', path: '/incidents', json: { description: 'x' }, photos: [{ field: 'file_ids', many: true, files: [photo(), photo()] }] });
    await q.add({ kind: 'scan', label: 'Điểm', path: '/scan', json: {}, photos: [{ field: 'photo_file_id', many: false, files: [photo()] }] });
    await q.flush();
    expect(upload).toHaveBeenCalledTimes(2);
    fail = false;
    await q.flush();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(bodies).toEqual([{ description: 'x', file_ids: ['f1', 'f2'] }, { photo_file_id: 'f3' }]);
  });

  it('runs one flush at a time', async () => {
    const request = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return {}; });
    const q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    await Promise.all([q.flush(), q.flush()]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd mobile && npm test`
Expected: FAIL — không có `./api`, `./queue`.

- [ ] **Step 3: API và phiên**

`mobile/src/lib/api.ts`:
```ts
export interface Session {
  access_token: string;
  refresh_token: string;
}

export interface TokenStore {
  get(): Promise<Session | null>;
  set(session: Session | null): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** No connection, or the server could not be reached at all. */
export class NetworkError extends Error {
  constructor() {
    super('Không có mạng — sẽ gửi lại khi có sóng');
  }
}

type Init = { method?: string; json?: unknown; body?: FormData };
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;
  onSignedOut?: () => void;

  constructor(
    private readonly base: string,
    private readonly store: TokenStore,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  async request<T = unknown>(path: string, init: Init = {}, retry = true): Promise<T> {
    const session = await this.store.get();
    const headers: Record<string, string> = { 'X-Client': 'mobile' };
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    if (session) headers.Authorization = `Bearer ${session.access_token}`;
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method: init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET'),
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401 && retry && session && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
      if (await this.refresh(session.refresh_token)) return this.request<T>(path, init, false);
      await this.signOut();
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Có lỗi xảy ra', res.status, body?.error?.details);
    return body.data as T;
  }

  /**
   * One refresh for everyone who hit 401 at once. A request that read the token before another refresh
   * finished just retries with the new one: presenting a used refresh token again ends the session.
   */
  private refresh(used: string): Promise<boolean> {
    // Claimed synchronously: two callers in the same tick must share one refresh.
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const now = await this.store.get();
        if (now && now.refresh_token !== used) return true;
        const res = await this.fetchFn(`${this.base}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
          body: JSON.stringify({ refresh_token: used }),
        });
        if (!res.ok) return false;
        const body = await res.json();
        await this.store.set({ access_token: body.data.access_token, refresh_token: body.data.refresh_token });
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async login<U>(identifier: string, password: string, device: { device_id: string; platform: string; label: string }): Promise<U> {
    const data = await this.request<Session & { user: U }>('/auth/login', {
      json: { identifier, password, device_id: device.device_id, platform: device.platform, device_label: device.label },
    });
    await this.store.set({ access_token: data.access_token, refresh_token: data.refresh_token });
    return data.user;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' }, false);
    } catch {
      // Signing out locally matters more than telling the server.
    }
    await this.store.set(null);
  }

  async upload(file: Blob, name: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append('file', file, name);
    return this.request('/files', { body: form });
  }

  async hasSession(): Promise<boolean> {
    return Boolean(await this.store.get());
  }

  private async signOut() {
    await this.store.set(null);
    this.onSignedOut?.();
  }
}
```

`mobile/src/lib/session.ts`:
```ts
import { Preferences } from '@capacitor/preferences';
import { Session, TokenStore } from './api';

const KEY = 'intelshield.session';

/** Tokens in the app's private storage (Android SharedPreferences), never in the web page's localStorage. */
export const preferencesStore: TokenStore = {
  async get() {
    const { value } = await Preferences.get({ key: KEY });
    return value ? (JSON.parse(value) as Session) : null;
  },
  async set(session) {
    if (session) await Preferences.set({ key: KEY, value: JSON.stringify(session) });
    else await Preferences.remove({ key: KEY });
  },
};
```

- [ ] **Step 4: Hàng đợi offline**

`mobile/src/lib/queue.ts`:
```ts
import { createStore, get, set, UseStore } from 'idb-keyval';
import { ApiClient, ApiError, NetworkError } from './api';

export interface StoredPhoto {
  type: string;
  data: ArrayBuffer;
}

export interface PhotoSlot {
  /** Field of the request that receives the uploaded ids. */
  field: string;
  /** true: an array of ids (file_ids); false: one id (photo_file_id). */
  many: boolean;
  files: StoredPhoto[];
  /** Ids already uploaded, so a resend never uploads twice. */
  uploaded?: string[];
}

export interface QueueItem {
  id: string;
  kind: string;
  label: string;
  path: string;
  json: Record<string, unknown>;
  photos?: PhotoSlot[];
  created_at: string;
  attempts: number;
  error?: string;
}

type Api = Pick<ApiClient, 'request' | 'upload'>;
type NewItem = Omit<QueueItem, 'id' | 'created_at' | 'attempts' | 'error'>;

const uuid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));

/**
 * What was done without signal, kept on the phone and sent in the order it happened.
 * A dead network or a server error stops the run and keeps everything; a refusal (4xx) is set aside with its reason.
 */
export class OfflineQueue {
  private readonly db: UseStore;
  private running: Promise<{ sent: number; failed: number; left: number }> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly api: Api,
    dbName = 'intelshield-queue',
  ) {
    this.db = createStore(dbName, 'items');
  }

  async list(): Promise<QueueItem[]> {
    return (await get<QueueItem[]>('pending', this.db)) ?? [];
  }

  async failed(): Promise<QueueItem[]> {
    return (await get<QueueItem[]>('failed', this.db)) ?? [];
  }

  async add(item: NewItem): Promise<QueueItem> {
    const full: QueueItem = { ...item, id: uuid(), created_at: new Date().toISOString(), attempts: 0 };
    await set('pending', [...(await this.list()), full], this.db);
    this.emit();
    return full;
  }

  flush(): Promise<{ sent: number; failed: number; left: number }> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  async retry(id: string): Promise<void> {
    const failed = await this.failed();
    const item = failed.find((i) => i.id === id);
    if (!item) return;
    await set('failed', failed.filter((i) => i.id !== id), this.db);
    await set('pending', [...(await this.list()), { ...item, error: undefined }], this.db);
    this.emit();
  }

  async discard(id: string): Promise<void> {
    await set('failed', (await this.failed()).filter((i) => i.id !== id), this.db);
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async run() {
    let sent = 0;
    let failed = 0;
    for (;;) {
      const [item] = await this.list();
      if (!item) break;
      try {
        const json = { ...item.json };
        for (const slot of item.photos ?? []) {
          const ids = slot.uploaded ?? [];
          for (let i = ids.length; i < slot.files.length; i++) {
            const f = slot.files[i];
            const { id } = await this.api.upload(new Blob([f.data], { type: f.type }), `photo-${i + 1}.jpg`);
            ids.push(id);
            slot.uploaded = ids;
            await this.replaceHead(item);
          }
          json[slot.field] = slot.many ? ids : ids[0];
        }
        await this.api.request(item.path, { json });
        await this.dropHead();
        sent += 1;
      } catch (error) {
        if (error instanceof NetworkError || (error instanceof ApiError && error.status >= 500)) {
          item.attempts += 1;
          await this.replaceHead(item);
          break;
        }
        const reason = error instanceof Error ? error.message : 'Lỗi không rõ';
        await this.dropHead();
        await set('failed', [...(await this.failed()), { ...item, error: reason }], this.db);
        failed += 1;
      }
      this.emit();
    }
    this.emit();
    return { sent, failed, left: (await this.list()).length };
  }

  private async replaceHead(item: QueueItem) {
    const [, ...rest] = await this.list();
    await set('pending', [item, ...rest], this.db);
  }

  private async dropHead() {
    const [, ...rest] = await this.list();
    await set('pending', rest, this.db);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/** A photo Blob as the queue keeps it (IndexedDB stores ArrayBuffers on every WebView). */
export async function storePhoto(blob: Blob): Promise<StoredPhoto> {
  return { type: blob.type || 'image/jpeg', data: await blob.arrayBuffer() };
}

export { uuid as newClientId };
```

- [ ] **Step 5: Thiết bị, camera, GPS, đẩy, định dạng, client dùng chung**

`mobile/src/lib/device.ts`:
```ts
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

/** The phone's identity as the backend binds it: one approved phone per guard. */
export async function getDeviceInfo(): Promise<{ device_id: string; platform: string; label: string }> {
  const [{ identifier }, info] = await Promise.all([Device.getId(), Device.getInfo()]);
  return {
    device_id: identifier,
    platform: Capacitor.getPlatform(),
    label: [info.manufacturer, info.model].filter(Boolean).join(' ') || 'Máy không rõ tên',
  };
}
```

`mobile/src/lib/native.ts`:
```ts
import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

/**
 * A photo taken now with the camera — never picked from the gallery. On a phone this is the native camera;
 * in a browser (development) an <input capture> stands in.
 */
export async function takePhoto(side: 'front' | 'rear'): Promise<Blob> {
  if (!Capacitor.isNativePlatform()) return pickInBrowser(side);
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    direction: side === 'front' ? CameraDirection.Front : CameraDirection.Rear,
    resultType: CameraResultType.Uri,
    quality: 60,
    width: 1280,
    allowEditing: false,
    saveToGallery: false,
  });
  return (await fetch(photo.webPath!)).blob();
}

function pickInBrowser(side: 'front' | 'rear'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png';
    input.setAttribute('capture', side === 'front' ? 'user' : 'environment');
    input.onchange = () => (input.files?.[0] ? resolve(input.files[0]) : reject(new Error('Chưa chụp ảnh')));
    input.click();
  });
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number;
}

/** Where the phone is now. Asks for permission the first time; fails with a message the guard can act on. */
export async function getPosition(): Promise<Fix> {
  if (Capacitor.isNativePlatform()) {
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted') {
      const asked = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (asked.location !== 'granted') throw new Error('Cần cho phép IntelShield dùng vị trí (Cài đặt → Ứng dụng → IntelShield → Quyền)');
    }
  }
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) };
  } catch {
    throw new Error('Chưa lấy được vị trí — bật GPS và đứng ở chỗ thoáng rồi thử lại');
  }
}
```

`mobile/src/lib/push.ts`:
```ts
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { ApiClient } from './api';

/**
 * Phone notifications through Firebase. Without google-services.json in the build the registration fails
 * quietly: the in-app inbox still works. `onTap` gets the notification's data to open the right screen.
 */
export async function registerPush(api: ApiClient, onTap: (data: Record<string, string>) => void, onArrive: () => void): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;
    await PushNotifications.createChannel({ id: 'critical', name: 'Khẩn cấp — SOS', importance: 5, visibility: 1, vibration: true, sound: 'default' });
    await PushNotifications.createChannel({ id: 'default', name: 'Thông báo', importance: 3, visibility: 1 });
    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener('registration', (t) => {
      api.request('/me/push-token', { json: { token: t.value } }).catch(() => undefined);
    });
    await PushNotifications.addListener('pushNotificationReceived', () => onArrive());
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => onTap((a.notification.data ?? {}) as Record<string, string>));
    await PushNotifications.register();
  } catch {
    // No Firebase configuration in this build: in-app notifications only.
  }
}
```

`mobile/src/lib/format.ts`:
```ts
const TZ = 'Asia/Ho_Chi_Minh';

export const time = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

export const day = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso));

export const stamp = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

/** YYYY-MM-DD in Vietnam, `offset` days from today. */
export const localDate = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offset * 86_400_000));

export const FLAG_LABEL: Record<string, string> = {
  outside_geofence: 'ngoài khu vực mục tiêu',
  mock_location: 'vị trí giả',
  clock_skew: 'giờ máy lệch',
  low_accuracy: 'GPS kém',
};
```

`mobile/src/lib/client.ts`:
```ts
import { API_BASE } from '../config';
import { ApiClient } from './api';
import { OfflineQueue } from './queue';
import { preferencesStore } from './session';

export const api = new ApiClient(API_BASE, preferencesStore);
export const queue = new OfflineQueue(api);
```

- [ ] **Step 6: Chạy test để thấy đạt, commit**

Run: `cd mobile && npm test && npm run build`
Expected: PASS — `api` 6, `queue` 6; build thành công.

```bash
git add mobile
git commit -m "feat(mobile): API client with single-flight refresh, offline queue with photos, device, camera, GPS and push helpers"
```

---

### Task 3: Đăng nhập, máy chờ duyệt, đổi mật khẩu, khung app, thông báo, trang Tôi

**Files:**
- Create: `mobile/src/lib/auth.tsx`, `mobile/src/lib/unread.tsx`, `mobile/src/components/ui.tsx`, `mobile/src/components/Layout.tsx`, `mobile/src/screens/Login.tsx`, `mobile/src/screens/ChangePassword.tsx`, `mobile/src/screens/Notifications.tsx`, `mobile/src/screens/Me.tsx`, `mobile/src/App.tsx`
- Modify: `mobile/src/main.tsx`

**Interfaces:**
- Produces:
  - `AuthProvider` / `useAuth()` → `{ state: 'loading' | 'out' | 'in', me, login(phone, password), logout(), reload(), can(permission) }`. Lỗi đăng nhập `DEVICE_PENDING` → màn "Máy đang chờ duyệt" (thử lại, dùng tài khoản khác); `DEVICE_REVOKED` → thông báo liên hệ HR. Hết phiên (refresh bị từ chối) → về màn đăng nhập.
  - `must_change_password` → bắt đổi mật khẩu trước khi vào app.
  - Khung: thanh tab dưới `Ca trực` · `Thông báo` (số chưa đọc) · `Tôi`; khi đã đăng nhập: đăng ký đẩy, gửi hàng đợi khi có mạng / khi mở lại app / mỗi phút.

- [ ] **Step 1: Ngữ cảnh đăng nhập và số chưa đọc**

`mobile/src/lib/auth.tsx`:
```tsx
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import { getDeviceInfo } from './device';

export interface Me {
  user: { id: string; full_name: string; phone: string | null; employee_id: string | null; must_change_password: boolean };
  permissions: string[];
  device: { device_id: string; platform: string | null; status: string } | null;
}

interface AuthValue {
  state: 'loading' | 'out' | 'in';
  me: Me | null;
  login(phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  can(permission: string): boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<AuthValue['state']>('loading');

  const reload = useCallback(async () => {
    if (!(await api.hasSession())) {
      setMe(null);
      setState('out');
      return;
    }
    try {
      setMe(await api.request<Me>('/auth/me'));
      setState('in');
    } catch {
      setMe(null);
      setState('out');
    }
  }, []);

  useEffect(() => {
    api.onSignedOut = () => {
      setMe(null);
      setState('out');
    };
    void reload();
  }, [reload]);

  const value = useMemo<AuthValue>(() => ({
    state,
    me,
    reload,
    async login(phone, password) {
      await api.login(phone.trim(), password, await getDeviceInfo());
      await reload();
    },
    async logout() {
      await api.logout();
      setMe(null);
      setState('out');
    },
    can: (permission) => Boolean(me?.permissions.includes(permission)),
  }), [state, me, reload]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth outside AuthProvider');
  return value;
}
```

`mobile/src/lib/unread.tsx`:
```tsx
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './client';

interface UnreadValue {
  unread: number;
  refresh(): Promise<void>;
}

const UnreadContext = createContext<UnreadValue>({ unread: 0, refresh: async () => undefined });

/** Unread notifications for the tab badge: polled every 30 s and refreshed when a push arrives. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      setUnread((await api.request<{ unread: number }>('/me/notifications?unread=true')).unread);
    } catch {
      // Offline: keep the last count.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return <UnreadContext.Provider value={{ unread, refresh }}>{children}</UnreadContext.Provider>;
}

export const useUnread = () => useContext(UnreadContext);
```

- [ ] **Step 2: Thành phần giao diện và khung**

`mobile/src/components/ui.tsx`:
```tsx
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

const TONE = {
  primary: 'bg-teal-700 text-white active:bg-teal-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 active:bg-slate-100',
  danger: 'bg-red-600 text-white active:bg-red-700',
};

export function Button({ tone = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONE }) {
  return <button {...props} className={`w-full rounded-xl px-4 py-3.5 text-lg font-semibold disabled:opacity-50 ${TONE[tone]} ${className}`} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg ${className}`} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="rounded-lg bg-red-50 p-3 text-base text-red-700">{error}</p> : null;
}

export function Screen({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="min-h-full pb-24">
      <header className="safe-top sticky top-0 z-10 flex items-center justify-between bg-teal-800 px-4 py-3 text-white">
        <h1 className="text-xl font-semibold">{title}</h1>
        {action}
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}
```

`mobile/src/components/Layout.tsx`:
```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useUnread } from '../lib/unread';

const TABS = [
  { to: '/', label: 'Ca trực', icon: '🕘' },
  { to: '/thong-bao', label: 'Thông báo', icon: '🔔' },
  { to: '/toi', label: 'Tôi', icon: '👤' },
];

export function Layout() {
  const { unread } = useUnread();
  return (
    <div className="h-full">
      <Outlet />
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-slate-200 bg-white">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end className={({ isActive }) => `relative flex flex-col items-center py-2 text-sm ${isActive ? 'text-teal-700 font-semibold' : 'text-slate-500'}`}>
            <span className="text-2xl" aria-hidden>{t.icon}</span>
            {t.label}
            {t.to === '/thong-bao' && unread > 0 && (
              <span className="absolute right-[30%] top-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{unread > 99 ? '99+' : unread}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 3: Đăng nhập và đổi mật khẩu**

`mobile/src/screens/Login.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Login() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<'pending' | 'revoked' | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEVICE_PENDING') setDevice('pending');
      else if (err instanceof ApiError && err.code === 'DEVICE_REVOKED') setDevice('revoked');
      else setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (device) {
    return (
      <div className="safe-top flex min-h-full flex-col justify-center gap-4 p-6">
        <div className="text-5xl">{device === 'pending' ? '⏳' : '⛔'}</div>
        <h1 className="text-2xl font-semibold">{device === 'pending' ? 'Máy này đang chờ duyệt' : 'Máy này đã bị thu hồi'}</h1>
        <p className="text-lg text-slate-600">
          {device === 'pending'
            ? 'Mỗi bảo vệ chỉ dùng một điện thoại. Báo HR hoặc đội trưởng duyệt máy mới trên trang Thiết bị, rồi bấm Thử lại.'
            : 'Liên hệ HR để được duyệt lại máy, hoặc đăng nhập bằng điện thoại đã được duyệt.'}
        </p>
        <ErrorText error={error} />
        {device === 'pending' && <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Thử lại'}</Button>}
        <Button tone="secondary" onClick={() => { setDevice(null); setPassword(''); }}>Dùng tài khoản khác</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="safe-top flex min-h-full flex-col justify-center gap-4 p-6">
      <div className="mb-4 text-center">
        <div className="text-5xl">🛡️</div>
        <h1 className="mt-2 text-3xl font-bold text-teal-800">IntelShield</h1>
        <p className="text-slate-500">Bảo vệ · Tuần tra · Sự cố</p>
      </div>
      <Field label="Số điện thoại"><Input type="tel" inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} required /></Field>
      <Field label="Mật khẩu"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      <ErrorText error={error} />
      <Button type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
      <p className="text-center text-sm text-slate-500">Quên mật khẩu: nhờ HR hoặc đội trưởng đặt lại.</p>
    </form>
  );
}
```

`mobile/src/screens/ChangePassword.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorText, Field, Input, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';

/** Forced on first sign-in with a password someone else set; also reachable from the "Tôi" tab. */
export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { reload, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== again) return setError('Hai lần nhập mật khẩu mới không khớp');
    if (next.length < 8) return setError('Mật khẩu mới cần ít nhất 8 ký tự');
    setBusy(true);
    setError(null);
    try {
      await api.request('/auth/change-password', { json: { current_password: current, new_password: next } });
      await reload();
      if (!forced) navigate('/toi');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Đổi mật khẩu">
      {forced && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">Bạn đang dùng mật khẩu do người khác đặt. Đổi mật khẩu của riêng bạn để tiếp tục.</p>}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Mật khẩu hiện tại"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
        <Field label="Mật khẩu mới (ít nhất 8 ký tự)"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
        <Field label="Nhập lại mật khẩu mới"><Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy}>Lưu mật khẩu</Button>
        {forced && <Button type="button" tone="secondary" onClick={() => void logout()}>Đăng xuất</Button>}
      </form>
    </Screen>
  );
}
```

- [ ] **Step 4: Thông báo và trang Tôi**

`mobile/src/screens/Notifications.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { stamp } from '../lib/format';
import { useUnread } from '../lib/unread';

interface Item {
  id: string;
  type: string;
  title: string;
  body: string | null;
  priority: 'normal' | 'high' | 'critical';
  read_at: string | null;
  created_at: string;
}

export function Notifications() {
  const { refresh } = useUnread();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.request<{ items: Item[] }>('/me/notifications')).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function read(n: Item) {
    setOpen(open === n.id ? null : n.id);
    if (!n.read_at) {
      await api.request(`/me/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
      await Promise.all([load(), refresh()]);
    }
  }

  return (
    <Screen
      title="Thông báo"
      action={items.some((n) => !n.read_at) ? (
        <button className="text-sm underline" onClick={async () => { await api.request('/me/notifications/read-all', { method: 'POST' }).catch(() => undefined); await Promise.all([load(), refresh()]); }}>Đọc hết</button>
      ) : undefined}
    >
      <ErrorText error={error} />
      {items.map((n) => (
        <Card key={n.id} className={n.priority === 'critical' && !n.read_at ? 'border-red-400 bg-red-50' : ''}>
          <button className="w-full text-left" onClick={() => void read(n)}>
            <div className={`text-lg ${n.read_at ? 'text-slate-600' : 'font-semibold'}`}>{n.priority === 'critical' && '🚨 '}{n.title}</div>
            <div className="text-sm text-slate-400">{stamp(n.created_at)}</div>
            {(open === n.id || !n.read_at) && n.body && <p className="mt-1 text-base text-slate-700">{n.body}</p>}
          </button>
        </Card>
      ))}
      {!items.length && !error && <p className="py-10 text-center text-slate-400">Chưa có thông báo</p>}
    </Screen>
  );
}
```

`mobile/src/screens/Me.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Screen } from '../components/ui';
import { API_BASE, APP_VERSION } from '../config';
import { useAuth } from '../lib/auth';
import { queue } from '../lib/client';
import { stamp } from '../lib/format';
import { QueueItem } from '../lib/queue';

export function Me() {
  const { me, logout } = useAuth();
  const [pending, setPending] = useState<QueueItem[]>([]);
  const [failed, setFailed] = useState<QueueItem[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setPending(await queue.list());
    setFailed(await queue.failed());
  }, []);
  useEffect(() => {
    void load();
    return queue.subscribe(() => void load());
  }, [load]);

  if (!me) return null;
  return (
    <Screen title="Tôi">
      <Card>
        <div className="text-xl font-semibold">{me.user.full_name}</div>
        <div className="text-slate-500">{me.user.phone}</div>
        <div className="mt-2 text-sm text-slate-500">Máy: {me.device ? (me.device.status === 'active' ? 'đã duyệt' : me.device.status) : 'chưa gắn máy'}</div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <b>Chờ gửi khi có mạng</b>
          <span className={pending.length ? 'font-semibold text-amber-700' : 'text-slate-400'}>{pending.length} mục</span>
        </div>
        {pending.map((i) => <div key={i.id} className="mt-1 text-sm text-slate-600">{i.label} · {stamp(i.created_at)}</div>)}
        {pending.length > 0 && (
          <Button tone="secondary" className="mt-3" disabled={sending} onClick={async () => { setSending(true); await queue.flush(); setSending(false); }}>
            {sending ? 'Đang gửi…' : 'Gửi ngay'}
          </Button>
        )}
        {failed.length > 0 && (
          <div className="mt-3 space-y-2">
            <b className="text-red-700">Không gửi được</b>
            {failed.map((i) => (
              <div key={i.id} className="rounded-lg bg-red-50 p-2 text-sm">
                <div>{i.label} · {stamp(i.created_at)}</div>
                <div className="text-red-700">{i.error}</div>
                <div className="mt-1 flex gap-2">
                  <button className="underline" onClick={() => void queue.retry(i.id)}>Gửi lại</button>
                  <button className="underline" onClick={() => window.confirm('Bỏ mục này?') && void queue.discard(i.id)}>Bỏ</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Link to="/doi-mat-khau" className="block"><Button tone="secondary">Đổi mật khẩu</Button></Link>
      <Button tone="danger" onClick={() => window.confirm('Đăng xuất khỏi máy này?') && void logout()}>Đăng xuất</Button>
      <p className="pt-2 text-center text-xs text-slate-400">IntelShield {APP_VERSION} · {API_BASE}</p>
    </Screen>
  );
}
```

- [ ] **Step 5: App và điểm vào**

`mobile/src/App.tsx`:
```tsx
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { api, queue } from './lib/client';
import { registerPush } from './lib/push';
import { UnreadProvider, useUnread } from './lib/unread';
import { Check } from './screens/Check';
import { ChangePassword } from './screens/ChangePassword';
import { Login } from './screens/Login';
import { Me } from './screens/Me';
import { Notifications } from './screens/Notifications';
import { Shifts } from './screens/Shifts';

/** While signed in: push registration, and the offline queue sent whenever there is a chance. */
function Background() {
  const navigate = useNavigate();
  const { refresh } = useUnread();
  useEffect(() => {
    void registerPush(api, () => navigate('/thong-bao'), () => void refresh());
    void queue.flush();
    const timer = setInterval(() => void queue.flush(), 60_000);
    const net = Network.addListener('networkStatusChange', (s) => { if (s.connected) void queue.flush(); });
    const resume = CapApp.addListener('resume', () => { void queue.flush(); void refresh(); });
    return () => {
      clearInterval(timer);
      void net.then((h) => h.remove());
      void resume.then((h) => h.remove());
    };
  }, [navigate, refresh]);
  return null;
}

function Gate() {
  const { state, me } = useAuth();
  if (state === 'loading') return <div className="flex h-full items-center justify-center text-4xl">🛡️</div>;
  if (state === 'out' || !me) return <Login />;
  if (me.user.must_change_password) return <ChangePassword forced />;
  return (
    <UnreadProvider>
      <Background />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Shifts />} />
          <Route path="/thong-bao" element={<Notifications />} />
          <Route path="/toi" element={<Me />} />
        </Route>
        <Route path="/check/:id/:way" element={<Check />} />
        <Route path="/doi-mat-khau" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </UnreadProvider>
  );
}

export function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  );
}
```

`mobile/src/main.tsx` (thay toàn bộ):
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

(Build ở Task 4, vì `App.tsx` dùng `Shifts` và `Check`.)

---

### Task 4: Ca trực, vào ca / ra ca bằng selfie + GPS

**Files:**
- Create: `mobile/src/screens/Shifts.tsx`, `mobile/src/screens/Check.tsx`

**Interfaces:**
- Consumes: `GET /api/me/shifts?from&to`, `POST /api/files`, `POST /api/attendance/check-in|check-out`.
- Produces: màn `Ca trực` (hôm qua → ngày mai, ca đang/sắp diễn ra lên đầu, nút Vào ca khi từ 60 phút trước giờ vào đến hết ca, Ra ca khi đã vào và chưa quá 6 giờ sau giờ ra); màn `/check/:id/in|out`: chụp selfie camera trước → lấy GPS (hiện độ chính xác) → gửi → kết quả (giờ, trễ, cờ nghi vấn).

- [ ] **Step 1: Ca trực**

`mobile/src/screens/Shifts.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { day, localDate, time } from '../lib/format';

interface Shift {
  id: string;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  site_name: string;
  site_address: string | null;
  template_name: string | null;
  attendance: { check_in_at: string | null; check_out_at: string | null; late_minutes: number | null } | null;
}

const HOUR = 3_600_000;

/** What the guard can do with this shift right now (same windows as the backend). */
function nextStep(s: Shift, now: number): 'in' | 'out' | null {
  const start = new Date(s.planned_start).getTime();
  const end = new Date(s.planned_end).getTime();
  if (!s.attendance?.check_in_at) return now >= start - HOUR && now <= end ? 'in' : null;
  if (!s.attendance.check_out_at) return now <= end + 6 * HOUR ? 'out' : null;
  return null;
}

export function Shifts() {
  const navigate = useNavigate();
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setShifts(await api.request<Shift[]>(`/me/shifts?from=${localDate(-1)}&to=${localDate(1)}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const now = Date.now();
  const live = (shifts ?? []).filter((s) => new Date(s.planned_end).getTime() + 6 * HOUR > now);
  const past = (shifts ?? []).filter((s) => !live.includes(s));

  return (
    <Screen title="Ca trực" action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      <ErrorText error={error} />
      {shifts && !shifts.length && <p className="py-10 text-center text-slate-500">Bạn chưa được xếp ca nào từ hôm qua tới ngày mai.</p>}
      {live.map((s) => {
        const step = nextStep(s, now);
        const a = s.attendance;
        return (
          <Card key={s.id} className={step ? 'border-teal-400' : ''}>
            <div className="text-sm capitalize text-slate-500">{day(s.planned_start)}</div>
            <div className="text-2xl font-semibold">{time(s.planned_start)} – {time(s.planned_end)}</div>
            <div className="text-lg">{s.site_name}{s.template_name ? ` · ${s.template_name}` : ''}</div>
            {s.site_address && <div className="text-sm text-slate-500">{s.site_address}</div>}
            {a?.check_in_at && (
              <div className="mt-2 text-base">
                Vào ca {time(a.check_in_at)}{a.late_minutes ? <span className="text-amber-700"> (trễ {a.late_minutes} phút)</span> : null}
                {a.check_out_at && <> · Ra ca {time(a.check_out_at)}</>}
              </div>
            )}
            {step && (
              <Button className="mt-3" tone={step === 'in' ? 'primary' : 'secondary'} onClick={() => navigate(`/check/${s.id}/${step}`)}>
                {step === 'in' ? 'Vào ca' : 'Ra ca'}
              </Button>
            )}
          </Card>
        );
      })}
      {past.length > 0 && <h2 className="pt-2 text-sm font-semibold uppercase text-slate-400">Đã qua</h2>}
      {past.map((s) => (
        <Card key={s.id} className="opacity-70">
          <div className="text-sm capitalize text-slate-500">{day(s.planned_start)}</div>
          <div className="text-lg">{time(s.planned_start)} – {time(s.planned_end)} · {s.site_name}</div>
          <div className="text-sm text-slate-500">{s.attendance?.check_in_at ? `Vào ${time(s.attendance.check_in_at)}${s.attendance.check_out_at ? ` · Ra ${time(s.attendance.check_out_at)}` : ''}` : 'Không vào ca'}</div>
        </Card>
      ))}
    </Screen>
  );
}
```

- [ ] **Step 2: Vào ca / ra ca**

`mobile/src/screens/Check.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { FLAG_LABEL, time } from '../lib/format';
import { Fix, getPosition, takePhoto } from '../lib/native';

interface Result {
  check_in_at?: string;
  check_out_at?: string | null;
  late_minutes?: number;
  early_minutes?: number | null;
  check_in_flags?: string[];
  check_out_flags?: string[] | null;
}

/** Selfie with the front camera, the phone's position, then one request. Needs the network: the server's clock decides. */
export function Check() {
  const { id, way } = useParams<{ id: string; way: 'in' | 'out' }>();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const label = way === 'in' ? 'Vào ca' : 'Ra ca';

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function shoot() {
    setError(null);
    try {
      const blob = await takePhoto('front');
      setPhoto(blob);
      setPreview(URL.createObjectURL(blob));
      setFix(null);
      setFix(await getPosition());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không chụp được ảnh');
    }
  }

  async function send() {
    if (!photo || !fix) return;
    setBusy(true);
    setError(null);
    try {
      const { id: selfie } = await api.upload(photo, 'selfie.jpg');
      setResult(await api.request<Result>(`/attendance/check-${way}`, {
        json: { assignment_id: id, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, device_time: new Date().toISOString(), selfie_file_id: selfie, mock_location: false },
      }));
    } catch (err) {
      setError(err instanceof NetworkError ? 'Không có mạng. Vào/ra ca cần mạng — thử lại khi có sóng.' : err instanceof Error ? err.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const flags = (way === 'in' ? result.check_in_flags : result.check_out_flags) ?? [];
    return (
      <Screen title={label}>
        <Card className="text-center">
          <div className="text-5xl">✅</div>
          <div className="mt-2 text-2xl font-semibold">{label} lúc {time(way === 'in' ? result.check_in_at : result.check_out_at)}</div>
          {way === 'in' && result.late_minutes ? <div className="text-lg text-amber-700">Trễ {result.late_minutes} phút</div> : null}
          {flags.length > 0 && <div className="mt-2 text-base text-red-700">Lưu ý: {flags.map((f) => FLAG_LABEL[f] ?? f).join(', ')}</div>}
        </Card>
        <Button onClick={() => navigate('/')}>Về ca trực</Button>
      </Screen>
    );
  }

  return (
    <Screen title={label} action={<button className="text-sm underline" onClick={() => navigate(-1)}>Huỷ</button>}>
      <Card>
        <div className="text-lg font-semibold">1. Chụp ảnh khuôn mặt</div>
        {preview ? <img src={preview} alt="" className="mt-2 aspect-square w-full rounded-xl object-cover" /> : <p className="text-slate-500">Dùng camera trước, nhìn thẳng, đủ sáng.</p>}
        <Button tone={preview ? 'secondary' : 'primary'} className="mt-3" onClick={() => void shoot()} disabled={busy}>{preview ? 'Chụp lại' : 'Mở camera'}</Button>
      </Card>
      <Card>
        <div className="text-lg font-semibold">2. Vị trí</div>
        <p className={fix ? 'text-slate-700' : 'text-slate-500'}>{fix ? `Đã lấy vị trí (sai số khoảng ${fix.accuracy_m} m)` : photo ? 'Đang lấy vị trí…' : 'Lấy tự động sau khi chụp ảnh.'}</p>
      </Card>
      <ErrorText error={error} />
      <Button onClick={() => void send()} disabled={!photo || !fix || busy}>{busy ? 'Đang gửi…' : `Gửi — ${label}`}</Button>
    </Screen>
  );
}
```

- [ ] **Step 3: Build, chạy test, commit**

Run: `cd mobile && npm test && npm run build`
Expected: PASS; build thành công.

```bash
git add mobile
git commit -m "feat(mobile): sign-in with device approval, forced password change, shifts, selfie+GPS clock-in/out, notifications, offline queue page"
```

---

### Task 5: Build APK thử, CORS cho app, kiểm tra

**Files:**
- Modify: `backend/.env` (máy dev, không commit), `mobile/README.md`

- [ ] **Step 1: CORS backend dev**

Trong `backend/.env` (dev) đặt `CORS_ORIGIN=http://localhost:3000,https://localhost,http://localhost:5173`; khởi động lại backend.

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: https://localhost" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,x-client,authorization" http://localhost:3001/api/auth/login
```
Expected: `204`, có header `access-control-allow-origin: https://localhost`.

- [ ] **Step 2: Đăng nhập kiểu app qua API (như app gọi)**

Run:
```bash
curl -s -H "Content-Type: application/json" -H "X-Client: mobile" -H "Origin: https://localhost" \
  -d '{"identifier":"0910000001","password":"Demo@123456","device_id":"apk-smoke-1","platform":"android","device_label":"Thử APK"}' \
  http://localhost:3001/api/auth/login
```
Expected: có `access_token`, `refresh_token`; `GET /api/me/shifts` với Bearer trả các ca của đội trưởng demo.

- [ ] **Step 3: Build APK trỏ vào máy dev trong LAN**

Run (Git Bash, thay IP bằng IPv4 của máy chạy backend — `ipconfig`):
```bash
cd mobile
VITE_API_BASE=http://<IP>:3001/api MOBILE_DEV=1 npm run build && MOBILE_DEV=1 npx cap sync android
cd android && JAVA_HOME=/d/Apps/AndroidStudio/jbr ./gradlew.bat assembleDebug
```
Expected: `BUILD SUCCESSFUL`; `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Ghi vào `mobile/README.md` mục "Cài thử trên điện thoại": chép APK sang máy, cho phép cài từ nguồn ngoài; điện thoại và máy chạy backend cùng Wi-Fi; mở cổng 3001 trong Windows Firewall nếu cần.

- [ ] **Step 4: Commit**

```bash
git add mobile
git commit -m "docs(mobile): test APK build against the office LAN backend"
```

---

## Self-review (người viết kế hoạch)

- **Phủ spec:** M1 (đăng nhập, gắn máy, quên mật khẩu → HR đặt lại) → Task 3; M2 ca hôm nay → Task 4; M3 vào/ra ca selfie + GPS → Task 4; M10 hàng đợi offline (nền) → Task 2; M11 + §5.1.4 thông báo, kênh khẩn cấp → Task 2–3. M4–M9 (tuần tra, sự cố, SOS, sổ trực, giao ca) và màn đội trưởng/quản lý → Plan 09b/09c.
- **Không có chỗ trống:** mọi bước có mã và lệnh cụ thể.
- **Khớp tên:** `ApiClient.request/upload/login/logout`, `OfflineQueue.add/list/failed/flush/retry/discard/subscribe`, `takePhoto/getPosition/getDeviceInfo/registerPush` dùng thống nhất; `App.tsx` dùng `Shifts`, `Check` của Task 4.
- **Việc để sau:** phát hiện GPS giả (plugin native); kiểm tra khuôn mặt (ML Kit); ký APK phát hành (keystore) và đưa lên Google Play; iOS.
