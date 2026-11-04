export type Severity = 'low' | 'medium' | 'high' | 'critical';
export const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
export const SEVERITY_ORDER: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** What a new company starts with; each company edits its own list afterwards. */
export const DEFAULT_INCIDENT_CATEGORIES: { name: string; default_severity: Severity }[] = [
  { name: 'Cháy nổ', default_severity: 'critical' },
  { name: 'Trộm cắp', default_severity: 'high' },
  { name: 'Xâm nhập', default_severity: 'high' },
  { name: 'Hư hỏng thiết bị', default_severity: 'medium' },
  { name: 'Vệ sinh / an toàn', default_severity: 'low' },
  { name: 'Khác', default_severity: 'medium' },
];
