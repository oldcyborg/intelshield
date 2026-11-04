'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MinePage } from '@/components/mine';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { date, money, monthLabel, VIOLATION_TYPE } from '@/lib/format';

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
  detail: { violations?: Record<string, number>; fixed?: { unpaid_days: number } };
}

const KIND: Record<string, string> = { bonus: 'Thưởng', advance: 'Tạm ứng', tax: 'Thuế TNCN', other: 'Khoản khác' };
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''));
const VIOLATION = VIOLATION_TYPE as Record<string, string>;

function Row({ label, value, minus, strong }: { label: string; value: number; minus?: boolean; strong?: boolean }) {
  if (!value && !strong) return null;
  return (
    <div className={`flex justify-between gap-3 border-t border-slate-100 py-2 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className={`shrink-0 ${minus ? 'text-red-700' : ''}`}>
        {minus ? '−' : ''}
        {money(value)}
      </span>
    </div>
  );
}

export default function MyPayslipPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Detail>(`/me/payslips/${id}`).then(setD).catch((e) => setError(errorMessage(e)));
  }, [id]);
  const unit = d?.unit === 'gio' ? 'giờ' : 'công';
  const violations = Object.entries(d?.detail?.violations ?? {})
    .map(([k, c]) => `${c} ${VIOLATION[k]?.toLowerCase() ?? k}`)
    .join(', ');
  return (
    <MinePage>
      <Link href="/cua-toi/phieu-luong" className="text-sm text-teal-700 hover:underline">
        ← Tất cả phiếu lương
      </Link>
      <ErrorText error={error} />
      {d && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={monthLabel(d.month)}>
            <div className="text-sm text-slate-500">Thực lĩnh</div>
            <div className="text-3xl font-bold text-teal-700">{money(d.net)}</div>
            <div className="text-sm text-slate-500">{d.status === 'paid' ? `Đã trả ngày ${date(d.paid_on)}` : 'Đã chốt — chờ trả'}</div>
            <div className="mt-3 text-sm">
              {d.detail?.fixed ? (
                <>
                  Lương tháng cố định · {d.shifts} ca đã trực
                  {d.detail?.fixed?.unpaid_days ? ` · trừ ${d.detail.fixed.unpaid_days} ngày nghỉ không lương` : ''}
                </>
              ) : (
                <>
                  {d.shifts} ca · {n(d.normal_units)} {unit}
                  {d.holiday_units ? ` · ${n(d.holiday_units)} ${unit} ngày lễ` : ''}
                  {d.overtime_units ? ` · ${n(d.overtime_units)} công tăng ca` : ''}
                </>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">Thắc mắc về lương: liên hệ kế toán.</p>
          </Card>
          <Card title="Chi tiết">
            <Row label={d.detail?.fixed ? 'Lương tháng' : 'Lương theo công'} value={d.base_amount} />
            <Row label="Làm ngày lễ" value={d.holiday_amount} />
            <Row label="Tăng ca" value={d.overtime_amount} />
            <Row label="Phụ cấp" value={d.allowance_amount} />
            {d.adjustments
              .filter((a) => a.kind === 'bonus' || (a.kind === 'other' && a.amount > 0))
              .map((a, i) => (
                <Row key={`p${i}`} label={a.note || KIND[a.kind]} value={a.amount} />
              ))}
            <Row label="Tổng thu nhập" value={d.gross} strong />
            <Row label={`Vi phạm${violations ? ` (${violations})` : ''}`} value={d.violation_amount} minus />
            <Row label="BHXH" value={d.social_insurance} minus />
            {d.adjustments
              .filter((a) => a.kind === 'advance' || a.kind === 'tax' || (a.kind === 'other' && a.amount < 0))
              .map((a, i) => (
                <Row key={`m${i}`} label={a.note ? `${KIND[a.kind]}: ${a.note}` : KIND[a.kind]} value={Math.abs(a.amount)} minus />
              ))}
            <Row label="Tổng khấu trừ" value={d.deductions} strong />
          </Card>
        </div>
      )}
    </MinePage>
  );
}
