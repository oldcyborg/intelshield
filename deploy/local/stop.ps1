# Dừng bản chạy trên máy. Dữ liệu vẫn giữ trong volume Docker.
#   powershell -File deploy\local\stop.ps1           dừng
#   powershell -File deploy\local\stop.ps1 -XoaHet   dừng và XÓA toàn bộ dữ liệu (database, tệp tải lên, .env)
param([switch]$XoaHet)
$Here = $PSScriptRoot
$EnvFile = Join-Path $Here '.env'
if (-not (Test-Path $EnvFile)) { Write-Host 'Chưa cài (không có deploy\local\.env).'; exit 0 }
if ($XoaHet) {
  docker compose --env-file $EnvFile -f (Join-Path $Here 'docker-compose.yml') down -v
  Remove-Item $EnvFile
  Write-Host 'Đã xóa toàn bộ dữ liệu. Chạy start.ps1 để cài lại từ đầu.'
} else {
  docker compose --env-file $EnvFile -f (Join-Path $Here 'docker-compose.yml') down
}
