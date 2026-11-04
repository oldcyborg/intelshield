import { describe, expect, it } from 'vitest';
import { correctionFor, dayCount, fromLocalInput, localInput } from './requests';

const H = 3_600_000;
const start = Date.parse('2026-10-13T11:00:00Z');
const shift = (attendance: { check_in_at: string | null; check_out_at: string | null } | null, correction: string | null = null) => ({
  planned_start: new Date(start).toISOString(), planned_end: new Date(start + 12 * H).toISOString(), attendance, correction,
});

describe('correctionFor', () => {
  it('offers to add a shift never clocked, once it is over, for 48 hours', () => {
    expect(correctionFor(shift(null), start + 2 * H)).toBeNull();
    expect(correctionFor(shift(null), start + 13 * H)).toBe('missing');
    expect(correctionFor(shift(null), start + 12 * H + 49 * H)).toBeNull();
  });
  it('offers a missing clock-out only after the six hours to clock out have gone', () => {
    const inOnly = shift({ check_in_at: new Date(start).toISOString(), check_out_at: null });
    expect(correctionFor(inOnly, start + 13 * H)).toBeNull();
    expect(correctionFor(inOnly, start + 19 * H)).toBe('missing');
  });
  it('lets a clocked shift be adjusted, and never while a request is open', () => {
    const full = shift({ check_in_at: new Date(start).toISOString(), check_out_at: new Date(start + 12 * H).toISOString() });
    expect(correctionFor(full, start + 13 * H)).toBe('adjust');
    expect(correctionFor({ ...full, correction: 'pending' }, start + 13 * H)).toBeNull();
    expect(correctionFor({ ...full, correction: 'rejected' }, start + 13 * H)).toBe('adjust');
  });
});

describe('dates', () => {
  it('reads and writes Vietnam time, and counts days inclusively', () => {
    expect(localInput('2026-10-13T11:05:00Z')).toBe('2026-10-13T18:05');
    expect(fromLocalInput('2026-10-13T18:05')).toBe('2026-10-13T18:05:00+07:00');
    expect(dayCount('2026-10-30', '2026-11-02')).toBe(4);
  });
});
