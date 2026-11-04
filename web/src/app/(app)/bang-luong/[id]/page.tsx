'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ADJUSTMENT_KIND, date, money, monthLabel, PAYROLL_STATUS, stamp, VIOLATION_TYPE } from '@/lib/format';
import { AdjustmentKind, PayrollAdjustment, PayrollLine, PayrollPeriod, ViolationType } from '@/lib/types';

const PAY_TYPE: Record<string, string> = { monthly: 'Lương tháng', per_shift: 'Theo ca', per_hour: 'Theo giờ' };
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''));
const hours = (min: number | null) => (min === null ? 'chưa ra ca' : `${Math.floor(min / 60)}g${String(min % 60).padStart(2, '0')}`);

/** "14 công + 1 lễ + 2 tăng ca" — what the amounts are paid for. */
function units(l: PayrollLine) {
  const u = l.unit === 'gio' ? 'giờ' : 'công';
  return [`${n(l.normal_units)} ${u}`, l.holiday_units ? `${n(l.holiday_units)} lễ` : '', l.overtime_units ? `${n(l.overtime_units)} tăng ca` : ''].filter(Boolean).join(' + ');
}

/** The accountant's own lines on one person's pay: bonus, advance, tax, other. */
function Adjustments({ line, editable, onSave }: { line: PayrollLine; editable: boolean; onSave: (items: PayrollAdjustment[]) => Promise<void> }) {
  const [items, setItems] = useState<{ kind: AdjustmentKind; amount: string; note: string }[]>(
    line.adjustments.map((a) => ({ kind: a.kind, amount: String(a.amount), note: a.note ?? '' })),
  );
  const [busy, setBusy] = useState(false);
  if (!editable) {
    return line.adjustments.length ? (
      <ul className="space-y-1">{line.adjustments.map((a, i) => <li key={i}>{ADJUSTMENT_KIND[a.kind].label}: {money(a.amount)}{a.note ? ` — ${a.note}` : ''}</li>)}</ul>
    ) : <span className="text-slate-400">Không có</span>;
  }
  return (
    <div className="space-y-2">
      {items.map((a, i) => (
        <div key={i} className="flex gap-2">
          <Select className="w-36" value={a.kind} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, kind: e.target.value as AdjustmentKind } : x)))}>
            {Object.entries(ADJUSTMENT_KIND).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.hint})</option>)}
          </Select>
          <Input className="w-36" inputMode="numeric" placeholder="Số tiền" value={a.amount} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <Input placeholder="Ghi chú" value={a.note} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
          <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-600">×</button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setItems([...items, { kind: 'bonus', amount: '', note: '' }])}>+ Thêm khoản</Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(items.filter((a) => a.amount.trim()).map((a) => ({ kind: a.kind, amount: Number(a.amount.replace(/[.,\s]/g, '')), ...(a.note.trim() ? { note: a.note.trim() } : {}) })));
            setBusy(false);
          }}
        >
          Lưu điều chỉnh
        </Button>
      </div>
    </div>
  );
}

export default function PayrollPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setPeriod(await api<PayrollPeriod>(`/payroll/${id}`)), [id]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function act(path: string, json: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      setPeriod(await api<PayrollPeriod>(path, { method: path.includes('adjustments') ? 'PUT' : 'POST', json }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!period) return <ErrorText error={error} />;
  const manage = can('payroll.manage');
  const draft = period.status === 'draft';
  const total = (k: 'gross' | 'deductions' | 'net') => period.lines.reduce((s, l) => s + l[k], 0);
  const warned = period.lines.filter((l) => l.warnings.length).length;

  return (
    <div className="space-y-4">
      <Link href="/bang-luong" className="text-sm text-teal-700 hover:underline">← Bảng lương</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Bảng lương {monthLabel(period.month).toLowerCase()}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${PAYROLL_STATUS[period.status].tone}`}>{PAYROLL_STATUS[period.status].label}</span>
        {manage && (
          <div className="ml-auto flex gap-2">
            {draft && <Button variant="secondary" disabled={busy} onClick={() => act(`/payroll/${id}/recompute`)}>Tính lại</Button>}
            {draft && (
              <Button disabled={busy} onClick={() => window.confirm(`Chốt bảng lương? Bảo vệ sẽ thấy phiếu lương; muốn sửa phải mở lại.${warned ? `\n\nCòn ${warned} người có cảnh báo.` : ''}`) && act(`/payroll/${id}/lock`)}>
                Chốt bảng lương
              </Button>
            )}
            {period.status === 'locked' && (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => { const reason = window.prompt('Lý do mở lại bảng lương:'); if (reason?.trim()) void act(`/payroll/${id}/unlock`, { reason }); }}>Mở lại</Button>
                <Button disabled={busy} onClick={() => { const paid = window.prompt('Ngày trả lương (YYYY-MM-DD):', new Date().toISOString().slice(0, 10)); if (paid) void act(`/payroll/${id}/paid`, { paid_on: paid }); }}>Đánh dấu đã trả</Button>
              </>
            )}
          </div>
        )}
      </div>
      <ErrorText error={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><div className="text-sm text-slate-500">Số người</div><div className="text-2xl font-semibold">{period.lines.length}</div></Card>
        <Card><div className="text-sm text-slate-500">Tổng thu nhập</div><div className="text-2xl font-semibold">{money(total('gross'))}</div></Card>
        <Card><div className="text-sm text-slate-500">Tổng khấu trừ</div><div className="text-2xl font-semibold">{money(total('deductions'))}</div></Card>
        <Card><div className="text-sm text-slate-500">Tổng thực lĩnh</div><div className="text-2xl font-semibold text-teal-700">{money(total('net'))}</div></Card>
      </div>
      <p className="text-xs text-slate-500">
        Quy tắc dùng: {period.rules.standard_shifts} công chuẩn · lễ ×{period.rules.holiday_coefficient} · tăng ca ×{period.rules.overtime_coefficient}
        {period.computed_at && ` · tính lúc ${stamp(period.computed_at)}`}
        {period.paid_on && ` · đã trả ngày ${date(period.paid_on)}${period.paid_by_name ? ` (${period.paid_by_name})` : ''}`}
        {period.locked_by_name && !period.paid_on && ` · chốt bởi ${period.locked_by_name}`}
      </p>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-2">Nhân viên</th><th>Công / giờ</th>
                <th className="text-right">Lương chính</th><th className="text-right">Lễ + tăng ca</th><th className="text-right">Phụ cấp</th>
                <th className="text-right">Vi phạm</th><th className="text-right">BHXH</th><th className="text-right">Điều chỉnh</th>
                <th className="text-right">Thực lĩnh</th>
              </tr>
            </thead>
            <tbody>
              {period.lines.map((l) => {
                const adjusted = l.gross - l.base_amount - l.holiday_amount - l.overtime_amount - l.allowance_amount - (l.deductions - l.violation_amount - l.social_insurance);
                return (
                  <Fragment key={l.id}>
                    <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === l.id ? null : l.id)}>
                      <td className="py-2">
                        <div className="font-medium">{l.employee_name} {l.warnings.length > 0 && <span title={l.warnings.join('\n')} className="text-amber-600">⚠</span>}</div>
                        <div className="font-mono text-xs text-slate-400">{l.employee_code} · {l.pay_type ? `${PAY_TYPE[l.pay_type]}${l.detail?.fixed ? ' cố định' : ''}` : 'chưa có hồ sơ lương'}</div>
                      </td>
                      <td>{units(l)}<div className="text-xs text-slate-400">{l.shifts} ca</div></td>
                      <td className="text-right">{money(l.base_amount)}</td>
                      <td className="text-right">{money(l.holiday_amount + l.overtime_amount)}</td>
                      <td className="text-right">{money(l.allowance_amount)}</td>
                      <td className="text-right text-red-700">{l.violation_amount ? `−${money(l.violation_amount)}` : '—'}</td>
                      <td className="text-right text-red-700">{l.social_insurance ? `−${money(l.social_insurance)}` : '—'}</td>
                      <td className={`text-right ${adjusted < 0 ? 'text-red-700' : ''}`}>{l.adjustments.length ? money(adjusted) : '—'}</td>
                      <td className="text-right font-semibold">{money(l.net)}</td>
                    </tr>
                    {open === l.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={9} className="space-y-3 p-4">
                          {l.warnings.map((w) => <p key={w} className="text-amber-700">⚠ {w}</p>)}
                          <div className="grid gap-6 md:grid-cols-2">
                            <div>
                              <div className="mb-1 font-semibold">Ca đã làm ({l.detail.shifts.length})</div>
                              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs">
                                {l.detail.shifts.map((s, i) => (
                                  <li key={i} className={s.worked_minutes === null ? 'text-amber-700' : ''}>
                                    {date(s.date)} · {s.site} · làm {hours(s.worked_minutes)} / {hours(s.planned_minutes)}{s.holiday ? ' · ngày lễ' : ''}
                                  </li>
                                ))}
                              </ul>
                              {Object.keys(l.detail.violations).length > 0 && (
                                <div className="mt-2 text-xs">
                                  Vi phạm đã xác nhận: {Object.entries(l.detail.violations).map(([k, c]) => `${VIOLATION_TYPE[k as ViolationType]} ×${c}`).join(', ')}
                                </div>
                              )}
                              {l.bank_account && <div className="mt-2 text-xs text-slate-500">Chuyển khoản: {l.bank_account} · {l.bank_name}</div>}
                            </div>
                            <div>
                              <div className="mb-1 font-semibold">Điều chỉnh của kế toán</div>
                              <Adjustments line={l} editable={manage && draft} onSave={(items) => act(`/payroll-lines/${l.id}/adjustments`, { items })} />
                              <div className="mt-3 text-xs text-slate-500">Thu nhập {money(l.gross)} · khấu trừ {money(l.deductions)} · thực lĩnh {money(l.net)}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!period.lines.length && <tr><td colSpan={9} className="py-6 text-center text-slate-400">Không có ai có hồ sơ lương hoặc ca làm trong tháng</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-slate-500">Bấm vào một dòng để xem từng ca, vi phạm và nhập thưởng, tạm ứng, thuế TNCN.</p>
    </div>
  );
}
