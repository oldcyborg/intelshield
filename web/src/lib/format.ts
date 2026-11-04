import type { AttendanceStatus, ContractStatus, IncidentStatus, LogbookRow, LogbookType, PhotoRule, RoundStatus, SettingKey, Severity, ViolationRow, ViolationStatus, ViolationType } from './types';

const VND = new Intl.NumberFormat('vi-VN');

/** Money arrives as a numeric string ("8500000"); shown as "8.500.000 đ". */
export const money = (value: string | number) => `${VND.format(Number(value))} đ`;

/** "2026-10-13" → "13/10/2026". */
export const date = (value: string | null | undefined) => {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
};

export const CONTRACT_STATUS: Record<ContractStatus, { label: string; tone: string }> = {
  draft: { label: 'Nháp', tone: 'bg-slate-100 text-slate-700' },
  upcoming: { label: 'Chưa hiệu lực', tone: 'bg-sky-100 text-sky-800' },
  active: { label: 'Đang hiệu lực', tone: 'bg-teal-100 text-teal-800' },
  expiring: { label: 'Sắp hết hạn', tone: 'bg-amber-100 text-amber-800' },
  expired: { label: 'Đã hết hạn', tone: 'bg-red-100 text-red-700' },
  terminated: { label: 'Đã chấm dứt', tone: 'bg-slate-200 text-slate-600' },
};

export const POSITION_LABEL: Record<string, string> = {
  guard: 'Bảo vệ',
  team_leader: 'Đội trưởng',
  supervisor: 'Giám sát',
};

export const UNIT_LABEL: Record<string, string> = {
  per_guard_month: '/người/tháng',
  per_shift: '/ca',
  per_hour: '/giờ',
};

export const DOCUMENT_KIND: Record<string, string> = {
  national_id: 'CCCD',
  security_certificate: 'Chứng chỉ nghiệp vụ bảo vệ',
  health_check: 'Giấy khám sức khoẻ',
  criminal_record: 'Lý lịch tư pháp',
  labor_contract: 'Hợp đồng lao động',
  other: 'Khác',
};

export const SETTING_FIELDS: { key: SettingKey; label: string; unit?: string; min?: number; max?: number }[] = [
  { key: 'late_after_minutes', label: 'Tính đi trễ sau', unit: 'phút', min: 1, max: 240 },
  { key: 'absent_after_minutes', label: 'Tính vắng ca sau', unit: 'phút', min: 2, max: 480 },
  { key: 'early_checkout_minutes', label: 'Ra ca sớm hơn … thì ghi vi phạm', unit: 'phút', min: 0, max: 240 },
  { key: 'round_tolerance_minutes', label: 'Vòng tuần được trễ', unit: 'phút', min: 0, max: 120 },
  { key: 'patrol_photo_random_percent', label: 'Điểm "ảnh ngẫu nhiên": tỉ lệ vòng phải chụp', unit: '%', min: 0, max: 100 },
  { key: 'incident_escalate_medium_minutes', label: 'Sự cố trung bình: leo thang sau', unit: 'phút', min: 1, max: 240 },
  { key: 'incident_escalate_high_minutes', label: 'Sự cố cao: leo thang sau', unit: 'phút', min: 1, max: 120 },
  { key: 'incident_escalate_critical_minutes', label: 'Khẩn cấp / SOS: nhắc lại mỗi', unit: 'phút', min: 1, max: 30 },
  { key: 'incident_close_by_leader_up_to', label: 'Đội trưởng được tự đóng sự cố' },
];

export const CLOSE_BY_LEADER: Record<string, string> = {
  none: 'Không (chỉ quản lý trở lên)',
  low: 'Mức thấp',
  medium: 'Mức thấp và trung bình',
};

export const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: string }> = {
  upcoming: { label: 'Chưa đến giờ', tone: 'bg-slate-100 text-slate-700' },
  waiting: { label: 'Đang chờ vào ca', tone: 'bg-sky-100 text-sky-800' },
  late: { label: 'Chưa vào ca — trễ', tone: 'bg-amber-100 text-amber-800' },
  absent: { label: 'Vắng ca', tone: 'bg-red-100 text-red-700' },
  on_duty: { label: 'Đang trực', tone: 'bg-teal-100 text-teal-800' },
  done: { label: 'Đã ra ca', tone: 'bg-slate-200 text-slate-700' },
  cancelled: { label: 'Đã huỷ', tone: 'bg-slate-100 text-slate-400' },
};

export const FLAG_LABEL: Record<string, string> = {
  outside_geofence: 'ngoài mục tiêu',
  mock_location: 'GPS giả',
  clock_skew: 'giờ máy lệch',
  low_accuracy: 'GPS kém',
  corrected: 'đã điều chỉnh',
};

export const PAY_TYPE: Record<string, string> = { monthly: 'Lương tháng', per_shift: 'Theo ca', per_hour: 'Theo giờ' };
export const MONTHLY_MODE: Record<string, string> = { attendance: 'Theo chấm công', fixed: 'Cố định' };
export const LEAVE_TYPE: Record<string, string> = { annual: 'Phép năm', sick: 'Ốm', personal: 'Việc riêng', unpaid: 'Không lương' };
export const LEAVE_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Chờ duyệt', tone: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Đã duyệt', tone: 'bg-teal-100 text-teal-800' },
  rejected: { label: 'Không duyệt', tone: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Đã rút', tone: 'bg-slate-100 text-slate-500' },
};
export const CORRECTION_REASON: Record<string, string> = {
  phone_dead: 'Máy hết pin', phone_broken: 'Máy hỏng', forgot: 'Quên chấm', no_signal: 'Mất sóng', app_error: 'Lỗi ứng dụng', other: 'Lý do khác',
};
export const CORRECTION_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Chờ đội trưởng', tone: 'bg-amber-100 text-amber-800' },
  proposed_approve: { label: 'Đề xuất duyệt', tone: 'bg-sky-100 text-sky-800' },
  proposed_reject: { label: 'Đề xuất từ chối', tone: 'bg-orange-100 text-orange-800' },
  approved: { label: 'Đã duyệt', tone: 'bg-teal-100 text-teal-800' },
  rejected: { label: 'Không duyệt', tone: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Đã rút', tone: 'bg-slate-100 text-slate-500' },
};

/** An instant as the value of a datetime-local input, in Vietnam time. */
export const localInput = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .format(new Date(iso))
        .replace(' ', 'T')
    : '';

/** A datetime-local value, read as Vietnam time, as an instant the API accepts. */
export const fromLocalInput = (value: string) => (value ? `${value}:00+07:00` : undefined);

/** "2026-10-13T01:30:00Z" → "08:30" in Vietnam time. */
export const time = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

export const SEVERITY: Record<Severity, { label: string; tone: string }> = {
  low: { label: 'Thấp', tone: 'bg-slate-100 text-slate-700' },
  medium: { label: 'Trung bình', tone: 'bg-sky-100 text-sky-800' },
  high: { label: 'Cao', tone: 'bg-amber-100 text-amber-800' },
  critical: { label: 'Khẩn cấp', tone: 'bg-red-600 text-white' },
};

export const INCIDENT_STATUS: Record<IncidentStatus, { label: string; tone: string }> = {
  new: { label: 'Mới — chưa ai nhận', tone: 'bg-red-100 text-red-700' },
  acknowledged: { label: 'Đã tiếp nhận', tone: 'bg-amber-100 text-amber-800' },
  in_progress: { label: 'Đang xử lý', tone: 'bg-sky-100 text-sky-800' },
  resolved: { label: 'Đã xử lý — chờ đóng', tone: 'bg-teal-100 text-teal-800' },
  closed: { label: 'Đã đóng', tone: 'bg-slate-200 text-slate-700' },
  rejected: { label: 'Báo nhầm', tone: 'bg-slate-100 text-slate-500' },
};

export const INCIDENT_SOURCE: Record<string, string> = {
  guard_app: 'Bảo vệ báo',
  staff: 'Nhân sự công ty ghi',
  client_report: 'Khách báo',
};

export const CLIENT_CHANNEL: Record<string, string> = {
  phone: 'Điện thoại',
  zalo: 'Zalo',
  email: 'Email',
  in_person: 'Trực tiếp',
};

/** "2026-10-13T01:30:00Z" → "13/10 08:30" in Vietnam time. */
export const stamp = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    : '—';

export const PHOTO_RULE: Record<PhotoRule, string> = {
  never: 'Không cần ảnh',
  always: 'Luôn kèm ảnh',
  random: 'Ảnh ngẫu nhiên',
};

export const METHOD_LABEL: Record<string, string> = { qr: 'QR', gps: 'GPS', photo: 'Chụp ảnh', nfc: 'NFC' };

export const ROUND_STATUS: Record<RoundStatus, { label: string; tone: string }> = {
  pending: { label: 'Chưa đến / chưa bắt đầu', tone: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'Đang tuần', tone: 'bg-sky-100 text-sky-800' },
  completed: { label: 'Đủ điểm', tone: 'bg-teal-100 text-teal-800' },
  partial: { label: 'Thiếu điểm', tone: 'bg-amber-100 text-amber-800' },
  missed: { label: 'Bỏ lỡ', tone: 'bg-red-100 text-red-700' },
};

export const SCAN_FLAG: Record<string, string> = {
  outside_radius: 'ngoài bán kính',
  mock_location: 'GPS giả',
  low_accuracy: 'GPS kém',
  clock_skew: 'giờ máy lệch',
  late_sync: 'gửi muộn',
  impossible_speed: 'di chuyển quá nhanh',
  backdated: 'báo bù muộn so với giờ khai',
  no_location: 'quét QR không có vị trí',
};

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' }, { value: 4, label: 'T5' },
  { value: 5, label: 'T6' }, { value: 6, label: 'T7' }, { value: 7, label: 'CN' },
];

export const VIOLATION_TYPE: Record<ViolationType, string> = {
  late_check_in: 'Vào ca trễ',
  absent: 'Vắng ca',
  early_check_out: 'Ra ca sớm',
  missed_round: 'Bỏ vòng tuần',
  missed_checkpoint: 'Thiếu điểm tuần tra',
  suspicious_scan: 'Lần quét nghi vấn',
};

export const VIOLATION_STATUS: Record<ViolationStatus, { label: string; tone: string }> = {
  auto: { label: 'Mới — chưa xem', tone: 'bg-amber-100 text-amber-800' },
  proposed_confirm: { label: 'Đội trưởng đề xuất xác nhận', tone: 'bg-sky-100 text-sky-800' },
  proposed_waive: { label: 'Đội trưởng đề xuất miễn', tone: 'bg-sky-100 text-sky-800' },
  confirmed: { label: 'Đã xác nhận', tone: 'bg-red-100 text-red-700' },
  waived: { label: 'Đã miễn', tone: 'bg-slate-100 text-slate-500' },
};

/** One line saying what happened, in the guard's terms. */
export function violationText(v: ViolationRow): string {
  switch (v.type) {
    case 'late_check_in':
      return `Trễ ${v.minutes ?? '?'} phút${v.detail.converted_from === 'absent' ? ' (lúc đầu ghi vắng)' : ''}`;
    case 'absent':
      return 'Không vào ca';
    case 'early_check_out':
      return `Về sớm ${v.minutes ?? '?'} phút`;
    case 'missed_round':
      return `Không ai đi vòng${v.detail.route_name ? ` "${v.detail.route_name}"` : ''}`;
    case 'missed_checkpoint':
      return `Thiếu: ${(v.detail.missing ?? []).map((k) => `${k.code} ${k.name}`).join(', ') || '—'}`;
    case 'suspicious_scan':
      return `${v.detail.checkpoint_code ?? ''} ${v.detail.checkpoint_name ?? ''}: ${(v.detail.flags ?? []).map((f) => SCAN_FLAG[f] ?? f).join(', ')}`;
  }
}

export const LOGBOOK_TYPE: Record<LogbookType, string> = {
  note: 'Ghi chú',
  visitor: 'Khách ra vào',
  vehicle: 'Xe ra vào',
  asset: 'Tài sản',
  other: 'Khác',
};

const ASSET_ACTION: Record<string, string> = { received: 'nhận', handed_out: 'giao', lent: 'cho mượn', returned: 'trả lại' };

/** One line of the book in plain words. */
export function logbookText(l: LogbookRow): string {
  const d = l.data;
  if (l.type === 'visitor') return [d.visitor_name, d.visitor_org && `(${d.visitor_org})`, d.meet_whom && `gặp ${d.meet_whom}`, d.purpose && `— ${d.purpose}`].filter(Boolean).join(' ');
  if (l.type === 'vehicle') return [d.plate, d.vehicle_kind && `· ${d.vehicle_kind}`, d.cargo && `— ${d.cargo}`].filter(Boolean).join(' ');
  if (l.type === 'asset') return `${ASSET_ACTION[d.asset_action ?? ''] ?? ''} ${d.quantity ?? ''} ${d.item ?? ''}${d.counterpart ? ` — ${d.counterpart}` : ''}`.replace(/\s+/g, ' ').trim();
  return l.body ?? '';
}

export const HANDOVER_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: 'Chờ người nhận xác nhận', tone: 'bg-amber-100 text-amber-800' },
  accepted: { label: 'Người nhận đồng ý', tone: 'bg-teal-100 text-teal-800' },
  disputed: { label: 'Người nhận không đồng ý', tone: 'bg-red-100 text-red-700' },
};

/** Who may see and call a site contact; each level also sees the ones below it. */
export const CONTACT_LEVEL: Record<string, { label: string; hint: string; tone: string }> = {
  staff: { label: 'Văn phòng', hint: 'quản lý, HR, kế toán', tone: 'bg-slate-100 text-slate-700' },
  leader: { label: 'Đội trưởng', hint: 'thêm đội trưởng phụ trách mục tiêu', tone: 'bg-sky-100 text-sky-800' },
  guard: { label: 'Bảo vệ', hint: 'thêm bảo vệ đang có ca tại mục tiêu', tone: 'bg-teal-100 text-teal-800' },
};

export const PAYROLL_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Nháp — đang chỉnh', tone: 'bg-amber-100 text-amber-800' },
  locked: { label: 'Đã chốt', tone: 'bg-sky-100 text-sky-800' },
  paid: { label: 'Đã trả', tone: 'bg-teal-100 text-teal-800' },
};

export const ADJUSTMENT_KIND: Record<string, { label: string; hint: string }> = {
  bonus: { label: 'Thưởng', hint: 'cộng' },
  advance: { label: 'Tạm ứng', hint: 'trừ' },
  tax: { label: 'Thuế TNCN', hint: 'trừ' },
  other: { label: 'Khác', hint: 'số dương cộng, số âm trừ' },
};

/** "2026-10" → "Tháng 10/2026". */
export const monthLabel = (month: string) => `Tháng ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

export const PAYMENT_METHOD: Record<string, string> = { transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác' };

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** 0–999 in words; `full` keeps "không trăm" and "linh" when a bigger group comes before. */
function hundreds(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (h || full) out.push(`${DIGITS[h]} trăm`);
  if (t > 1) out.push(`${DIGITS[t]} mươi`);
  else if (t === 1) out.push('mười');
  else if (u && (h || full)) out.push('linh');
  if (u === 1 && t > 1) out.push('mốt');
  else if (u === 5 && t > 0) out.push('lăm');
  else if (u === 4 && t > 1) out.push('tư');
  else if (u) out.push(DIGITS[u]);
  return out.join(' ');
}

/** An amount of đồng in Vietnamese words, as written on payment requests: "Mười chín triệu … đồng chẵn". */
export function vndWords(amount: number): string {
  const value = Math.round(Math.abs(amount));
  if (!value) return 'Không đồng';
  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const groups: number[] = [];
  for (let v = value; v > 0; v = Math.floor(v / 1000)) groups.push(v % 1000);
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (!groups[i]) continue;
    parts.push(`${hundreds(groups[i], i < groups.length - 1)}${units[i] ? ` ${units[i]}` : ''}`);
  }
  const text = `${amount < 0 ? 'âm ' : ''}${parts.join(' ')} đồng chẵn`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where a statement stands: being prepared, waiting for money, paid, or late. */
export function statementState(s: { status: string; balance: number; paid: number; overdue_days: number }): { label: string; tone: string } {
  if (s.status === 'draft') return { label: 'Nháp — đang đối soát', tone: 'bg-amber-100 text-amber-800' };
  if (s.balance <= 0) return { label: 'Đã thu đủ', tone: 'bg-teal-100 text-teal-800' };
  if (s.overdue_days > 0) return { label: `Quá hạn ${s.overdue_days} ngày`, tone: 'bg-red-100 text-red-700' };
  return { label: s.paid > 0 ? 'Đã thu một phần' : 'Chờ thanh toán', tone: 'bg-sky-100 text-sky-800' };
}
