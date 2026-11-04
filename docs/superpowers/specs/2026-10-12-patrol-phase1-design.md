# Patrol — Thiết kế Giai đoạn 1

Version 1.9 · 14/10/2026 (đơn nghỉ, bổ sung chấm công, lương & ngày phép) · Trạng thái: **đã duyệt**

Hệ thống quản lý tuần tra bảo vệ cho công ty dịch vụ bảo vệ, tham khảo FastPatrol
(smartguard.vn), sẵn sàng mở rộng thành SaaS nhỏ cho các công ty bảo vệ khác.

---

## 0. Hiểu biết chung (đã chốt qua trao đổi)

**Chủ dự án đã nói:**

- Công ty cung cấp dịch vụ bảo vệ. Có khách hàng công ty quản lý trực tiếp, có
  khách hàng tự quản lý; sau này mở cho mạng lưới công ty bảo vệ khác (SaaS nhỏ).
- "Tự quản lý" gồm cả hai: (A) bảo vệ của công ty nhưng người phía khách hàng tự
  cấu hình/giám sát; (B) khách hàng có đội bảo vệ riêng, chỉ dùng phần mềm.
- Bảo vệ dùng **điện thoại cá nhân**, cả Android và iPhone.
- Ưu tiên: **giám sát nội bộ nhiều mục tiêu** (ai bỏ ca, bỏ điểm, đi trễ) và
  **đặc biệt là xử lý sự cố**; thay **sổ giấy** và **tính lương thủ công**.
- Lương có đủ: theo ca/công, đơn giá theo mục tiêu, phụ cấp/hệ số (đêm, lễ, tăng
  ca, trực thay), thưởng/phạt kỷ luật.
- Chủ dự án tự làm cùng Claude; triển khai lên **VPS** như các dự án trước.
- **Ưu tiên làm trước: công ty tự quản lý** (khách `managed`). Nhân sự công ty
  vận hành toàn bộ: mục tiêu, điểm, tuyến, xếp ca, tuần tra, sự cố.
- **Khách tự quản lý (`self_managed`)**: Giai đoạn 1 **chưa** làm phần vận hành cho khách.
  Chỉ quản lý: **hợp đồng** (thời hạn thuê, giá), **người** (bảo vệ nào đang ở khách nào,
  thông tin nhân viên), và **sự cố / phản ánh khách báo** về.
- Cổng đăng nhập để khách tự vận hành: làm sau (Giai đoạn 2+).

**Giả định (sửa nếu sai):**

- Quy mô đầu: 1 tenant, vài chục bảo vệ, 5–20 mục tiêu.
- Ca trực tự cấu hình được (8h, 12h, qua đêm, xoay ca).
- Một số điểm tuần tra nằm ở nơi mất sóng (tầng hầm) → app phải chạy offline.

**Thước đo thành công của Giai đoạn 1:**

1. Quản lý biết trong **≤ 2 phút** khi một bảo vệ không vào ca, bỏ vòng tuần hoặc
   bỏ điểm.
2. Sự cố khẩn cấp đến điện thoại người phụ trách trong **≤ 30 giây** khi có mạng,
   và được theo dõi đến lúc đóng.
3. Không còn sổ trực giấy tại các mục tiêu triển khai.
4. Dữ liệu ca trực/chấm công/vi phạm đủ để Giai đoạn 2 tính lương mà không phải
   nhập lại.
5. Công ty xem được trên một màn hình: mỗi khách hàng đang dùng những bảo vệ nào,
   hợp đồng nào sắp hết hạn, và khách đang phản ánh gì về nhân viên.

---

## 1. Phân chia giai đoạn

| Giai đoạn | Nội dung |
|---|---|
| **1 (spec này)** | Tenant & phân quyền · **Hợp đồng & điều động bảo vệ** · **Sự cố / phản ánh khách báo** · Mục tiêu/điểm/tuyến · Xếp ca & chấm công · Tuần tra · **Sự cố** · Sổ trực & giao ca · Giám sát & vi phạm · Báo cáo · Triển khai VPS — tất cả do **nhân sự công ty** thao tác |
| 2 | **Tính lương** (quy tắc lương, bảng công, phiếu lương) · **đối soát công nợ với khách theo hợp đồng** · **cổng khách hàng** (xem báo cáo, tự báo sự cố, tự vận hành cho khách `self_managed`) · báo cáo định kỳ gửi khách · NFC · so khớp khuôn mặt tự động · ghi âm sự cố |
| 3 | SaaS: tự đăng ký tenant, gói cước, thanh toán · Beacon |

Giai đoạn 1 **ghi sẵn** mọi dữ liệu Giai đoạn 2 cần (§4.4, §4.8).

---

## 2. Kiến trúc & triển khai (đã duyệt)

```
VPS Ubuntu · Docker Compose
├── nginx        HTTPS (certbot), reverse proxy, phục vụ ảnh có kiểm quyền (X-Accel)
├── backend      NestJS 11 + TypeORM 0.3, Node 20 (như POS)
├── web          Next.js 14 + Tailwind — quản lý, khách hàng, quản trị nền tảng
└── postgres:16  TZ Asia/Ho_Chi_Minh
volumes: postgres_data, uploads_data, backups

mobile/          React + Vite SPA bọc Capacitor 7 (Android + iOS), đóng gói sẵn → offline
                 MỘT app cho bảo vệ, đội trưởng, quản lý — giao diện theo vai trò (§5.1)
shared/          kiểu dữ liệu & hằng số dùng chung (npm workspaces)
```

- **Đăng nhập:** JWT access + refresh. Web dùng cookie, app dùng Bearer (như POS 026).
- **Phân quyền:** guard toàn cục, mặc định đóng; route khai báo
  `@RequirePermission('incident.manage')` (như Dentist). Không rẽ nhánh theo tên vai trò.
- **Realtime:** Server-Sent Events cho dashboard web; **FCM** (firebase-admin) đẩy
  thông báo xuống app, kể cả app quản lý trên điện thoại.
- **Lịch chạy nền:** `@nestjs/schedule`, chạy mỗi phút để quét vi phạm & leo thang sự cố.
- **Ảnh:** nén phía app (≤ 1280px, JPEG ~150 KB), lưu `uploads/<tenant>/<yyyy>/<mm>/`.
  Thời hạn giữ ảnh là cấu hình theo tenant (mặc định 180 ngày); ảnh gắn với sự cố
  không bao giờ bị xoá tự động.
- **Sao lưu:** `pg_dump` hằng đêm + nén uploads, giữ 14 bản, script như `deploy/` của POS.
- **VPS dự kiến:** 2 vCPU · 4 GB RAM · ≥ 80 GB SSD.

---

## 3. Tenant, người dùng, phân quyền

### 3.1 Phân tầng

```
Nền tảng (chủ dự án vận hành SaaS)
└── Tenant  = một công ty bảo vệ, HOẶC một khách hàng tự có đội bảo vệ (trường hợp B)
    └── Khách hàng (client)
        └── Mục tiêu (site)  — toà nhà, nhà máy, kho…
            ├── Chốt gác (post)       — vị trí trực cố định
            └── Điểm tuần tra (checkpoint)
```

Trường hợp B và SaaS dùng **cùng một cơ chế**: tạo một tenant mới. Không có code riêng.

### 3.2 Loại người dùng

| Loại | Thuộc | Ví dụ |
|---|---|---|
| `platform_admin` | Nền tảng | Chủ dự án: tạo/khoá tenant |
| `staff` | Tenant | Giám đốc, quản lý, HR, kế toán |
| `guard` | Tenant | Bảo vệ, **đội trưởng** (dùng app) |
| `client_user` | Tenant + 1 khách hàng | Trưởng BQL toà nhà — **Giai đoạn 2** |

### 3.3 Tổ chức đội & nhóm

```
Tenant
└── Nhóm (team_group) — tuỳ chọn ─── do 1 Quản lý phụ trách
    └── Đội (team) ─────────────────── do 1 Đội trưởng phụ trách
        └── Bảo vệ (thành viên đội)
```

- **Đội trưởng quản lý trực tiếp bảo vệ** trong đội; **quản lý quản lý các đội trưởng**.
- Mỗi bảo vệ thuộc **đúng một đội** tại một thời điểm (`team_members` có từ ngày–đến ngày,
  giữ lịch sử khi chuyển đội). Đội trưởng cũng là thành viên của đội mình.
- **Nhóm là tuỳ chọn.** Công ty nhỏ không tạo nhóm: một quản lý có phạm vi **toàn tenant**,
  quản lý tất cả các đội. Công ty lớn hơn chia nhóm, mỗi quản lý một (hoặc vài) nhóm.
- Đội **không gắn cứng** với mục tiêu: thành viên một đội có thể được điều động tới nhiều
  khách/mục tiêu. Mỗi mục tiêu có thể ghi **đội phụ trách** (`sites.responsible_team_id`) để
  biết báo ai khi sự cố đến từ khách chứ không từ bảo vệ.
- Ai chịu trách nhiệm một bảo vệ được suy ra theo chuỗi: **bảo vệ → đội trưởng của đội →
  quản lý của nhóm (hoặc quản lý toàn tenant)**. Chuỗi này dùng cho thông báo, leo thang (§6.2)
  và cảnh báo vi phạm (§7.1).

### 3.4 Vai trò = tập quyền, cộng **phạm vi**

Quyền được kiểm theo **(permission) ∧ (phạm vi)**. Phạm vi là danh sách `user_scopes`, mỗi dòng một
trong: **toàn tenant · nhóm · đội · khách hàng · mục tiêu**. Phạm vi nhóm/đội bao gồm
các bảo vệ trong đó và dữ liệu của họ (chấm công, vòng tuần, sự cố họ báo, vi phạm).
`client_user` (Giai đoạn 2) **bắt buộc** có phạm vi trong khách hàng của mình.

Vai trò mẫu tạo sẵn cho mỗi tenant (tenant được sửa/thêm vai trò; một người có thể giữ nhiều vai trò):

| Vai trò mẫu | Quyền chính | Phạm vi điển hình |
|---|---|---|
| Quản trị (giám đốc) | Tất cả, kể cả người dùng, vai trò, cài đặt | Toàn tenant |
| Quản lý | Cấu hình mục tiêu/điểm/tuyến/lịch, xếp ca, xử lý & đóng sự cố, **duyệt vi phạm**, quản lý đội & đội trưởng, báo cáo | Một nhóm, hoặc toàn tenant |
| **Đội trưởng** | Như bảo vệ, thêm: xem trực tiếp đội (ai đang trực, vòng tuần, vị trí check-in), **xếp ca cho đội**, tiếp nhận & xử lý sự cố của đội, **đề xuất** vi phạm/miễn vi phạm, duyệt giao ca, ghi nhận xét bảo vệ | Đội của mình |
| Bảo vệ | App: chấm công, tuần tra, báo sự cố, sổ trực, giao ca | Bản thân + mục tiêu được xếp ca |
| HR (nhân sự) | Hồ sơ nhân viên, giấy tờ & chứng chỉ, đội & thành viên đội, **điều động bảo vệ tới khách**, tài khoản bảo vệ & duyệt đổi thiết bị, xử lý phản ánh về nhân viên | Toàn tenant |
| Kế toán | Khách hàng, **hợp đồng & giá**, cảnh báo hết hạn; xem bảng chấm công & vi phạm đã duyệt (đầu vào lương/công nợ Giai đoạn 2); không sửa vận hành | Toàn tenant |

Vai trò phía khách hàng (`client_user`: Khách hàng – xem / Khách hàng – quản lý) **để Giai đoạn 2**.
Mô hình dữ liệu (`user_type`, `user_scopes`) đã có chỗ cho chúng nên không phải sửa cấu trúc.

### 3.3a Hai chế độ khách hàng trong Giai đoạn 1

| Việc | Khách `managed` | Khách `self_managed` |
|---|---|---|
| Hợp đồng, thời hạn, giá | Công ty | Công ty |
| Điều động bảo vệ tới khách, hồ sơ nhân viên | Công ty | Công ty |
| Sự cố / phản ánh khách báo về | Công ty ghi nhận & xử lý | Công ty ghi nhận & xử lý |
| Mục tiêu, điểm, tuyến, xếp ca, tuần tra, sổ trực, vi phạm | **Công ty vận hành đầy đủ** | **Không dùng** trong Giai đoạn 1 (khách tự lo bằng cách của họ) |

Khách `self_managed` vì vậy chỉ xuất hiện ở các màn C1–C8 (§5.3) và trong danh sách sự cố.

### 3.5 Cách ly dữ liệu

- Mọi bảng nghiệp vụ có `tenant_id NOT NULL`. `tenant_id` **chỉ lấy từ token**, không
  bao giờ từ body/query.
- Repository gốc `TenantScopedRepository` tự thêm điều kiện `tenant_id` và phạm vi.
- Bộ test e2e bắt buộc: người tenant A / khách hàng X **không đọc, không sửa được**
  dữ liệu tenant B / khách hàng Y, kể cả ảnh qua URL.

---

## 4. Mô hình dữ liệu (Giai đoạn 1)

Mọi bảng có `id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at` (xoá mềm)
trừ khi ghi khác.

### 4.1 Nền tảng & người dùng
- `tenants` (name, code, status, settings jsonb: retention_days, grace_minutes…)
- `users` (tenant_id null cho platform_admin, user_type, phone, email, password_hash, status)
- `roles`, `role_permissions`, `user_roles`, `user_scopes` (scope_type: `tenant`|`team_group`|`team`|`client`|`site`, scope_id?)
- `team_groups` (name, manager_user_id?) · `teams` (name, team_group_id?, leader_employee_id?)
- `team_members` (team_id, employee_id, start_date, end_date?) — một bảo vệ chỉ thuộc một đội mỗi thời điểm (exclusion trên khoảng ngày)
- `employees` (user_id, mã NV, họ tên, CCCD, ngày vào làm, chức danh, ảnh mẫu khuôn mặt)
- `devices` (user_id, platform, device_id, fcm_token, last_seen) — **mỗi bảo vệ / đội trưởng 1 máy hoạt động** (chống chấm công hộ); đổi máy cần HR hoặc quản lý duyệt. Nhân sự văn phòng (quản lý, HR, kế toán) đăng nhập được nhiều máy
- `audit_logs`

### 4.1a Hợp đồng, điều động, phản ánh
- `contracts` (client_id, contract_no, signed_at, start_date, end_date, status:
  `draft`|`active`|`expiring`|`expired`|`terminated`, auto_renew, notice_days, file_id, note)
- `contract_lines` (contract_id, position (vd: bảo vệ thường, đội trưởng), headcount,
  unit: `per_guard_month`|`per_shift`|`per_hour`, unit_price, currency VND, shift_hours?,
  effective_from, effective_to) — giá đổi giữa kỳ thì thêm dòng mới, không sửa dòng cũ
- `deployments` (employee_id, client_id, contract_id?, site_id?, position, start_date, end_date?,
  status: `active`|`ended`, end_reason) — "bảo vệ nào đang làm ở khách nào"; một bảo vệ
  không có hai điều động trùng ngày (ràng buộc exclusion trên khoảng ngày)
- `guard_feedback` (client_id, employee_id?, reported_by_name, channel: `phone`|`zalo`|`email`|`in_person`,
  kind: `praise`|`complaint`|`request_replace`|`evaluation`, rating 1–5?, body, files,
  status: `open`|`in_review`|`resolved`, assignee_id, response, resolved_by, recorded_by) — phản ánh
  của khách **về nhân viên**, do nhân sự công ty ghi nhận lại
- `client_monthly_evaluations` (client_id, employee_id, month, score, comment) — đánh giá định kỳ (tuỳ chọn)

### 4.2 Mục tiêu
- `clients` (name, management_mode: `managed` | `self_managed`, mã số thuế, địa chỉ, người liên hệ,
  account_manager_id — người phụ trách bên công ty)
- `sites` (client_id, name, address, lat, lng, geofence_radius_m, responsible_team_id?, settings jsonb — ghi đè cài đặt công ty, xem §7.0)
- `posts` (site_id, name) — chốt gác
- `checkpoints` (site_id, name, code, lat?, lng?, radius_m, allowed_methods[]: `qr`|`gps`|`photo`|`nfc`,
  `qr_secret`, photo_rule: `never`|`always`|`random`, instructions) — chủ dự án 13/10/2026: mỗi điểm chọn cách
  xác nhận (QR, GPS, chỉ chụp ảnh; NFC Giai đoạn 2) và **có thể bắt gửi kèm ảnh** khi dùng QR hay GPS:
  luôn luôn, hoặc ngẫu nhiên theo tỉ lệ `patrol_photo_random_percent` (§7.0). Cách `photo` luôn cần ảnh.
- `routes` (site_id, name) · `route_checkpoints` (route_id, checkpoint_id, seq, required)

### 4.3 Ca trực & chấm công
- `shift_templates` (site_id, name, start_time, end_time, crosses_midnight, position)
- `shift_assignments` (employee_id, site_id, post_id?, template_id?, planned_start, planned_end,
  status: `planned`|`swapped`|`cancelled`, substitute_for_assignment_id?)
- `attendances` (assignment_id, check_in_at, check_in_selfie, check_in_lat/lng, check_in_flags,
  check_out_at, check_out_selfie, check_out_lat/lng, worked_minutes)

### 4.3a Đơn nghỉ, bổ sung chấm công, lương & ngày phép (chủ dự án 14/10/2026)

**Lương & ngày phép** — `employee_pay` (employee_id, pay_type: `monthly`|`per_shift`|`per_hour`, base_pay, allowance,
bank_name, bank_account, tax_code, social_insurance_no, annual_leave_days?, note). Phần riêng trên hồ sơ nhân viên,
chỉ người có `employee.pay.view` (HR, kế toán, giám đốc) xem; `employee.pay.manage` sửa. Phần lớn công ty bảo vệ **không tính
phép năm**: `annual_leave_days` để trống = không theo dõi. Có số ngày thì hệ thống đếm số ngày phép năm đã duyệt trong năm
và còn lại; vượt số ngày chỉ **cảnh báo**, không chặn. Mọi thay đổi ghi `audit_logs`. Người duyệt đơn nghỉ (cả đội trưởng) thấy số phép tiêu chuẩn
và số còn lại của người xin khi số phép tiêu chuẩn lớn hơn 0 — để trống hoặc 0 thì không hiện (chủ dự án 14/10/2026); không thấy lương; đơn phép năm vắt qua năm mới tính vào năm của ngày bắt đầu.

**Đơn xin nghỉ** — `leave_requests` (employee_id, type: `annual`|`sick`|`personal`|`unpaid`, from_date, to_date, days, reason,
ảnh ≤ 3, status: `pending`|`approved`|`rejected`|`cancelled`, urgent, decided_by, decided_at, decision_note, created_by, client_uuid).
- Bảo vệ gửi trên app cho chính mình (từ 7 ngày trước tới 90 ngày sau, tối đa 31 ngày một đơn). Đội trưởng, quản lý có thể
  ghi đơn thay cho người trong đội (bảo vệ gọi điện xin nghỉ).
- Người duyệt: **đội trưởng hoặc quản lý** (quyền `leave.review`) xếp ca được cho người đó; không tự duyệt đơn của mình.
  Từ chối phải ghi lý do. Người gửi huỷ được đơn còn chờ.
- Gửi đơn → báo đội trưởng của đội người đó; ca đầu tiên bị ảnh hưởng bắt đầu trong vòng **12 giờ** (hoặc đã bắt đầu) → đơn **gấp**,
  báo cả quản lý nhóm. Duyệt/từ chối → báo người gửi.
- Duyệt: mọi ca **chưa vào ca** của người đó trong các ngày nghỉ bị huỷ (ghi lý do "nghỉ có đơn"), vi phạm vắng/trễ còn mở của các ca đó
  tự **miễn** (lý do: hệ thống — nghỉ có đơn). Ca bị huỷ vì nghỉ vẫn **gọi người trực thay** được. Không xếp ca mới vào ngày đã duyệt nghỉ.

**Bổ sung / điều chỉnh chấm công** — `attendance_corrections` (assignment_id, employee_id, site_id, check_in_at?, check_out_at?,
reason_code: `phone_dead`|`phone_broken`|`forgot`|`no_signal`|`app_error`|`other`, reason, ảnh ≤ 3, before jsonb,
status: `pending`|`proposed_approve`|`proposed_reject`|`approved`|`rejected`|`cancelled`, proposed_*, reviewed_*, client_uuid).
- Bảo vệ gửi cho ca của mình trong **48 giờ** sau giờ kết thúc ca; mỗi ca một đơn đang mở. Giờ đề nghị nằm trong cửa sổ chấm công của ca
  (vào: từ 1 giờ trước giờ bắt đầu tới giờ kết thúc; ra: sau giờ vào, tới 6 giờ sau giờ kết thúc, không ở tương lai).
- Đơn hiện kèm **dữ liệu đối chiếu**: các lần quét tuần tra, dòng sổ trực, biên bản giao ca của người đó trong ca.
- **Đội trưởng đề xuất** duyệt/từ chối, **quản lý duyệt** (`attendance.correct.propose` / `attendance.correct.review`) — như vi phạm;
  quản lý duyệt thẳng được; từ chối hoặc đi ngược đề xuất phải ghi lý do; không tự đề xuất/duyệt đơn của mình.
- Duyệt: ghi giờ vào chấm công (cờ `corrected`, không có ảnh/GPS), giữ giá trị cũ trong `before`, ghi `audit_logs`; vi phạm vắng/trễ/ra sớm
  **còn mở** của ca được tính lại theo giờ mới. Vi phạm đã được quản lý quyết định giữ nguyên.
- Quản lý sửa thẳng trên web (cũng là một đơn, duyệt ngay, bắt buộc lý do).
- Quên ra ca: quá 6 giờ sau ca mà chưa ra → nhắc bảo vệ gửi đơn bổ sung (một lần).

### 4.4 Tuần tra
- `patrol_schedules` (site_id, route_id, name, start_time, end_time — qua đêm nếu end ≤ start, bằng nhau = cả ngày,
  interval_minutes — mỗi vòng một khung dài bằng khoảng cách, days[] — thứ trong tuần theo ngày bắt đầu khung)
- `patrol_rounds` (schedule_id, route_id, site_id, expected_start, expected_end, photo_checkpoint_ids[] — điểm rút
  ngẫu nhiên phải chụp ảnh ở vòng này, stops — danh sách điểm chụp lại lúc bắt đầu, employee_id?, started_at,
  ended_at, ended_by, late, status: `pending`|`in_progress`|`completed`|`partial`|`missed`)
  — sinh trước 24h theo lịch, chỉ cho khách `managed`, mục tiêu và tuyến còn dùng
- Quy tắc vòng: bắt đầu được từ 10 phút trước khung tới hết khung; bắt đầu sau `expected_start + round_tolerance_minutes`
  thì đánh dấu trễ; hết khung chưa ai bắt đầu → `missed` (báo đội trưởng phụ trách); đang làm thì tự đóng ở
  `expected_end + round_tolerance_minutes` → `completed` nếu đủ điểm bắt buộc, không thì `partial`. Một vòng do một người làm;
  người làm phải có ca được xếp ở mục tiêu bao trùm lúc đó và dùng máy đã duyệt. Nhắc người đang trực 5 phút trước vòng.
- Thời điểm của lần quét: giờ máy chủ khi online; khi gửi bù từ offline dùng giờ máy (không được ở tương lai) — dữ liệu
  offline gửi muộn vẫn được tính nếu giờ quét nằm trong khung, kể cả khi vòng đã bị ghi `missed`/`partial`.
- Lỗi cứng → từ chối: mã QR sai chữ ký, điểm không thuộc tuyến, cách xác nhận không được phép, thiếu ảnh bắt buộc,
  quét trùng điểm. Dấu hiệu nghi vấn (§7.2) → vẫn ghi nhận, `validity = suspicious`, đội trưởng xem xét.
- `patrol_scans` (round_id, checkpoint_id, employee_id, method, device_time, server_time,
  lat, lng, accuracy_m, is_mock_location, photo_id?, captured_offline, validity: `valid`|`suspicious`,
  flags[])

### 4.5 Sự cố
- `incident_categories` (name, default_severity) — tenant tự định nghĩa; tạo sẵn: Cháy nổ,
  Trộm cắp, Xâm nhập, Hư hỏng thiết bị, Vệ sinh/an toàn, Khác
- `incidents` (client_id, site_id?, checkpoint_id?, round_id?, category_id,
  source: `guard_app`|`staff`|`client_report`, client_reporter_name?, client_channel?, severity: `low`|`medium`|`high`|`critical`,
  is_sos, title, description, lat, lng, reported_by, assignee_id?, status, acknowledged_at,
  resolved_at, closed_at, escalation_level)
- `incident_events` (incident_id, type: `created`|`acknowledged`|`assigned`|`comment`|`status_changed`|`escalated`,
  actor_id, body, from_status, to_status) — dòng thời gian bất biến
- `files` (owner_type, owner_id, path, mime, size, sha256, taken_at) — dùng chung cho mọi ảnh

### 4.6 Sổ trực điện tử
- `logbook_entries` (site_id, assignment_id?, author, type: `note`|`visitor`|`vehicle`|`asset`|`other`,
  body, data jsonb theo loại, occurred_at, exited_at, client_uuid, captured_offline, ảnh ≤ 5)
  - khách: tên, đơn vị, gặp ai, việc gì; xe: biển số, loại xe, hàng hoá; tài sản: món, số lượng, nhận/giao/cho mượn/trả, với ai.
  - Chủ dự án 13/10/2026: **không bắt buộc giấy tờ tuỳ thân**; được chụp kèm ảnh tuỳ ý (ảnh khách, danh thiếp, xe…).
  - Khách và xe có giờ vào; giờ ra ghi sau ("đang ở trong" cho tới khi ghi ra). Dòng sổ không sửa, không xoá; ghi nhầm thì ghi dòng đính chính.
  - Ai ghi: người có ca ở mục tiêu (từ 10 phút trước giờ vào tới 30 phút sau giờ ra), hoặc nhân sự có quyền `logbook.manage` thấy mục tiêu (ghi từ web).
  - Ai xem: `logbook.view` + thấy mục tiêu; bảo vệ xem sổ của mục tiêu mình đang có ca (để biết khách nào còn trong toà).
- `handovers` (site_id, from_assignment_id, to_assignment_id?, items jsonb [{label, status: ok|missing|issue, note}], notes,
  status: `submitted`|`accepted`|`disputed`, receiver_note, accepted_at, reviewed_by, reviewed_at, review_note)
- Danh mục bàn giao: `sites.handover_items` (chìa khoá, bộ đàm, tài sản…), quản lý mục tiêu sửa.
- Quy trình giao ca: người hết ca điền danh mục (đủ/thiếu/có vấn đề) và ghi chú → người nhận ca **xác nhận trên tài khoản của mình**
  (đồng ý, hoặc không đồng ý kèm lý do) → đội trưởng duyệt biên bản. Có món thiếu/có vấn đề hoặc người nhận không đồng ý: báo đội trưởng + quản lý nhóm.
- Người nhận ca là người có ca ở mục tiêu bắt đầu trong khoảng 2 giờ quanh giờ kết thúc ca giao; nhiều người thì người giao chọn.
- Chủ dự án 13/10/2026: chưa xác nhận giao ca **vẫn được vào ca**; người nhận đã vào ca 15 phút mà chưa có biên bản được xác nhận
  (khi có ca trước đó để nhận) → báo đội trưởng + quản lý nhóm, một lần.
- Khách hàng xem sổ trực: Giai đoạn 2 (Giai đoạn 1 xuất file gửi khách khi cần — cùng phần Báo cáo).

### 4.7 Giám sát
- `violations` (employee_id, site_id, type, ref_type, ref_id, occurred_at, minutes?,
  status: `auto`|`proposed_confirm`|`proposed_waive`|`confirmed`|`waived`, proposed_by, proposed_note,
  reviewed_by, note)
- `notifications` (user_id, type, payload, read_at)

### 4.8 Dữ liệu cho Giai đoạn 2 (lương)
Giai đoạn 2 chỉ đọc: `shift_assignments` (ca, mục tiêu, trực thay), `attendances`
(giờ thực tế, kể cả giờ đã điều chỉnh), `violations` có `status = confirmed`, `leave_requests` đã duyệt, `employee_pay`. Mọi giờ lưu `timestamptz`; ngày lễ
và hệ số **không** lưu ở Giai đoạn 1.

---

## 5. Chức năng Giai đoạn 1

### 5.1 App di động (mobile/) — một app, ba giao diện theo vai trò

Sau khi đăng nhập, app hiện các tab theo quyền của người dùng. Một người có nhiều vai trò
thấy hợp các tab. Đây là **kênh chính để nhận và xử lý sự cố** — web chỉ là nơi làm việc
đầy đủ hơn ở văn phòng.

#### 5.1.1 Bảo vệ

| # | Chức năng | Chi tiết |
|---|---|---|
| M1 | Đăng nhập | SĐT + mật khẩu; gắn thiết bị; quên mật khẩu → quản lý đặt lại |
| M2 | Ca hôm nay | Danh sách ca được xếp, giờ, mục tiêu, chốt |
| M3 | **Vào ca / ra ca** | Selfie bằng camera trước (không chọn ảnh thư viện) + GPS trong geofence mục tiêu |
| M4 | Lịch tuần tra | Các vòng tuần của ca: chưa đến / đang mở / đã xong / bỏ lỡ |
| M5 | **Tuần tra** | Bắt đầu vòng → check-in từng điểm (QR, GPS tự động khi vào bán kính, chụp ảnh) → tiến độ x/y, điểm còn thiếu → kết thúc |
| M6 | **Báo sự cố** | Chọn loại, mức độ, mô tả, ≤ 5 ảnh, vị trí tự gắn; xem trạng thái & bình luận của sự cố mình báo |
| M7 | **Nút SOS** | Giữ 2 giây → tạo sự cố `critical` kèm vị trí, gửi ngay, ảnh bổ sung sau |
| M8 | Sổ trực | Ghi chép, khách ra vào, xe ra vào, tài sản; có ảnh |
| M9 | Giao ca | Điền danh mục bàn giao; người nhận ca xác nhận trên máy mình |
| M10 | **Offline** | M3, M5, M6, M8 lưu hàng đợi khi mất sóng, tự gửi khi có mạng; hiển thị "đang chờ gửi n mục" |
| M11 | Thông báo | Nhắc sắp đến vòng tuần, nhắc vào ca; hộp thư thông báo |

App phải chạy tốt trên máy Android đời thấp (RAM 3 GB, Android 9+) và iOS 15+.

#### 5.1.2 Đội trưởng (người trực tiếp quản lý tại mục tiêu)

Có toàn bộ chức năng bảo vệ, thêm:

| # | Chức năng | Chi tiết |
|---|---|---|
| T1 | **Đội của tôi** | Theo thời gian thực: ai đang trực / chưa vào ca / đi trễ / đang tuần tra, tiến độ vòng tuần, check-in nghi vấn; chạm vào một người → selfie vào ca, vị trí, các điểm đã quét |
| T2 | **Sự cố của đội** | Hộp sự cố của đội & mục tiêu phụ trách, sắp theo mức độ; **tiếp nhận, giao bảo vệ xử lý, bình luận kèm ảnh, chuyển trạng thái, ghi cách xử lý**; push âm thanh với `high`/`critical` |
| T3 | **Ghi nhận sự cố khách báo tại chỗ** | Khách báo trực tiếp ở mục tiêu → đội trưởng tạo sự cố `source = client_report` ngay trên app |
| T4 | Xếp ca nhanh | Xem/sửa lịch tuần của đội, đổi ca, gọi người trực thay khi có `absent` |
| T5 | Vi phạm | Danh sách vi phạm mới của đội; **đề xuất** xác nhận/miễn kèm lý do |
| T6 | Giao ca & sổ trực | Duyệt biên bản giao ca; xem sổ trực các mục tiêu của đội |
| T7 | **Báo cáo đội** | Báo cáo ca/ngày: chấm công, vòng tuần hoàn thành x/y, điểm bỏ sót, vi phạm, sự cố; **chia sẻ** (ảnh/PDF qua Zalo) cho quản lý hoặc khách |

#### 5.1.3 Quản lý (và giám đốc)

Không có chức năng tuần tra/chấm công (trừ khi cũng là bảo vệ). Gồm:

| # | Chức năng | Chi tiết |
|---|---|---|
| Q1 | **Tổng quan** | Theo nhóm hoặc toàn công ty: đang trực / thiếu người / vòng bỏ lỡ / sự cố mở theo mức độ; danh sách mục tiêu có vấn đề lên đầu |
| Q2 | **Trung tâm sự cố** | Toàn bộ sự cố trong phạm vi; lọc theo mức độ, trạng thái, đội, mục tiêu, nguồn (bảo vệ / khách báo); **tiếp nhận, giao đội trưởng/bảo vệ, bình luận, đóng sự cố**; nhận leo thang (§6.2) |
| Q3 | **Ghi nhận khách báo** | Khách gọi điện → tạo ngay sự cố khách báo hoặc phản ánh về nhân viên (C5, C6) từ điện thoại |
| Q4 | Đội & đội trưởng | Tình trạng từng đội; liên hệ nhanh (gọi / Zalo) đội trưởng & bảo vệ |
| Q5 | **Duyệt vi phạm** | Duyệt đề xuất của đội trưởng — xác nhận hoặc miễn |
| Q6 | **Báo cáo** | Báo cáo nhanh theo ngày/tuần: theo mục tiêu, theo đội, theo nhân viên; chỉ số sự cố (thời gian tiếp nhận, xử lý); chia sẻ PDF/ảnh. Báo cáo đầy đủ & xuất Excel vẫn ở web (W10) |
| Q7 | Cảnh báo hành chính | Hợp đồng sắp hết hạn, khách thiếu người so với hợp đồng (chỉ xem, chạm để mở web) |

HR và kế toán chủ yếu dùng web; trên app chỉ thấy Q3 (HR) và Q7.

#### 5.1.4 Thông báo trên app

- `critical`/SOS: kênh thông báo riêng **ưu tiên cao, có âm thanh**, hiện cả khi máy đang khoá;
  không tắt được trong app cho đội trưởng & quản lý đang trong chuỗi leo thang.
- Mọi thông báo mở thẳng đúng màn hình (sự cố, vi phạm, người đi trễ).
- Một nút **"Tôi tiếp nhận"** ngay trên thông báo cho sự cố — tiếp nhận là dừng leo thang.

### 5.2 Web quản lý (web/)

| # | Chức năng | Chi tiết |
|---|---|---|
| W1 | **Dashboard realtime** | Đang trực / chưa vào ca / vòng đang chạy / vòng bỏ lỡ / sự cố mở theo mức độ; bản đồ mục tiêu tô màu trạng thái; luồng sự kiện mới nhất |
| W2 | Khách hàng & mục tiêu | CRUD khách hàng, mục tiêu (chọn vị trí trên bản đồ, bán kính), chốt gác |
| W3 | Điểm tuần tra | CRUD, phương thức cho phép; **in tem QR** (PDF A4, nhiều tem/trang, có tên điểm) |
| W4 | Tuyến & lịch tuần tra | Kéo thả thứ tự điểm; lịch theo khung giờ/ca, số vòng hoặc chu kỳ phút |
| W5 | **Xếp ca** | Mẫu ca; lịch tuần dạng lưới nhân viên × ngày; sao chép tuần; đổi ca, trực thay |
| W6 | Bảo vệ, đội & người dùng | Hồ sơ nhân viên, tài khoản, vai trò, phạm vi; **nhóm & đội** (tạo, gán quản lý / đội trưởng, chuyển bảo vệ giữa các đội, lịch sử); sơ đồ tổ chức; duyệt đổi thiết bị |
| W7 | **Sự cố** | Danh sách + bảng kanban theo trạng thái; chi tiết với ảnh, bản đồ, dòng thời gian; tiếp nhận, giao người, bình luận, đổi trạng thái |
| W8 | Sổ trực & giao ca | Xem theo mục tiêu/ngày; tìm kiếm |
| W9 | **Vi phạm** | Danh sách vi phạm tự động theo đội; đội trưởng đề xuất, quản lý duyệt xác nhận hoặc miễn (kèm lý do) |
| W10 | Báo cáo | Theo mục tiêu / nhân viên / khách hàng: tỷ lệ hoàn thành vòng & điểm, bảng chấm công, vi phạm, sự cố (số lượng, thời gian tiếp nhận & xử lý); **xuất Excel** |
| W11 | Cài đặt | **Bộ mặc định của công ty** (đi trễ, vắng ca, leo thang sự cố, ai được đóng sự cố, thời hạn giữ ảnh, danh mục sự cố) và **ghi đè theo từng mục tiêu** (§7.0) |
| W12 | Quản trị nền tảng | (platform_admin) tạo/khoá tenant, tạo quản trị tenant đầu tiên |

W2–W9 chỉ áp dụng cho khách `managed`. W7 (sự cố) áp dụng cho mọi khách.

### 5.3 Hợp đồng, người, phản ánh — mọi khách hàng

| # | Chức năng | Chi tiết |
|---|---|---|
| C1 | **Hợp đồng** | Tạo hợp đồng theo khách: số HĐ, ngày ký, hiệu lực từ–đến, tự gia hạn, đính kèm bản scan; các dòng giá (vị trí, số lượng, đơn vị tính, đơn giá); lịch sử thay đổi giá |
| C2 | **Cảnh báo hết hạn** | Hợp đồng chuyển `expiring` trước `notice_days` (mặc định 30); thông báo 30/15/7/1 ngày; danh sách "sắp hết hạn" trên dashboard công ty |
| C3 | **Điều động bảo vệ** | Gán bảo vệ cho khách (từ ngày–đến ngày, vị trí); rút về, chuyển khách; xem theo khách ("khách X đang có ai") và theo người ("anh Y đang ở đâu, từng ở đâu"); cảnh báo số người điều động < `headcount` hợp đồng |
| C4 | Hồ sơ nhân viên | Thông tin cá nhân, giấy tờ, chứng chỉ nghiệp vụ, ngày hết hạn chứng chỉ; lịch sử điều động |
| C5 | **Phản ánh của khách về nhân viên** | Nhân sự công ty ghi nhận (khách gọi, nhắn Zalo, email): khen / chê / yêu cầu thay người / đánh giá; gắn với bảo vệ; giao người xử lý, ghi phản hồi, đóng phiếu. Yêu cầu thay người → nút tạo điều động mới (C3) |
| C6 | **Sự cố khách báo** | Nhân sự công ty tạo sự cố `source = client_report` (ai báo, qua kênh nào) cho khách bất kỳ, kể cả `self_managed`; đi theo quy trình §6 |
| C7 | **Hồ sơ nhân viên tổng hợp** | Theo từng bảo vệ: lịch sử điều động, phản ánh, sự cố liên quan; với khách `managed` thêm chấm công, vi phạm; xuất Excel |
| C8 | Dashboard công ty | Số bảo vệ đang điều động / còn trống; hợp đồng sắp hết hạn; phản ánh & sự cố khách báo đang mở; khách thiếu người so với hợp đồng |

Đối soát công nợ (tính tiền khách theo số công thực tế × đơn giá) để Giai đoạn 2 — Giai đoạn 1
lưu sẵn giá theo kỳ hiệu lực để tính được sau.

---

## 6. Quy trình sự cố (trọng tâm)

### 6.1 Trạng thái

```
new ──acknowledge──▶ acknowledged ──start──▶ in_progress ──resolve──▶ resolved ──close──▶ closed
 │                                                                       │
 └──────────────── reject (báo nhầm, bắt buộc lý do) ──▶ rejected        └─reopen─▶ in_progress
```

- `resolve` bắt buộc ghi **cách xử lý**; mức `high`/`critical` bắt buộc thêm ≥ 1 ảnh.
- `close` do người có quyền `incident.close` (quản lý vận hành trở lên).
- Mọi chuyển trạng thái ghi một `incident_events`; không sửa/xoá event.

### 6.2 Ai được báo

| Mức | Thông báo ngay tới | Leo thang nếu chưa tiếp nhận sau |
|---|---|---|
| low | Đội trưởng (trong app) | — |
| medium | Đội trưởng (push) | 30 phút → quản lý của nhóm |
| high | Đội trưởng + quản lý của nhóm (push) | 10 phút → quản trị (giám đốc) |
| critical / SOS | Đội trưởng + quản lý + quản trị, push âm thanh ưu tiên cao | 3 phút → nhắc lại mỗi 3 phút, lên cấp tiếp theo |

"Đội trưởng" là đội trưởng của **bảo vệ báo sự cố**; sự cố do nhân sự công ty tạo thì dùng **đội phụ trách mục tiêu**. Đội không có đội trưởng → báo thẳng quản lý. Không có nhóm → "quản lý của nhóm" là các quản lý có phạm vi toàn tenant.
Ngưỡng phút và người được đóng sự cố là **cài đặt theo mục tiêu**, lấy bộ mặc định của công ty khi mục tiêu không ghi đè (§7.0). Thông báo cho người phía khách hàng: Giai đoạn 2.

**Sự cố khách báo** (`source = client_report`): thông báo tới người phụ trách khách hàng bên công ty
(`clients.account_manager_id`), đội trưởng của đội phụ trách mục tiêu (nếu có) và quản lý của nhóm đó.

### 6.3 Chỉ số
Thời gian tiếp nhận (created → acknowledged) và thời gian xử lý (created → resolved)
theo mục tiêu/mức độ, hiện trong W10.

---

## 7. Giám sát, vi phạm, chống gian lận

### 7.0 Cài đặt: mặc định của công ty, ghi đè theo mục tiêu

Chủ dự án (13/10/2026): mốc đi trễ/vắng ca và cách xử lý sự cố **phải chỉnh được theo từng mục tiêu**,
có **một bộ giá trị mặc định chung**. Mỗi khoá dưới đây có giá trị trong `tenants.settings`
(mặc định của công ty, lấy giá trị cột "Mặc định" khi chưa ai sửa) và có thể ghi đè trong
`sites.settings` của từng mục tiêu. Giá trị hiệu lực = mục tiêu → công ty → mặc định hệ thống.

| Khoá | Ý nghĩa | Mặc định |
|---|---|---|
| `late_after_minutes` | Quá bao nhiêu phút sau giờ vào ca thì tính đi trễ | 10 |
| `absent_after_minutes` | Quá bao nhiêu phút thì tính vắng ca | 30 |
| `early_checkout_minutes` | Ra ca sớm hơn bao nhiêu phút thì ghi vi phạm | 10 |
| `round_tolerance_minutes` | Vòng tuần được trễ bao nhiêu phút so với khung giờ | 15 |
| `incident_escalate_minutes.medium` | Sự cố trung bình chưa tiếp nhận sau … phút thì leo thang | 30 |
| `incident_escalate_minutes.high` | Sự cố cao … | 10 |
| `incident_escalate_minutes.critical` | Khẩn cấp/SOS: nhắc lại và leo thang mỗi … phút | 3 |
| `incident_close_by_leader_up_to` | Mức cao nhất đội trưởng được tự đóng (`none`/`low`/`medium`) | `none` |
| `patrol_photo_random_percent` | Điểm "ảnh ngẫu nhiên": tỉ lệ vòng bị yêu cầu chụp (%) | 20 |
| `incident_notify_client` | Báo sự cố khẩn cấp cho người phía khách (Giai đoạn 2) | `false` |

- Sửa mặc định công ty: quyền `tenant.settings.manage`. Sửa ghi đè của một mục tiêu: `site.manage` +
  được cấu hình mục tiêu đó. Mỗi thay đổi ghi `audit_logs` (ai, lúc nào, giá trị cũ → mới).
- Màn cài đặt mục tiêu hiện rõ giá trị nào **đang ghi đè** và giá trị nào **đang lấy theo công ty**;
  có nút "Dùng mặc định công ty" để bỏ ghi đè.
- Bộ quy tắc ở §7.1 và chuỗi leo thang ở §6.2 luôn đọc **giá trị hiệu lực** của mục tiêu nơi xảy ra ca/sự cố.

### 7.1 Bộ quy tắc (chạy mỗi phút)

| Vi phạm | Điều kiện | Cảnh báo |
|---|---|---|
| `late_check_in` | Không vào ca sau `planned_start + late_after_minutes` (§7.0) | Push đội trưởng |
| `absent` | Không vào ca sau `planned_start + absent_after_minutes` (§7.0) | Push đội trưởng + quản lý; gợi ý người trực thay trong đội |
| `early_check_out` | Ra ca trước `planned_end − grace` | Ghi nhận |
| `missed_round` | Vòng hết khung giờ mà chưa bắt đầu | Push đội trưởng |
| `missed_checkpoint` | Vòng kết thúc thiếu điểm `required` | Ghi nhận, hiện dashboard |
| `suspicious_scan` | Có cờ ở §7.2 | Ghi nhận, đội trưởng xem xét |

Vi phạm sinh ra ở trạng thái `auto`; đội trưởng **đề xuất** xác nhận/miễn kèm lý do; **quản lý duyệt** → `confirmed`/`waived`. Chỉ `confirmed` mới đi sang lương (Giai đoạn 2).
Bộ quy tắc chỉ chạy cho khách `managed`.

Quy tắc chi tiết (13/10/2026):
- Tới mốc trễ mà chưa vào ca: **nhắc** đội trưởng một lần (chưa ghi vi phạm). Tới mốc vắng: ghi `absent`, báo đội trưởng + quản lý nhóm.
- Vào ca trễ quá mốc trễ: ghi `late_check_in` kèm số phút; nếu trước đó đã ghi `absent` (còn `auto`) thì bản ghi đó **đổi thành** `late_check_in`.
- Huỷ ca hoặc đổi người trực sau mốc vắng mà người cũ chưa vào ca: ghi `absent` cho người cũ **trước** khi đổi (không để mất dấu vắng).
- `missed_round` tính cho mọi người có ca ở mục tiêu trùm khung vòng; không ai có ca thì không ghi (đó là lỗi xếp ca, đã có thông báo bỏ lỡ).
- `missed_checkpoint` tính cho người làm vòng, ghi các điểm bắt buộc còn thiếu. `suspicious_scan` một bản ghi cho mỗi lần quét nghi vấn.
- Vòng bỏ lỡ/thiếu điểm sau đó được báo bù đủ: vi phạm còn `auto` tự chuyển `waived` (lý do: hệ thống); lần báo bù đó đã mang cờ `backdated` nên vẫn có `suspicious_scan`.
- Mỗi lần chạy chỉ xét dữ liệu 2 ngày gần nhất; chạy lại không sinh trùng (khoá theo loại + đối tượng + nhân viên).
- Không đề xuất hay duyệt vi phạm của chính mình. Miễn (`waive`) bắt buộc ghi lý do. Quản lý duyệt thẳng được khi chưa có đề xuất,
  và sửa được quyết định đã duyệt (ghi lý do, lưu nhật ký).
- Quyền: `violation.view`, `violation.propose` (đội trưởng), `violation.review` (quản lý). Bảo vệ xem vi phạm của chính mình.
- Mốc trễ/vắng tính từ **lúc người đó nhận ca**: giờ bắt đầu, hoặc lúc ca được giao nếu muộn hơn (người trực thay gọi lúc 09:45 cho ca 09:00 không bị tính trễ 45 phút).
- `absent` chưa được quản lý duyệt (kể cả đang có đề xuất) mà người đó vào ca: đổi thành `late_check_in`, trở về `auto` và ghi lại trạng thái/đề xuất cũ trong `detail`; vào ca trong mốc trễ thì hệ thống tự miễn.
- Tự miễn khi báo bù chỉ áp dụng khi vòng đã khép lại: đủ điểm → miễn cả bỏ vòng lẫn thiếu điểm; thiếu điểm → miễn bỏ vòng, người đi vòng nhận `missed_checkpoint` (danh sách điểm thiếu được cập nhật khi chưa duyệt).
- Quy tắc "không tự duyệt" dựa trên tài khoản gắn với hồ sơ nhân viên: mọi người làm việc tại mục tiêu cần tài khoản gắn hồ sơ của mình.

### 7.2 Cờ nghi vấn trên mỗi lần check-in

- `mock_location`: Android báo vị trí giả lập / app giả lập GPS (iOS: phát hiện một phần).
- `outside_radius`: cách điểm > `radius_m` (với điểm có toạ độ).
- `impossible_speed`: tốc độ giữa hai lần quét liên tiếp > 15 km/h trong cùng mục tiêu.
- `clock_skew`: giờ máy lệch giờ máy chủ > 5 phút (khi online).
- `late_sync`: dữ liệu offline gửi lên sau > 12 giờ.

### 7.3 Biện pháp

- **QR có chữ ký**: nội dung = `checkpoint_id` + HMAC(`qr_secret`) → không tự tạo mã
  giả được. Chụp lại tem QR để quét ở chỗ khác vẫn có thể — giảm thiểu bằng GPS, ảnh
  bắt buộc ở điểm quan trọng và cờ `impossible_speed`; NFC ở Giai đoạn 2.
- **Selfie vào/ra ca và đầu vòng**: Giai đoạn 1 lưu ảnh + kiểm tra có khuôn mặt
  (ML Kit trên máy); giám sát xem ngẫu nhiên. So khớp khuôn mặt tự động: Giai đoạn 2.
- **Một thiết bị cho mỗi bảo vệ**: đăng nhập máy khác → chờ duyệt.
- **Giờ máy chủ là chuẩn**; offline dùng giờ máy + thời gian tính từ lần đồng bộ gần nhất
  để phát hiện chỉnh giờ.

### 7.4 Offline

- Hàng đợi cục bộ (SQLite qua Capacitor) giữ scan, chấm công, sự cố, sổ trực kèm ảnh.
- Mỗi mục có `client_id` (uuid sinh trên máy) → backend xử lý **idempotent**, gửi lại không nhân đôi.
- Gửi lại theo thứ tự thời gian, có thử lại lùi dần; SOS khi offline: lưu + gợi ý gọi điện
  số khẩn cấp của mục tiêu.
- Dữ liệu cần để tuần tra offline (ca, vòng, điểm, khoá QR công khai) tải sẵn lúc vào ca.

---

## 8. Xử lý lỗi & kiểm thử

- Phản hồi API thống nhất `{ data | error: { code, message } }`, mã lỗi tiếng Anh, thông điệp tiếng Việt.
- **Unit**: bộ quy tắc vi phạm & leo thang (giả lập thời gian), máy trạng thái sự cố, xác thực QR.
- **E2E trên PostgreSQL thật** (như Dentist): cách ly tenant & phạm vi, luồng tuần tra, luồng sự cố,
  idempotent khi đồng bộ offline.
- **App**: test hàng đợi offline; kiểm thử thủ công trên 1 máy Android đời thấp + 1 iPhone trước mỗi bản phát hành.
- Kịch bản kiểm thử chấp nhận viết theo 4 thước đo thành công ở §0.

---

## 9. Thứ tự làm (gợi ý cho bước lập kế hoạch)

1. Nền móng: monorepo, Docker, auth, tenant, vai trò & phạm vi, **nhóm/đội/đội trưởng**, audit
2. **Khách hàng, hồ sơ nhân viên, hợp đồng & giá, cảnh báo hết hạn, điều động bảo vệ** (C1–C4, C8)
3. Mục tiêu / điểm / tuyến + in tem QR; xếp ca cho bảo vệ đang được điều động + app: đăng nhập, ca hôm nay, vào/ra ca
4. Lịch tuần tra, vòng, check-in (QR/GPS/ảnh) + offline
5. **Sự cố + SOS + push + leo thang**; sự cố & phản ánh khách báo (C5, C6); **app đội trưởng T1–T3 & quản lý Q1–Q3**
6. Sổ trực & giao ca
7. Bộ quy tắc vi phạm + dashboard realtime; app T4–T6, Q4–Q5
8. Báo cáo + xuất Excel; hồ sơ nhân viên tổng hợp (C7); báo cáo trên app T7, Q6–Q7
9. Triển khai VPS, sao lưu, hướng dẫn sử dụng

Mỗi bước chạy được và thử được trước khi sang bước sau. Bước 2 dùng được ngay
(thay sổ theo dõi hợp đồng & điều động) trước khi app bảo vệ xong. Bước 5 có thể
làm ngay sau bước 3 nếu cần dùng thử sự cố sớm.

---

## 10. Ngoài phạm vi Giai đoạn 1

Tính lương · gói cước & thanh toán · NFC · Beacon · theo dõi vị trí liên tục · video ·
ghi âm · so khớp khuôn mặt tự động · báo cáo tự động gửi khách · đa ngôn ngữ (chỉ tiếng Việt).

## 11. Câu hỏi còn mở (không chặn việc bắt đầu)

1. ~~Mô hình ca~~ — **Đã chốt:** mẫu ca do từng mục tiêu tự cấu hình (giờ bắt đầu, kết thúc, qua đêm, số người). Xếp ca **không cần quản lý duyệt**. Xoay ca: **Giai đoạn 1 xếp tay theo tuần**, có "chép từ tuần trước"; mẫu xoay ca tự động (2 ngày–2 đêm–2 nghỉ, 24/48…) để sau khi dùng thật.
2. Danh mục sự cố thực tế của công ty. ~~Chuỗi leo thang~~ — **Đã chốt:** chỉnh theo mục tiêu, có bộ mặc định chung (§7.0).
3. Tên sản phẩm / thương hiệu hiển thị trên app.
4. Thời hạn giữ ảnh khách hàng yêu cầu (nếu có trong hợp đồng).
5. Đơn vị tính giá hợp đồng thực tế (theo người/tháng, theo ca hay theo giờ) — spec hỗ trợ cả ba.
6. ~~Gộp hay tách sự cố khách báo và phản ánh nhân viên~~ — **Đã chốt: tách riêng** (sự cố →
   `incidents` §6; phản ánh → `guard_feedback` C5).
