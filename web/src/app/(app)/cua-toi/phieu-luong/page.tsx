'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, MinePage } from '@/components/mine';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { date, money, monthLabel } from '@/lib/format';

interface Slip {
  period_id: string;
  month: string;
  status: 'locked' | 'paid';
  paid_on: string | null;
  net: number;
}

/** Each month the accountant has locked. */
export default function MyPayslipsPage() {
  const [rows, setRows] = useState<Slip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Slip[]>('/me/payslips').then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <MinePage>
      <ErrorText error={error} />
      <Card title="Phiếu lương">
        <ul className="divide-y divide-slate-100 text-sm">
          {rows?.map((r) => (
            <li key={r.period_id}>
              <Link href={`/cua-toi/phieu-luong/${r.period_id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                <span>
                  <b>{monthLabel(r.month)}</b>
                  <span className="ml-2 text-slate-500">{r.status === 'paid' ? `đã trả ${date(r.paid_on)}` : 'đã chốt — chờ trả'}</span>
                </span>
                <span className="shrink-0 font-semibold text-teal-700">{money(r.net)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {rows && !rows.length && <Empty>Chưa có phiếu lương nào. Phiếu lương hiện sau khi kế toán chốt bảng lương tháng.</Empty>}
      </Card>
    </MinePage>
  );
}
