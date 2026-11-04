import { ContractState } from './contract.entity';

export type ContractStatus = 'draft' | 'upcoming' | 'active' | 'expiring' | 'expired' | 'terminated';

export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * Status follows from the dates every time it is read, so no nightly job can
 * forget to flip a contract to "expired". The end date is the last covered day.
 */
export function contractStatus(
  c: { state: ContractState; start_date: string; end_date: string; notice_days: number },
  today: string,
): ContractStatus {
  if (c.state === 'terminated') return 'terminated';
  if (c.state === 'draft') return 'draft';
  if (c.end_date < today) return 'expired';
  if (c.start_date > today) return 'upcoming';
  return daysBetween(today, c.end_date) <= c.notice_days ? 'expiring' : 'active';
}

/** The same rule in SQL, for filtering lists. `$TODAY` is replaced with the parameter placeholder. */
export const statusSql = (alias: string, today: string) => `
  CASE WHEN ${alias}.state = 'terminated' THEN 'terminated'
       WHEN ${alias}.state = 'draft' THEN 'draft'
       WHEN ${alias}.end_date < ${today}::date THEN 'expired'
       WHEN ${alias}.start_date > ${today}::date THEN 'upcoming'
       WHEN ${alias}.end_date - ${today}::date <= ${alias}.notice_days THEN 'expiring'
       ELSE 'active' END`;
