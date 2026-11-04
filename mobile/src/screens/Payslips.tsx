import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';

interface Slip {
  period_id: string;
  month: string;
  status: 'locked' | 'paid';
  paid_on: string | null;
  net: number;
}

interface Detail {
  month: string;
  pay_type: string | null;
  status: 'locked' | 'paid';
  paid_on: string | null;
  unit: 'cong' | 'gio';
  shifts: number;
  normal_units: number;
  holiday_units: number;
  overtime_units: number;
  base_amount: number;
  holiday_amount: number;
  overtime_amount: number;
  allowance_amount: number;
  violation_amount: number;
  social_insurance: number;
  adjustments: { kind: 'bonus' | 'advance' | 'tax' | 'other'; amount: number; note?: string }[];
  gross: number;
  deductions: number;
  net: number;
  detail: { violations: Record<string, number>; fixed?: { unpaid_days: number } };
}

const VND = new Intl.NumberFormat('vi-VN');
const money = (v: number) => `${VND.format(v)} đ`;
const monthLabel = (m: string) => `Tháng ${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;
const dayLabel = (d: string) => d.split('-').reverse().join('/');
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''));
const KIND: Record<string, string> = { bonus: 'Thưởng', advance: 'Tạm ứng', tax: 'Thuế TNCN', other: 'Khoản khác' };
const VIOLATION: Record<string, string> = {
  late_check_in: 'vào trễ', absent: 'vắng ca', early_check_out: 'ra sớm', missed_round: 'bỏ vòng tuần', missed_checkpoint: 'thiếu điểm', suspicious_scan: 'quét nghi vấn',
};

/** My payslips: each month the accountant has locked. */
export function Payslips() {
  const [rows, setRows] = useState<Slip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.request<Slip[]>('/me/payslips').then(setRows).catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra')); }, []);
  return (
    <Screen title="Phiếu lương" back>
      <ErrorText error={error} />
      {rows?.map((r) => (
        <Link key={r.period_id} to={`/phieu-luong/${r.period_id}`} className="block">
          <Card>
            <div className="flex items-center justify-between">
              <b className="text-lg">{monthLabel(r.month)}</b>
              <span className="text-xl font-semibold text-teal-700">{money(r.net)}</span>
            </div>
            <div className="text-sm text-slate-500">{r.status === 'paid' ? `Đã trả ngày ${r.paid_on ? dayLabel(r.paid_on) : ''}` : 'Đã chốt — chờ trả'}</div>
          </Card>
        </Link>
      ))}
      {rows && !rows.length && <p className="py-10 text-center text-slate-400">Chưa có phiếu lương nào. Phiếu lương hiện sau khi kế toán chốt bảng lương tháng.</p>}
    </Screen>
  );
}

function Row({ label, value, minus, strong }: { label: string; value: number; minus?: boolean; strong?: boolean }) {
  if (!value && !strong) return null;
  return (
    <div className={`flex justify-between border-t border-slate-100 py-2 ${strong ? 'text-lg font-semibold' : 'text-base'}`}>
      <span>{label}</span>
      <span className={minus ? 'text-red-700' : ''}>{minus ? '−' : ''}{money(value)}</span>
    </div>
  );
}

export function Payslip() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.request<Detail>(`/me/payslips/${id}`).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra')); }, [id]);
  if (!d) return <Screen title="Phiếu lương" back><ErrorText error={error} /></Screen>;
  const unit = d.unit === 'gio' ? 'giờ' : 'công';
  const violations = Object.entries(d.detail.violations ?? {}).map(([k, c]) => `${c} ${VIOLATION[k] ?? k}`).join(', ');
  return (
    <Screen title={monthLabel(d.month)} back>
      <Card className="text-center">
        <div className="text-sm text-slate-500">Thực lĩnh</div>
        <div className="text-3xl font-bold text-teal-700">{money(d.net)}</div>
        <div className="text-sm text-slate-500">{d.status === 'paid' ? `Đã trả ngày ${d.paid_on ? dayLabel(d.paid_on) : ''}` : 'Đã chốt — chờ trả'}</div>
      </Card>
      <Card>
        <b>Công trong tháng</b>
        {d.detail.fixed ? (
          <div className="mt-1 text-base">Lương tháng cố định · {d.shifts} ca đã trực{d.detail.fixed?.unpaid_days ? ` · trừ ${d.detail.fixed.unpaid_days} ngày nghỉ không lương` : ''}</div>
        ) : (
          <div className="mt-1 text-base">{d.shifts} ca · {n(d.normal_units)} {unit}{d.holiday_units ? ` · ${n(d.holiday_units)} ${unit} ngày lễ` : ''}{d.overtime_units ? ` · ${n(d.overtime_units)} công tăng ca` : ''}</div>
        )}
      </Card>
      <Card>
        <b>Thu nhập</b>
        <Row label={d.detail.fixed ? 'Lương tháng' : 'Lương theo công'} value={d.base_amount} />
        <Row label="Làm ngày lễ" value={d.holiday_amount} />
        <Row label="Tăng ca" value={d.overtime_amount} />
        <Row label="Phụ cấp" value={d.allowance_amount} />
        {d.adjustments.filter((a) => a.kind === 'bonus' || (a.kind === 'other' && a.amount > 0)).map((a, i) => <Row key={i} label={a.note || KIND[a.kind]} value={a.amount} />)}
        <Row label="Tổng thu nhập" value={d.gross} strong />
      </Card>
      <Card>
        <b>Khấu trừ</b>
        <Row label={`Vi phạm${violations ? ` (${violations})` : ''}`} value={d.violation_amount} minus />
        <Row label="BHXH" value={d.social_insurance} minus />
        {d.adjustments.filter((a) => a.kind === 'advance' || a.kind === 'tax' || (a.kind === 'other' && a.amount < 0)).map((a, i) => (
          <Row key={i} label={a.note ? `${KIND[a.kind]}: ${a.note}` : KIND[a.kind]} value={Math.abs(a.amount)} minus />
        ))}
        <Row label="Tổng khấu trừ" value={d.deductions} strong />
      </Card>
      <p className="text-center text-sm text-slate-500">Thắc mắc về lương: liên hệ kế toán.</p>
    </Screen>
  );
}
