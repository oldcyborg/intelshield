'use client';

import { useEffect, useState } from 'react';
import { Empty, localDay, MinePage, MyShift, weekday } from '@/components/mine';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { time } from '@/lib/format';

function ShiftLine({ s }: { s: MyShift }) {
  const a = s.attendance;
  const past = new Date(s.planned_end).getTime() < Date.now();
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
      <span>
        <span className="capitalize text-slate-500">{weekday(s.planned_start)}</span>{' '}
        <b>
          {time(s.planned_start)}–{time(s.planned_end)}
        </b>{' '}
        · {s.site_name}
        {s.template_name ? ` · ${s.template_name}` : ''}
      </span>
      <span className="text-slate-500">
        {a?.check_in_at ? (
          <>
            Vào {time(a.check_in_at)}
            {a.late_minutes ? <span className="text-amber-700"> (trễ {a.late_minutes} phút)</span> : null}
            {a.check_out_at ? ` · Ra ${time(a.check_out_at)}` : ' · chưa ra ca'}
            {a.corrected ? ' · đã điều chỉnh' : ''}
          </>
        ) : past ? (
          <span className="text-red-700">Không vào ca</span>
        ) : (
          'Chưa tới ca'
        )}
      </span>
    </li>
  );
}

/** A guard's shifts for a fortnight either side of today, and the sites they stand at. */
export default function MyShiftsPage() {
  const [shifts, setShifts] = useState<MyShift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<MyShift[]>(`/me/shifts?from=${localDay(-14)}&to=${localDay(14)}`).then(setShifts).catch((e) => setError(errorMessage(e)));
  }, []);

  const now = Date.now();
  const ahead = (shifts ?? []).filter((s) => new Date(s.planned_end).getTime() >= now);
  const past = (shifts ?? []).filter((s) => new Date(s.planned_end).getTime() < now).reverse();
  const sites = [...new Map((shifts ?? []).map((s) => [s.site_id, s])).values()];

  return (
    <MinePage>
      <ErrorText error={error} />
      <Card title="Mục tiêu trực">
        <ul className="divide-y divide-slate-100 text-sm">
          {sites.map((s) => (
            <li key={s.site_id} className="py-2">
              <b>{s.site_name}</b>
              {s.site_address && <div className="text-slate-500">{s.site_address}</div>}
            </li>
          ))}
        </ul>
        {shifts && !sites.length && <Empty>Hai tuần quanh hôm nay bạn không có ca ở mục tiêu nào.</Empty>}
      </Card>
      <Card title="Ca sắp tới">
        <ul className="divide-y divide-slate-100">
          {ahead.map((s) => (
            <ShiftLine key={s.id} s={s} />
          ))}
        </ul>
        {shifts && !ahead.length && <Empty>Chưa có ca nào trong 14 ngày tới.</Empty>}
      </Card>
      <Card title="Ca đã qua (14 ngày)">
        <ul className="divide-y divide-slate-100">
          {past.map((s) => (
            <ShiftLine key={s.id} s={s} />
          ))}
        </ul>
        {shifts && !past.length && <Empty>Không có ca nào trong 14 ngày qua.</Empty>}
      </Card>
    </MinePage>
  );
}
