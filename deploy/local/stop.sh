#!/usr/bin/env bash
# Dừng bản chạy trên máy. Dữ liệu vẫn giữ trong volume Docker.
#   bash deploy/local/stop.sh            dừng
#   bash deploy/local/stop.sh --xoa-het  dừng và XÓA toàn bộ dữ liệu (database, tệp tải lên, .env)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/.env" ]] || { echo 'Chưa cài (không có deploy/local/.env).'; exit 0; }
if [[ "${1:-}" == --xoa-het ]]; then
  docker compose --env-file "$HERE/.env" -f "$HERE/docker-compose.yml" down -v
  rm -f "$HERE/.env"
  echo 'Đã xóa toàn bộ dữ liệu. Chạy start.sh để cài lại từ đầu.'
else
  docker compose --env-file "$HERE/.env" -f "$HERE/docker-compose.yml" down
fi
