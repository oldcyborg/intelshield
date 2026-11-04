import { describe, expect, it } from 'vitest';
import { navFor, routeFor } from './nav';

const labels = (perms: string[], employee: boolean) => navFor(perms, employee).map((t) => t.label);

describe('navFor', () => {
  it('gives a guard their shifts and themself only', () => {
    expect(labels(['incident.report', 'patrol.perform', 'logbook.write'], true)).toEqual(['Ca trực', 'Tôi']);
  });
  it('gives a team leader the team, incidents and reviews next to their shifts', () => {
    expect(labels(['attendance.view', 'patrol.view', 'incident.view', 'incident.manage', 'violation.propose', 'handover.review'], true))
      .toEqual(['Ca trực', 'Đội', 'Sự cố', 'Duyệt', 'Tôi']);
  });
  it('opens a manager on the overview', () => {
    expect(labels(['client.view', 'attendance.view', 'incident.view', 'violation.review'], false)).toEqual(['Tổng quan', 'Đội', 'Sự cố', 'Duyệt', 'Tôi']);
  });
  it('never shows more than five tabs', () => {
    expect(navFor(['client.view', 'attendance.view', 'incident.view', 'violation.review'], true).length).toBe(5);
  });
});

describe('routeFor', () => {
  const leader = ['patrol.view', 'attendance.view', 'handover.review', 'violation.view'];
  it('opens what a notification is about, for someone who can work on it', () => {
    expect(routeFor({ incident_id: 'i1' }, [])).toBe('/su-co/i1');
    expect(routeFor({ type: 'payslip.ready', period_id: 'p1' }, [])).toBe('/phieu-luong/p1');
    expect(routeFor({ round_id: 'r1', type: 'patrol.missed' }, leader)).toBe('/doi/vong/r1');
    expect(routeFor({ handover_id: 'h1', type: 'handover.problem' }, leader)).toBe('/duyet');
    expect(routeFor({ type: 'violation.absent', assignment_id: 'a1' }, leader)).toBe('/duyet');
    expect(routeFor({ assignment_id: 'a1', type: 'attendance.late' }, leader)).toBe('/doi');
    expect(routeFor({}, leader)).toBe('/thong-bao');
  });
  it('sends a guard to their shifts, not to screens they cannot use', () => {
    expect(routeFor({ handover_id: 'h1', type: 'handover.incoming' }, leader)).toBe('/nhan-ca/h1');
    expect(routeFor({ round_id: 'r1', type: 'patrol.reminder' }, leader)).toBe('/tuan-tra');
    expect(routeFor({ round_id: 'r1', type: 'patrol.missed' }, [])).toBe('/');
    expect(routeFor({ type: 'violation.absent' }, [])).toBe('/thong-bao');
  });
  it('opens requests: the decision for the person who asked, the review list for the one who decides', () => {
    expect(routeFor({ type: 'leave.decided', leave_request_id: 'l1' }, [])).toBe('/don');
    expect(routeFor({ type: 'leave.submitted', leave_request_id: 'l1' }, ['leave.review'])).toBe('/duyet');
    expect(routeFor({ type: 'attendance.correction.submitted', correction_id: 'c1' }, ['attendance.correct.propose'])).toBe('/duyet');
    expect(routeFor({ type: 'attendance.correction.decided', correction_id: 'c1' }, ['attendance.correct.propose'])).toBe('/don');
    expect(routeFor({ type: 'attendance.missing_out', assignment_id: 'a1' }, leader)).toBe('/');
  });
});
