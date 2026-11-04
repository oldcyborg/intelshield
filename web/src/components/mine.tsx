'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

/** One's own records — read here, acted on in the app. */
const TABS = [
  { href: '/cua-toi', label: 'Ca trực & mục tiêu' },
  { href: '/cua-toi/phieu-luong', label: 'Phiếu lương' },
  { href: '/cua-toi/giay-to', label: 'Hợp đồng & giấy tờ' },
  { href: '/cua-toi/vi-pham', label: 'Vi phạm' },
  { href: '/cua-toi/don-tu', label: 'Ngày phép & đơn từ' },
];

/**
 * The tabs scroll sideways on a phone rather than wrapping: five wrapped tabs are three rows before the first record.
 */
export function MinePage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = TABS.filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Của tôi</h1>
      <nav className="-mx-3 flex gap-1 overflow-x-auto border-b border-slate-200 px-3 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${t === current ? 'border-teal-700 font-medium text-teal-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

/** Today in Vietnam, shifted by some days, as YYYY-MM-DD. */
export function localDay(offset = 0): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 86_400_000));
}

export const weekday = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso));

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-400">{children}</p>;
}

export function StatusBadge({ s }: { s?: { label: string; tone: string } }) {
  return s ? <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${s.tone}`}>{s.label}</span> : null;
}

export interface MyShift {
  id: string;
  site_id: string;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  site_name: string;
  site_address: string | null;
  template_name: string | null;
  attendance: { check_in_at: string | null; check_out_at: string | null; late_minutes: number | null; corrected?: boolean } | null;
  correction: string | null;
}
