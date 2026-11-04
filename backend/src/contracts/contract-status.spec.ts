import { contractStatus, daysBetween } from './contract-status';

const base = { state: 'signed' as const, start_date: '2026-01-01', end_date: '2026-12-31', notice_days: 30 };

describe('contractStatus', () => {
  it.each([
    ['2025-12-31', 'upcoming'],
    ['2026-01-01', 'active'],
    ['2026-12-01', 'expiring'], // 30 days left
    ['2026-11-30', 'active'], // 31 days left
    ['2026-12-31', 'expiring'], // the last day still counts
    ['2027-01-01', 'expired'],
  ])('on %s a signed contract is %s', (today, expected) => {
    expect(contractStatus(base, today)).toBe(expected);
  });

  it('never calls a draft or a terminated contract anything else', () => {
    expect(contractStatus({ ...base, state: 'draft' }, '2026-06-01')).toBe('draft');
    expect(contractStatus({ ...base, state: 'terminated' }, '2026-06-01')).toBe('terminated');
  });

  it('with zero notice only the last day is "expiring"', () => {
    expect(contractStatus({ ...base, notice_days: 0 }, '2026-12-30')).toBe('active');
    expect(contractStatus({ ...base, notice_days: 0 }, '2026-12-31')).toBe('expiring');
  });

  it('counts calendar days', () => {
    expect(daysBetween('2026-12-01', '2026-12-31')).toBe(30);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});
