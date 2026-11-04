export type IncidentStep = 'acknowledge' | 'assign' | 'start' | 'resolve' | 'close' | 'reopen' | 'reject' | 'comment';

interface Shape {
  status: string;
  assignee_user_id: string | null;
  severity: string;
  /** From the incident detail: whether this person may end it (close, or dismiss as a false alarm). */
  can_close?: boolean;
}

/** Which buttons to show, mirroring the backend's rules (Plan 05, workflow.service.ts). */
export function incidentActions(i: Shape, permissions: string[], myUserId: string): IncidentStep[] {
  const manage = permissions.includes('incident.manage');
  const mine = i.assignee_user_id === myUserId;
  const mayEnd = i.can_close ?? permissions.includes('incident.close');
  const out: IncidentStep[] = [];
  if (manage && i.status === 'new') out.push('acknowledge');
  if ((manage || mine) && i.status === 'acknowledged') out.push('start');
  if ((manage || mine) && (i.status === 'acknowledged' || i.status === 'in_progress')) out.push('resolve');
  if (manage && i.status !== 'closed' && i.status !== 'rejected') out.push('assign');
  if (mayEnd && i.status === 'resolved') out.push('close');
  if (manage && i.status === 'resolved') out.push('reopen');
  if (mayEnd && ['new', 'acknowledged', 'in_progress'].includes(i.status)) out.push('reject');
  out.push('comment');
  return ORDER.filter((s) => out.includes(s));
}

const ORDER: IncidentStep[] = ['acknowledge', 'start', 'resolve', 'assign', 'close', 'reopen', 'reject', 'comment'];
