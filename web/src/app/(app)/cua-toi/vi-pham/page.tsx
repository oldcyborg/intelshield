'use client';

import { useEffect, useState } from 'react';
import { Empty, MinePage, StatusBadge } from '@/components/mine';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { stamp, VIOLATION_STATUS, VIOLATION_TYPE, violationText } from '@/lib/format';
import { ViolationRow } from '@/lib/types';

/** The last 90 days, as the server keeps them for the person concerned. */
export default function MyViolationsPage() {
  const [rows, setRows] = useState<ViolationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ViolationRow[]>('/me/violations').then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <MinePage>
      <ErrorText error={error} />
      <Card title="Vi phạm 90 ngày qua">
        <ul className="divide-y divide-slate-100 text-sm">
          {rows?.map((v) => (
            <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span>
                <b>{VIOLATION_TYPE[v.type]}</b> · {violationText(v)}
                <div className="text-slate-500">
                  {stamp(v.occurred_at)} · {v.site_name}
                </div>
                {(v.review_note || v.proposed_note) && <div className="text-slate-600">{v.review_note ?? v.proposed_note}</div>}
              </span>
              <StatusBadge s={VIOLATION_STATUS[v.status]} />
            </li>
          ))}
        </ul>
        {rows && !rows.length && <Empty>Không có vi phạm nào trong 90 ngày qua.</Empty>}
      </Card>
    </MinePage>
  );
}
