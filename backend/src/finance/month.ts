/** First and last day of a YYYY-MM month. */
export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  return [`${month}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
}

/** Days from one YYYY-MM-DD to another, both counted. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
