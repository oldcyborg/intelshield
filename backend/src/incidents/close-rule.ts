import { Settings } from '../settings/settings';
import { SEVERITY_ORDER, Severity } from './categories';

const CLOSE_LEVEL: Record<string, number> = { none: 0, low: 1, medium: 2 };

/**
 * Ending an incident (closing it, or dismissing it as a false alarm): anyone with incident.close; a leader with
 * incident.manage up to the level the site allows (spec §7.0 incident_close_by_leader_up_to).
 */
export function mayEnd(held: Set<string>, severity: Severity, s: Settings): boolean {
  if (held.has('incident.close')) return true;
  return held.has('incident.manage') && SEVERITY_ORDER[severity] <= CLOSE_LEVEL[s.incident_close_by_leader_up_to];
}
