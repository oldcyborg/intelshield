import { describe, expect, it } from 'vitest';
import { incidentActions } from './incident-rules';

const base = { status: 'new', assignee_user_id: null, severity: 'medium' } as const;
const leader = ['incident.view', 'incident.manage'];
const manager = ['incident.view', 'incident.manage', 'incident.close'];

describe('incidentActions', () => {
  it('lets a leader take a new incident and hand it out; dismissing only when the site allows them to end it', () => {
    expect(incidentActions({ ...base, can_close: false }, leader, 'me')).toEqual(['acknowledge', 'assign', 'comment']);
    expect(incidentActions({ ...base, can_close: true }, leader, 'me')).toEqual(['acknowledge', 'assign', 'reject', 'comment']);
  });
  it('lets the assignee work it without manage rights', () => {
    expect(incidentActions({ ...base, status: 'acknowledged', assignee_user_id: 'me' }, ['incident.view'], 'me')).toEqual(['start', 'resolve', 'comment']);
    expect(incidentActions({ ...base, status: 'in_progress', assignee_user_id: 'me' }, ['incident.view'], 'me')).toEqual(['resolve', 'comment']);
  });
  it('still lets a manager hand out an incident already taken, or resolved', () => {
    expect(incidentActions({ ...base, status: 'acknowledged', can_close: false }, leader, 'me')).toEqual(['start', 'resolve', 'assign', 'comment']);
    expect(incidentActions({ ...base, status: 'resolved', can_close: true }, manager, 'me')).toEqual(['assign', 'close', 'reopen', 'comment']);
  });
  it('shows close only to whoever may end it', () => {
    expect(incidentActions({ ...base, status: 'resolved', can_close: false }, leader, 'me')).toEqual(['assign', 'reopen', 'comment']);
    expect(incidentActions({ ...base, status: 'new', can_close: true }, ['incident.view', 'incident.close'], 'me')).toEqual(['reject', 'comment']);
  });
  it('leaves only comments on closed and rejected incidents, nothing for strangers', () => {
    expect(incidentActions({ ...base, status: 'closed', can_close: true }, manager, 'me')).toEqual(['comment']);
    expect(incidentActions({ ...base, status: 'rejected', can_close: true }, manager, 'me')).toEqual(['comment']);
    expect(incidentActions({ ...base, status: 'in_progress', can_close: false }, ['incident.view'], 'me')).toEqual(['comment']);
  });
});
