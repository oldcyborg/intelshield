export type AttendanceStatus = 'upcoming' | 'waiting' | 'late' | 'absent' | 'on_duty' | 'done' | 'cancelled';

/**
 * Where a shift stands right now, from its times, its clock-in/out and the site's
 * thresholds. Computed when read, so changing a site's threshold changes the board at once.
 */
export function attendanceStatus(
  a: { status: 'planned' | 'cancelled'; planned_start: Date; planned_end: Date; check_in_at: Date | null; check_out_at: Date | null },
  now: Date,
  s: { late_after_minutes: number; absent_after_minutes: number },
): AttendanceStatus {
  if (a.status === 'cancelled') return 'cancelled';
  if (a.check_out_at) return 'done';
  if (a.check_in_at) return 'on_duty';
  const minutesIn = (now.getTime() - a.planned_start.getTime()) / 60_000;
  if (minutesIn < 0) return 'upcoming';
  if (now.getTime() >= a.planned_end.getTime() || minutesIn > s.absent_after_minutes) return 'absent';
  if (minutesIn > s.late_after_minutes) return 'late';
  return 'waiting';
}
