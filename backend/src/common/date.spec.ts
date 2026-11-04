import { addDays, todayLocal } from './date';

describe('todayLocal', () => {
  it('uses Vietnam time, not UTC', () => {
    // 18:30 UTC on the 12th is 01:30 on the 13th in Hanoi.
    expect(todayLocal(new Date('2026-10-12T18:30:00Z'))).toBe('2026-10-13');
    expect(todayLocal(new Date('2026-10-12T16:59:00Z'))).toBe('2026-10-12');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
