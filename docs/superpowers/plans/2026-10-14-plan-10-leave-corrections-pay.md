# Plan 10 — Đơn nghỉ, bổ sung chấm công, lương & ngày phép — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bảo vệ xin nghỉ và xin bổ sung/điều chỉnh chấm công ngay trên app; đội trưởng hoặc quản lý duyệt đơn nghỉ (ca trong ngày nghỉ được huỷ, vắng không bị ghi); đơn chấm công đi hai cấp như vi phạm (đội trưởng đề xuất, quản lý duyệt), duyệt xong giờ công được sửa có lưu vết và vi phạm còn mở được tính lại. Hồ sơ nhân viên có phần "Lương & ngày phép" riêng quyền; số ngày phép năm để trống là không theo dõi.

**Architecture:** Khối mới `requests` trong backend: `LeaveService`, `CorrectionsService`, `PayService`, một controller `RequestsController`. Quy tắc tính lại vi phạm đặt trong `ViolationsEngine.reconcileAttendance(m, assignmentId)` (dùng chung bộ mốc của mục tiêu); bước mới "thiếu giờ ra" trong vòng quét mỗi phút. Ca bị huỷ vì nghỉ mang `shift_assignments.leave_request_id`; `RosterService.substitute` nhận cả ca đó.

**Tech Stack:** như trước (NestJS 11, TypeORM 0.3, PostgreSQL 16; Next.js 14; React + Capacitor).

**Spec:** `docs/superpowers/specs/2026-10-12-patrol-phase1-design.md` bản 1.9 — §4.3a, §4.8. Chủ dự án 14/10/2026: phép năm đặt trong phần lương & phép, để trống = không tính; đơn nghỉ đội trưởng hoặc quản lý duyệt; mốc 48 giờ và 12 giờ.

**Khác với spec (có chủ đích):**
- Đơn chỉ gửi khi có mạng (không vào hàng đợi offline); `client_uuid` vẫn giữ để bấm hai lần không thành hai đơn.
- Số ngày nghỉ đếm theo ngày lịch (từ–đến, gồm cả hai đầu); nửa ngày để sau.
- Bỏ duyệt một đơn nghỉ đã duyệt chưa làm (ca đã huỷ không tự khôi phục).

## Global Constraints

- Mọi quy ước Plan 01–09 giữ nguyên: `tenantOf`, phạm vi qua `ScopeService`, `{data}`/`{error}`, mã lỗi tiếng Anh + câu tiếng Việt, audit cho mọi quyết định.
- Ngày theo giờ Việt Nam (`todayLocal`, `shift_date`). Giờ lưu `timestamptz`.
- Ảnh đính kèm: của chính người gửi, chưa gắn vào đâu, tối đa 3 (`FilesService.claim`).
- Không ai tự duyệt (hay tự đề xuất) đơn của chính mình.

## Review Focus

1. **Không mất dấu và không phạt oan**: nghỉ có đơn duyệt thì không có vắng; bổ sung chấm công duyệt xong thì vắng/trễ/ra sớm còn mở khớp giờ mới; vi phạm đã duyệt không bị đụng — Task 2, 3.
2. **Đúng người**: chỉ người xếp ca được cho bảo vệ đó mới duyệt; không tự duyệt; giờ đề nghị trong cửa sổ hợp lệ; dữ liệu lương chỉ người có quyền thấy — Task 1–4.

---

### Task 1: Schema, quyền, entity, lương & ngày phép

**Files:**
- Create: `backend/src/database/migrations/1761500000000-LeaveCorrectionsPay.ts`, `backend/src/requests/{leave-request.entity,attendance-correction.entity,employee-pay.entity,dto,pay.service,requests.module}.ts`
- Modify: `backend/src/access/permissions.ts`, `backend/src/common/errors/error-codes.ts`, `backend/src/files/file.entity.ts`, `backend/src/app.module.ts`, `backend/test/users.e2e-spec.ts`, `backend/test/access.e2e-spec.ts`
- Test: `backend/test/pay.e2e-spec.ts`

**Interfaces:**
- Quyền: `employee.pay.view` 'Xem lương và ngày phép', `employee.pay.manage` 'Sửa lương và ngày phép', `leave.review` 'Duyệt đơn nghỉ', `attendance.correct.propose` 'Đề xuất duyệt đơn bổ sung chấm công', `attendance.correct.review` 'Duyệt đơn bổ sung chấm công, sửa chấm công'.
  Vai trò mẫu: `admin` tất cả; `manager` leave.review + correct.propose + correct.review; `team_leader` leave.review + correct.propose; `hr` pay.view + pay.manage; `accountant` pay.view + pay.manage. Migration cấp cho vai trò hệ thống của công ty đã có.
- Bảng `employee_pay` (employee_id PK/FK, tenant_id, pay_type, base_pay numeric(14,0), allowance numeric(14,0), bank_name, bank_account, tax_code, social_insurance_no, annual_leave_days int NULL CHECK 0–365, note, updated_by, timestamps).
- Bảng `leave_requests` (§4.3a) — CHECK to_date ≥ from_date, UNIQUE (tenant_id, client_uuid), chỉ mục (tenant_id, employee_id, from_date).
- Bảng `attendance_corrections` (§4.3a) — CHECK có ít nhất một giờ, UNIQUE (tenant_id, client_uuid), chỉ mục duy nhất một đơn mở mỗi ca: `(assignment_id) WHERE status IN ('pending','proposed_approve','proposed_reject')`.
- Cột: `shift_assignments.leave_request_id uuid NULL`, `attendances.corrected_at timestamptz NULL`, `attendances.missing_out_alerted_at timestamptz NULL`; `attendances.check_in_lat/lng` vốn đã nullable.
- `FileOwnerType` thêm `'leave_request' | 'attendance_correction'`.
- API: `GET /employees/:id/pay` (pay.view) → `{ pay | null, leave: { year, allowance, used, remaining } }`; `PUT /employees/:id/pay` (pay.manage); `GET /me/leave-balance?year=`.
- Mã lỗi: `LEAVE_RANGE_INVALID`, `LEAVE_OVERLAP`, `LEAVE_NOT_PENDING`, `LEAVE_OWN`, `LEAVE_NOTE_REQUIRED`, `ROSTER_ON_LEAVE`, `CORRECTION_TOO_LATE`, `CORRECTION_TIME_INVALID`, `CORRECTION_OPEN_EXISTS`, `CORRECTION_NOT_OPEN`, `CORRECTION_OWN`, `CORRECTION_NOTE_REQUIRED`, `CORRECTION_NOTHING`, `REQUEST_PHOTO_INVALID`.

- [ ] **Step 1: Viết test thất bại** — `pay.e2e-spec.ts`: vai trò mẫu có đúng quyền mới; HR đặt lương + 12 ngày phép, đọc lại; quản lý (không có quyền) → 403; hồ sơ `GET /employees/:id/profile` không lộ lương; `annual_leave_days` null → `leave.allowance = null, remaining = null`; audit `employee.pay.update`.
- [ ] **Step 2: Chạy, thấy đỏ.**
- [ ] **Step 3: Migration, entity, quyền, PayService, endpoint.**
- [ ] **Step 4: Chạy lại, xanh; sửa fixture quyền (`users`, `access`).**

### Task 2: Đơn xin nghỉ

**Files:** Create `backend/src/requests/leave.service.ts`, `backend/src/requests/people.ts`, `backend/src/requests/requests.controller.ts`; Modify `backend/src/shifts/roster.service.ts`, `backend/src/violations/engine.service.ts`. Test `backend/test/leave.e2e-spec.ts`.

**Quy tắc:**
- `POST /leave-requests` {client_uuid, type, from_date, to_date, reason, file_ids?, employee_id?}. Không có `employee_id` = cho chính mình (cần hồ sơ nhân viên). Có `employee_id` khác mình = ghi thay, cần `leave.review` và xếp ca được cho người đó. Ngày: from ≥ hôm nay − 7, to ≤ hôm nay + 90, tối đa 31 ngày → không thì `LEAVE_RANGE_INVALID`. Trùng ngày với đơn chờ/đã duyệt của cùng người → `LEAVE_OVERLAP`. Cùng `client_uuid` → trả đơn cũ.
- `urgent` = có ca planned của người đó trong các ngày nghỉ, bắt đầu trước now + 12h. Báo đội trưởng đội người đó (`leave.submitted`); gấp → thêm quản lý nhóm, `priority: high`.
- `GET /leave-requests?status=&employee_id=&from=&to=` cho người có `leave.review` (trong phạm vi đội) ; `GET /me/leave-requests` của mình. Mỗi dòng kèm `shifts` (ca bị ảnh hưởng: id, giờ, mục tiêu, đã vào ca chưa), `balance` khi loại `annual` và có theo dõi.
- `POST /leave-requests/:id/approve` {note?}, `/reject` {note bắt buộc}: chỉ đơn `pending`; không tự duyệt (`LEAVE_OWN`); người duyệt xếp ca được cho người đó. Duyệt: trong một transaction, khoá các ca planned chưa vào ca trong ngày nghỉ → `status='cancelled'`, `leave_request_id`, note "Nghỉ có đơn"; vi phạm `absent`/`late_check_in` còn mở của các ca đó → `waived`, review_note 'Hệ thống: nghỉ có đơn được duyệt'. Báo người gửi (`leave.decided`).
- `POST /leave-requests/:id/cancel`: người gửi (hoặc chính chủ), chỉ `pending`.
- Xếp ca: `insert` từ chối `ROSTER_ON_LEAVE` nếu ngày ca nằm trong đơn đã duyệt của người đó. `substitute` nhận ca `cancelled` có `leave_request_id` khi chưa có ca thay nào trỏ về nó (không chạy `recordAbsenceIfDue`, không huỷ lại).

- [ ] Step 1 test đỏ: gửi đơn → đội trưởng nhận thông báo, không gấp; đơn sát giờ → gấp, quản lý nhận; trùng → LEAVE_OVERLAP; ngoài khoảng → LEAVE_RANGE_INVALID; bảo vệ khác đội không duyệt được (403/404); tự duyệt → LEAVE_OWN; từ chối không lý do → LEAVE_NOTE_REQUIRED; duyệt → ca huỷ, vi phạm vắng đã ghi được miễn, engine tick không ghi vắng nữa; xếp ca vào ngày nghỉ → ROSTER_ON_LEAVE; gọi trực thay cho ca nghỉ được; huỷ đơn chờ; phép năm: 12 ngày, duyệt 3 → used 3 remaining 9; replay client_uuid.
- [ ] Step 2–4 như Task 1.

### Task 3: Đơn bổ sung / điều chỉnh chấm công

**Files:** Create `backend/src/requests/corrections.service.ts`; Modify `backend/src/violations/engine.service.ts`, `backend/src/attendance/attendance.service.ts` (board/myShifts trả `corrected`). Test `backend/test/corrections.e2e-spec.ts`.

**Quy tắc:**
- `POST /attendance-corrections` {client_uuid, assignment_id, check_in_at?, check_out_at?, reason_code, reason?, file_ids?}. Chủ ca: ca planned của mình, now ≤ planned_end + 48h (`CORRECTION_TOO_LATE`), một đơn mở mỗi ca (`CORRECTION_OPEN_EXISTS`). Không phải chủ ca: cần `attendance.correct.review`, thấy mục tiêu, không phải ca của mình, bắt buộc `reason`; đơn được duyệt và áp dụng ngay (sửa thẳng của quản lý, không giới hạn 48h).
- Giờ hiệu lực = giờ đề nghị, thiếu thì lấy giờ đang có. Vào: [planned_start − 1h, planned_end]; ra: > vào, ≤ planned_end + 6h, ≤ now; có giờ ra mà không có giờ vào → `CORRECTION_TIME_INVALID`. Đề nghị trùng y giờ đang có → `CORRECTION_NOTHING`.
- `GET /attendance-corrections?status=open|…&site_id=` (propose hoặc review, theo mục tiêu thấy được); `GET /me/attendance-corrections`; `GET /attendance-corrections/:id` kèm `evidence`: `{ scans: n, first_scan_at, last_scan_at, logbook: n, handovers: [...] }` trong [planned_start − 1h, planned_end + 6h] của người đó, và `current` (giờ đang có).
- `POST /:id/propose` {decision: approve|reject, note?} (`attendance.correct.propose`) chỉ đơn mở chưa duyệt; reject cần note. `POST /:id/review` {decision, note?} (`attendance.correct.review`): từ `pending|proposed_*`; reject hoặc đi ngược đề xuất cần note. `POST /:id/cancel` chủ đơn, đơn mở.
- Áp dụng (transaction, khoá ca + chấm công): chưa có bản ghi → tạo `attendances` (không ảnh, không GPS, `check_in_flags=['corrected']`); có rồi → sửa giờ được đề nghị, thêm cờ `corrected` vào phía bị sửa; tính lại `late_minutes`, `early_minutes`, `worked_minutes`; `corrected_at = now`; `before` lưu giá trị cũ; audit `attendance.correct`. Rồi `engine.reconcileAttendance(m, assignmentId)`.
- `reconcileAttendance`: mốc theo mục tiêu, ANCHOR như cũ. Vi phạm còn mở của ca: có giờ vào: trễ ≤ mốc → miễn `absent`/`late_check_in` ('Hệ thống: chấm công được bổ sung'); trễ > mốc → `absent` đổi thành `late_check_in` (như `lateArrivals`), `late_check_in` cập nhật số phút, chưa có thì ghi mới. Có giờ ra: ra sớm ≤ mốc → miễn `early_check_out`; > mốc → cập nhật hoặc ghi mới. Chỉ cho khách `managed`.
- Engine bước "thiếu giờ ra": có vào, chưa ra, planned_end + 6h đã qua (trong 2 ngày), `missing_out_alerted_at` null → đặt, báo người đó (`attendance.missing_out`).

- [ ] Step 1 test đỏ: máy hết pin, đơn bổ sung giờ vào+ra → đội trưởng đề xuất duyệt → quản lý duyệt → có chấm công cờ corrected, vắng → miễn; vào trễ 40 phút qua đơn → vắng đổi thành trễ 40; quên ra ca → nhắc một lần; đơn quá 48h → CORRECTION_TOO_LATE; giờ ngoài cửa sổ → CORRECTION_TIME_INVALID; đơn thứ hai → CORRECTION_OPEN_EXISTS; đội trưởng không duyệt cuối được (403); tự đề xuất → CORRECTION_OWN; quản lý sửa thẳng ca người khác → áp dụng ngay, cần lý do; vi phạm đã xác nhận giữ nguyên; evidence đếm lần quét; replay.
- [ ] Step 2–4.

### Task 4: Cách ly công ty, dữ liệu demo

- Test `backend/test/requests-tenancy.e2e-spec.ts`: công ty B không đọc/duyệt đơn, không đọc lương của công ty A (404).
- Seed demo: một đơn nghỉ chờ duyệt, một đơn bổ sung chấm công chờ đề xuất, lương mẫu cho 2 bảo vệ.

### Task 5: Web

- Trang `/don-tu` (menu "Đơn từ", quyền `leave.review` hoặc `attendance.correct.propose`): hai thẻ "Đơn nghỉ" và "Bổ sung chấm công"; lọc trạng thái; xem ca bị ảnh hưởng, dữ liệu đối chiếu; nút duyệt/từ chối/đề xuất; từ chối hỏi lý do.
- Trang Chấm công: nút "Sửa giờ" mỗi dòng cho người có `attendance.correct.review` (hỏi giờ vào/ra, lý do); dòng đã sửa có nhãn "đã điều chỉnh".
- Trang nhân viên: phần "Lương & ngày phép" (`employee.pay.view`, sửa khi `employee.pay.manage`): hình thức trả lương, lương cơ bản, phụ cấp, ngân hàng, số tài khoản, MST, số BHXH, số ngày phép năm (để trống = không tính), đã dùng / còn lại năm nay.
- Xếp ca: ca huỷ vì nghỉ hiện "Nghỉ có đơn" và nút gọi trực thay.

### Task 6: App

- Bảo vệ: tab Tôi → "Đơn của tôi" (`/don`): danh sách đơn nghỉ + đơn chấm công với trạng thái; nút "Xin nghỉ" (`/don/nghi`) — loại, từ ngày, đến ngày, lý do, ảnh; hiện số phép còn lại khi có theo dõi; cảnh báo vượt.
- Ca trực: lấy từ 2 ngày trước; ca đã qua trong 48h thiếu giờ vào hoặc giờ ra → nút "Bổ sung chấm công" (`/don/cham-cong/:assignmentId`) — giờ vào/ra (giờ:phút, ngày theo ca), lý do (danh sách + ghi thêm), ảnh.
- Đội trưởng/quản lý: tab Duyệt thêm "Đơn nghỉ chờ duyệt" (duyệt/từ chối, thấy ca bị ảnh hưởng, đơn gấp nổi bật) và "Bổ sung chấm công" (đề xuất hoặc duyệt, thấy dữ liệu đối chiếu).
- Thông báo `leave.*`, `attendance.correction.*`, `attendance.missing_out` mở đúng màn (`routeFor`).
- Test vitest: `routeFor` cho loại mới; hàm `needsCorrection(shift, now)`.

## Self-review (người viết kế hoạch)

- Bao phủ spec §4.3a: lương & phép (T1), đơn nghỉ (T2), bổ sung chấm công + quên ra ca (T3), web (T5), app (T6). §4.8 không cần code.
- Rủi ro: tính lại vi phạm trùng với vòng quét — engine dùng NOT EXISTS + trạng thái mở, nên bản ghi đã sửa/miễn không bị ghi lại; test ở T3 chạy `tick()` sau khi duyệt.
