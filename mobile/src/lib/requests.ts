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
  proposed_approve: { label: 'Đội trưởng đề xuất duyệt', tone: 'bg-sky-100 text-sky-800' },
  proposed_reject: { label: 'Đội trưởng đề xuất từ chối', tone: 'bg-orange-100 text-orange-800' },
  approved: { label: 'Đã duyệt', tone: 'bg-teal-100 text-teal-800' },
  rejected: { label: 'Không duyệt', tone: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Đã rút', tone: 'bg-slate-100 text-slate-500' },
};

export const OPEN_CORRECTION = ['pending', 'proposed_approve', 'proposed_reject'];

const HOUR = 3_600_000;

interface ShiftLike {
  planned_start: string;
  planned_end: string;
  attendance: { check_in_at: string | null; check_out_at: string | null } | null;
  correction?: string | null;
}

/**
 * What a guard may ask about a shift now (same limits as the backend: from its start until 48 hours after its end,
 * one open request at a time): "missing" when a clock-in, or a clock-out more than six hours late, is not there;
 * "adjust" for a shift already clocked that needs a time changed; null otherwise.
 */
export function correctionFor(s: ShiftLike, now: number): 'missing' | 'adjust' | null {
  const start = new Date(s.planned_start).getTime();
  const end = new Date(s.planned_end).getTime();
  if (now < start || now > end + 48 * HOUR) return null;
  if (s.correction && OPEN_CORRECTION.includes(s.correction)) return null;
  const a = s.attendance;
  if (!a?.check_in_at) return now > end ? 'missing' : null;
  if (!a.check_out_at) return now > end + 6 * HOUR ? 'missing' : null;
  return 'adjust';
}

/** An instant as a datetime-local value, in Vietnam time. */
export const localInput = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .format(new Date(iso))
        .replace(' ', 'T')
    : '';

/** A datetime-local value read as Vietnam time. */
export const fromLocalInput = (value: string) => (value ? `${value}:00+07:00` : undefined);

/** Calendar days from…to, both included. */
export const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const dateVi = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
