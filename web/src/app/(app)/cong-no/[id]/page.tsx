'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, money, monthLabel, PAYMENT_METHOD, statementState } from '@/lib/format';
import { BillingStatement } from '@/lib/types';

const qty = (v: number | null) => (v === null ? '' : Number.isInteger(v) ? String(v) : v.toFixed(2));
const today = () => new Date().toISOString().slice(0, 10);

export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [s, setS] = useState<BillingStatement | null>(null);
  const [extra, setExtra] = useState({ description: '', amount: '' });
  const [vat, setVat] = useState('');
  const [pay, setPay] = useState({ paid_on: today(), amount: '', method: 'transfer', reference: '', note: '' });
  const [openShifts, setOpenShifts] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((x: BillingStatement) => { setS(x); setVat(String(x.vat_rate)); }, []);
  const load = useCallback(async () => show(await api<BillingStatement>(`/billing/${id}`)), [id, show]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function act(path: string, method: 'POST' | 'PATCH' | 'DELETE', json?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      show(await api<BillingStatement>(path, { method, json }));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <ErrorText error={error} />;
  const manage = can('billing.manage');
  const draft = s.status === 'draft';
  const state = statementState(s);
  const toNumber = (v: string) => Number(v.replace(/[.,\s]/g, ''));

  return (
    <div className="max-w-5xl space-y-4">
      <Link href="/cong-no" className="text-sm text-teal-700 hover:underline">← Đối soát & công nợ</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{s.client_name} · {monthLabel(s.month).toLowerCase()}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${state.tone}`}>{state.label}</span>
        {s.code && <span className="font-mono text-sm text-slate-500">{s.code}</span>}
        <div className="ml-auto flex gap-2">
          {s.status === 'issued' && <a href={`/de-nghi-thanh-toan/${s.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-teal-700 hover:underline">In / lưu PDF ↗</a>}
          {manage && draft && <Button variant="secondary" disabled={busy} onClick={() => act(`/billing/${id}/recompute`, 'POST')}>Tính lại</Button>}
          {manage && draft && (
            <Button disabled={busy} onClick={() => window.confirm('Chốt thành đề nghị thanh toán? Bảng sẽ được đánh số và tính hạn thanh toán; muốn sửa phải mở lại.') && act(`/billing/${id}/issue`, 'POST')}>
              Chốt đề nghị thanh toán
            </Button>
          )}
          {manage && !draft && (
            <Button variant="secondary" disabled={busy} onClick={() => { const reason = window.prompt('Lý do mở lại để sửa:'); if (reason?.trim()) void act(`/billing/${id}/reopen`, 'POST', { reason }); }}>
              Mở lại
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-500">
        Hợp đồng {s.contract_no}
        {s.issued_on && ` · chốt ngày ${date(s.issued_on)}${s.issued_by_name ? ` (${s.issued_by_name})` : ''} · hạn thanh toán ${date(s.due_date)}`}
      </p>
      <ErrorText error={error} />

      <Card title="Bảng đối soát">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Nội dung</th><th className="text-right">Số lượng</th><th className="text-right">Đơn giá</th><th className="text-right">Thành tiền</th><th /></tr>
          </thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.id} className={`border-t border-slate-100 align-top ${l.applied ? '' : 'text-slate-400'}`}>
                <td className="py-2">
                  {l.kind === 'shortfall' && (
                    <label className="mr-2 inline-flex items-center gap-1">
                      <input type="checkbox" checked={l.applied} disabled={!manage || !draft || busy}
                        onChange={() => act(`/billing-lines/${l.id}/shortfall`, 'PATCH', { applied: !l.applied, note: l.note })} />
                    </label>
                  )}
                  {l.description}
                  {l.kind === 'shortfall' && (
                    <>
                      <button className="ml-2 text-xs text-teal-700 underline" onClick={() => setOpenShifts(openShifts === l.id ? null : l.id)}>xem ca</button>
                      {!l.applied && <span className="ml-2 text-xs">(gợi ý — chưa trừ)</span>}
                      {openShifts === l.id && (
                        <ul className="mt-1 text-xs text-slate-600">
                          {l.detail.shifts?.map((x, i) => <li key={i}>{date(x.date)} · {x.site} · {x.employee} · {x.reason === 'leave' ? 'nghỉ có đơn, không ai trực thay' : 'không vào ca'}</li>)}
                        </ul>
                      )}
                    </>
                  )}
                  {l.note && <div className="text-xs text-slate-500">{l.note}</div>}
                </td>
                <td className="text-right">{qty(l.quantity)} {l.unit ?? ''}</td>
                <td className="text-right">{l.unit_price === null ? '' : money(l.unit_price)}</td>
                <td className={`text-right ${l.amount < 0 ? 'text-red-700' : ''}`}>{money(l.amount)}</td>
                <td className="text-right">
                  {manage && draft && l.kind === 'extra' && <button onClick={() => act(`/billing-lines/${l.id}`, 'DELETE')} className="text-slate-400 hover:text-red-600">×</button>}
                </td>
              </tr>
            ))}
            {!s.lines.length && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Hợp đồng không có dòng giá nào hiệu lực trong tháng</td></tr>}
          </tbody>
          <tfoot className="border-t border-slate-200">
            <tr><td className="py-1.5" colSpan={3}>Cộng</td><td className="text-right">{money(s.subtotal)}</td><td /></tr>
            <tr>
              <td className="py-1.5" colSpan={3}>
                VAT
                {manage && draft ? (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <Input className="w-20" type="number" step="0.5" min={0} max={100} value={vat} onChange={(e) => setVat(e.target.value)} />%
                    {vat !== String(s.vat_rate) && <Button variant="secondary" onClick={() => act(`/billing/${id}`, 'PATCH', { vat_rate: Number(vat) })}>Áp dụng</Button>}
                  </span>
                ) : ` ${s.vat_rate}%`}
              </td>
              <td className="text-right">{money(s.vat_amount)}</td><td />
            </tr>
            <tr className="text-base font-semibold"><td className="py-2" colSpan={3}>Tổng cộng</td><td className="text-right">{money(s.total)}</td><td /></tr>
          </tfoot>
        </table></div>
        {manage && draft && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              if (await act(`/billing/${id}/lines`, 'POST', { description: extra.description, amount: toNumber(extra.amount) })) setExtra({ description: '', amount: '' });
            }}
          >
            <Field label="Thêm dòng phát sinh"><Input className="w-96" value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} placeholder="VD: Tăng cường bảo vệ dịp lễ" required /></Field>
            <Field label="Số tiền (âm = giảm trừ)"><Input className="w-40" inputMode="numeric" value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value })} required /></Field>
            <Button type="submit" variant="secondary" disabled={busy}>Thêm dòng</Button>
          </form>
        )}
      </Card>

      {s.status === 'issued' && (
        <Card title="Tiền thu">
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <div>Phải thu <div className="text-lg font-semibold">{money(s.total)}</div></div>
            <div>Đã thu <div className="text-lg font-semibold text-teal-700">{money(s.paid)}</div></div>
            <div>Còn lại <div className={`text-lg font-semibold ${s.overdue_days > 0 ? 'text-red-700' : ''}`}>{money(s.balance)}</div></div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-2">Ngày</th><th>Hình thức</th><th>Số chứng từ</th><th>Ghi chú</th><th className="text-right">Số tiền</th><th /></tr></thead>
            <tbody>
              {s.payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-2">{date(p.paid_on)}</td><td>{PAYMENT_METHOD[p.method]}</td><td>{p.reference ?? '—'}</td>
                  <td className="text-slate-500">{p.note ?? ''} <span className="text-xs">· {p.created_by_name}</span></td>
                  <td className="text-right font-medium">{money(p.amount)}</td>
                  <td className="text-right">
                    {manage && <button onClick={() => { const reason = window.prompt('Lý do xoá khoản thu này:'); if (reason?.trim()) void act(`/billing-payments/${p.id}/remove`, 'POST', { reason }); }} className="text-slate-400 hover:text-red-600">×</button>}
                  </td>
                </tr>
              ))}
              {!s.payments.length && <tr><td colSpan={6} className="py-3 text-center text-slate-400">Chưa thu khoản nào</td></tr>}
            </tbody>
          </table></div>
          {manage && s.balance > 0 && (
            <form
              className="mt-3 grid grid-cols-2 items-end gap-2 border-t border-slate-100 pt-3 md:grid-cols-6"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                if (await act(`/billing/${id}/payments`, 'POST', { ...pay, amount: toNumber(pay.amount), reference: pay.reference || undefined, note: pay.note || undefined })) {
                  setPay({ paid_on: today(), amount: '', method: 'transfer', reference: '', note: '' });
                }
              }}
            >
              <Field label="Ngày thu"><Input type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} required /></Field>
              <Field label="Số tiền"><Input inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder={String(s.balance)} required /></Field>
              <Field label="Hình thức">
                <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Số chứng từ"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="UNC, phiếu thu…" /></Field>
              <Field label="Ghi chú"><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
              <Button type="submit" disabled={busy}>Ghi nhận tiền thu</Button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
