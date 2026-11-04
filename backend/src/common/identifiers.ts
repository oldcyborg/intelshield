/** Vietnamese local format: 0 followed by 9–10 digits. */
export const PHONE_PATTERN = /^0\d{9,10}$/;

/**
 * Guards type their number however their phone shows it. Store and compare one
 * form only, or "+84 912…" and "0912…" become two different accounts.
 */
export function normalizePhone(raw: string): string {
  let phone = raw.replace(/[\s.\-()]/g, '');
  if (phone.startsWith('+84')) phone = '0' + phone.slice(3);
  else if (phone.startsWith('84') && phone.length === 11) phone = '0' + phone.slice(2);
  return phone;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseIdentifier(raw: string): { phone: string } | { email: string } {
  const value = raw.trim();
  return value.includes('@') ? { email: normalizeEmail(value) } : { phone: normalizePhone(value) };
}
