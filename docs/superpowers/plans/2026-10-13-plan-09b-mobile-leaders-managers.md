# Plan 09b — App IntelShield: màn đội trưởng và quản lý — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đội trưởng và quản lý dùng được app: **Tổng quan** (quản lý: sự cố mở theo mức độ, vòng bỏ lỡ hôm nay, vi phạm chờ duyệt, thiếu người), **Đội** (theo mục tiêu: ai đang trực / trễ / vắng, selfie và vị trí vào ca, vòng tuần hôm nay và từng điểm đã quét, sổ trực và người đang ở trong), **Sự cố** (hộp sự cố theo phạm vi, chi tiết với dòng thời gian và ảnh, tiếp nhận / giao người / bắt đầu / xử lý xong kèm ảnh / đóng / mở lại / báo nhầm / bình luận; ghi nhận sự cố hoặc khách báo tại chỗ), **Duyệt** (vi phạm: đội trưởng đề xuất, quản lý duyệt; biên bản giao ca chờ duyệt). Chạm thông báo mở thẳng đúng màn.

**Architecture:** Toàn bộ dùng API đã có; backend thêm một route `GET /api/incidents/:id/assignees` (người giao được: có ca ở mục tiêu trong 12 giờ quanh lúc này, hoặc thuộc đội phụ trách mục tiêu — đều có tài khoản đang hoạt động). Trên app: thanh tab dựng theo quyền (`navFor`), chuông thông báo ở đầu mọi màn, ảnh tải bằng Bearer thành blob (`AuthImage`), các nút xử lý sự cố quyết định bằng một hàm thuần (`incidentActions`) có test.

**Tech Stack:** như Plan 09a.

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` — §5.1.2 T1–T6, §5.1.3 Q1–Q3, Q5, Q7, §5.1.4 (mở thẳng đúng màn), §6. Chủ dự án 13/10/2026: tiếp tục cho vai trò đội trưởng và quản lý.

**Khác với spec (có chủ đích):**
- T4 xếp ca nhanh, T7/Q6 báo cáo chia sẻ, Q4 liên hệ nhanh: để sau (web đã có xếp ca; báo cáo làm cùng W10).
- Nút "Tôi tiếp nhận" ngay trên thông báo hệ thống (action button native): sau; chạm thông báo mở sự cố, nút tiếp nhận ở màn chi tiết.
- Các thao tác hiện trường của bảo vệ (quét điểm, SOS, ghi sổ, nộp giao ca) ở Plan 09c.

## Global Constraints

- Mọi quy ước Plan 09a giữ nguyên. Màn và nút hiện theo **quyền** từ `/auth/me`, không theo tên vai trò; backend vẫn là nơi quyết định.
- Ảnh trên app luôn tải qua `api` (Bearer), không dùng URL trần.
- Mọi danh sách có "Tải lại" và tự làm mới khi quay lại màn.

## Review Focus

1. **Nút đúng người**: `incidentActions` khớp quy tắc backend (tiếp nhận/giao/báo nhầm cần `incident.manage`; bắt đầu/xử lý cho `manage` hoặc người được giao; đóng cần `incident.close` hoặc `manage` trong mức cho phép — app hiện nút, backend có thể từ chối và app hiện lý do) — test ở Task 2.
2. **Ai được giao**: `assignees` chỉ gồm người của công ty, có tài khoản hoạt động, ở đúng mục tiêu/đội — test ở Task 1.

---

### Task 1: Backend — người giao được cho một sự cố

**Files:**
- Modify: `backend/src/incidents/incidents.service.ts`, `backend/src/incidents/incidents.controller.ts`
- Test: `backend/test/incident-assignees.e2e-spec.ts`

**Interfaces:**
- Produces: `IncidentsService.assignees(actor, id)` → `{ user_id, full_name, phone, on_shift }[]` — cần `incident.manage` và thấy sự cố; gồm người có ca `planned` ở mục tiêu bắt đầu trước 12 giờ sau và kết thúc sau 12 giờ trước lúc này (`on_shift = true` nếu ca bao trùm lúc này), và thành viên hiện tại của đội phụ trách mục tiêu; chỉ người có tài khoản `active`; người đang có ca lên đầu. Sự cố không có mục tiêu → người có ca ở các mục tiêu của khách đó. Route `GET /api/incidents/:id/assignees` (`incident.manage`).

- [ ] **Step 1: Viết test thất bại**

`backend/test/incident-assignees.e2e-spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Incidents — who can be assigned (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ias');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'AK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'AS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'AS2', name: 'Kho' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  async function person(name: string, opts: { team?: boolean; shiftAt?: string; start?: number; end?: number; account?: boolean }) {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `AG${seq}`, full_name: name }).expect(201)).body.data.id;
    if (opts.team) await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    if (opts.shiftAt) await api.post('/api/roster', { site_id: opts.shiftAt, employee_id: e, start_at: minutes(opts.start ?? -60), end_at: minutes(opts.end ?? 300) }).expect(201);
    if (opts.account === false) return { employee: e, user: null };
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    return { employee: e, user: u.user.id as string };
  }

  it('offers the guards on shift there first, then the team that runs the site', async () => {
    const onShift = await person('Đang trực', { shiftAt: ids.site });
    const teammate = await person('Cùng đội', { team: true });
    const later = await person('Ca chiều', { shiftAt: ids.site, start: 300, end: 600 });
    const elsewhere = await person('Mục tiêu khác', { shiftAt: ids.site2 });
    const noAccount = await person('Chưa có tài khoản', { team: true, account: false });
    const category = (await api.get('/api/incident-categories').expect(200)).body.data[0].id;
    const i = (await api.post('/api/incidents', { site_id: ids.site, category_id: category, description: 'x', source: 'staff' }).expect(201)).body.data;
    const list = (await api.get(`/api/incidents/${i.id}/assignees`).expect(200)).body.data as { user_id: string; full_name: string; on_shift: boolean }[];
    expect(list[0]).toMatchObject({ user_id: onShift.user, full_name: 'Đang trực', on_shift: true });
    const users = list.map((x) => x.user_id);
    expect(users).toEqual(expect.arrayContaining([teammate.user, later.user]));
    expect(users).not.toContain(elsewhere.user);
    expect(list.map((x) => x.full_name)).not.toContain(noAccount && 'Chưa có tài khoản');
    const guard = client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: onShift.employee })).token);
    await guard.get(`/api/incidents/${i.id}/assignees`).expect(403);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd backend && npm run test:e2e -- incident-assignees`
Expected: FAIL — 404.

- [ ] **Step 3: Service và route**

Trong `backend/src/incidents/incidents.service.ts`, thêm phương thức (trước `lockVisible`):
```ts
  /**
   * People a manager can hand this incident to: those rostered at the site around now (on shift first),
   * and the members of the team that runs the site — only those with an active account.
   */
  async assignees(actor: AuthUser, id: string) {
    const tenantId = tenantOf(actor);
    const [row] = await this.ds.query(`SELECT id, site_id, client_id, reported_by, assignee_user_id FROM incidents WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!row || !(await this.canSee(actor, row))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `WITH rostered AS (
         SELECT a.employee_id, bool_or(a.planned_start <= now() AND a.planned_end > now()) AS on_shift
           FROM shift_assignments a
           JOIN sites s ON s.id = a.site_id
          WHERE a.tenant_id = $1 AND a.status = 'planned'
            AND (CASE WHEN $2::uuid IS NULL THEN s.client_id = $3 ELSE a.site_id = $2::uuid END)
            AND a.planned_start < now() + interval '12 hours' AND a.planned_end > now() - interval '12 hours'
          GROUP BY a.employee_id),
       team AS (
         SELECT tm.employee_id FROM sites s JOIN team_members tm ON tm.team_id = s.responsible_team_id
          WHERE s.id = $2::uuid AND tm.start_date <= current_date AND (tm.end_date IS NULL OR tm.end_date >= current_date)),
       people AS (
         SELECT employee_id, on_shift FROM rostered
         UNION ALL SELECT employee_id, false FROM team)
       SELECT u.id AS user_id, e.full_name, e.phone, bool_or(p.on_shift) AS on_shift
         FROM people p
         JOIN employees e ON e.id = p.employee_id AND e.deleted_at IS NULL
         JOIN users u ON u.employee_id = e.id AND u.tenant_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL
        GROUP BY u.id, e.full_name, e.phone
        ORDER BY bool_or(p.on_shift) DESC, e.full_name`,
      [tenantId, row.site_id, row.client_id],
    );
  }
```

Trong `backend/src/incidents/incidents.controller.ts` thêm (trước route `incidents/:id`):
```ts
  @RequirePermission('incident.manage')
  @Get('incidents/:id/assignees')
  assignees(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.assignees(user, id);
  }
```

- [ ] **Step 4: Chạy test để thấy đạt, chạy toàn bộ, commit**

Run: `cd backend && npm run test:e2e`
Expected: PASS toàn bộ (gồm `incident-assignees` 1).

```bash
git add backend
git commit -m "feat(backend): people an incident can be handed to — on shift at the site first, then its team"
```

---

### Task 2: App — tab theo quyền, chuông, ảnh có xác thực, mở thông báo đúng màn, nhãn

**Files:**
- Create: `mobile/src/lib/nav.ts`, `mobile/src/lib/incident-rules.ts`, `mobile/src/lib/labels.ts`, `mobile/src/components/AuthImage.tsx`, `mobile/src/components/Bell.tsx`, `mobile/src/components/SitePicker.tsx`
- Modify: `mobile/src/lib/api.ts`, `mobile/src/components/ui.tsx`, `mobile/src/components/Layout.tsx`, `mobile/src/App.tsx`, `mobile/src/screens/Notifications.tsx`
- Test: `mobile/src/lib/nav.test.ts`, `mobile/src/lib/incident-rules.test.ts`

**Interfaces:**
- Produces:
  - `navFor(permissions, hasEmployee)` → các tab theo thứ tự: `Tổng quan` (`client.view` hoặc `violation.review`, không phải bảo vệ có ca) · `Ca trực` (có hồ sơ nhân viên) · `Đội` (`attendance.view` hoặc `patrol.view`) · `Sự cố` (`incident.view`) · `Duyệt` (`violation.propose` | `violation.review` | `handover.review`) · `Tôi`; tối đa 5 tab (bỏ `Tổng quan` khi đã có `Ca trực` và vượt 5).
  - `incidentActions(incident, permissions, me)` → các bước được hiện: `acknowledge`, `assign`, `start`, `resolve`, `close`, `reopen`, `reject`, `comment`.
  - `routeFor(data)` → màn mở khi chạm thông báo: `incident_id` → `/su-co/:id`; `round_id` → `/doi/vong/:id`; `assignment_id` → `/doi`; `handover_id` hoặc loại `violation.*` → `/duyet`; còn lại `/thong-bao`.
  - `ApiClient.blob(path)` → `Blob`; `<AuthImage fileId />` (tải một lần, giữ trong bộ nhớ, bấm để xem lớn).
  - `Screen` nhận `back` (nút quay lại) và hiện chuông có số chưa đọc ở góc phải.

- [ ] **Step 1: Viết test thất bại**

`mobile/src/lib/nav.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { navFor, routeFor } from './nav';

const labels = (perms: string[], employee: boolean) => navFor(perms, employee).map((t) => t.label);

describe('navFor', () => {
  it('gives a guard their shifts and themself only', () => {
    expect(labels(['incident.report', 'patrol.perform', 'logbook.write'], true)).toEqual(['Ca trực', 'Tôi']);
  });
  it('gives a team leader the team, incidents and reviews next to their shifts', () => {
    expect(labels(['attendance.view', 'patrol.view', 'incident.view', 'incident.manage', 'violation.propose', 'handover.review'], true))
      .toEqual(['Ca trực', 'Đội', 'Sự cố', 'Duyệt', 'Tôi']);
  });
  it('opens a manager on the overview', () => {
    expect(labels(['client.view', 'attendance.view', 'incident.view', 'violation.review'], false)).toEqual(['Tổng quan', 'Đội', 'Sự cố', 'Duyệt', 'Tôi']);
  });
  it('never shows more than five tabs', () => {
    expect(navFor(['client.view', 'attendance.view', 'incident.view', 'violation.review'], true).length).toBe(5);
  });
});

describe('routeFor', () => {
  it('opens the screen a notification is about', () => {
    expect(routeFor({ incident_id: 'i1' })).toBe('/su-co/i1');
    expect(routeFor({ round_id: 'r1' })).toBe('/doi/vong/r1');
    expect(routeFor({ handover_id: 'h1' })).toBe('/duyet');
    expect(routeFor({ type: 'violation.absent', assignment_id: 'a1' })).toBe('/duyet');
    expect(routeFor({ assignment_id: 'a1' })).toBe('/doi');
    expect(routeFor({})).toBe('/thong-bao');
  });
});
```

`mobile/src/lib/incident-rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { incidentActions } from './incident-rules';

const base = { status: 'new', assignee_user_id: null, severity: 'medium' } as const;
const leader = ['incident.view', 'incident.manage'];
const manager = ['incident.view', 'incident.manage', 'incident.close'];

describe('incidentActions', () => {
  it('lets a manager take a new incident, hand it out or mark it a false alarm', () => {
    expect(incidentActions({ ...base }, leader, 'me')).toEqual(['acknowledge', 'assign', 'reject', 'comment']);
  });
  it('lets the assignee work it without manage rights', () => {
    expect(incidentActions({ ...base, status: 'acknowledged', assignee_user_id: 'me' }, ['incident.view'], 'me')).toEqual(['start', 'resolve', 'comment']);
    expect(incidentActions({ ...base, status: 'in_progress', assignee_user_id: 'me' }, ['incident.view'], 'me')).toEqual(['resolve', 'comment']);
  });
  it('still lets a manager hand out an incident already taken', () => {
    expect(incidentActions({ ...base, status: 'acknowledged' }, leader, 'me')).toEqual(['start', 'resolve', 'assign', 'reject', 'comment']);
  });
  it('shows close and reopen once resolved', () => {
    expect(incidentActions({ ...base, status: 'resolved' }, manager, 'me')).toEqual(['close', 'reopen', 'comment']);
    expect(incidentActions({ ...base, status: 'resolved' }, leader, 'me')).toEqual(['close', 'reopen', 'comment']);
  });
  it('leaves only comments on closed and rejected incidents, nothing for strangers', () => {
    expect(incidentActions({ ...base, status: 'closed' }, manager, 'me')).toEqual(['comment']);
    expect(incidentActions({ ...base, status: 'rejected' }, manager, 'me')).toEqual(['comment']);
    expect(incidentActions({ ...base, status: 'in_progress' }, ['incident.view'], 'me')).toEqual(['comment']);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `cd mobile && npm test`
Expected: FAIL — không có `./nav`, `./incident-rules`.

- [ ] **Step 3: Quy tắc thuần**

`mobile/src/lib/nav.ts`:
```ts
export interface Tab {
  to: string;
  label: string;
  icon: string;
}

/** Tabs from permissions, in the order people reach for them. The backend still decides every action. */
export function navFor(permissions: string[], hasEmployee: boolean): Tab[] {
  const has = (p: string) => permissions.includes(p);
  const tabs: Tab[] = [];
  const overview = has('client.view') || has('violation.review');
  if (overview) tabs.push({ to: '/tong-quan', label: 'Tổng quan', icon: '📊' });
  if (hasEmployee) tabs.push({ to: '/', label: 'Ca trực', icon: '🕘' });
  if (has('attendance.view') || has('patrol.view')) tabs.push({ to: '/doi', label: 'Đội', icon: '👥' });
  if (has('incident.view')) tabs.push({ to: '/su-co', label: 'Sự cố', icon: '🚨' });
  if (has('violation.propose') || has('violation.review') || has('handover.review')) tabs.push({ to: '/duyet', label: 'Duyệt', icon: '✅' });
  tabs.push({ to: '/toi', label: 'Tôi', icon: '👤' });
  // Five fit on a small phone: a guard-manager keeps "Ca trực" and reaches the overview from "Tôi".
  if (tabs.length > 5 && overview && hasEmployee) tabs.splice(0, 1);
  return tabs.slice(0, 5);
}

/** The screen a notification is about. */
export function routeFor(data: Record<string, string | undefined>): string {
  if (data.incident_id) return `/su-co/${data.incident_id}`;
  if (data.round_id) return `/doi/vong/${data.round_id}`;
  if (data.handover_id || data.type?.startsWith('violation.')) return '/duyet';
  if (data.assignment_id) return '/doi';
  return '/thong-bao';
}
```

`mobile/src/lib/incident-rules.ts`:
```ts
export type IncidentStep = 'acknowledge' | 'assign' | 'start' | 'resolve' | 'close' | 'reopen' | 'reject' | 'comment';

interface Shape {
  status: string;
  assignee_user_id: string | null;
  severity: string;
}

/**
 * Which buttons to show, mirroring the backend's rules (Plan 05). Closing by a leader depends on the site's
 * setting the app does not know: the button shows for `incident.manage` and the server may refuse with its reason.
 */
export function incidentActions(i: Shape, permissions: string[], myUserId: string): IncidentStep[] {
  const manage = permissions.includes('incident.manage');
  const close = permissions.includes('incident.close');
  const mine = i.assignee_user_id === myUserId;
  const out: IncidentStep[] = [];
  if (manage && i.status === 'new') out.push('acknowledge');
  if ((manage || mine) && i.status === 'acknowledged') out.push('start');
  if ((manage || mine) && (i.status === 'acknowledged' || i.status === 'in_progress')) out.push('resolve');
  if (manage && !['resolved', 'closed', 'rejected'].includes(i.status)) out.push('assign');
  if ((close || manage) && i.status === 'resolved') out.push('close');
  if (manage && i.status === 'resolved') out.push('reopen');
  if (manage && ['new', 'acknowledged', 'in_progress'].includes(i.status)) out.push('reject');
  out.push('comment');
  return order(out);
}

const ORDER: IncidentStep[] = ['acknowledge', 'start', 'resolve', 'assign', 'close', 'reopen', 'reject', 'comment'];
const order = (steps: IncidentStep[]) => ORDER.filter((s) => steps.includes(s));
```

- [ ] **Step 4: Nhãn**

`mobile/src/lib/labels.ts`:
```ts
export const SEVERITY: Record<string, { label: string; tone: string }> = {
  low: { label: 'Thấp', tone: 'bg-slate-100 text-slate-700' },
  medium: { label: 'Trung bình', tone: 'bg-sky-100 text-sky-800' },
  high: { label: 'Cao', tone: 'bg-amber-100 text-amber-800' },
  critical: { label: 'Khẩn cấp', tone: 'bg-red-600 text-white' },
};

export const INCIDENT_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: 'Chưa ai nhận', tone: 'bg-red-100 text-red-700' },
  acknowledged: { label: 'Đã tiếp nhận', tone: 'bg-amber-100 text-amber-800' },
  in_progress: { label: 'Đang xử lý', tone: 'bg-sky-100 text-sky-800' },
  resolved: { label: 'Chờ đóng', tone: 'bg-teal-100 text-teal-800' },
  closed: { label: 'Đã đóng', tone: 'bg-slate-200 text-slate-700' },
  rejected: { label: 'Báo nhầm', tone: 'bg-slate-100 text-slate-500' },
};

export const STEP_LABEL: Record<string, string> = {
  acknowledge: 'Tôi tiếp nhận',
  assign: 'Giao người xử lý',
  start: 'Bắt đầu xử lý',
  resolve: 'Đã xử lý xong',
  close: 'Đóng sự cố',
  reopen: 'Mở lại',
  reject: 'Báo nhầm',
  comment: 'Bình luận',
};

export const ATTENDANCE_STATUS: Record<string, { label: string; tone: string }> = {
  upcoming: { label: 'Chưa đến giờ', tone: 'bg-slate-100 text-slate-600' },
  waiting: { label: 'Chờ vào ca', tone: 'bg-sky-100 text-sky-800' },
  late: { label: 'Trễ — chưa vào', tone: 'bg-amber-100 text-amber-800' },
  absent: { label: 'Vắng', tone: 'bg-red-100 text-red-700' },
  on_duty: { label: 'Đang trực', tone: 'bg-teal-100 text-teal-800' },
  done: { label: 'Đã ra ca', tone: 'bg-slate-200 text-slate-600' },
  cancelled: { label: 'Đã huỷ', tone: 'bg-slate-100 text-slate-400' },
};

export const ROUND_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Chưa đến', tone: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'Đang tuần', tone: 'bg-sky-100 text-sky-800' },
  completed: { label: 'Đủ điểm', tone: 'bg-teal-100 text-teal-800' },
  partial: { label: 'Thiếu điểm', tone: 'bg-amber-100 text-amber-800' },
  missed: { label: 'Bỏ lỡ', tone: 'bg-red-100 text-red-700' },
};

export const SCAN_FLAG: Record<string, string> = {
  outside_radius: 'ngoài bán kính', mock_location: 'vị trí giả', low_accuracy: 'GPS kém', clock_skew: 'giờ máy lệch',
  late_sync: 'gửi muộn', impossible_speed: 'đi quá nhanh', backdated: 'báo bù muộn', no_location: 'QR không có vị trí',
  outside_geofence: 'ngoài khu vực mục tiêu',
};

export const VIOLATION_TYPE: Record<string, string> = {
  late_check_in: 'Vào ca trễ', absent: 'Vắng ca', early_check_out: 'Ra ca sớm',
  missed_round: 'Bỏ vòng tuần', missed_checkpoint: 'Thiếu điểm', suspicious_scan: 'Quét nghi vấn',
};

export const VIOLATION_STATUS: Record<string, string> = {
  auto: 'Mới', proposed_confirm: 'Đề xuất xác nhận', proposed_waive: 'Đề xuất miễn', confirmed: 'Đã xác nhận', waived: 'Đã miễn',
};

export const LOGBOOK_TYPE: Record<string, string> = { note: 'Ghi chú', visitor: 'Khách', vehicle: 'Xe', asset: 'Tài sản', other: 'Khác' };
```

- [ ] **Step 5: Ảnh có xác thực, chuông, chọn mục tiêu, khung màn**

Trong `mobile/src/lib/api.ts`, thêm phương thức vào `ApiClient` (sau `upload`):
```ts
  /** A protected file as a Blob (images on the app always go through the session). */
  async blob(path: string): Promise<Blob> {
    const session = await this.store.get();
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, { headers: { 'X-Client': 'mobile', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) } });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401 && session && (await this.refresh(session.refresh_token)) === 'ok') return this.blob(path);
    if (!res.ok) throw new ApiError('FILE_UNAVAILABLE', 'Không tải được ảnh', res.status);
    return res.blob();
  }
```

`mobile/src/components/AuthImage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/client';

const cache = new Map<string, string>();

/** An image behind the session: fetched once per app run, tap to see it full screen. */
export function AuthImage({ fileId, className = '' }: { fileId: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(cache.get(fileId) ?? null);
  const [big, setBig] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (src) return;
    let live = true;
    api.blob(`/files/${fileId}`)
      .then((b) => {
        const url = URL.createObjectURL(b);
        cache.set(fileId, url);
        if (live) setSrc(url);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [fileId, src]);

  if (failed) return <div className={`flex items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 ${className}`}>Không tải được ảnh</div>;
  if (!src) return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
  return (
    <>
      <img src={src} alt="" onClick={() => setBig(true)} className={`rounded-lg object-cover ${className}`} />
      {big && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setBig(false)}>
          <img src={src} alt="" className="max-h-full max-w-full" />
        </div>
      )}
    </>
  );
}
```

`mobile/src/components/Bell.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { useUnread } from '../lib/unread';

export function Bell() {
  const { unread } = useUnread();
  return (
    <Link to="/thong-bao" className="relative px-1 text-2xl" aria-label="Thông báo">
      🔔
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
```

`mobile/src/components/SitePicker.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/client';

export interface SiteOption {
  id: string;
  name: string;
  client_name: string;
}

const KEY = 'intelshield.site';

/** The sites the person can see; remembers the last one chosen on this phone. */
export function SitePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [sites, setSites] = useState<SiteOption[]>([]);
  useEffect(() => {
    api.request<SiteOption[]>('/sites').then((s) => {
      setSites(s);
      const remembered = localStorage.getItem(KEY);
      if (!value) onChange(s.find((x) => x.id === remembered)?.id ?? s[0]?.id ?? '');
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <select
      value={value}
      onChange={(e) => { localStorage.setItem(KEY, e.target.value); onChange(e.target.value); }}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base"
    >
      {sites.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.client_name}</option>)}
      {!sites.length && <option value="">Chưa có mục tiêu nào</option>}
    </select>
  );
}
```

Trong `mobile/src/components/ui.tsx` thay hàm `Screen` bằng:
```tsx
export function Screen({ title, children, action, back }: { title: string; children: ReactNode; action?: ReactNode; back?: boolean }) {
  return (
    <div className="min-h-full pb-24">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 bg-teal-800 px-4 py-3 text-white">
        {back && <button onClick={() => window.history.back()} className="-ml-1 pr-1 text-2xl" aria-label="Quay lại">‹</button>}
        <h1 className="flex-1 truncate text-xl font-semibold">{title}</h1>
        {action}
        <Bell />
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-block rounded-md px-2 py-0.5 text-sm font-medium ${tone}`}>{children}</span>;
}
```
và thêm `import { Bell } from './Bell';` ở đầu tệp.

`mobile/src/components/Layout.tsx` (thay toàn bộ):
```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { navFor } from '../lib/nav';

export function Layout() {
  const { me } = useAuth();
  const tabs = navFor(me?.permissions ?? [], Boolean(me?.user.employee_id));
  return (
    <div className="h-full">
      <Outlet />
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `flex flex-1 flex-col items-center py-2 text-sm ${isActive ? 'font-semibold text-teal-700' : 'text-slate-500'}`}>
            <span className="text-2xl" aria-hidden>{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
```

Trong `mobile/src/screens/Notifications.tsx`:
- import `useNavigate` từ `react-router-dom` và `routeFor` từ `../lib/nav`; `Item` thêm `data: Record<string, string>;`;
- trong component thêm `const navigate = useNavigate();`;
- cuối hàm `read`, thêm: `const target = routeFor({ ...n.data, type: n.type }); if (target !== '/thong-bao') navigate(target);`
- `Screen` thêm `back`.

Trong `mobile/src/App.tsx` (các màn mới được tạo ở Task 3–5; đăng ký route ở đây một lần):
- import `routeFor` từ `./lib/nav`; trong `Background`, đổi tham số đầu của `registerPush` thành `(data) => go.current(routeFor(data))`;
- import `Overview` từ `./screens/Overview`, `Team` từ `./screens/Team`, `PersonShift` từ `./screens/PersonShift`, `RoundDetail` từ `./screens/RoundDetail`, `Incidents` từ `./screens/Incidents`, `IncidentDetail` từ `./screens/IncidentDetail`, `NewIncident` từ `./screens/NewIncident`, `Reviews` từ `./screens/Reviews`;
- trong nhóm `<Route element={<Layout />}>` thêm:
```tsx
          <Route path="/tong-quan" element={<Overview />} />
          <Route path="/doi" element={<Team />} />
          <Route path="/su-co" element={<Incidents />} />
          <Route path="/duyet" element={<Reviews />} />
```
  và ngoài nhóm (màn có nút quay lại, không có thanh tab) thêm:
```tsx
        <Route path="/doi/ca/:siteId/:assignmentId" element={<PersonShift />} />
        <Route path="/doi/vong/:id" element={<RoundDetail />} />
        <Route path="/su-co/moi" element={<NewIncident />} />
        <Route path="/su-co/:id" element={<IncidentDetail />} />
```
- route `/thong-bao` chuyển ra ngoài nhóm `Layout` (màn có nút quay lại, mở từ chuông);
- route `*` thay bằng `<Route path="*" element={<Home />} />` với
```tsx
/** First tab of this person: the overview for managers, the shifts for everyone with a shift. */
function Home() {
  const { me } = useAuth();
  const first = navFor(me?.permissions ?? [], Boolean(me?.user.employee_id))[0];
  return <Navigate to={first?.to ?? '/toi'} replace />;
}
```
  (import `navFor` cùng `routeFor`), và route `/` giữ `<Shifts />` cho người có hồ sơ nhân viên; người không có thì `/` chuyển về `Home`:
```tsx
          <Route path="/" element={me?.user.employee_id ? <Shifts /> : <Home />} />
```
  (lấy `me` bằng `const { me } = useAuth();` trong `Gate`, đã có).

(Build ở Task 5 khi đủ các màn.)

- [ ] **Step 6: Chạy test, commit**

Run: `cd mobile && npm test`
Expected: PASS (`nav` 5, `incident-rules` 4, cũ 18).

```bash
git add mobile
git commit -m "feat(mobile): permission-built tabs, bell on every screen, authenticated images, notifications open their screen"
```

---

### Task 3: Sự cố — hộp sự cố, chi tiết và xử lý, ghi nhận tại chỗ

**Files:**
- Create: `mobile/src/screens/Incidents.tsx`, `mobile/src/screens/IncidentDetail.tsx`, `mobile/src/screens/NewIncident.tsx`, `mobile/src/components/PhotoStrip.tsx`

**Interfaces:**
- Consumes: `GET /api/incidents?status&severity`, `GET /api/incidents/:id`, `POST /api/incidents/:id/{acknowledge|assign|start|resolve|close|reopen|reject|comments}`, `GET /api/incidents/:id/assignees`, `GET /api/incident-categories`, `POST /api/incidents`, `POST /api/files`.
- Produces: `Incidents` (lọc Đang mở / Chưa ai nhận / Tất cả; khẩn cấp và chưa nhận lên đầu; nút "+ Ghi nhận" cho `incident.manage`), `IncidentDetail` (thông tin, ảnh, bản đồ, dòng thời gian, các nút từ `incidentActions`, ô ghi chú/lý do, chụp ảnh kèm), `NewIncident` (nhân sự ghi hoặc khách báo; mục tiêu, loại, mức độ, mô tả, người báo bên khách, kênh, ≤ 5 ảnh), `PhotoStrip` (chụp bằng camera sau, hiện ảnh nhỏ, bỏ từng ảnh).

- [ ] **Step 1: Dải ảnh**

`mobile/src/components/PhotoStrip.tsx`:
```tsx
import { useEffect, useMemo } from 'react';
import { takePhoto } from '../lib/native';

/** Photos taken now with the rear camera, shown small; at most `max`. */
export function PhotoStrip({ photos, onChange, max = 5, onError }: { photos: Blob[]; onChange: (p: Blob[]) => void; max?: number; onError: (m: string) => void }) {
  const urls = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <div key={u} className="relative">
          <img src={u} alt="" className="h-20 w-20 rounded-lg object-cover" />
          <button type="button" onClick={() => onChange(photos.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 h-7 w-7 rounded-full bg-slate-800 text-white">×</button>
        </div>
      ))}
      {photos.length < max && (
        <button
          type="button"
          onClick={async () => { try { onChange([...photos, await takePhoto('rear')]); } catch (e) { onError(e instanceof Error ? e.message : 'Không chụp được ảnh'); } }}
          className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500"
        >
          <span className="text-2xl">📷</span>Chụp
        </button>
      )}
    </div>
  );
}

/** Upload taken photos one by one; returns their ids. */
export async function uploadAll(upload: (b: Blob, name: string) => Promise<{ id: string }>, photos: Blob[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, p] of photos.entries()) ids.push((await upload(p, `anh-${i + 1}.jpg`)).id);
  return ids;
}
```

- [ ] **Step 2: Hộp sự cố**

`mobile/src/screens/Incidents.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { stamp } from '../lib/format';
import { INCIDENT_STATUS, SEVERITY } from '../lib/labels';

export interface IncidentRow {
  id: string;
  code: string;
  title: string;
  severity: string;
  is_sos: boolean;
  status: string;
  site_name: string | null;
  client_name: string;
  reporter_name: string | null;
  source: string;
  created_at: string;
  escalation_level: number;
}

const FILTERS = [
  { value: 'open', label: 'Đang mở' },
  { value: 'new', label: 'Chưa ai nhận' },
  { value: '', label: 'Tất cả' },
];
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function Incidents() {
  const { can } = useAuth();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.request<IncidentRow[]>(`/incidents${status ? `?status=${status}` : ''}`);
      // Unanswered first, then the most serious, then the newest.
      list.sort((a, b) => Number(b.status === 'new') - Number(a.status === 'new') || RANK[a.severity] - RANK[b.severity] || b.created_at.localeCompare(a.created_at));
      setRows(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [status]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Screen title="Sự cố" action={can('incident.manage') ? <Link to="/su-co/moi" className="rounded-lg bg-white/20 px-3 py-1 text-base font-semibold">+ Ghi nhận</Link> : undefined}>
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setStatus(f.value)} className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${status === f.value ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>{f.label}</button>
        ))}
      </div>
      <ErrorText error={error} />
      {rows?.map((r) => (
        <Link key={r.id} to={`/su-co/${r.id}`} className="block">
          <Card className={r.status === 'new' && (r.severity === 'critical' || r.is_sos) ? 'border-red-400 bg-red-50' : ''}>
            <div className="flex items-center gap-2">
              <Badge tone={SEVERITY[r.severity]?.tone ?? ''}>{r.is_sos ? 'SOS' : SEVERITY[r.severity]?.label}</Badge>
              <Badge tone={INCIDENT_STATUS[r.status]?.tone ?? ''}>{INCIDENT_STATUS[r.status]?.label}</Badge>
              <span className="ml-auto text-sm text-slate-400">{stamp(r.created_at)}</span>
            </div>
            <div className="mt-1 text-lg font-semibold">{r.title}</div>
            <div className="text-sm text-slate-500">{r.site_name ?? r.client_name} · {r.source === 'client_report' ? 'Khách báo' : r.reporter_name}</div>
            {r.status === 'new' && r.escalation_level > 1 && <div className="text-sm text-red-700">Đã leo thang cấp {r.escalation_level}</div>}
          </Card>
        </Link>
      ))}
      {rows && !rows.length && <p className="py-10 text-center text-slate-400">Không có sự cố nào</p>}
    </Screen>
  );
}
```

- [ ] **Step 3: Chi tiết và xử lý**

`mobile/src/screens/IncidentDetail.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { Badge, Button, Card, ErrorText, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { stamp } from '../lib/format';
import { IncidentStep, incidentActions } from '../lib/incident-rules';
import { INCIDENT_STATUS, SEVERITY, STEP_LABEL } from '../lib/labels';

interface Detail {
  id: string;
  code: string;
  title: string;
  severity: string;
  is_sos: boolean;
  status: string;
  site_name: string | null;
  client_name: string;
  description: string | null;
  reporter_name: string | null;
  source: string;
  client_reporter_name: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  lat: string | null;
  lng: string | null;
  resolution_note: string | null;
  rejected_reason: string | null;
  created_at: string;
  events: { id: string; type: string; actor_name: string | null; body: string | null; to_status: string | null; data: { level?: number }; created_at: string }[];
  files: { id: string }[];
}

interface Assignee {
  user_id: string;
  full_name: string;
  on_shift: boolean;
}

/** Steps that need words from the person: what was done, or why. */
const NEEDS_TEXT: Partial<Record<IncidentStep, { field: 'note' | 'reason' | 'body'; prompt: string; required: boolean; photos: boolean }>> = {
  resolve: { field: 'note', prompt: 'Đã xử lý thế nào?', required: true, photos: true },
  reopen: { field: 'reason', prompt: 'Vì sao mở lại?', required: true, photos: false },
  reject: { field: 'reason', prompt: 'Vì sao là báo nhầm?', required: true, photos: false },
  comment: { field: 'body', prompt: 'Bình luận, cập nhật…', required: true, photos: true },
};

function describe(e: Detail['events'][number]): string {
  if (e.type === 'created') return 'báo sự cố';
  if (e.type === 'acknowledged') return 'tiếp nhận';
  if (e.type === 'assigned') return 'giao việc';
  if (e.type === 'comment') return 'bình luận';
  if (e.type === 'escalated') return `leo thang cấp ${e.data.level ?? ''}`;
  if (e.type === 'status_changed' && e.to_status) return `→ ${INCIDENT_STATUS[e.to_status]?.label ?? e.to_status}`;
  return e.type;
}

export function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const [i, setI] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<IncidentStep | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Assignee[] | null>(null);

  const load = useCallback(async () => {
    try {
      setI(await api.request<Detail>(`/incidents/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function run(path: string, json: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      setI(await api.request<Detail>(`/incidents/${id}/${path}`, { json }));
      setStep(null);
      setText('');
      setPhotos([]);
      setPeople(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Không có mạng — thao tác này cần mạng.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  async function choose(s: IncidentStep) {
    setError(null);
    if (s === 'assign') {
      try {
        setPeople(await api.request<Assignee[]>(`/incidents/${id}/assignees`));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
      }
      return;
    }
    if (NEEDS_TEXT[s]) {
      setStep(s);
      return;
    }
    await run(s);
  }

  async function submitText() {
    if (!step) return;
    const need = NEEDS_TEXT[step]!;
    if (need.required && !text.trim()) return setError(need.prompt);
    setBusy(true);
    try {
      const file_ids = need.photos && photos.length ? await uploadAll((b, n) => api.upload(b, n), photos) : undefined;
      setBusy(false);
      await run(step === 'comment' ? 'comments' : step, { [need.field]: text.trim(), ...(file_ids ? { file_ids } : {}) });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Không tải được ảnh');
    }
  }

  if (!i || !me) return <Screen title="Sự cố" back><ErrorText error={error} /></Screen>;
  const steps = incidentActions(i, me.permissions, me.user.id);

  return (
    <Screen title={i.code} back>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY[i.severity]?.tone ?? ''}>{i.is_sos ? 'SOS' : SEVERITY[i.severity]?.label}</Badge>
          <Badge tone={INCIDENT_STATUS[i.status]?.tone ?? ''}>{INCIDENT_STATUS[i.status]?.label}</Badge>
        </div>
        <div className="mt-2 text-xl font-semibold">{i.title}</div>
        <div className="text-slate-600">{i.site_name ?? '—'} · {i.client_name}</div>
        <div className="text-sm text-slate-500">
          {stamp(i.created_at)} · {i.source === 'client_report' ? `Khách báo${i.client_reporter_name ? ` (${i.client_reporter_name})` : ''}, ghi bởi ${i.reporter_name}` : i.reporter_name}
        </div>
        <div className="text-sm text-slate-500">Người xử lý: {i.assignee_name ?? 'chưa giao'}</div>
        {i.description && <p className="mt-2 whitespace-pre-wrap text-base">{i.description}</p>}
        {i.lat && i.lng && <a href={`https://www.google.com/maps?q=${i.lat},${i.lng}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-teal-700 underline">Xem vị trí trên bản đồ</a>}
        {i.resolution_note && <p className="mt-2 rounded-lg bg-teal-50 p-2"><b>Đã xử lý:</b> {i.resolution_note}</p>}
        {i.rejected_reason && <p className="mt-2 rounded-lg bg-slate-100 p-2"><b>Báo nhầm:</b> {i.rejected_reason}</p>}
        {i.files.length > 0 && <div className="mt-2 grid grid-cols-3 gap-2">{i.files.map((f) => <AuthImage key={f.id} fileId={f.id} className="aspect-square w-full" />)}</div>}
      </Card>

      <ErrorText error={error} />

      {people && (
        <Card>
          <div className="mb-2 font-semibold">Giao cho ai?</div>
          {people.map((p) => (
            <button key={p.user_id} disabled={busy} onClick={() => void run('assign', { user_id: p.user_id })} className="flex w-full items-center justify-between border-t border-slate-100 py-3 text-left text-lg">
              {p.full_name}
              {p.on_shift && <span className="text-sm text-teal-700">đang trực</span>}
            </button>
          ))}
          <button onClick={() => void run('assign', { user_id: me.user.id })} className="w-full border-t border-slate-100 py-3 text-left text-lg text-teal-700">Giao cho tôi</button>
          <Button tone="secondary" onClick={() => setPeople(null)}>Thôi</Button>
        </Card>
      )}

      {step ? (
        <Card>
          <div className="mb-2 font-semibold">{STEP_LABEL[step]}</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={NEEDS_TEXT[step]!.prompt} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
          {NEEDS_TEXT[step]!.photos && <div className="mt-2"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></div>}
          {step === 'resolve' && (i.severity === 'high' || i.severity === 'critical') && !i.files.length && (
            <p className="mt-2 text-sm text-amber-700">Sự cố mức cao cần ít nhất một ảnh.</p>
          )}
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void submitText()} disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi'}</Button>
            <Button tone="secondary" onClick={() => { setStep(null); setText(''); setPhotos([]); }}>Thôi</Button>
          </div>
        </Card>
      ) : !people && (
        <div className="grid grid-cols-2 gap-2">
          {steps.map((s) => (
            <Button key={s} tone={s === 'acknowledge' || s === 'resolve' || s === 'start' ? 'primary' : s === 'reject' ? 'danger' : 'secondary'} disabled={busy} onClick={() => void choose(s)} className={s === 'acknowledge' ? 'col-span-2' : ''}>
              {STEP_LABEL[s]}
            </Button>
          ))}
        </div>
      )}

      <Card>
        <div className="mb-2 font-semibold">Dòng thời gian</div>
        <ol className="space-y-2">
          {i.events.map((e) => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3 text-base">
              <span className="text-sm text-slate-400">{stamp(e.created_at)}</span> · <b>{e.actor_name ?? 'Hệ thống'}</b> {describe(e)}
              {e.body && <p className="whitespace-pre-wrap text-slate-700">{e.body}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </Screen>
  );
}
```

- [ ] **Step 4: Ghi nhận tại chỗ**

`mobile/src/screens/NewIncident.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { SitePicker } from '../components/SitePicker';
import { Button, ErrorText, Field, Input, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { SEVERITY } from '../lib/labels';

interface Category {
  id: string;
  name: string;
  default_severity: string;
}

const CHANNELS = [
  { value: 'in_person', label: 'Trực tiếp' },
  { value: 'phone', label: 'Điện thoại' },
  { value: 'zalo', label: 'Zalo' },
  { value: 'email', label: 'Email' },
];

/** A leader or manager writing down an incident on the spot — their own finding, or what the client just reported. */
export function NewIncident() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ source: 'client_report', site_id: '', category_id: '', severity: '', description: '', client_reporter_name: '', client_channel: 'in_person' });
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.request<Category[]>('/incident-categories').then((c) => { setCategories(c); setForm((f) => ({ ...f, category_id: c[0]?.id ?? '' })); }).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const file_ids = await uploadAll((b, n) => api.upload(b, n), photos);
      const client = form.source === 'client_report';
      const created = await api.request<{ id: string }>('/incidents', {
        json: {
          source: form.source, site_id: form.site_id, category_id: form.category_id, description: form.description, file_ids,
          ...(form.severity ? { severity: form.severity } : {}),
          ...(client ? { client_channel: form.client_channel, ...(form.client_reporter_name.trim() ? { client_reporter_name: form.client_reporter_name.trim() } : {}) } : {}),
        },
      });
      navigate(`/su-co/${created.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof NetworkError ? 'Không có mạng — ghi nhận sự cố cần mạng.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <Screen title="Ghi nhận sự cố" back>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[{ v: 'client_report', l: 'Khách báo' }, { v: 'staff', l: 'Tôi phát hiện' }].map((o) => (
            <button key={o.v} type="button" onClick={() => setForm({ ...form, source: o.v })} className={`rounded-xl py-3 text-base font-medium ${form.source === o.v ? 'bg-teal-700 text-white' : 'border border-slate-300 bg-white'}`}>{o.l}</button>
          ))}
        </div>
        <Field label="Mục tiêu"><SitePicker value={form.site_id} onChange={(id) => setForm((f) => ({ ...f, site_id: id }))} /></Field>
        <Field label="Loại sự cố">
          <select value={form.category_id} onChange={set('category_id')} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({SEVERITY[c.default_severity]?.label})</option>)}
          </select>
        </Field>
        <Field label="Mức độ">
          <select value={form.severity} onChange={set('severity')} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            <option value="">Theo loại sự cố</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        {form.source === 'client_report' && (
          <>
            <Field label="Người báo bên khách"><Input value={form.client_reporter_name} onChange={set('client_reporter_name')} placeholder="VD: Chị Lan — BQL" /></Field>
            <Field label="Báo qua">
              <select value={form.client_channel} onChange={set('client_channel')} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Mô tả">
          <textarea value={form.description} onChange={set('description')} required rows={4} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
        </Field>
        <Field label="Ảnh (tối đa 5)"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || !form.site_id || !form.category_id}>{busy ? 'Đang gửi…' : 'Gửi — báo người phụ trách'}</Button>
      </form>
    </Screen>
  );
}
```

- [ ] **Step 5: Commit** (build ở Task 5)

```bash
git add mobile
git commit -m "feat(mobile): incident inbox, detail with workflow, assignee picker and photos, on-the-spot reporting"
```

---

### Task 4: Đội — ai đang trực, vòng tuần, sổ trực của mục tiêu

**Files:**
- Create: `mobile/src/screens/Team.tsx`, `mobile/src/screens/PersonShift.tsx`, `mobile/src/screens/RoundDetail.tsx`

**Interfaces:**
- Consumes: `GET /api/attendance/board?site_id&date`, `GET /api/patrol/rounds?site_id&date`, `GET /api/patrol/rounds/:id`, `GET /api/sites/:id/logbook?date`, `GET /api/sites/:id/logbook/inside`.
- Produces: `Team` (chọn mục tiêu; ba phần theo quyền: **Ca trực** `attendance.view` — đếm đang trực/trễ/vắng và danh sách; **Vòng tuần** `patrol.view` — tóm tắt và từng vòng; **Sổ trực** `logbook.view` — đang ở trong và các dòng hôm nay), `PersonShift` (một người: giờ vào/ra, trễ/sớm, cờ, khoảng cách, selfie vào và ra), `RoundDetail` (từng điểm: lúc quét, cách, cờ; các lần quét với ảnh).

- [ ] **Step 1: Màn Đội**

`mobile/src/screens/Team.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { SitePicker } from '../components/SitePicker';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { localDate, time } from '../lib/format';
import { ATTENDANCE_STATUS, LOGBOOK_TYPE, ROUND_STATUS } from '../lib/labels';

export interface BoardRow {
  id: string;
  employee_name: string;
  employee_code: string;
  template_name: string | null;
  planned_start: string;
  planned_end: string;
  status: string;
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

interface RoundRow {
  id: string;
  expected_start: string;
  expected_end: string;
  status: string;
  late: boolean;
  employee_name: string | null;
  route_name: string;
  required_count: number;
  done_required: number;
  suspicious_count: number;
  started_at: string | null;
}

interface LogLine {
  id: string;
  type: string;
  body: string | null;
  data: Record<string, string | number | undefined>;
  occurred_at: string;
  exited_at: string | null;
  author_name: string;
  files: { id: string }[];
}

type Part = 'shifts' | 'rounds' | 'book';

const lineText = (l: LogLine) => {
  const d = l.data;
  if (l.type === 'visitor') return [d.visitor_name, d.visitor_org && `(${d.visitor_org})`, d.meet_whom && `gặp ${d.meet_whom}`].filter(Boolean).join(' ');
  if (l.type === 'vehicle') return [d.plate, d.vehicle_kind, d.cargo].filter(Boolean).join(' · ');
  if (l.type === 'asset') return [d.item, d.quantity, d.counterpart].filter(Boolean).join(' · ');
  return l.body ?? '';
};

export function Team() {
  const { can } = useAuth();
  const parts = ([
    can('attendance.view') && { key: 'shifts', label: 'Ca trực' },
    can('patrol.view') && { key: 'rounds', label: 'Vòng tuần' },
    can('logbook.view') && { key: 'book', label: 'Sổ trực' },
  ].filter(Boolean) as { key: Part; label: string }[]);
  const [part, setPart] = useState<Part>(parts[0]?.key ?? 'shifts');
  const [siteId, setSiteId] = useState('');
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [rounds, setRounds] = useState<{ summary: Record<string, number>; rounds: RoundRow[] } | null>(null);
  const [book, setBook] = useState<{ inside: LogLine[]; today: LogLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    const day = localDate(0);
    try {
      if (part === 'shifts') setBoard((await api.request<{ rows: BoardRow[] }>(`/attendance/board?site_id=${siteId}&date=${day}`)).rows);
      if (part === 'rounds') setRounds(await api.request(`/patrol/rounds?site_id=${siteId}&date=${day}`));
      if (part === 'book') {
        const [inside, today] = await Promise.all([
          api.request<LogLine[]>(`/sites/${siteId}/logbook/inside`),
          api.request<LogLine[]>(`/sites/${siteId}/logbook?date=${day}`),
        ]);
        setBook({ inside, today });
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [siteId, part]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const count = (s: string) => board?.filter((r) => r.status === s).length ?? 0;

  return (
    <Screen title="Đội" action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      <SitePicker value={siteId} onChange={setSiteId} />
      {parts.length > 1 && (
        <div className="flex gap-2">
          {parts.map((p) => (
            <button key={p.key} onClick={() => setPart(p.key)} className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${part === p.key ? 'bg-teal-700 text-white' : 'border border-slate-300 bg-white text-slate-600'}`}>{p.label}</button>
          ))}
        </div>
      )}
      <ErrorText error={error} />

      {part === 'shifts' && board && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card className="p-2"><div className="text-2xl font-semibold text-teal-700">{count('on_duty')}</div><div className="text-sm text-slate-500">Đang trực</div></Card>
            <Card className="p-2"><div className="text-2xl font-semibold text-amber-700">{count('late')}</div><div className="text-sm text-slate-500">Trễ</div></Card>
            <Card className="p-2"><div className="text-2xl font-semibold text-red-700">{count('absent')}</div><div className="text-sm text-slate-500">Vắng</div></Card>
          </div>
          {board.map((r) => (
            <Link key={r.id} to={`/doi/ca/${siteId}/${r.id}`} className="block">
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">{r.employee_name}</span>
                  <Badge tone={ATTENDANCE_STATUS[r.status]?.tone ?? ''}>{ATTENDANCE_STATUS[r.status]?.label ?? r.status}</Badge>
                </div>
                <div className="text-sm text-slate-500">
                  {r.template_name ?? 'Ca lẻ'} {time(r.planned_start)}–{time(r.planned_end)}
                  {r.check_in_at && ` · vào ${time(r.check_in_at)}`}{r.late_in && <span className="text-amber-700"> (trễ {r.late_minutes}′)</span>}
                  {r.check_out_at && ` · ra ${time(r.check_out_at)}`}
                </div>
                {[...(r.check_in_flags ?? []), ...(r.check_out_flags ?? [])].length > 0 && <div className="text-sm text-red-700">⚠ Có dấu hiệu nghi vấn</div>}
              </Card>
            </Link>
          ))}
          {!board.length && <p className="py-6 text-center text-slate-400">Hôm nay không có ca nào</p>}
        </>
      )}

      {part === 'rounds' && rounds && (
        <>
          <Card className="grid grid-cols-4 gap-1 p-2 text-center text-sm">
            {(['completed', 'in_progress', 'partial', 'missed'] as const).map((k) => (
              <div key={k}><div className="text-xl font-semibold">{rounds.summary[k] ?? 0}</div><div className="text-slate-500">{ROUND_STATUS[k].label}</div></div>
            ))}
          </Card>
          {rounds.rounds.map((r) => (
            <Link key={r.id} to={`/doi/vong/${r.id}`} className="block">
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">{time(r.expected_start)}–{time(r.expected_end)}</span>
                  <Badge tone={ROUND_STATUS[r.status]?.tone ?? ''}>{ROUND_STATUS[r.status]?.label}</Badge>
                </div>
                <div className="text-sm text-slate-500">{r.route_name} · {r.employee_name ?? 'chưa ai đi'}{r.started_at ? ` · ${r.done_required}/${r.required_count} điểm` : ''}</div>
                {(r.late || r.suspicious_count > 0) && <div className="text-sm text-red-700">{r.late ? 'Bắt đầu trễ. ' : ''}{r.suspicious_count ? `${r.suspicious_count} lần quét nghi vấn` : ''}</div>}
              </Card>
            </Link>
          ))}
          {!rounds.rounds.length && <p className="py-6 text-center text-slate-400">Hôm nay không có vòng tuần</p>}
        </>
      )}

      {part === 'book' && book && (
        <>
          {book.inside.length > 0 && (
            <Card>
              <div className="mb-1 font-semibold">Đang ở trong ({book.inside.length})</div>
              {book.inside.map((l) => <div key={l.id} className="border-t border-slate-100 py-1.5 text-base">{LOGBOOK_TYPE[l.type]} · {lineText(l)} <span className="text-sm text-slate-400">vào {time(l.occurred_at)}</span></div>)}
            </Card>
          )}
          {book.today.map((l) => (
            <Card key={l.id}>
              <div className="text-sm text-slate-400">{time(l.occurred_at)} · {LOGBOOK_TYPE[l.type]} · {l.author_name}</div>
              <div className="text-base">{lineText(l)}{l.exited_at && <span className="text-sm text-slate-500"> · ra {time(l.exited_at)}</span>}</div>
              {l.type !== 'note' && l.type !== 'other' && l.body && <div className="text-sm text-slate-600">{l.body}</div>}
              {l.files.length > 0 && <div className="mt-2 flex gap-2">{l.files.map((f) => <AuthImage key={f.id} fileId={f.id} className="h-16 w-16" />)}</div>}
            </Card>
          ))}
          {!book.today.length && <p className="py-6 text-center text-slate-400">Hôm nay chưa ghi sổ</p>}
        </>
      )}
    </Screen>
  );
}
```

- [ ] **Step 2: Một người trong ca**

`mobile/src/screens/PersonShift.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { localDate, time } from '../lib/format';
import { ATTENDANCE_STATUS, SCAN_FLAG } from '../lib/labels';
import { BoardRow } from './Team';

export function PersonShift() {
  const { siteId, assignmentId } = useParams<{ siteId: string; assignmentId: string }>();
  const [row, setRow] = useState<BoardRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.request<{ rows: BoardRow[] }>(`/attendance/board?site_id=${siteId}&date=${localDate(0)}`)
      .then((b) => setRow(b.rows.find((r) => r.id === assignmentId) ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra'));
  }, [siteId, assignmentId]);

  if (!row) return <Screen title="Ca trực" back><ErrorText error={error} /></Screen>;
  const flags = (f: string[] | null) => (f ?? []).map((x) => SCAN_FLAG[x] ?? x).join(', ');
  return (
    <Screen title={row.employee_name} back>
      <Card>
        <Badge tone={ATTENDANCE_STATUS[row.status]?.tone ?? ''}>{ATTENDANCE_STATUS[row.status]?.label ?? row.status}</Badge>
        <div className="mt-2 text-lg">{row.template_name ?? 'Ca lẻ'} {time(row.planned_start)}–{time(row.planned_end)}</div>
        <div className="text-base text-slate-600">Mã NV {row.employee_code}</div>
      </Card>
      <Card>
        <div className="font-semibold">Vào ca {time(row.check_in_at)}{row.late_in && <span className="text-amber-700"> · trễ {row.late_minutes} phút</span>}</div>
        {row.check_in_distance_m !== null && <div className="text-sm text-slate-500">Cách mục tiêu {row.check_in_distance_m} m</div>}
        {flags(row.check_in_flags) && <div className="text-sm text-red-700">⚠ {flags(row.check_in_flags)}</div>}
        {row.check_in_selfie_id && <AuthImage fileId={row.check_in_selfie_id} className="mt-2 aspect-square w-40" />}
      </Card>
      {row.check_out_at && (
        <Card>
          <div className="font-semibold">Ra ca {time(row.check_out_at)}{row.early_out && <span className="text-amber-700"> · sớm {row.early_minutes} phút</span>}</div>
          {flags(row.check_out_flags) && <div className="text-sm text-red-700">⚠ {flags(row.check_out_flags)}</div>}
          {row.check_out_selfie_id && <AuthImage fileId={row.check_out_selfie_id} className="mt-2 aspect-square w-40" />}
        </Card>
      )}
    </Screen>
  );
}
```

- [ ] **Step 3: Chi tiết vòng**

`mobile/src/screens/RoundDetail.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { stamp, time } from '../lib/format';
import { ROUND_STATUS, SCAN_FLAG } from '../lib/labels';

interface Round {
  site_name: string;
  route_name: string;
  expected_start: string;
  expected_end: string;
  status: string;
  late: boolean;
  employee_name: string | null;
  started_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  required_count: number;
  done_required: number;
  stops: { checkpoint_id: string; code: string; name: string; required: boolean; scanned_at: string | null; method: string | null; validity: string | null; flags: string[] }[];
  scans: { id: string; checkpoint_code: string; checkpoint_name: string; method: string; scanned_at: string; captured_offline: boolean; distance_m: number | null; photo_id: string | null; flags: string[]; validity: string }[];
}

const METHOD: Record<string, string> = { qr: 'QR', gps: 'GPS', photo: 'Ảnh' };

export function RoundDetail() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.request<Round>(`/patrol/rounds/${id}`).then(setR).catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra')); }, [id]);

  if (!r) return <Screen title="Vòng tuần" back><ErrorText error={error} /></Screen>;
  return (
    <Screen title={`${time(r.expected_start)}–${time(r.expected_end)}`} back>
      <Card>
        <Badge tone={ROUND_STATUS[r.status]?.tone ?? ''}>{ROUND_STATUS[r.status]?.label}</Badge>
        <div className="mt-2 text-lg font-semibold">{r.route_name} · {r.site_name}</div>
        <div className="text-base text-slate-600">{r.employee_name ?? 'Chưa ai đi'}{r.started_at && ` · bắt đầu ${time(r.started_at)}`}{r.late && <span className="text-amber-700"> (trễ)</span>}</div>
        {r.ended_at && <div className="text-sm text-slate-500">Kết thúc {time(r.ended_at)}{r.ended_by === 'system' ? ' (hệ thống tự đóng)' : ''} · {r.done_required}/{r.required_count} điểm bắt buộc</div>}
      </Card>
      <Card>
        {r.stops.map((s) => (
          <div key={s.checkpoint_id} className={`flex items-center justify-between border-t border-slate-100 py-2 first:border-0 ${!s.scanned_at && s.required && r.ended_at ? 'text-red-700' : ''}`}>
            <span>{s.scanned_at ? '✓' : '○'} {s.code} · {s.name}{!s.required && <span className="text-sm text-slate-400"> (không bắt buộc)</span>}</span>
            <span className="text-sm text-slate-500">{s.scanned_at ? `${time(s.scanned_at)} ${METHOD[s.method ?? ''] ?? ''}` : ''}</span>
          </div>
        ))}
      </Card>
      {r.scans.map((s) => (
        <Card key={s.id} className={s.validity === 'suspicious' ? 'border-red-300' : ''}>
          <div className="font-semibold">{s.checkpoint_code} · {s.checkpoint_name}</div>
          <div className="text-sm text-slate-500">{METHOD[s.method]} lúc {stamp(s.scanned_at)}{s.captured_offline ? ' · gửi bù khi mất sóng' : ''}{s.distance_m !== null ? ` · cách ${s.distance_m} m` : ''}</div>
          {s.flags.length > 0 && <div className="text-sm text-red-700">⚠ {s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</div>}
          {s.photo_id && <AuthImage fileId={s.photo_id} className="mt-2 h-32 w-32" />}
        </Card>
      ))}
    </Screen>
  );
}
```

- [ ] **Step 4: Commit** (build ở Task 5)

```bash
git add mobile
git commit -m "feat(mobile): team screen — who is on duty with selfies, today's rounds and checkpoints, the site's book"
```

---

### Task 5: Tổng quan, Duyệt; build, APK

**Files:**
- Create: `mobile/src/screens/Overview.tsx`, `mobile/src/screens/Reviews.tsx`
- Modify: `mobile/src/screens/Me.tsx`

**Interfaces:**
- Consumes: `GET /api/incidents?status=open`, `GET /api/patrol/today`, `GET /api/violations/summary`, `GET /api/dashboard/company`, `GET /api/violations?status=open`, `POST /api/violations/:id/{propose|review}`, `GET /api/sites/:id/handovers?date`, `POST /api/handovers/:id/review`.
- Produces: `Overview` (Q1/Q7: sự cố mở theo mức độ và số chưa ai nhận; mục tiêu có vòng bỏ lỡ/thiếu điểm hôm nay lên đầu; vi phạm chờ xử lý; bảo vệ đang làm/được điều động/chưa có chỗ; khách thiếu người; hợp đồng sắp hết hạn — chạm để mở tab tương ứng), `Reviews` (vi phạm chờ xử lý với nút đề xuất hoặc duyệt theo quyền, không hiện nút cho vi phạm của chính mình; biên bản giao ca hôm qua và hôm nay của mục tiêu đã chọn chờ duyệt). `Me` thêm lối vào `Tổng quan` khi tab đó bị ẩn.

- [ ] **Step 1: Tổng quan**

`mobile/src/screens/Overview.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { SEVERITY } from '../lib/labels';

interface Data {
  incidents?: { severity: string; status: string }[];
  patrol?: { site_id: string; site_name: string; total: number; completed: number; partial: number; missed: number; suspicious: number }[];
  violations?: { auto: number; proposed_confirm: number; proposed_waive: number };
  company?: { guards: { active: number; deployed: number; idle: number }; shortfalls: unknown[]; expiring_contracts: unknown[] };
}

export function Overview() {
  const { can } = useAuth();
  const [data, setData] = useState<Data>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [incidents, patrol, violations, company] = await Promise.all([
        can('incident.view') ? api.request<Data['incidents']>('/incidents?status=open') : undefined,
        can('patrol.view') ? api.request<Data['patrol']>('/patrol/today') : undefined,
        can('violation.view') ? api.request<Data['violations']>('/violations/summary') : undefined,
        can('client.view') ? api.request<Data['company']>('/dashboard/company') : undefined,
      ]);
      setData({ incidents, patrol, violations, company });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [can]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const open = data.incidents ?? [];
  const fresh = open.filter((i) => i.status === 'new').length;
  const troubled = (data.patrol ?? []).filter((p) => p.missed || p.partial || p.suspicious).sort((a, b) => b.missed - a.missed || b.partial - a.partial);
  const pending = data.violations ? data.violations.auto + data.violations.proposed_confirm + data.violations.proposed_waive : 0;

  return (
    <Screen title="Tổng quan" action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      <ErrorText error={error} />
      {data.incidents && (
        <Link to="/su-co" className="block">
          <Card className={fresh ? 'border-red-400' : ''}>
            <div className="flex items-center justify-between"><b className="text-lg">Sự cố đang mở</b><span className="text-2xl font-semibold">{open.length}</span></div>
            {fresh > 0 && <div className="text-red-700">{fresh} chưa ai tiếp nhận</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              {(['critical', 'high', 'medium', 'low'] as const).map((s) => {
                const n = open.filter((i) => i.severity === s).length;
                return n ? <span key={s} className={`rounded-md px-2 py-0.5 text-sm ${SEVERITY[s].tone}`}>{SEVERITY[s].label}: {n}</span> : null;
              })}
            </div>
          </Card>
        </Link>
      )}
      {data.patrol && (
        <Link to="/doi" className="block">
          <Card className={troubled.some((p) => p.missed) ? 'border-red-400' : ''}>
            <b className="text-lg">Tuần tra hôm nay</b>
            {troubled.length ? troubled.slice(0, 6).map((p) => (
              <div key={p.site_id} className="flex justify-between border-t border-slate-100 py-1.5 text-base">
                <span>{p.site_name}</span>
                <span className="text-sm">{p.missed ? <span className="text-red-700">{p.missed} bỏ lỡ </span> : null}{p.partial ? <span className="text-amber-700">{p.partial} thiếu </span> : null}{p.suspicious ? <span className="text-red-700">{p.suspicious} nghi vấn</span> : null}</span>
              </div>
            )) : <div className="text-slate-500">Các mục tiêu đều tuần tra đủ</div>}
          </Card>
        </Link>
      )}
      {data.violations && (
        <Link to="/duyet" className="block">
          <Card className={pending ? 'border-amber-300' : ''}>
            <div className="flex items-center justify-between"><b className="text-lg">Vi phạm chờ xử lý</b><span className="text-2xl font-semibold">{pending}</span></div>
            {data.violations.proposed_confirm + data.violations.proposed_waive > 0 && <div className="text-amber-700">{data.violations.proposed_confirm + data.violations.proposed_waive} đề xuất của đội trưởng chờ duyệt</div>}
          </Card>
        </Link>
      )}
      {data.company && (
        <Card>
          <b className="text-lg">Nhân sự & hợp đồng</b>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xl font-semibold">{data.company.guards.active}</div><div className="text-sm text-slate-500">Đang làm</div></div>
            <div><div className="text-xl font-semibold">{data.company.guards.deployed}</div><div className="text-sm text-slate-500">Được điều động</div></div>
            <div><div className={`text-xl font-semibold ${data.company.guards.idle ? 'text-amber-700' : ''}`}>{data.company.guards.idle}</div><div className="text-sm text-slate-500">Chưa có chỗ</div></div>
          </div>
          {data.company.shortfalls.length > 0 && <div className="mt-2 text-amber-700">{data.company.shortfalls.length} vị trí khách đang thiếu người</div>}
          {data.company.expiring_contracts.length > 0 && <div className="text-amber-700">{data.company.expiring_contracts.length} hợp đồng sắp hết hạn — xem trên web</div>}
        </Card>
      )}
    </Screen>
  );
}
```

- [ ] **Step 2: Duyệt**

`mobile/src/screens/Reviews.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SitePicker } from '../components/SitePicker';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { localDate, stamp } from '../lib/format';
import { SCAN_FLAG, VIOLATION_STATUS, VIOLATION_TYPE } from '../lib/labels';

interface Violation {
  id: string;
  type: string;
  status: string;
  occurred_at: string;
  minutes: number | null;
  detail: { missing?: { code: string }[]; flags?: string[]; round_id?: string; converted_from?: string };
  ref_type: string;
  ref_id: string;
  site_name: string;
  employee_id: string;
  employee_name: string;
  proposed_note: string | null;
  proposed_by_name: string | null;
}

interface Handover {
  id: string;
  from_name: string;
  to_name: string | null;
  status: string;
  submitted_at: string;
  items: { label: string; status: string; note?: string }[];
  notes: string | null;
  receiver_note: string | null;
  reviewed_at: string | null;
}

function what(v: Violation): string {
  if (v.type === 'late_check_in' || v.type === 'early_check_out') return `${v.minutes ?? '?'} phút${v.detail.converted_from ? ' (lúc đầu ghi vắng)' : ''}`;
  if (v.type === 'missed_checkpoint') return `thiếu ${(v.detail.missing ?? []).map((m) => m.code).join(', ')}`;
  if (v.type === 'suspicious_scan') return (v.detail.flags ?? []).map((f) => SCAN_FLAG[f] ?? f).join(', ');
  return '';
}

export function Reviews() {
  const { me, can } = useAuth();
  const [violations, setViolations] = useState<Violation[] | null>(null);
  const [siteId, setSiteId] = useState('');
  const [handovers, setHandovers] = useState<Handover[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reviewer = can('violation.review');
  const proposer = can('violation.propose');

  const load = useCallback(async () => {
    try {
      if (can('violation.view')) setViolations(await api.request<Violation[]>('/violations?status=open'));
      if (can('handover.review') && siteId) {
        const [today, yesterday] = await Promise.all([
          api.request<Handover[]>(`/sites/${siteId}/handovers?date=${localDate(0)}`),
          api.request<Handover[]>(`/sites/${siteId}/handovers?date=${localDate(-1)}`),
        ]);
        setHandovers([...today, ...yesterday].filter((h) => !h.reviewed_at));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [can, siteId]);
  useEffect(() => { void load(); }, [load]);

  async function decide(v: Violation, step: 'propose' | 'review', decision: 'confirm' | 'waive') {
    const note = window.prompt(decision === 'waive' ? 'Lý do miễn (bắt buộc):' : 'Ghi chú (không bắt buộc):');
    if (note === null) return;
    try {
      await api.request(`/violations/${v.id}/${step}`, { json: { decision, ...(note.trim() ? { note: note.trim() } : {}) } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }

  async function review(h: Handover) {
    const note = window.prompt('Nhận xét khi duyệt (không bắt buộc):');
    if (note === null) return;
    try {
      await api.request(`/handovers/${h.id}/review`, { json: note.trim() ? { note: note.trim() } : {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }

  return (
    <Screen title="Duyệt" action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      <ErrorText error={error} />
      {violations && (
        <>
          <h2 className="text-sm font-semibold uppercase text-slate-500">Vi phạm chờ xử lý ({violations.length})</h2>
          {violations.map((v) => {
            const own = Boolean(me?.user.employee_id) && v.employee_id === me?.user.employee_id;
            const roundId = v.ref_type === 'round' ? v.ref_id : v.detail.round_id;
            return (
              <Card key={v.id}>
                <div className="flex items-center justify-between">
                  <b className="text-lg">{v.employee_name}</b>
                  <span className="text-sm text-slate-400">{stamp(v.occurred_at)}</span>
                </div>
                <div className="text-base">{VIOLATION_TYPE[v.type]}{what(v) ? ` — ${what(v)}` : ''} · {v.site_name}</div>
                {roundId && <Link to={`/doi/vong/${roundId}`} className="text-sm text-teal-700 underline">Xem vòng</Link>}
                <div className="text-sm text-slate-500">{VIOLATION_STATUS[v.status]}{v.proposed_by_name ? ` · ${v.proposed_by_name}${v.proposed_note ? `: ${v.proposed_note}` : ''}` : ''}</div>
                {!own && (reviewer || proposer) && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button tone="secondary" onClick={() => void decide(v, reviewer ? 'review' : 'propose', 'confirm')}>{reviewer ? 'Xác nhận' : 'Đề xuất xác nhận'}</Button>
                    <Button tone="secondary" onClick={() => void decide(v, reviewer ? 'review' : 'propose', 'waive')}>{reviewer ? 'Miễn' : 'Đề xuất miễn'}</Button>
                  </div>
                )}
              </Card>
            );
          })}
          {!violations.length && <p className="py-4 text-center text-slate-400">Không có vi phạm chờ xử lý</p>}
        </>
      )}
      {can('handover.review') && (
        <>
          <h2 className="pt-2 text-sm font-semibold uppercase text-slate-500">Biên bản giao ca chờ duyệt</h2>
          <SitePicker value={siteId} onChange={setSiteId} />
          {handovers?.map((h) => {
            const answered = h.status !== 'submitted' || !h.to_name;
            return (
              <Card key={h.id} className={h.status === 'disputed' || h.items.some((i) => i.status !== 'ok') ? 'border-red-300' : ''}>
                <div className="text-lg"><b>{h.from_name}</b> → <b>{h.to_name ?? 'chưa rõ người nhận'}</b></div>
                <div className="text-sm text-slate-400">{stamp(h.submitted_at)} · {h.status === 'accepted' ? 'người nhận đồng ý' : h.status === 'disputed' ? 'người nhận KHÔNG đồng ý' : 'chờ người nhận'}</div>
                {h.items.filter((i) => i.status !== 'ok').map((i) => <div key={i.label} className="text-red-700">✗ {i.label}{i.note ? `: ${i.note}` : ''}</div>)}
                {h.notes && <div className="text-slate-600">Ghi chú: {h.notes}</div>}
                {h.receiver_note && <div className="text-red-700">Người nhận: {h.receiver_note}</div>}
                {answered && <Button tone="secondary" className="mt-2" onClick={() => void review(h)}>Duyệt biên bản</Button>}
              </Card>
            );
          })}
          {handovers && !handovers.length && <p className="py-4 text-center text-slate-400">Không có biên bản chờ duyệt</p>}
        </>
      )}
    </Screen>
  );
}
```

- [ ] **Step 3: Lối vào Tổng quan từ trang Tôi**

Trong `mobile/src/screens/Me.tsx`: import `navFor` từ `../lib/nav`; ngay trước `<Link to="/doi-mat-khau"` thêm:
```tsx
      {(me.permissions.includes('client.view') || me.permissions.includes('violation.review')) && !navFor(me.permissions, Boolean(me.user.employee_id)).some((t) => t.to === '/tong-quan') && (
        <Link to="/tong-quan" className="block"><Button tone="secondary">Tổng quan công ty</Button></Link>
      )}
```

- [ ] **Step 4: Build, test, APK, commit**

Run: `cd mobile && npm test && npm run build`
Expected: PASS; build thành công.

Run (APK thử trong LAN như Plan 09a):
```bash
cd mobile && VITE_API_BASE=http://<IP>:3001/api MOBILE_DEV=1 npm run build && MOBILE_DEV=1 npx cap sync android
cd android && JAVA_HOME=/d/Apps/AndroidStudio/jbr ./gradlew.bat assembleDebug
```
Expected: `BUILD SUCCESSFUL`.

Kiểm tra API như app gọi (đội trưởng demo `0910000001`, Bearer): `/incidents?status=open`, `/attendance/board?site_id=…&date=hôm nay`, `/patrol/rounds?…`, `/violations?status=open`, `/incidents/:id/assignees` đều 200; giám đốc demo `0900000001`: `/dashboard/company`, `/patrol/today`, `/violations/summary` 200.

```bash
git add mobile
git commit -m "feat(mobile): overview for managers, reviews of violations and handovers"
```

---

## Self-review (người viết kế hoạch)

- **Phủ spec:** T1 → Task 4; T2, T3, Q2, Q3 → Task 3; T5, Q5, T6 (duyệt giao ca, xem sổ) → Task 4–5; Q1, Q7 → Task 5; §5.1.4 mở đúng màn → Task 2. Để sau: T4, T7, Q4, Q6, nút trên thông báo.
- **Không có chỗ trống:** mọi bước có mã và lệnh cụ thể.
- **Khớp tên:** `navFor/routeFor`, `incidentActions`, `AuthImage`, `PhotoStrip/uploadAll`, `SitePicker`, `BoardRow` (xuất từ `Team`), các màn đăng ký ở `App.tsx` Task 2 và được tạo ở Task 3–5.
