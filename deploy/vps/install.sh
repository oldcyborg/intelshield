#!/usr/bin/env bash
# Cài hoặc cập nhật IntelShield trên một VPS Ubuntu/Debian — máy mới tinh hoặc
# máy đang chạy dịch vụ khác.
#
#   sudo bash deploy/vps/install.sh     lần đầu: tạo deploy/.env rồi dừng để bạn điền DOMAIN
#   sudo bash deploy/vps/install.sh     lần sau: dựng ảnh, chạy, cấu hình nginx + HTTPS
#
# Chạy lại là cập nhật: giữ nguyên mật khẩu và khóa JWT trong deploy/.env.
# Không đụng tới dịch vụ khác: container nghe ở 127.0.0.1, nginx chỉ thêm tệp
# sites-available/intelshield.conf, mọi lệnh compose chỉ đích danh project `intelshield`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
ENV_FILE="$DEPLOY/.env"
NGINX_SITE=/etc/nginx/sites-available/intelshield.conf
NGINX_LINK=/etc/nginx/sites-enabled/intelshield.conf

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die()  { printf '\n\033[31mDỪNG: %s\033[0m\n' "$*" >&2; exit 1; }
rand() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
val()  { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r'; }
setval() { sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; }
compose() { docker compose --env-file "$ENV_FILE" -f "$DEPLOY/docker-compose.yml" "$@"; }

[[ $EUID -eq 0 ]] || die 'chạy bằng sudo: sudo bash deploy/vps/install.sh'

step '1/7  Cấu hình deploy/.env'
if [[ ! -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" == *=__RANDOM__ ]]; then echo "${line%__RANDOM__}$(rand)"; else echo "$line"; fi
  done < "$DEPLOY/.env.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  note "Đã tạo $ENV_FILE với mật khẩu ngẫu nhiên."
  note 'Mở tệp, điền DOMAIN (và LETSENCRYPT_EMAIL), rồi chạy lại lệnh này.'
  exit 0
fi
sed -i 's/\r$//' "$ENV_FILE"
DOMAIN="$(val DOMAIN)"; EMAIL="$(val LETSENCRYPT_EMAIL)"
WEB_PORT="$(val WEB_PORT)"; WEB_PORT="${WEB_PORT:-5000}"
API_PORT="$(val API_PORT)"; API_PORT="${API_PORT:-5001}"
[[ -n "$DOMAIN" && "$DOMAIN" != *example.com ]] || die "điền DOMAIN trong $ENV_FILE (đang là tên miền mẫu)."
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "DOMAIN '$DOMAIN' không phải tên miền (không có https://, không có /)."
setval CORS_ORIGIN "https://$DOMAIN,https://localhost"
[[ -n "$(val DEMO_RESET_KEY)" || "$(val SEED_DEMO)" != yes ]] || setval DEMO_RESET_KEY "$(rand)"
note "tên miền $DOMAIN · web 127.0.0.1:$WEB_PORT · api 127.0.0.1:$API_PORT"

step '2/7  Chuẩn bị máy (Docker, nginx, certbot, swap, tường lửa)'
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1 || ! command -v nginx >/dev/null || ! command -v certbot >/dev/null; then
  bash "$HERE/prepare-server.sh"
else
  note 'đã có đủ — bỏ qua.'
fi

step '3/7  Kiểm tra cổng'
for p in "$WEB_PORT" "$API_PORT"; do
  if ss -ltnH "( sport = :$p )" 2>/dev/null | grep -q . && ! compose ps -q 2>/dev/null | grep -q .; then
    die "cổng $p đã có dịch vụ khác dùng — đổi WEB_PORT/API_PORT trong $ENV_FILE."
  fi
done
note 'ổn.'

step '4/7  Dựng ảnh và khởi động'
# Từng ảnh một: dựng song song trên VPS nhỏ là hai lần npm ci cùng lúc.
compose build backend
compose build web
compose up -d --remove-orphans
docker image prune -f >/dev/null

step '5/7  Chờ backend (tự chạy migration)'
ok=0
for _ in $(seq 1 90); do
  curl -fs "http://127.0.0.1:$API_PORT/api/health" >/dev/null && { ok=1; break; }
  sleep 2
done
[[ $ok -eq 1 ]] || { compose logs --tail 60 backend; die 'backend không lên — xem log ở trên.'; }
compose exec -T backend node dist/scripts/create-platform-admin.js
if [[ "$(val SEED_DEMO)" == yes ]]; then compose exec -T backend node dist/scripts/seed-demo.js; fi

step '6/7  nginx + HTTPS'
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__WEB_PORT__/$WEB_PORT/g" -e "s/__API_PORT__/$API_PORT/g" \
  "$DEPLOY/nginx/intelshield.conf.template" > /tmp/intelshield.conf
if [[ -f "$NGINX_SITE" ]] && grep -q 'managed by Certbot' "$NGINX_SITE"; then
  note "$NGINX_SITE đã được certbot sửa — giữ nguyên."
else
  install -m 644 /tmp/intelshield.conf "$NGINX_SITE"
  ln -sf "$NGINX_SITE" "$NGINX_LINK"
  if ! nginx -t 2>/dev/null; then rm -f "$NGINX_LINK"; nginx -t || true; die 'cấu hình nginx lỗi — đã gỡ tệp của IntelShield, dịch vụ khác không bị ảnh hưởng.'; fi
  systemctl reload nginx
fi
if [[ -n "$EMAIL" ]] && ! grep -q 'managed by Certbot' "$NGINX_SITE"; then
  certbot --nginx -d "$DOMAIN" --redirect -m "$EMAIL" --agree-tos -n || note 'certbot lỗi — kiểm tra DNS đã trỏ về VPS chưa, rồi chạy lại.'
elif [[ -z "$EMAIL" ]]; then
  note 'không có LETSENCRYPT_EMAIL — chạy HTTP. App Android cần HTTPS.'
fi

step '7/7  Sao lưu hằng đêm'
chmod +x "$DEPLOY/backup.sh"
echo "30 2 * * * root $DEPLOY/backup.sh >> /var/log/intelshield-backup.log 2>&1" > /etc/cron.d/intelshield-backup
note 'mỗi đêm 02:30 vào /var/backups/intelshield, giữ 14 ngày.'

scheme=http; grep -q 'managed by Certbot' "$NGINX_SITE" && scheme=https
printf '\n\033[1;32mXong: %s://%s\033[0m\n' "$scheme" "$DOMAIN"
note "Quản trị nền tảng: $(val PLATFORM_ADMIN_EMAIL) / mật khẩu PLATFORM_ADMIN_PASSWORD trong $ENV_FILE"
[[ "$(val SEED_DEMO)" == yes ]] && note "Dựng lại demo: $scheme://$DOMAIN/resetdemo?key=$(val DEMO_RESET_KEY)"
