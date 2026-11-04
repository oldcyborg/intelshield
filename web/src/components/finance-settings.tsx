'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, VIOLATION_TYPE } from '@/lib/format';
import { FinanceSettings as Values, ViolationType } from '@/lib/types';

const toText = (v: Values) => ({
  standard_shifts: String(v.standard_shifts), holiday_coefficient: String(v.holiday_coefficient), overtime_coefficient: String(v.overtime_coefficient),
  vat_rate: String(v.vat_rate), payment_terms_days: String(v.payment_terms_days), payment_info: v.payment_info ?? '',
  penalties: Object.fromEntries(Object.keys(VIOLATION_TYPE).map((k) => [k, String(v.penalties[k as ViolationType] ?? '')])) as Record<string, string>,
});

/** The company's money rules: pay rules (payroll.manage) and billing terms (billing.manage). */
export function FinanceSettings({ part }: { part: 'payroll' | 'billing' }) {
  const { can } = useAuth();
  const editable = can(part === 'payroll' ? 'payroll.manage' : 'billing.manage');
  const [values, setValues] = useState<Values | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof toText> | null>(null);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newDay, setNewDay] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ values: Values }>('/finance/settings');
    setValues(r.values);
    setDraft(toText(r.values));
    setHolidays(r.values.holidays);
  }, []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    setSaved(false);
    const json = part === 'payroll'
      ? {
        standard_shifts: Number(draft.standard_shifts), holiday_coefficient: Number(draft.holiday_coefficient),
        overtime_coefficient: Number(draft.overtime_coefficient), holidays,
        penalties: Object.fromEntries(Object.entries(draft.penalties).filter(([, v]) => v.trim()).map(([k, v]) => [k, Number(v)])),
      }
      : { vat_rate: Number(draft.vat_rate), payment_terms_days: Number(draft.payment_terms_days), payment_info: draft.payment_info.trim() || null };
    try {
      await api('/finance/settings', { method: 'PUT', json });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!values || !draft) return <ErrorText error={error} />;
  const set = (k: 'standard_shifts' | 'holiday_coefficient' | 'overtime_coefficient' | 'vat_rate' | 'payment_terms_days') =>
    (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const summary = part === 'payroll'
    ? `${values.standard_shifts} công chuẩn/tháng · lễ ×${values.holiday_coefficient} · tăng ca ×${values.overtime_coefficient} · ${values.holidays.length} ngày lễ`
    : `VAT ${values.vat_rate}% · hạn thanh toán ${values.payment_terms_days} ngày`;

  return (
    <Card
      title={part === 'payroll' ? 'Quy tắc tính lương' : 'Điều khoản thu tiền'}
      actions={<Button variant="secondary" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : editable ? 'Xem / sửa' : 'Xem'}</Button>}
    >
      <p className="text-sm text-slate-600">{summary}</p>
      {open && (
        <form onSubmit={save} className="mt-4 space-y-4">
          {part === 'payroll' ? (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Số công chuẩn/tháng (chỉ lương theo tháng)">
                  <Input type="number" step="0.5" min={1} max={31} value={draft.standard_shifts} onChange={set('standard_shifts')} disabled={!editable} />
                </Field>
                <Field label="Hệ số ngày lễ"><Input type="number" step="0.1" min={1} max={10} value={draft.holiday_coefficient} onChange={set('holiday_coefficient')} disabled={!editable} /></Field>
                <Field label="Hệ số tăng ca (công vượt chuẩn)"><Input type="number" step="0.1" min={1} max={10} value={draft.overtime_coefficient} onChange={set('overtime_coefficient')} disabled={!editable} /></Field>
              </div>
              <div>
                <div className="mb-1 text-sm text-slate-600">Ngày lễ (ca trong ngày này nhân hệ số lễ)</div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {holidays.map((d) => (
                    <span key={d} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1">
                      {date(d)}
                      {editable && <button type="button" onClick={() => setHolidays(holidays.filter((x) => x !== d))} className="text-slate-400 hover:text-red-600">×</button>}
                    </span>
                  ))}
                  {!holidays.length && <span className="text-slate-400">Chưa khai ngày lễ nào</span>}
                </div>
                {editable && (
                  <div className="mt-2 flex gap-2">
                    <Input type="date" className="w-48" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
                    <Button type="button" variant="secondary" disabled={!newDay} onClick={() => { setHolidays([...new Set([...holidays, newDay])].sort()); setNewDay(''); }}>Thêm ngày lễ</Button>
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-sm text-slate-600">Mức trừ cho mỗi vi phạm đã được quản lý xác nhận (đ, để trống = không trừ)</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {Object.entries(VIOLATION_TYPE).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <Input inputMode="numeric" value={draft.penalties[k]} disabled={!editable} onChange={(e) => setDraft({ ...draft, penalties: { ...draft.penalties, [k]: e.target.value } })} />
                    </Field>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="VAT mặc định (%)"><Input type="number" step="0.5" min={0} max={100} value={draft.vat_rate} onChange={set('vat_rate')} disabled={!editable} /></Field>
              <Field label="Hạn thanh toán (ngày sau khi chốt)"><Input type="number" min={0} max={365} value={draft.payment_terms_days} onChange={set('payment_terms_days')} disabled={!editable} /></Field>
              <div className="md:col-span-3">
                <Field label="Thông tin chuyển khoản (in trên đề nghị thanh toán)">
                  <textarea rows={3} value={draft.payment_info} disabled={!editable} onChange={(e) => setDraft({ ...draft, payment_info: e.target.value })}
                    placeholder="Tên tài khoản, số tài khoản, ngân hàng, chi nhánh…" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
                </Field>
              </div>
            </div>
          )}
          {editable && (
            <div className="flex items-center gap-3">
              <Button type="submit">Lưu</Button>
              {saved && <span className="text-sm text-teal-700">Đã lưu. Bảng nháp cần "Tính lại" để áp dụng.</span>}
            </div>
          )}
        </form>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
