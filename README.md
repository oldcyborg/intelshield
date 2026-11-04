# IntelShield — quản lý bảo vệ mục tiêu

Phần mềm mã nguồn mở, miễn phí, cho công ty dịch vụ bảo vệ: xếp ca và chấm công
bằng khuôn mặt + GPS, tuần tra theo vòng bằng QR/GPS/ảnh, sự cố và SOS tự leo
thang, sổ trực và giao ca, vi phạm, hợp đồng, điều động và tính lương. Gồm **web
quản lý** (cho quản lý, nhân sự, kế toán) và **app Android** (cho bảo vệ, đội
trưởng). Giao diện tiếng Việt.

Giấy phép [MIT](LICENSE).

---

## Chạy thử nhanh (chỉ cần Docker)

```bash
git clone https://github.com/oldcyborg/intelshield.git
cd intelshield
bash deploy/local/start.sh                                # Linux, macOS, Git Bash
# hoặc trên Windows:
powershell -ExecutionPolicy Bypass -File deploy\local\start.ps1
```

- Web quản lý: <http://localhost:8082> — giám đốc `0900000001`, quản lý `0900000002`…
- App điện thoại chạy trên trình duyệt (để thử): <http://localhost:8083> — đội trưởng
  `0910000001`, bảo vệ `0910000003`…

Mật khẩu demo `Demo@123456`; danh sách đầy đủ in ra ở cuối lệnh. Lần đầu mất vài
phút để dựng ảnh Docker.

Cài lên máy chủ có tên miền và HTTPS: xem [deploy/README.md](deploy/README.md).
APK dựng sẵn (nếu có): [Releases](https://github.com/oldcyborg/intelshield/releases).

---

## Chức năng chính

| Nhóm | Có gì |
|---|---|
| **Xếp ca & chấm công** | Mẫu ca theo mục tiêu, xếp cả tuần, chép tuần trước, gọi người trực thay; vào/ra ca bằng ảnh khuôn mặt + GPS, mỗi người một máy (máy mới cần duyệt); mốc trễ/vắng riêng từng mục tiêu; sửa giờ vẫn giữ giờ cũ |
| **Tuần tra** | Lịch theo khung giờ, tự sinh vòng mỗi ngày; xác nhận điểm bằng tem QR có chữ ký (in từ phần mềm), GPS hoặc ảnh; ghi bỏ lỡ, thiếu điểm, quét nghi vấn; mất sóng vẫn quét, có sóng tự gửi |
| **Sự cố & SOS** | Báo sự cố kèm ảnh và vị trí; mức độ quyết định ai được báo và bao lâu thì leo thang; SOS nhắc mỗi 3 phút tới khi có người nhận |
| **Sổ trực & giao ca** | Khách, xe, tài sản ra vào; biên bản giao ca theo danh mục, người nhận xác nhận trên máy mình |
| **Vi phạm** | Tự ghi trễ, vắng, bỏ vòng, thiếu điểm từ dữ liệu thật; đội trưởng đề xuất, quản lý duyệt hoặc miễn; chỉ vi phạm đã duyệt mới trừ lương |
| **Văn phòng** | Khách hàng, hợp đồng, bảng giá theo người/ca/giờ; cảnh báo giấy tờ sắp hết hạn; bảng lương từ chấm công thực tế (lương tháng theo công hoặc cố định); phiếu lương trên app; đơn nghỉ, bổ sung công |
| **Đội trưởng** | Ghi sổ trực và tuần tra ở mọi mục tiêu của đội mà không cần đang trong ca |
| **Nền tảng** | Nhiều công ty trên một máy chủ (quản trị nền tảng tạo công ty), phân quyền theo quyền chứ không theo tên vai trò, thông báo tức thời (SSE) |

---

## Công nghệ

| Phần | Dùng |
|---|---|
| Backend | NestJS 11, TypeORM 0.3, PostgreSQL 16 — `backend/` |
| Web quản lý | Next.js 14, React 18, Tailwind CSS — `web/` |
| App điện thoại | React 18 + Vite + Capacitor 8 (Android) — `mobile/` |
| Thông báo đẩy | Firebase Cloud Messaging (tùy chọn) |

```text
backend/          API NestJS — /api, migration trong src/database/migrations, kịch bản trong src/scripts
web/              Next.js — trang quản lý; /api được rewrite tới backend
mobile/           app bảo vệ/đội trưởng (Capacitor) — xem mobile/README.md
docs/superpowers/ đặc tả và kế hoạch triển khai từng phần
tools/            quay video hướng dẫn tự động (Playwright)
deploy/           bộ cài: local/ (máy cá nhân) và vps/ (máy chủ có tên miền)
```

---

## Thiết lập môi trường để code tiếp

Cần: **Node.js 22**, **Docker** (để chạy PostgreSQL), Git. Với app Android thêm
**JDK 21** và **Android SDK** (Android Studio).

```bash
docker compose up -d postgres          # PostgreSQL ở cổng 5433 (patrol/patrol)

cd backend
cp .env.example .env
npm install
npm run migration:run
npm run seed:demo                      # công ty demo, mật khẩu Demo@123456
npm run start:dev                      # API ở http://localhost:3001/api

# cửa sổ khác
cd web
npm install
npm run dev                            # http://localhost:3000

# cửa sổ khác — app điện thoại trên trình duyệt
cd mobile
cp .env.example .env                   # VITE_API_BASE=http://localhost:3001/api
npm install
npm run dev                            # http://localhost:5173
```

Kiểm thử:

```bash
cd backend && npm test && npm run test:e2e     # e2e chạy trên database patrol_test, tự xóa sạch mỗi lần
cd web && npm run build
cd mobile && npm test && npm run build
```

Quản trị nền tảng (mở công ty mới): đặt `PLATFORM_ADMIN_EMAIL` và
`PLATFORM_ADMIN_PASSWORD` trong `backend/.env`, chạy `npm run create-platform-admin`,
rồi gọi `POST /api/platform/tenants` để tạo công ty kèm giám đốc đầu tiên.

### App Android

Xem [mobile/README.md](mobile/README.md): build APK thử trong mạng nội bộ, bản phát
hành trỏ vào HTTPS, và thông báo đẩy. Thông báo đẩy cần `google-services.json` của
dự án Firebase **và** build với `VITE_PUSH_ENABLED=1` — thiếu một trong hai thì app
không đụng tới Firebase (gọi plugin khi chưa có Firebase làm app sập ở tầng native).
Trước khi phát hành, đổi `appId` (`io.github.oldcyborg.intelshield`) thành gói của
bạn trong `mobile/capacitor.config.ts` và `mobile/android/app/build.gradle`.

---

## Triển khai

| Nơi chạy | Lệnh | Ghi chú |
|---|---|---|
| Máy cá nhân | `bash deploy/local/start.sh` hoặc `deploy\local\start.ps1` | Web 8082, app trên trình duyệt 8083 |
| VPS Ubuntu có tên miền | `sudo bash deploy/vps/install.sh` | Tự cài Docker, nginx, HTTPS (Let's Encrypt), sao lưu hằng đêm. App Android cần HTTPS |

Chi tiết: [deploy/README.md](deploy/README.md).

---

## Đóng góp

Mở issue hoặc pull request trên GitHub. Trước khi gửi: `npm test` của backend và
mobile, `npm run build` của web.
