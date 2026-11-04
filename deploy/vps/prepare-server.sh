#!/usr/bin/env bash
# Chuẩn bị một VPS Ubuntu/Debian **mới tinh**.
#
#   sudo bash deploy/vps/prepare-server.sh
#
# `install.sh` tự gọi tệp này khi máy còn thiếu công cụ, nên thường không cần
# chạy tay. Chạy lại bao nhiêu lần cũng được: thứ gì đã có thì bỏ qua.
#
# Cài: Docker (từ kho chính thức, có plugin `docker compose`), nginx, certbot,
# ufw, cron. Tạo swap nếu máy chưa có. Mở tường lửa cho SSH, 80, 443.
#
# **Không đụng** vào thứ đã có: Docker cài sẵn thì không cài lại, swap đã có thì
# không thêm, `daemon.json` đã có thì không ghi đè — trên một VPS đang chạy dịch
# vụ khác, ghi đè cấu hình Docker là khởi động lại container của người khác.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$HERE/cau-hinh.env"

SWAP_GB=2
if [[ -f "$CONF" ]]; then
  # Bỏ CR cuối dòng — tệp sửa trên Windows rồi chép lên mang CRLF.
  # shellcheck disable=SC1090
  set -a; . <(tr -d '\r' < "$CONF"); set +a
fi
SWAP_GB="${SWAP_GB:-2}"

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
warn() { printf '   \033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mDUNG: %s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[[ $EUID -eq 0 ]] || die 'chay bang quyen root: sudo bash deploy/vps/prepare-server.sh'
[[ "$SWAP_GB" =~ ^[0-9]+$ ]] || die "SWAP_GB='$SWAP_GB' phai la mot so nguyen (GB)."
[[ -r /etc/os-release ]] || die 'khong doc duoc /etc/os-release — khong nhan ra he dieu hanh.'
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) die "he dieu hanh '${ID:-?}' chua duoc ho tro. Bo cai nay viet cho Ubuntu (da thu 24.04) va Debian." ;;
esac
have apt-get || die 'khong co apt-get.'

export DEBIAN_FRONTEND=noninteractive

# ─────────────────────────────────────────────────────── 1. Gói hệ thống
step '1/5  Goi he thong'
want=(ca-certificates curl openssl iproute2 gnupg nginx certbot python3-certbot-nginx ufw cron)
missing=()
for pkg in "${want[@]}"; do
  dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed' || missing+=("$pkg")
done
if (( ${#missing[@]} > 0 )); then
  note "cai: ${missing[*]}"
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends "${missing[@]}"
else
  note 'da du goi.'
fi
if have systemctl; then
  systemctl enable --now nginx >/dev/null 2>&1 || warn 'khong bat duoc dich vu nginx bang systemctl.'
  systemctl enable --now cron  >/dev/null 2>&1 || true
fi

# ─────────────────────────────────────────────────────── 2. Docker
step '2/5  Docker'
fresh_docker=0
if have docker && docker compose version >/dev/null 2>&1; then
  note "da co Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') va compose $(docker compose version --short 2>/dev/null)."
elif have docker; then
  # Docker do kho của Ubuntu cài (`docker.io`) không kèm plugin compose. Cài
  # `docker-ce` chồng lên sẽ xung đột gói, nên chỉ thêm đúng plugin.
  note 'da co Docker nhung thieu plugin compose — cai them.'
  apt-get install -y -qq docker-compose-v2 2>/dev/null \
    || apt-get install -y -qq docker-compose-plugin 2>/dev/null \
    || die "khong cai duoc plugin 'docker compose'. Cai tay roi chay lai."
else
  note 'cai Docker tu kho chinh thuc download.docker.com …'
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fresh_docker=1
fi

# Giới hạn nhật ký cho **mọi** container, kể cả ảnh của bên khác: nhật ký không
# giới hạn là cách một ổ 15 GB đầy dần mà không ai thấy. Chỉ ghi khi chính script
# vừa cài Docker — có `daemon.json` rồi thì đó là cấu hình của người khác.
if (( fresh_docker == 1 )) && [[ ! -f /etc/docker/daemon.json ]]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
  note 'da ghi /etc/docker/daemon.json (nhat ky toi da 30 MB moi container).'
  have systemctl && systemctl restart docker >/dev/null 2>&1 || true
fi
if have systemctl; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker info >/dev/null 2>&1 || die 'Docker da cai nhung khong chay (docker info that bai). Xem: systemctl status docker'
note "Docker chay. compose $(docker compose version --short 2>/dev/null)."

# ─────────────────────────────────────────────────────── 3. Swap
step '3/5  Swap'
swap_mb=$(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo)
if (( swap_mb > 0 )); then
  note "da co swap $swap_mb MB — giu nguyen."
elif (( SWAP_GB == 0 )); then
  warn 'SWAP_GB=0 — khong tao swap. Mot truy van nang co the lam PostgreSQL bi giet.'
else
  free_mb=$(df -Pm / | awk 'NR==2 {print $4}')
  need=$(( SWAP_GB * 1024 + 4000 ))
  if (( free_mb < need )); then
    warn "o dia con $free_mb MB, khong du cho swap ${SWAP_GB} GB va van con 4 GB cho ung dung — bo qua."
  elif [[ -e /swapfile ]]; then
    warn '/swapfile da ton tai nhung khong duoc bat — khong dung toi, kiem tra bang tay.'
  else
    note "tao /swapfile ${SWAP_GB} GB …"
    fallocate -l "${SWAP_GB}G" /swapfile 2>/dev/null \
      || dd if=/dev/zero of=/swapfile bs=1M count=$(( SWAP_GB * 1024 )) status=none
    chmod 600 /swapfile
    # VPS dạng container (OpenVZ, LXC) thường không cho tự tạo swap: nhà cung
    # cấp quyết định. Hỏng ở đây là nói ra rồi đi tiếp, không phải dừng cả cài đặt.
    if mkswap /swapfile >/dev/null 2>&1 && swapon /swapfile 2>/dev/null; then
      grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      note "da bat swap ${SWAP_GB} GB."
    else
      rm -f /swapfile
      warn 'VPS nay khong cho tao swap (thuong la VPS dang container). Hoi nha cung cap, hoac chay khong swap.'
    fi
  fi
fi
# Chỉ dùng swap khi thật cần: đẩy PostgreSQL ra đĩa sớm thì mọi trang đều chậm.
if [[ ! -f /etc/sysctl.d/99-app-swappiness.conf ]]; then
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-app-swappiness.conf
  sysctl -q -p /etc/sysctl.d/99-app-swappiness.conf 2>/dev/null || true
fi

# ─────────────────────────────────────────────────────── 4. Tường lửa
step '4/5  Tuong lua'
if ! have ufw; then
  warn 'khong co ufw — bo qua. Nho mo cong 80 va 443 o tuong lua cua nha cung cap.'
else
  # Mở SSH **trước** khi bật ufw, và mở đúng cổng đang dùng: bật tường lửa mà
  # quên cổng SSH là tự khóa mình ngoài máy, chỉ còn đường vào qua bảng điều
  # khiển của nhà cung cấp. Gom cổng từ mọi nguồn: 22, cấu hình sshd, phiên SSH
  # đang mở.
  ssh_ports=(22)
  while read -r p; do [[ -n "$p" ]] && ssh_ports+=("$p"); done < <(sshd -T 2>/dev/null | awk '/^port / {print $2}')
  [[ -n "${SSH_CONNECTION:-}" ]] && ssh_ports+=("$(awk '{print $4}' <<<"$SSH_CONNECTION")")
  while read -r p; do [[ -n "$p" ]] && ssh_ports+=("$p"); done \
    < <(ss -tnpH state established 2>/dev/null | awk '/sshd/ {n=split($3,a,":"); print a[n]}')
  mapfile -t ssh_ports < <(printf '%s\n' "${ssh_ports[@]}" | grep -E '^[0-9]+$' | sort -un)

  ok_ufw=1
  for p in "${ssh_ports[@]}"; do ufw allow "$p/tcp" >/dev/null 2>&1 || ok_ufw=0; done
  ufw allow 80/tcp  >/dev/null 2>&1 || ok_ufw=0
  ufw allow 443/tcp >/dev/null 2>&1 || ok_ufw=0
  if (( ok_ufw == 0 )); then
    warn 'ufw khong ghi duoc luat (VPS dang container?) — bo qua. Mo cong 80 va 443 o tuong lua cua nha cung cap.'
  elif ufw status 2>/dev/null | grep -q 'Status: active'; then
    note "ufw dang bat — da them luat cho SSH (${ssh_ports[*]}), 80, 443."
  elif ufw --force enable >/dev/null 2>&1; then
    note "da bat ufw: SSH (${ssh_ports[*]}), 80, 443."
  else
    warn 'khong bat duoc ufw — bo qua. Mo cong 80 va 443 o tuong lua cua nha cung cap.'
  fi
fi

# ─────────────────────────────────────────────────────── 5. Tóm tắt
step '5/5  Xong'
note "RAM $(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo) MB · swap $(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo) MB · o dia con $(df -Pm / | awk 'NR==2 {print $4}') MB"
note 'buoc tiep theo: sudo bash deploy/vps/install.sh'
