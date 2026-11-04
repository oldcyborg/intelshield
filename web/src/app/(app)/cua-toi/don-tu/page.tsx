'use client';

import { useEffect, useState } from 'react';
import { Empty, MinePage, StatusBadge } from '@/components/mine';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { CORRECTION_REASON, CORRECTION_STATUS, date, LEAVE_STATUS, LEAVE_TYPE, stamp, time } from '@/lib/format';

interface Balance {
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

/** Read only: asking for leave or a correction hangs off a shift and a photo, so it is done in the app. */
export default function MyRequestsPage() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [leave, setLeave] = useState<Leave[] | null>(null);
  const [corrections, setCorrections] = useState<Correction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api<Balance>('/me/leave-balance'), api<Leave[]>('/me/leave-requests'), api<Correction[]>('/me/attendance-corrections')])
      .then(([b, l, c]) => {
        setBalance(b);
        setLeave(l);
        setCorrections(c);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <MinePage>
      <ErrorText error={error} />
      {balance && (
        <Card title={`Phép năm ${balance.year}`}>
          {balance.allowance ? (
            <p className="text-sm">
              Còn <b className="text-lg text-teal-700">{balance.remaining}</b> / {balance.allowance} ngày · đã nghỉ {balance.used} ngày
            </p>
          ) : (
            <p className="text-sm text-slate-500">Công ty chưa đặt số ngày phép năm. Đã nghỉ phép năm {balance.used} ngày.</p>
          )}
        </Card>
      )}
      <Card title="Đơn nghỉ">
        <ul className="divide-y divide-slate-100 text-sm">
          {leave?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span>
                <b>{LEAVE_TYPE[r.type] ?? r.type}</b> · {r.from_date === r.to_date ? date(r.from_date) : `${date(r.from_date)} – ${date(r.to_date)}`} · {r.days} ngày
                <div className="text-slate-500">
                  gửi {stamp(r.created_at)}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
                {r.decision_note && (
                  <div className="text-slate-600">
                    {r.decided_by_name}: {r.decision_note}
                  </div>
                )}
              </span>
              <StatusBadge s={LEAVE_STATUS[r.status]} />
            </li>
          ))}
        </ul>
        {leave && !leave.length && <Empty>Chưa có đơn nghỉ nào.</Empty>}
      </Card>
      <Card title="Bổ sung chấm công">
        <ul className="divide-y divide-slate-100 text-sm">
          {corrections?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span>
                <b>
                  Ca {date(c.planned_start.slice(0, 10))} {time(c.planned_start)}–{time(c.planned_end)}
                </b>{' '}
                · {c.site_name}
                <div className="text-slate-500">
                  {CORRECTION_REASON[c.reason_code] ?? c.reason_code}
                  {c.check_in_at && ` · vào ${time(c.check_in_at)}`}
                  {c.check_out_at && ` · ra ${time(c.check_out_at)}`}
                </div>
                {(c.review_note || c.proposed_note) && <div className="text-slate-600">{c.review_note ?? c.proposed_note}</div>}
              </span>
              <StatusBadge s={CORRECTION_STATUS[c.status]} />
            </li>
          ))}
        </ul>
        {corrections && !corrections.length && <Empty>Chưa có đơn bổ sung chấm công nào.</Empty>}
      </Card>
      <p className="text-sm text-slate-500">Xin nghỉ, bổ sung chấm công và rút đơn làm trên ứng dụng IntelShield.</p>
    </MinePage>
  );
}
