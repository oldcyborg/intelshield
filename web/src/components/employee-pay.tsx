'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { date, money, MONTHLY_MODE, PAY_TYPE } from '@/lib/format';
import { PayInfo } from '@/lib/types';

const EMPTY = { pay_type: 'monthly', monthly_mode: 'attendance', base_pay: '', allowance: '', bank_name: '', bank_account: '', tax_code: '', social_insurance_no: '', social_insurance: '', annual_leave_days: '', note: '' };
type Draft = typeof EMPTY;

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[.\s,]/g, '')));

/** The pay & leave part of a person's file — shown only to people with the pay permissions. */
export function EmployeePay({ employeeId, editable }: { employeeId: string; editable: boolean }) {
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const r = await api<PayInfo>(`/employees/${employeeId}/pay`);
    setInfo(r);
    const p = r.pay;
    setDraft(p ? {
      pay_type: p.pay_type, monthly_mode: p.monthly_mode ?? 'attendance', base_pay: p.base_pay?.toString() ?? '', allowance: p.allowance?.toString() ?? '', bank_name: p.bank_name ?? '',
      bank_account: p.bank_account ?? '', tax_code: p.tax_code ?? '', social_insurance_no: p.social_insurance_no ?? '', social_insurance: p.social_insurance?.toString() ?? '',
      annual_leave_days: p.annual_leave_days?.toString() ?? '', note: p.note ?? '',
    } : EMPTY);
  }, [employeeId]);

  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api(`/employees/${employeeId}/pay`, {
        method: 'PUT',
        json: {
          pay_type: draft.pay_type, monthly_mode: draft.pay_type === 'monthly' ? draft.monthly_mode : undefined, base_pay: num(draft.base_pay), allowance: num(draft.allowance), annual_leave_days: num(draft.annual_leave_days),
          bank_name: draft.bank_name || null, bank_account: draft.bank_account || null, tax_code: draft.tax_code || null,
          social_insurance_no: draft.social_insurance_no || null, social_insurance: num(draft.social_insurance), note: draft.note || null,
        },
      });
      await load();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });
  const leave = info?.leave;

  return (
    <Card title="Lương & ngày phép">
      <ErrorText error={error} />
      <form onSubmit={save} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
        <Field label="Hình thức trả lương">
          <Select value={draft.pay_type} onChange={set('pay_type')} disabled={!editable}>
            {Object.entries(PAY_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {draft.pay_type === 'monthly' && (
          <Field label="Cách tính lương tháng">
            <Select value={draft.monthly_mode} onChange={set('monthly_mode')} disabled={!editable}>
              {Object.entries(MONTHLY_MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        )}
        <Field label={`Lương cơ bản (đ/${draft.pay_type === 'monthly' ? 'tháng' : draft.pay_type === 'per_shift' ? 'ca' : 'giờ'})`}>
          <Input inputMode="numeric" value={draft.base_pay} onChange={set('base_pay')} disabled={!editable} />
        </Field>
        <Field label="Phụ cấp (đ/tháng)"><Input inputMode="numeric" value={draft.allowance} onChange={set('allowance')} disabled={!editable} /></Field>
        <Field label="Số ngày phép năm (để trống = không tính)">
          <Input inputMode="numeric" value={draft.annual_leave_days} onChange={set('annual_leave_days')} disabled={!editable} />
        </Field>
        <Field label="Ngân hàng"><Input value={draft.bank_name} onChange={set('bank_name')} disabled={!editable} /></Field>
        <Field label="Số tài khoản"><Input value={draft.bank_account} onChange={set('bank_account')} disabled={!editable} /></Field>
        <Field label="Mã số thuế cá nhân"><Input value={draft.tax_code} onChange={set('tax_code')} disabled={!editable} /></Field>
        <Field label="Số sổ BHXH"><Input value={draft.social_insurance_no} onChange={set('social_insurance_no')} disabled={!editable} /></Field>
        <Field label="BHXH trừ mỗi tháng (đ)"><Input inputMode="numeric" value={draft.social_insurance} onChange={set('social_insurance')} disabled={!editable} /></Field>
        <div className="md:col-span-3"><Field label="Ghi chú"><Input value={draft.note} onChange={set('note')} disabled={!editable} /></Field></div>
        {draft.pay_type === 'monthly' && (
          <p className="text-xs text-slate-500 md:col-span-4">
            {draft.monthly_mode === 'fixed'
              ? 'Cố định: trả đủ lương và phụ cấp, không tính theo số ca; chỉ trừ ngày nghỉ không lương và tháng mới vào làm.'
              : 'Theo chấm công: lương tháng chia công chuẩn, nhân số công thực làm; quá công chuẩn tính tăng ca.'}
          </p>
        )}
        {editable && <Button type="submit">Lưu lương & phép</Button>}
      </form>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-sm text-slate-600">
        {info?.pay?.base_pay != null && <span>Lương: <b>{money(info.pay.base_pay)}</b> · {PAY_TYPE[info.pay.pay_type].toLowerCase()}{info.pay.pay_type === 'monthly' ? ` ${MONTHLY_MODE[info.pay.monthly_mode]?.toLowerCase() ?? ''}` : ''}</span>}
        {leave && (leave.allowance === null
          ? <span>Phép năm {leave.year}: không theo dõi{leave.used ? ` (đã nghỉ phép năm ${leave.used} ngày)` : ''}</span>
          : <span>Phép năm {leave.year}: {leave.allowance} ngày · đã dùng {leave.used} · <b className={leave.remaining! < 0 ? 'text-red-700' : ''}>còn {leave.remaining}</b></span>)}
        {info?.pay && <span className="text-slate-400">Cập nhật {date(info.pay.updated_at.slice(0, 10))}</span>}
        {saved && <span className="text-teal-700">Đã lưu</span>}
      </div>
    </Card>
  );
}
