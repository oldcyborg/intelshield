# Triển khai IntelShield

| | Máy cá nhân | VPS có tên miền |
|---|---|---|
| Thư mục | [`deploy/local/`](local/) | [`deploy/vps/`](vps/) + [`deploy/docker-compose.yml`](docker-compose.yml) |
| Cần | Docker Desktop (Windows, macOS) hoặc Docker Engine (Linux) | Ubuntu 22.04/24.04 hoặc Debian 12, quyền `sudo`, tên miền trỏ về VPS |
| Lệnh | `bash deploy/local/start.sh` · `deploy\local\start.ps1` | `sudo bash deploy/vps/install.sh` |
| Truy cập | web `http://localhost:8082`, app trên trình duyệt `http://localhost:8083` | `https://tên-miền-của-bạn` (web + `/api` cho app Android) |
| HTTPS, sao lưu | Không | Có (Let's Encrypt, sao lưu 02:30 mỗi đêm, giữ 14 ngày) |

Cấu hình tối thiểu cho VPS: **1 vCPU / 2 GB RAM / 20 GB SSD** (dựng ảnh Next.js
tốn RAM; máy ít RAM hơn thì `prepare-server.sh` tạo 2 GB swap).

---

## 1. Chạy trên máy (local)

```bash
bash deploy/local/start.sh                 # Linux, macOS, Git Bash
bash deploy/local/start.sh --khong-demo    # không dựng công ty demo
```

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local\start.ps1
powershell -ExecutionPolicy Bypass -File deploy\local\start.ps1 -KhongDemo
```

Lần đầu script tạo `deploy/local/.env` từ [`local/.env.example`](local/.env.example)
(mật khẩu và khóa ngẫu nhiên), dựng bốn container (`postgres`, `backend`, `web`,
`mobile`) trong project Docker `intelshield-local`, tạo tài khoản quản trị nền tảng
và công ty demo (mật khẩu chung `Demo@123456`). Backend tự chạy migration khi khởi
động.

| Việc | Lệnh |
|---|---|
| Cập nhật sau `git pull` | chạy lại `start` (giữ dữ liệu và mật khẩu) |
| Dừng (giữ dữ liệu) | `bash deploy/local/stop.sh` · `deploy\local\stop.ps1` |
| Xóa sạch để cài lại | `bash deploy/local/stop.sh --xoa-het` · `deploy\local\stop.ps1 -XoaHet` |
| Xem log | `docker compose -p intelshield-local logs -f backend` |
| Dựng lại công ty demo | mở `http://localhost:8082/resetdemo?key=` + `DEMO_RESET_KEY` trong `.env` |

App Android trên điện thoại thật cần HTTPS (hoặc bản build thử `MOBILE_DEV=1` trỏ
vào IP trong mạng nội bộ — xem [mobile/README.md](../mobile/README.md)).

---

## 2. Cài lên VPS

```bash
# 1. Trỏ bản ghi A của tên miền về IP của VPS.
# 2. Trên VPS:
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/oldcyborg/intelshield.git
cd intelshield
sudo bash deploy/vps/install.sh          # lần đầu: tạo deploy/.env rồi dừng
sudo nano deploy/.env                    # DOMAIN, LETSENCRYPT_EMAIL, SEED_DEMO, PLATFORM_ADMIN_EMAIL
sudo bash deploy/vps/install.sh          # dựng, chạy, nginx, HTTPS, sao lưu
```

`install.sh`:

1. kiểm tra `deploy/.env` (mật khẩu database, khóa JWT, mật khẩu quản trị đã được sinh ngẫu nhiên);
2. cài Docker, nginx, certbot, swap, tường lửa nếu máy còn thiếu ([`vps/prepare-server.sh`](vps/prepare-server.sh));
3. dừng nếu cổng `WEB_PORT`/`API_PORT` (5000/5001) đã bị dịch vụ khác chiếm;
4. dựng từng ảnh một, chạy project Docker `intelshield` — container chỉ nghe ở `127.0.0.1`;
5. chờ backend (tự migrate), tạo tài khoản quản trị nền tảng, dựng công ty demo nếu `SEED_DEMO=yes`;
6. ghi `/etc/nginx/sites-available/intelshield.conf` từ [`nginx/intelshield.conf.template`](nginx/intelshield.conf.template), `nginx -t`, reload, xin chứng chỉ;
7. đặt lịch sao lưu ([`backup.sh`](backup.sh)) 02:30 mỗi đêm vào `/var/backups/intelshield`.

Không đụng dịch vụ khác trên cùng VPS: chỉ thêm một tệp nginx của mình, mọi lệnh
compose chỉ đích danh project `intelshield`.

Cập nhật phiên bản:

```bash
cd /opt/intelshield && sudo git pull --ff-only && sudo bash deploy/vps/install.sh
```

Sau khi có HTTPS, build app Android trỏ vào máy chủ:
`MOBILE_RELEASE=1 VITE_API_BASE=https://<tên-miền>/api npm run build && npx cap sync android`
(trong `mobile/`), rồi ký APK bằng khóa phát hành của bạn.

---

## 3. Sao lưu và khôi phục

VPS: tự sao lưu mỗi đêm; chạy tay: `sudo deploy/backup.sh`. Máy cá nhân:

```bash
docker compose -p intelshield-local exec -T postgres pg_dump -U intelshield -d intelshield -Fc > intelshield-$(date +%F).dump
```

Khôi phục:

```bash
docker compose -p intelshield-local stop backend
docker compose -p intelshield-local exec -T postgres pg_restore -U intelshield -d intelshield --clean --if-exists < intelshield-YYYY-MM-DD.dump
docker compose -p intelshield-local start backend
```

(trên VPS: `cd deploy` rồi bỏ `-p intelshield-local` — compose tự đọc `deploy/.env`).
Chép bản sao lưu ra khỏi máy chủ, và giữ một bản `deploy/.env` ở nơi khác.

---

## 4. Tùy chọn

| Biến | Ở đâu | Tác dụng |
|---|---|---|
| `FCM_SERVICE_ACCOUNT` | `deploy/.env` | JSON service account Firebase (một dòng) để đẩy thông báo tới điện thoại. App cũng phải build với `VITE_PUSH_ENABLED=1` và có `google-services.json` |
| `DEMO_RESET_KEY` | `deploy/.env` | Bật trang `/resetdemo?key=…` dựng lại công ty demo. Để trống: tắt |
| `VIDEO_BASE_URL` | `deploy/.env` (dựng lại ảnh `web`) | Thư mục chứa video hướng dẫn theo vai trò (`bao-ve.mp4`, `doi-truong.mp4`, `quan-ly.mp4`, `nhan-su.mp4`, `ke-toan.mp4`). Tự quay bằng `tools/tutorial-videos` |
| `APP_DOWNLOAD_URL` | `deploy/.env` (dựng lại ảnh `web`) | Nơi tải app Android hiện trên web. Mặc định: trang Releases trên GitHub |
| `ESCALATION_TICK`, `PATROL_TICK`, `VIOLATION_TICK`, `HANDOVER_TICK` | `deploy/.env` | Bật/tắt các tác vụ định kỳ (leo thang sự cố, sinh vòng tuần tra, ghi vi phạm, giao ca) |
