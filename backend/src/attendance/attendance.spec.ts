import { attendanceStatus } from './attendance-status';
import { distanceMeters } from './geo';

const at = (iso: string) => new Date(iso);
const S = { late_after_minutes: 10, absent_after_minutes: 30 };
const shift = { status: 'planned' as const, planned_start: at('2026-10-13T00:00:00Z'), planned_end: at('2026-10-13T12:00:00Z'), check_in_at: null, check_out_at: null };

describe('distanceMeters', () => {
  it('measures short distances on the ground', () => {
    expect(distanceMeters({ lat: 21.0285, lng: 105.8542 }, { lat: 21.0285, lng: 105.8542 })).toBe(0);
    const d = distanceMeters({ lat: 21.0285, lng: 105.8542 }, { lat: 21.0294, lng: 105.8542 });
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe('attendanceStatus', () => {
  it.each([
    ['2026-10-12T23:59:00Z', 'upcoming'],
    ['2026-10-13T00:10:00Z', 'waiting'],
    ['2026-10-13T00:11:00Z', 'late'],
    ['2026-10-13T00:31:00Z', 'absent'],
    ['2026-10-13T12:00:00Z', 'absent'],
  ])('with nobody clocked in, at %s the shift is %s', (now, expected) => {
    expect(attendanceStatus(shift, at(now), S)).toBe(expected);
  });

  it('follows the clock-in and clock-out once they exist', () => {
    expect(attendanceStatus({ ...shift, check_in_at: at('2026-10-13T00:20:00Z') }, at('2026-10-13T03:00:00Z'), S)).toBe('on_duty');
    expect(attendanceStatus({ ...shift, check_in_at: at('2026-10-13T00:00:00Z'), check_out_at: at('2026-10-13T12:00:00Z') }, at('2026-10-13T13:00:00Z'), S)).toBe('done');
    expect(attendanceStatus({ ...shift, status: 'cancelled' }, at('2026-10-13T03:00:00Z'), S)).toBe('cancelled');
  });

  it('uses the site thresholds it is given', () => {
    expect(attendanceStatus(shift, at('2026-10-13T00:15:00Z'), { late_after_minutes: 20, absent_after_minutes: 40 })).toBe('waiting');
  });
});
