const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Today's date in Vietnam as YYYY-MM-DD, whatever the server clock's zone is. */
export function todayLocal(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Calendar arithmetic on a YYYY-MM-DD string, free of time-zone drift. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
