export const SEVERITY: Record<string, { label: string; tone: string }> = {
  low: { label: 'Thấp', tone: 'bg-slate-100 text-slate-700' },
  medium: { label: 'Trung bình', tone: 'bg-sky-100 text-sky-800' },
  high: { label: 'Cao', tone: 'bg-amber-100 text-amber-800' },
  critical: { label: 'Khẩn cấp', tone: 'bg-red-600 text-white' },
};

export const INCIDENT_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: 'Chưa ai nhận', tone: 'bg-red-100 text-red-700' },
  acknowledged: { label: 'Đã tiếp nhận', tone: 'bg-amber-100 text-amber-800' },
  in_progress: { label: 'Đang xử lý', tone: 'bg-sky-100 text-sky-800' },
  resolved: { label: 'Chờ đóng', tone: 'bg-teal-100 text-teal-800' },
  closed: { label: 'Đã đóng', tone: 'bg-slate-200 text-slate-700' },
  rejected: { label: 'Báo nhầm', tone: 'bg-slate-100 text-slate-500' },
};

export const STEP_LABEL: Record<string, string> = {
  acknowledge: 'Tôi tiếp nhận',
  assign: 'Giao người xử lý',
  start: 'Bắt đầu xử lý',
  resolve: 'Đã xử lý xong',
  close: 'Đóng sự cố',
  reopen: 'Mở lại',
  reject: 'Báo nhầm',
  comment: 'Bình luận',
};

export const ATTENDANCE_STATUS: Record<string, { label: string; tone: string }> = {
  upcoming: { label: 'Chưa đến giờ', tone: 'bg-slate-100 text-slate-600' },
  waiting: { label: 'Chờ vào ca', tone: 'bg-sky-100 text-sky-800' },
  late: { label: 'Trễ — chưa vào', tone: 'bg-amber-100 text-amber-800' },
  absent: { label: 'Vắng', tone: 'bg-red-100 text-red-700' },
  on_duty: { label: 'Đang trực', tone: 'bg-teal-100 text-teal-800' },
  done: { label: 'Đã ra ca', tone: 'bg-slate-200 text-slate-600' },
  cancelled: { label: 'Đã huỷ', tone: 'bg-slate-100 text-slate-400' },
};

export const ROUND_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Chưa đến', tone: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'Đang tuần', tone: 'bg-sky-100 text-sky-800' },
  completed: { label: 'Đủ điểm', tone: 'bg-teal-100 text-teal-800' },
  partial: { label: 'Thiếu điểm', tone: 'bg-amber-100 text-amber-800' },
  missed: { label: 'Bỏ lỡ', tone: 'bg-red-100 text-red-700' },
};

export const SCAN_FLAG: Record<string, string> = {
  outside_radius: 'ngoài bán kính', mock_location: 'vị trí giả', low_accuracy: 'GPS kém', clock_skew: 'giờ máy lệch',
  late_sync: 'gửi muộn', impossible_speed: 'đi quá nhanh', backdated: 'báo bù muộn', no_location: 'QR không có vị trí',
  outside_geofence: 'ngoài khu vực mục tiêu',
};

export const VIOLATION_TYPE: Record<string, string> = {
  late_check_in: 'Vào ca trễ', absent: 'Vắng ca', early_check_out: 'Ra ca sớm',
  missed_round: 'Bỏ vòng tuần', missed_checkpoint: 'Thiếu điểm', suspicious_scan: 'Quét nghi vấn',
};

export const VIOLATION_STATUS: Record<string, string> = {
  auto: 'Mới', proposed_confirm: 'Đề xuất xác nhận', proposed_waive: 'Đề xuất miễn', confirmed: 'Đã xác nhận', waived: 'Đã miễn',
};

export const LOGBOOK_TYPE: Record<string, string> = { note: 'Ghi chú', visitor: 'Khách', vehicle: 'Xe', asset: 'Tài sản', other: 'Khác' };
