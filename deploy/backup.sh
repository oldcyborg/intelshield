#!/bin/sh
# Sao lưu CSDL và ảnh của IntelShield, giữ 14 ngày.
# Cài: chmod +x deploy/backup.sh ; crontab -e  →  30 2 * * * /opt/intelshield/deploy/backup.sh >> /var/log/intelshield-backup.log 2>&1
set -eu
cd "$(dirname "$0")"
# Chỉ đọc hai biến cần dùng (FCM_SERVICE_ACCOUNT là JSON, không source cả file được).
DB_USERNAME=$(grep '^DB_USERNAME=' .env | cut -d= -f2-)
DB_DATABASE=$(grep '^DB_DATABASE=' .env | cut -d= -f2-)
DEST=/var/backups/intelshield
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"
docker compose exec -T postgres pg_dump -U "$DB_USERNAME" -d "$DB_DATABASE" -Fc > "$DEST/db-$STAMP.dump"
docker compose exec -T backend tar -C /app -czf - uploads > "$DEST/uploads-$STAMP.tar.gz"
find "$DEST" -type f -mtime +14 -delete
echo "$(date) sao lưu xong: $DEST/db-$STAMP.dump"
