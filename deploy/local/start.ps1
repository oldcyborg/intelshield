# Chạy IntelShield trên máy Windows bằng Docker Desktop.
#
#   powershell -ExecutionPolicy Bypass -File deploy\local\start.ps1             cài lần đầu (kèm công ty demo) hoặc cập nhật
#   powershell -ExecutionPolicy Bypass -File deploy\local\start.ps1 -KhongDemo  không dựng công ty demo
param([switch]$KhongDemo)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$EnvFile = Join-Path $Here '.env'
$ComposeFile = Join-Path $Here 'docker-compose.yml'

function Say($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Die($m) { Write-Host "`nDỪNG: $m" -ForegroundColor Red; exit 1 }
function Rand { -join ((1..24) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }
function Compose { & docker compose --env-file $EnvFile -f $ComposeFile @args; if ($LASTEXITCODE -ne 0) { Die "docker compose $args" } }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die 'chưa cài Docker Desktop (https://docs.docker.com/desktop/).' }
docker info *> $null; if ($LASTEXITCODE -ne 0) { Die 'Docker chưa chạy — mở Docker Desktop rồi chạy lại.' }

if (-not (Test-Path $EnvFile)) {
  Say 'Tạo deploy\local\.env (mật khẩu ngẫu nhiên)'
  $lines = Get-Content (Join-Path $Here '.env.example') | ForEach-Object { if ($_ -match '=__RANDOM__$') { $_ -replace '__RANDOM__$', (Rand) } else { $_ } }
  [IO.File]::WriteAllLines($EnvFile, $lines)
}
$cfg = @{}; Get-Content $EnvFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $cfg[$k] = $v }
$Port = if ($cfg.WEB_PORT) { $cfg.WEB_PORT } else { '8082' }
$MobilePort = if ($cfg.MOBILE_PORT) { $cfg.MOBILE_PORT } else { '8083' }

Say 'Dựng ảnh và khởi động (lần đầu mất vài phút)'
Compose up -d --build

Say 'Chờ hệ thống sẵn sàng'
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null; $ok = $true; break } catch {}
  Start-Sleep -Seconds 2
}
if (-not $ok) { Compose logs --tail 60 backend; Die 'backend không trả lời — xem log ở trên.' }

Say 'Tài khoản quản trị nền tảng'
Compose exec -T backend node dist/scripts/create-platform-admin.js
if (-not $KhongDemo) {
  Say 'Công ty demo'
  Compose exec -T backend node dist/scripts/seed-demo.js
}

Say "Xong: http://localhost:$Port   (app điện thoại trên trình duyệt: http://localhost:$MobilePort)"
Write-Host "   Quản trị nền tảng: $($cfg.PLATFORM_ADMIN_EMAIL) / $($cfg.PLATFORM_ADMIN_PASSWORD)"
if (-not $KhongDemo) { Write-Host '   Demo: số điện thoại in ở bước "Công ty demo" phía trên — mật khẩu Demo@123456' }
Write-Host '   Dừng: powershell -File deploy\local\stop.ps1'
