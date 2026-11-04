const TZ = 'Asia/Ho_Chi_Minh';

export const time = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

export const day = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso));

export const stamp = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

/** YYYY-MM-DD in Vietnam, `offset` days from today. */
export const localDate = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offset * 86_400_000));

export const FLAG_LABEL: Record<string, string> = {
  outside_geofence: 'ngoài khu vực mục tiêu',
  mock_location: 'vị trí giả',
  clock_skew: 'giờ máy lệch',
  low_accuracy: 'GPS kém',
  corrected: 'đã điều chỉnh',
};
