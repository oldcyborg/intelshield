#!/usr/bin/env bash
# Chạy IntelShield trên máy này bằng Docker.
#
#   bash deploy/local/start.sh               cài lần đầu (kèm công ty demo) hoặc cập nhật
#   bash deploy/local/start.sh --khong-demo  không dựng công ty demo
#
# Chạy lại bao nhiêu lần cũng được: chỉ dựng lại ảnh, giữ nguyên dữ liệu và
# mật khẩu. Backend tự chạy migration khi khởi động.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"
DEMO=1
for a in "$@"; do
  case "$a" in
    --khong-demo|--no-demo) DEMO=0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Tham số không hợp lệ: $a" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mDỪNG: %s\033[0m\n' "$*" >&2; exit 1; }
rand() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
compose() { docker compose --env-file "$ENV_FILE" -f "$HERE/docker-compose.yml" "$@"; }
val() { grep -E "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r'; }

command -v docker >/dev/null || die 'chưa cài Docker (https://docs.docker.com/get-docker/).'
docker info >/dev/null 2>&1 || die 'Docker chưa chạy — mở Docker Desktop rồi chạy lại.'
docker compose version >/dev/null 2>&1 || die 'cần Docker Compose v2 (lệnh "docker compose").'

if [[ ! -f "$ENV_FILE" ]]; then
  say 'Tạo deploy/local/.env (mật khẩu ngẫu nhiên)'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" == *=__RANDOM__ ]]; then echo "${line%__RANDOM__}$(rand)"; else echo "$line"; fi
  done < "$HERE/.env.example" > "$ENV_FILE"
fi
WEB_PORT="$(val WEB_PORT)"; WEB_PORT="${WEB_PORT:-8082}"
MOBILE_PORT="$(val MOBILE_PORT)"; MOBILE_PORT="${MOBILE_PORT:-8083}"

say 'Dựng ảnh và khởi động (lần đầu mất vài phút)'
compose up -d --build

say 'Chờ hệ thống sẵn sàng'
code=000
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB_PORT/api/health" || true)"
  [[ "$code" == 200 ]] && break
  sleep 2
done
[[ "$code" == 200 ]] || { compose logs --tail 60 backend; die 'backend không trả lời — xem log ở trên.'; }

say 'Tài khoản quản trị nền tảng'
compose exec -T backend node dist/scripts/create-platform-admin.js
if [[ $DEMO -eq 1 ]]; then
  say 'Công ty demo'
  compose exec -T backend node dist/scripts/seed-demo.js
fi

say "Xong: http://localhost:$WEB_PORT   (app điện thoại trên trình duyệt: http://localhost:$MOBILE_PORT)"
echo "   Quản trị nền tảng: $(val PLATFORM_ADMIN_EMAIL) / $(val PLATFORM_ADMIN_PASSWORD)"
[[ $DEMO -eq 1 ]] && echo '   Demo: số điện thoại in ở bước "Công ty demo" phía trên — mật khẩu Demo@123456'
echo '   Dừng: bash deploy/local/stop.sh   ·   Xem log: docker compose -p intelshield-local logs -f backend'
