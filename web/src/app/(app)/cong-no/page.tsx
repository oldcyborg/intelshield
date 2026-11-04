'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FinanceSettings } from '@/components/finance-settings';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, money, monthLabel, statementState } from '@/lib/format';
import { BillingStatementRow, ClientDebt } from '@/lib/types';

function lastMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function BillingPage() {
  const { can } = useAuth();
  const [month, setMonth] = useState(lastMonth());
  const [rows, setRows] = useState<BillingStatementRow[] | null>(null);
  const [debts, setDebts] = useState<ClientDebt[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await api<BillingStatementRow[]>(`/billing?month=${month}`));
    setDebts(await api<ClientDebt[]>('/billing/debts'));
  }, [month]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ created: number }>('/billing', { method: 'POST', json: { month } });
      setNote(r.created ? `Đã lập ${r.created} bảng đối soát mới.` : 'Các hợp đồng của tháng này đều đã có bảng đối soát.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const sum = (k: 'total' | 'paid' | 'balance') => (rows ?? []).filter((r) => r.status === 'issued').reduce((s, r) => s + r[k], 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Đối soát & công nợ</h1>
      <p className="text-sm text-slate-500">
        Mỗi hợp đồng một bảng đối soát mỗi tháng: tính theo đơn giá hợp đồng; ca không có người trực được gợi ý giảm trừ để bạn quyết định.
        Chốt bảng thành đề nghị thanh toán gửi khách, rồi ghi nhận tiền thu.
      </p>
      <ErrorText error={error} />

      {debts.length > 0 && (
        <Card title="Công nợ theo khách hàng">
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Khách hàng</th><th className="text-right">Đã đề nghị</th><th className="text-right">Đã thu</th><th className="text-right">Còn phải thu</th><th className="text-right">Quá hạn</th></tr>
            </thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.client_id} className="border-t border-slate-100">
                  <td className="py-2"><Link href={`/khach-hang/${d.client_id}`} className="text-teal-700 hover:underline">{d.client_name}</Link></td>
                  <td className="text-right">{money(d.billed)}</td>
                  <td className="text-right">{money(d.paid)}</td>
                  <td className="text-right font-semibold">{money(d.balance)}</td>
                  <td className={`text-right ${d.overdue ? 'font-semibold text-red-700' : 'text-slate-400'}`}>{d.overdue ? `${money(d.overdue)} · ${d.max_overdue_days} ngày` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}

      <Card
        title={`Bảng đối soát ${monthLabel(month).toLowerCase()}`}
        actions={<div className="w-44"><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>}
      >
        {can('billing.manage') && (
          <form onSubmit={generate} className="mb-3 flex items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? 'Đang lập…' : 'Lập đối soát cho các hợp đồng của tháng'}</Button>
            {note && <span className="text-sm text-teal-700">{note}</span>}
          </form>
        )}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Khách hàng · hợp đồng</th><th>Số đề nghị</th><th className="text-right">Tổng tiền</th><th className="text-right">Đã thu</th><th className="text-right">Còn lại</th><th className="pl-4">Hạn</th><th>Trạng thái</th></tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const st = statementState(r);
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <Link href={`/cong-no/${r.id}`} className="font-medium text-teal-700 hover:underline">{r.client_name}</Link>
                    <div className="text-xs text-slate-400">HĐ {r.contract_no}</div>
                  </td>
                  <td className="font-mono text-xs">{r.code ?? '—'}</td>
                  <td className="text-right">{money(r.total)}</td>
                  <td className="text-right">{r.status === 'issued' ? money(r.paid) : '—'}</td>
                  <td className="text-right font-medium">{r.status === 'issued' ? money(r.balance) : '—'}</td>
                  <td className="pl-4">{r.due_date ? date(r.due_date) : '—'}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${st.tone}`}>{st.label}</span></td>
                </tr>
              );
            })}
            {rows && !rows.length && <tr><td colSpan={7} className="py-6 text-center text-slate-400">Chưa có bảng đối soát nào cho tháng này</td></tr>}
          </tbody>
          {rows && rows.some((r) => r.status === 'issued') && (
            <tfoot className="border-t border-slate-200 font-semibold">
              <tr><td className="py-2" colSpan={2}>Tổng đã chốt</td><td className="text-right">{money(sum('total'))}</td><td className="text-right">{money(sum('paid'))}</td><td className="text-right">{money(sum('balance'))}</td><td colSpan={2} /></tr>
            </tfoot>
          )}
        </table></div>
      </Card>

      <FinanceSettings part="billing" />
    </div>
  );
}
