'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FinanceSettings } from '@/components/finance-settings';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, monthLabel, PAYROLL_STATUS } from '@/lib/format';
import { PayrollPeriod, PayrollPeriodRow } from '@/lib/types';

/** Last month as YYYY-MM: the usual one to pay. */
function lastMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollListPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<PayrollPeriodRow[] | null>(null);
  const [month, setMonth] = useState(lastMonth());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRows(await api<PayrollPeriodRow[]>('/payroll')), []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api<PayrollPeriod>('/payroll', { method: 'POST', json: { month } });
      router.push(`/bang-luong/${p.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Bảng lương</h1>
      <p className="text-sm text-slate-500">
        Lương tính từ chấm công thực tế (kể cả giờ đã điều chỉnh qua đơn), vi phạm đã được quản lý xác nhận và hồ sơ lương của từng người.
        Bảng nháp chỉnh được; chốt xong bảo vệ xem phiếu lương trên ứng dụng.
      </p>
      <ErrorText error={error} />

      {can('payroll.manage') && (
        <Card title="Lập bảng lương">
          <form onSubmit={create} className="flex items-end gap-3">
            <Field label="Tháng"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required className="w-48" /></Field>
            <Button type="submit" disabled={busy}>{busy ? 'Đang tính…' : 'Lập và tính lương'}</Button>
          </form>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Kỳ lương</th><th>Trạng thái</th><th className="text-right">Số người</th><th className="text-right">Tổng thực lĩnh</th><th>Chốt / trả</th></tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-2"><Link href={`/bang-luong/${r.id}`} className="font-medium text-teal-700 hover:underline">{monthLabel(r.month)}</Link></td>
                <td><span className={`rounded px-1.5 py-0.5 text-xs ${PAYROLL_STATUS[r.status].tone}`}>{PAYROLL_STATUS[r.status].label}</span></td>
                <td className="text-right">{r.people}</td>
                <td className="text-right font-medium">{money(r.total_net ?? 0)}</td>
                <td className="text-slate-500">{r.paid_on ? `Trả ${r.paid_on.split('-').reverse().join('/')} · ${r.paid_by_name ?? ''}` : r.locked_by_name ? `Chốt bởi ${r.locked_by_name}` : '—'}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có bảng lương nào</td></tr>}
          </tbody>
        </table></div>
      </Card>

      <FinanceSettings part="payroll" />
    </div>
  );
}
