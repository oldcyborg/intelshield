import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { stamp, time } from '../lib/format';
import { CORRECTION_REASON, CORRECTION_STATUS, dateVi, LEAVE_STATUS, LEAVE_TYPE, OPEN_CORRECTION } from '../lib/requests';

export interface Balance {
  year: number;
  allowance: number | null;
  used: number;
  remaining: number | null;
}

interface Leave {
  id: string;
  type: string;
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  status: string;
  created_at: string;
  decided_by_name: string | null;
  decision_note: string | null;
  shifts: { id: string; site_name: string; planned_start: string; status: string; substitute: string | null }[];
}

interface Correction {
  id: string;
  site_name: string;
  planned_start: string;
  planned_end: string;
  check_in_at: string | null;
  check_out_at: string | null;
  reason_code: string;
  status: string;
  proposed_note: string | null;
  review_note: string | null;
  created_at: string;
}

/** A guard's own leave requests and attendance corrections, and what is left of annual leave. */
export function MyRequests() {
  const [leave, setLeave] = useState<Leave[] | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, c, b] = await Promise.all([
        api.request<Leave[]>('/me/leave-requests'),
        api.request<Correction[]>('/me/attendance-corrections'),
        api.request<Balance>('/me/leave-balance'),
      ]);
      setLeave(l);
      setCorrections(c);
      setBalance(b);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được đơn');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function withdraw(path: string) {
    if (!window.confirm('Rút đơn này?')) return;
    try {
      await api.request(path, { json: {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }

  return (
    <Screen title="Đơn của tôi" back>
      <ErrorText error={error} />
      <Link to="/don/nghi" className="block"><Button>📝 Xin nghỉ</Button></Link>
      {balance?.allowance ? (
        <Card>
          <div className="text-base">Phép năm {balance.year}: <b>còn {balance.remaining}</b> / {balance.allowance} ngày</div>
          <div className="text-sm text-slate-500">Đã nghỉ phép năm {balance.used} ngày</div>
        </Card>
      ) : null}

      <h2 className="pt-2 text-sm font-semibold uppercase text-slate-500">Đơn nghỉ</h2>
      {leave?.map((r) => (
        <Card key={r.id}>
          <div className="flex items-center justify-between">
            <b className="text-lg">{LEAVE_TYPE[r.type]} · {r.from_date === r.to_date ? dateVi(r.from_date) : `${dateVi(r.from_date)}–${dateVi(r.to_date)}`}</b>
            <Badge tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].label}</Badge>
          </div>
          <div className="text-sm text-slate-500">{r.days} ngày · gửi {stamp(r.created_at)}</div>
          {r.reason && <div className="text-base">{r.reason}</div>}
          {r.decision_note && <div className="text-sm text-slate-600">{r.decided_by_name}: {r.decision_note}</div>}
          {r.status === 'approved' && r.shifts.map((s) => (
            <div key={s.id} className="text-sm text-slate-600">Ca {dateVi(s.planned_start.slice(0, 10))} {time(s.planned_start)} · {s.site_name}: đã huỷ{s.substitute ? `, ${s.substitute} trực thay` : ''}</div>
          ))}
          {r.status === 'pending' && <button className="mt-2 text-sm underline" onClick={() => void withdraw(`/leave-requests/${r.id}/cancel`)}>Rút đơn</button>}
        </Card>
      ))}
      {leave && !leave.length && <p className="py-2 text-center text-slate-400">Chưa có đơn nghỉ</p>}

      <h2 className="pt-2 text-sm font-semibold uppercase text-slate-500">Bổ sung chấm công</h2>
      <p className="text-sm text-slate-500">Gửi từ thẻ ca ở tab Ca trực, trong 48 giờ sau khi hết ca.</p>
      {corrections.map((c) => (
        <Card key={c.id}>
          <div className="flex items-center justify-between">
            <b className="text-lg">Ca {dateVi(c.planned_start.slice(0, 10))} {time(c.planned_start)}–{time(c.planned_end)}</b>
            <Badge tone={CORRECTION_STATUS[c.status].tone}>{CORRECTION_STATUS[c.status].label}</Badge>
          </div>
          <div className="text-sm text-slate-500">{c.site_name} · {CORRECTION_REASON[c.reason_code]}</div>
          <div className="text-base">{c.check_in_at && `Vào ${time(c.check_in_at)}`}{c.check_in_at && c.check_out_at && ' · '}{c.check_out_at && `Ra ${time(c.check_out_at)}`}</div>
          {(c.review_note || c.proposed_note) && <div className="text-sm text-slate-600">{c.review_note ?? c.proposed_note}</div>}
          {OPEN_CORRECTION.includes(c.status) && <button className="mt-2 text-sm underline" onClick={() => void withdraw(`/attendance-corrections/${c.id}/cancel`)}>Rút đơn</button>}
        </Card>
      ))}
    </Screen>
  );
}
