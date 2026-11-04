import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SitePicker } from '../components/SitePicker';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { localDate, stamp } from '../lib/format';
import { SCAN_FLAG, VIOLATION_STATUS, VIOLATION_TYPE } from '../lib/labels';
import { CORRECTION_REASON, CORRECTION_STATUS, dateVi, LEAVE_TYPE } from '../lib/requests';
import { time } from '../lib/format';

interface Violation {
  id: string;
  type: string;
  status: string;
  occurred_at: string;
  minutes: number | null;
  detail: { missing?: { code: string }[]; flags?: string[]; round_id?: string; converted_from?: string };
  ref_type: string;
  ref_id: string;
  site_name: string;
  employee_id: string;
  employee_name: string;
  proposed_note: string | null;
  proposed_by_name: string | null;
  /** False: someone else's team — seen, not decided here. */
  can_judge?: boolean;
}

interface Handover {
  id: string;
  from_employee_id: string;
  to_employee_id: string | null;
  from_name: string;
  to_name: string | null;
  status: string;
  submitted_at: string;
  items: { label: string; status: string; note?: string }[];
  notes: string | null;
  receiver_note: string | null;
  reviewed_at: string | null;
}

interface Leave {
  id: string;
  employee_id: string;
  employee_name: string;
  type: string;
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  urgent: boolean;
  created_by_name: string;
  shifts: { id: string; site_name: string; planned_start: string; planned_end: string; checked_in: boolean }[];
  balance: { allowance: number | null; remaining: number | null } | null;
}

interface Correction {
  id: string;
  employee_id: string;
  employee_name: string;
  site_name: string;
  planned_start: string;
  planned_end: string;
  check_in_at: string | null;
  check_out_at: string | null;
  reason_code: string;
  reason: string | null;
  status: string;
  proposed_by_name: string | null;
  proposed_note: string | null;
  current: { check_in_at: string | null; check_out_at: string | null } | null;
  evidence: { scans: number; first_scan_at: string | null; last_scan_at: string | null; logbook: number; handovers: { role: string; at: string | null }[] };
  can_judge?: boolean;
}

function what(v: Violation): string {
  if (v.type === 'late_check_in' || v.type === 'early_check_out') return `${v.minutes ?? '?'} phút${v.detail.converted_from ? ' (lúc đầu ghi vắng)' : ''}`;
  if (v.type === 'missed_checkpoint') return `thiếu ${(v.detail.missing ?? []).map((m) => m.code).join(', ')}`;
  if (v.type === 'suspicious_scan') return (v.detail.flags ?? []).map((f) => SCAN_FLAG[f] ?? f).join(', ');
  return '';
}

export function Reviews() {
  const { me, can } = useAuth();
  const [violations, setViolations] = useState<Violation[] | null>(null);
  const [siteId, setSiteId] = useState('');
  const [handovers, setHandovers] = useState<Handover[] | null>(null);
  const [leave, setLeave] = useState<Leave[] | null>(null);
  const [corrections, setCorrections] = useState<Correction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const reviewer = can('violation.review');
  const proposer = can('violation.propose');

  const load = useCallback(async () => {
    // Two independent lists: one failing must not hide the other.
    const problems: string[] = [];
    if (can('violation.view')) {
      try {
        setViolations(await api.request<Violation[]>('/violations?status=open'));
      } catch (e) {
        problems.push(e instanceof Error ? e.message : 'Không tải được vi phạm');
      }
    }
    if (can('leave.review')) {
      try {
        setLeave(await api.request<Leave[]>('/leave-requests?status=pending'));
      } catch (e) {
        problems.push(e instanceof Error ? e.message : 'Không tải được đơn nghỉ');
      }
    }
    if (can('attendance.correct.propose')) {
      try {
        setCorrections(await api.request<Correction[]>('/attendance-corrections?status=open'));
      } catch (e) {
        problems.push(e instanceof Error ? e.message : 'Không tải được đơn chấm công');
      }
    }
    if (can('handover.review') && siteId) {
      try {
        const [today, yesterday] = await Promise.all([
          api.request<Handover[]>(`/sites/${siteId}/handovers?date=${localDate(0)}`),
          api.request<Handover[]>(`/sites/${siteId}/handovers?date=${localDate(-1)}`),
        ]);
        setHandovers([...today, ...yesterday].filter((h) => !h.reviewed_at));
      } catch (e) {
        problems.push(e instanceof Error ? e.message : 'Không tải được biên bản');
      }
    }
    setError(problems.length ? problems.join(' · ') : null);
  }, [can, siteId]);
  useEffect(() => { void load(); }, [load]);

  async function decide(v: Violation, step: 'propose' | 'review', decision: 'confirm' | 'waive') {
    const note = window.prompt(decision === 'waive' ? 'Lý do miễn (bắt buộc):' : 'Ghi chú (không bắt buộc):');
    if (note === null) return;
    if (decision === 'waive' && !note.trim()) return setError('Miễn vi phạm cần ghi lý do');
    try {
      await api.request(`/violations/${v.id}/${step}`, { json: { decision, ...(note.trim() ? { note: note.trim() } : {}) } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }

  async function decideLeave(r: Leave, way: 'approve' | 'reject') {
    const note = window.prompt(way === 'reject' ? 'Lý do không duyệt (bắt buộc):' : 'Ghi chú (không bắt buộc):');
    if (note === null) return;
    if (way === 'reject' && !note.trim()) return setError('Không duyệt cần ghi lý do');
    try {
      await api.request(`/leave-requests/${r.id}/${way}`, { json: note.trim() ? { note: note.trim() } : {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }

  async function decideCorrection(c: Correction, decision: 'approve' | 'reject') {
    const final = can('attendance.correct.review');
    const against = (c.status === 'proposed_approve' && decision === 'reject') || (c.status === 'proposed_reject' && decision === 'approve');
    const needs = decision === 'reject' || (final && against);
    const note = window.prompt(needs ? 'Lý do (bắt buộc):' : 'Ghi chú (không bắt buộc):');
    if (note === null) return;
    if (needs && !note.trim()) return setError('Cần ghi lý do');
    try {
      await api.request(`/attendance-corrections/${c.id}/${final ? 'review' : 'propose'}`, { json: { decision, ...(note.trim() ? { note: note.trim() } : {}) } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }

  async function review(h: Handover) {
    const note = window.prompt('Nhận xét khi duyệt (không bắt buộc):');
    if (note === null) return;
    try {
      await api.request(`/handovers/${h.id}/review`, { json: note.trim() ? { note: note.trim() } : {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }

  return (
    <Screen title="Duyệt" action={<button className="text-sm underline" onClick={() => { setReload((n) => n + 1); void load(); }}>Tải lại</button>}>
      <ErrorText error={error} />
      {leave && (
        <>
          <h2 className="text-sm font-semibold uppercase text-slate-500">Đơn nghỉ chờ duyệt ({leave.length})</h2>
          {leave.map((r) => {
            const own = Boolean(me?.user.employee_id) && r.employee_id === me?.user.employee_id;
            return (
              <Card key={r.id} className={r.urgent ? 'border-red-300' : ''}>
                <div className="flex items-center justify-between">
                  <b className="text-lg">{r.employee_name}</b>
                  {r.urgent && <span className="rounded-md bg-red-100 px-2 text-sm font-semibold text-red-700">GẤP</span>}
                </div>
                <div className="text-base">{LEAVE_TYPE[r.type]} · {r.from_date === r.to_date ? dateVi(r.from_date) : `${dateVi(r.from_date)}–${dateVi(r.to_date)}`} ({r.days} ngày)</div>
                {r.reason && <div className="text-slate-600">{r.reason}</div>}
                {r.created_by_name !== r.employee_name && <div className="text-sm text-slate-500">{r.created_by_name} ghi thay</div>}
                {r.balance && r.balance.remaining !== null && <div className={`text-sm ${r.days > r.balance.remaining ? 'text-red-700' : 'text-slate-500'}`}>Phép năm còn {r.balance.remaining}/{r.balance.allowance} ngày</div>}
                {r.shifts.map((s) => <div key={s.id} className="text-sm text-slate-600">Ca {dateVi(s.planned_start.slice(0, 10))} {time(s.planned_start)}–{time(s.planned_end)} · {s.site_name}{s.checked_in ? ' (đã vào ca)' : ''}</div>)}
                {!r.shifts.length && <div className="text-sm text-slate-400">Không có ca trong những ngày này</div>}
                {!own && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button tone="secondary" onClick={() => void decideLeave(r, 'approve')}>Duyệt</Button>
                    <Button tone="secondary" onClick={() => void decideLeave(r, 'reject')}>Không duyệt</Button>
                  </div>
                )}
                {!own && r.shifts.length > 0 && <div className="mt-1 text-xs text-slate-500">Duyệt sẽ huỷ các ca chưa vào — nhớ gọi người trực thay.</div>}
              </Card>
            );
          })}
          {!leave.length && <p className="py-2 text-center text-slate-400">Không có đơn nghỉ chờ duyệt</p>}
        </>
      )}
      {corrections && (
        <>
          <h2 className="pt-2 text-sm font-semibold uppercase text-slate-500">Bổ sung chấm công ({corrections.length})</h2>
          {corrections.map((c) => {
            const own = Boolean(me?.user.employee_id) && c.employee_id === me?.user.employee_id;
            const final = can('attendance.correct.review');
            const ev = c.evidence;
            return (
              <Card key={c.id}>
                <b className="text-lg">{c.employee_name}</b>
                <div className="text-sm text-slate-500">Ca {dateVi(c.planned_start.slice(0, 10))} {time(c.planned_start)}–{time(c.planned_end)} · {c.site_name}</div>
                <div className="text-base">Xin: {c.check_in_at ? `vào ${time(c.check_in_at)}` : ''}{c.check_in_at && c.check_out_at ? ' · ' : ''}{c.check_out_at ? `ra ${time(c.check_out_at)}` : ''}</div>
                <div className="text-sm text-slate-500">Đang có: vào {time(c.current?.check_in_at)} · ra {time(c.current?.check_out_at)}</div>
                <div className="text-slate-600">{CORRECTION_REASON[c.reason_code]}{c.reason ? `: ${c.reason}` : ''}</div>
                <div className="mt-1 rounded-lg bg-slate-50 p-2 text-sm">
                  Trong ca: {ev.scans ? `${ev.scans} lần quét tuần tra (${time(ev.first_scan_at)}–${time(ev.last_scan_at)})` : 'không có lần quét nào'} · {ev.logbook} dòng sổ trực
                  {ev.handovers.map((h, i) => <span key={i}> · {h.role === 'gave' ? 'giao ca' : 'nhận ca'} {time(h.at)}</span>)}
                </div>
                <div className="text-sm text-slate-500">{CORRECTION_STATUS[c.status].label}{c.proposed_by_name ? ` · ${c.proposed_by_name}${c.proposed_note ? `: ${c.proposed_note}` : ''}` : ''}</div>
                {!own && c.can_judge !== false && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button tone="secondary" onClick={() => void decideCorrection(c, 'approve')}>{final ? 'Duyệt' : 'Đề xuất duyệt'}</Button>
                    <Button tone="secondary" onClick={() => void decideCorrection(c, 'reject')}>{final ? 'Từ chối' : 'Đề xuất từ chối'}</Button>
                  </div>
                )}
              </Card>
            );
          })}
          {!corrections.length && <p className="py-2 text-center text-slate-400">Không có đơn chấm công chờ</p>}
        </>
      )}
      {violations && (
        <>
          <h2 className="text-sm font-semibold uppercase text-slate-500">Vi phạm chờ xử lý ({violations.length})</h2>
          {violations.map((v) => {
            const own = Boolean(me?.user.employee_id) && v.employee_id === me?.user.employee_id;
            const roundId = v.ref_type === 'round' ? v.ref_id : v.detail.round_id;
            return (
              <Card key={v.id}>
                <div className="flex items-center justify-between">
                  <b className="text-lg">{v.employee_name}</b>
                  <span className="text-sm text-slate-400">{stamp(v.occurred_at)}</span>
                </div>
                <div className="text-base">{VIOLATION_TYPE[v.type]}{what(v) ? ` — ${what(v)}` : ''} · {v.site_name}</div>
                {roundId && <Link to={`/doi/vong/${roundId}`} className="text-sm text-teal-700 underline">Xem vòng</Link>}
                <div className="text-sm text-slate-500">{VIOLATION_STATUS[v.status]}{v.proposed_by_name ? ` · ${v.proposed_by_name}${v.proposed_note ? `: ${v.proposed_note}` : ''}` : ''}</div>
                {!own && v.can_judge !== false && (reviewer || proposer) && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button tone="secondary" onClick={() => void decide(v, reviewer ? 'review' : 'propose', 'confirm')}>{reviewer ? 'Xác nhận' : 'Đề xuất xác nhận'}</Button>
                    <Button tone="secondary" onClick={() => void decide(v, reviewer ? 'review' : 'propose', 'waive')}>{reviewer ? 'Miễn' : 'Đề xuất miễn'}</Button>
                  </div>
                )}
              </Card>
            );
          })}
          {!violations.length && <p className="py-4 text-center text-slate-400">Không có vi phạm chờ xử lý</p>}
        </>
      )}
      {can('handover.review') && (
        <>
          <h2 className="pt-2 text-sm font-semibold uppercase text-slate-500">Biên bản giao ca chờ duyệt</h2>
          <SitePicker value={siteId} onChange={setSiteId} reload={reload} />
          {handovers?.map((h) => {
            const answered = h.status !== 'submitted' || !h.to_name;
            const own = Boolean(me?.user.employee_id) && (h.from_employee_id === me?.user.employee_id || h.to_employee_id === me?.user.employee_id);
            return (
              <Card key={h.id} className={h.status === 'disputed' || h.items.some((i) => i.status !== 'ok') ? 'border-red-300' : ''}>
                <div className="text-lg"><b>{h.from_name}</b> → <b>{h.to_name ?? 'chưa rõ người nhận'}</b></div>
                <div className="text-sm text-slate-400">{stamp(h.submitted_at)} · {h.status === 'accepted' ? 'người nhận đồng ý' : h.status === 'disputed' ? 'người nhận KHÔNG đồng ý' : 'chờ người nhận'}</div>
                {h.items.filter((i) => i.status !== 'ok').map((i) => <div key={i.label} className="text-red-700">✗ {i.label}{i.note ? `: ${i.note}` : ''}</div>)}
                {h.notes && <div className="text-slate-600">Ghi chú: {h.notes}</div>}
                {h.receiver_note && <div className="text-red-700">Người nhận: {h.receiver_note}</div>}
                {answered && !own && <Button tone="secondary" className="mt-2" onClick={() => void review(h)}>Duyệt biên bản</Button>}
                {own && <div className="mt-1 text-sm text-slate-500">Biên bản có bạn tham gia — đội trưởng khác hoặc quản lý duyệt</div>}
              </Card>
            );
          })}
          {handovers && !handovers.length && <p className="py-4 text-center text-slate-400">Không có biên bản chờ duyệt</p>}
        </>
      )}
    </Screen>
  );
}
