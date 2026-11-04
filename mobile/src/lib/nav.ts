export interface Tab {
  to: string;
  label: string;
  icon: string;
}

/** Tabs from permissions, in the order people reach for them. The backend still decides every action. */
export function navFor(permissions: string[], hasEmployee: boolean): Tab[] {
  const has = (p: string) => permissions.includes(p);
  const tabs: Tab[] = [];
  const overview = has('client.view') || has('violation.review');
  if (overview) tabs.push({ to: '/tong-quan', label: 'Tổng quan', icon: '📊' });
  if (hasEmployee) tabs.push({ to: '/', label: 'Ca trực', icon: '🕘' });
  if (has('attendance.view') || has('patrol.view')) tabs.push({ to: '/doi', label: 'Đội', icon: '👥' });
  if (has('incident.view')) tabs.push({ to: '/su-co', label: 'Sự cố', icon: '🚨' });
  if (has('violation.propose') || has('violation.review') || has('handover.review') || has('leave.review') || has('attendance.correct.propose')) {
    tabs.push({ to: '/duyet', label: 'Duyệt', icon: '✅' });
  }
  tabs.push({ to: '/toi', label: 'Tôi', icon: '👤' });
  // Five fit on a small phone: a guard-manager keeps "Ca trực" and reaches the overview from "Tôi".
  if (tabs.length > 5 && overview && hasEmployee) tabs.splice(0, 1);
  return tabs.slice(0, 5);
}

/**
 * The screen a notification is about — one this person can use. Guards are reminded about their own work,
 * so their taps open the shifts tab; leaders open the round, the review list or the team.
 */
export function routeFor(data: Record<string, string | undefined>, permissions: string[]): string {
  const has = (p: string) => permissions.includes(p);
  if (data.incident_id) return `/su-co/${data.incident_id}`;
  if (data.type === 'payslip.ready' && data.period_id) return `/phieu-luong/${data.period_id}`;
  if (data.type === 'handover.incoming' && data.handover_id) return `/nhan-ca/${data.handover_id}`;
  if (data.type === 'patrol.reminder') return '/tuan-tra';
  if (data.type === 'handover.incoming') return '/';
  if (data.type === 'leave.decided' || data.type === 'attendance.correction.decided') return '/don';
  if (data.type === 'leave.submitted') return has('leave.review') ? '/duyet' : '/thong-bao';
  if (data.type?.startsWith('attendance.correction.')) return has('attendance.correct.propose') ? '/duyet' : '/don';
  if (data.type === 'attendance.missing_out') return '/';
  if (data.round_id) return has('patrol.view') ? `/doi/vong/${data.round_id}` : '/';
  if (data.handover_id) return has('handover.review') ? '/duyet' : '/';
  if (data.type?.startsWith('violation.')) return has('violation.view') ? '/duyet' : '/thong-bao';
  if (data.assignment_id) return has('attendance.view') ? '/doi' : '/';
  return '/thong-bao';
}
