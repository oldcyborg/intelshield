'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { date, money, monthLabel, vndWords } from '@/lib/format';
import { BillingStatement } from '@/lib/types';

const qty = (v: number | null) => (v === null ? '' : Number.isInteger(v) ? String(v) : v.toFixed(2));

/** The payment request sent to the client: printed, or saved as PDF from the browser's print dialog. */
function Request() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<BillingStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<BillingStatement>(`/billing/${id}`).then(setS).catch((e) => setError(e instanceof Error ? e.message : 'Không tải được')); }, [id]);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!s) return <p className="p-8 text-slate-500">Đang tải…</p>;
  const lines = s.lines.filter((l) => l.applied);
  const cell = 'border border-slate-400 px-2 py-1';

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-black print:p-0">
      <style>{`@page { size: A4; margin: 15mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="no-print mb-6 flex items-center justify-between rounded bg-amber-50 p-3 text-sm text-amber-900">
        <span>{s.status === 'draft' ? 'Bảng này chưa chốt — đây là bản nháp.' : 'Dùng lệnh In của trình duyệt (Ctrl+P), chọn "Lưu dưới dạng PDF" để gửi khách.'}</span>
        <button onClick={() => window.print()} className="rounded bg-teal-700 px-3 py-1.5 text-white">In / lưu PDF</button>
      </div>

      <div className="flex justify-between">
        <div className="font-semibold uppercase">{s.company_name}</div>
        <div className="text-right">
          <div className="font-semibold">CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
          <div>Độc lập – Tự do – Hạnh phúc</div>
        </div>
      </div>
      <div className="mt-2 flex justify-between text-slate-700">
        <div>Số: {s.code ?? '(nháp)'}</div>
        <div className="italic">Ngày {s.issued_on ? date(s.issued_on) : date(new Date().toISOString().slice(0, 10))}</div>
      </div>

      <h1 className="mt-6 text-center text-lg font-bold">ĐỀ NGHỊ THANH TOÁN</h1>
      <p className="text-center">Phí dịch vụ bảo vệ {monthLabel(s.month).toLowerCase()} — Hợp đồng số {s.contract_no}</p>

      <div className="mt-5 space-y-0.5">
        <div><b>Kính gửi:</b> {s.client.name}</div>
        {s.client.address && <div>Địa chỉ: {s.client.address}</div>}
        {s.client.tax_code && <div>Mã số thuế: {s.client.tax_code}</div>}
        {s.client.contact_name && <div>Người liên hệ: {s.client.contact_name}{s.client.contact_phone ? ` — ${s.client.contact_phone}` : ''}</div>}
      </div>
      <p className="mt-3">{s.company_name} trân trọng đề nghị Quý khách thanh toán phí dịch vụ bảo vệ {monthLabel(s.month).toLowerCase()} như sau:</p>

      <div className="overflow-x-auto"><table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="bg-slate-100">
            <th className={`${cell} w-10`}>STT</th><th className={cell}>Nội dung</th><th className={`${cell} w-28`}>Số lượng</th>
            <th className={`${cell} w-32`}>Đơn giá (đ)</th><th className={`${cell} w-36`}>Thành tiền (đ)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id}>
              <td className={`${cell} text-center`}>{i + 1}</td>
              <td className={cell}>{l.description}{l.note ? <div className="text-xs italic">{l.note}</div> : null}</td>
              <td className={`${cell} text-right`}>{qty(l.quantity)} {l.unit ?? ''}</td>
              <td className={`${cell} text-right`}>{l.unit_price === null ? '' : money(l.unit_price).replace(' đ', '')}</td>
              <td className={`${cell} text-right`}>{money(l.amount).replace(' đ', '')}</td>
            </tr>
          ))}
          <tr><td className={cell} colSpan={4}>Cộng tiền dịch vụ</td><td className={`${cell} text-right`}>{money(s.subtotal).replace(' đ', '')}</td></tr>
          <tr><td className={cell} colSpan={4}>Thuế GTGT ({s.vat_rate}%)</td><td className={`${cell} text-right`}>{money(s.vat_amount).replace(' đ', '')}</td></tr>
          <tr className="font-bold"><td className={cell} colSpan={4}>Tổng cộng thanh toán</td><td className={`${cell} text-right`}>{money(s.total).replace(' đ', '')}</td></tr>
        </tbody>
      </table></div>
      <p className="mt-2"><b>Bằng chữ:</b> <i>{vndWords(s.total)}.</i></p>
      {s.due_date && <p className="mt-2">Đề nghị Quý khách thanh toán trước ngày <b>{date(s.due_date)}</b>.</p>}
      {s.payment_info && <div className="mt-3"><b>Thông tin chuyển khoản:</b><div className="whitespace-pre-line">{s.payment_info}</div></div>}
      {s.note && <p className="mt-3 italic">{s.note}</p>}

      <div className="mt-12 grid grid-cols-2 text-center">
        <div><b>XÁC NHẬN CỦA KHÁCH HÀNG</b><div className="text-xs italic">(Ký, ghi rõ họ tên)</div></div>
        <div><b>{s.company_name.toUpperCase()}</b><div className="text-xs italic">(Ký, ghi rõ họ tên, đóng dấu)</div></div>
      </div>
    </div>
  );
}

export default function PaymentRequestPage() {
  return (
    <AuthProvider>
      <Request />
    </AuthProvider>
  );
}
