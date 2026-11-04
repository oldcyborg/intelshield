'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Bell } from './bell';

/** `self`: one's own records, shown to anyone who is an employee — no permission, the server answers only about them. */
const NAV: { href: string; label: string; permission?: string; self?: boolean }[] = [
  { href: '/', label: 'Tổng quan' },
  { href: '/cua-toi', label: 'Của tôi', self: true },
  { href: '/su-co', label: 'Sự cố', permission: 'incident.view' },
  { href: '/khach-hang', label: 'Khách hàng', permission: 'client.view' },
  { href: '/hop-dong', label: 'Hợp đồng', permission: 'contract.view' },
  { href: '/muc-tieu', label: 'Mục tiêu', permission: 'site.view' },
  { href: '/xep-ca', label: 'Xếp ca', permission: 'roster.view' },
  { href: '/cham-cong', label: 'Chấm công', permission: 'attendance.view' },
  { href: '/tuan-tra', label: 'Tuần tra', permission: 'patrol.view' },
  { href: '/vi-pham', label: 'Vi phạm', permission: 'violation.view' },
  { href: '/don-tu', label: 'Đơn từ', permission: 'leave.review' },
  { href: '/bang-luong', label: 'Bảng lương', permission: 'payroll.view' },
  { href: '/cong-no', label: 'Đối soát & công nợ', permission: 'billing.view' },
  { href: '/so-truc', label: 'Sổ trực & giao ca', permission: 'logbook.view' },
  { href: '/to-chuc', label: 'Tổ chức', permission: 'org.view' },
  { href: '/nhan-vien', label: 'Nhân viên', permission: 'employee.view' },
  { href: '/nguoi-dung', label: 'Người dùng', permission: 'user.view' },
  { href: '/thiet-bi', label: 'Thiết bị', permission: 'device.manage' },
  { href: '/cai-dat', label: 'Cài đặt', permission: 'tenant.settings.manage' },
  { href: '/huong-dan', label: 'Video hướng dẫn' },
];

/**
 * A page opened by its address (a bookmark, a shared link) by someone without its permission: a plain notice,
 * not a half-working page. The server refuses the data either way.
 */
function allowed(pathname: string, can: (p: string) => boolean): boolean {
  const item = NAV.filter((n) => n.href !== '/' && (pathname === n.href || pathname.startsWith(`${n.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return !item?.permission || can(item.permission);
}

function NotAllowed() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
      <div className="text-3xl">🔒</div>
      <h1 className="mt-2 text-lg font-semibold">Bạn không có quyền xem trang này</h1>
      <p className="mt-1 text-sm text-slate-500">Trang này không thuộc vai trò của bạn. Cần dùng, hãy nhờ quản trị cấp thêm quyền.</p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">← Về trang tổng quan</Link>
    </div>
  );
}

/**
 * Below `lg` the menu becomes a drawer behind ☰: on a phone a fixed 224px column takes more than half the screen
 * and clips the page — the roster showed nothing but its name column.
 *
 * The content column carries `min-w-0`: without it a wide table stretches the flex item past the viewport
 * instead of scrolling inside its own frame.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Tapping an item navigates; a drawer left open would cover the page just opened.
  useEffect(() => setOpen(false), [pathname]);

  const links = NAV.filter((item) => (item.self ? Boolean(me.user.employee_id) : !item.permission || can(item.permission))).map((item) => (
    <Link
      key={item.href}
      href={item.href}
      className={`block rounded px-3 py-2 text-sm ${pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)) ? 'bg-teal-700' : 'hover:bg-slate-800'}`}
    >
      {item.label}
    </Link>
  ));

  return (
    <div className="flex min-h-screen">
      {open && (
        <button aria-label="Đóng menu" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto bg-slate-900 text-slate-100 transition-transform lg:static lg:w-56 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-4 py-5">
          <span className="text-lg font-semibold">IntelShield</span>
          <button aria-label="Đóng menu" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xl leading-none hover:bg-slate-800 lg:hidden">
            ✕
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-2">{links}</nav>
        {/* On a phone the top bar has no room for the name and these two links. */}
        <div className="space-y-1 border-t border-slate-800 px-2 py-3 text-sm lg:hidden">
          <div className="px-3 py-1 text-slate-400">{me.user.full_name}</div>
          <Link href="/doi-mat-khau" className="block rounded px-3 py-2 hover:bg-slate-800">Đổi mật khẩu</Link>
          <button onClick={logout} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-800">Đăng xuất</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 text-sm sm:px-6 sm:py-3 lg:static lg:justify-end lg:gap-4">
          <button aria-label="Mở menu" onClick={() => setOpen(true)} className="rounded px-2 py-1 text-xl leading-none text-slate-700 hover:bg-slate-100 lg:hidden">
            ☰
          </button>
          <span className="font-semibold lg:hidden">IntelShield</span>
          <span className="ml-auto lg:ml-0">
            <Bell />
          </span>
          <span className="hidden lg:inline">{me.user.full_name}</span>
          <Link href="/doi-mat-khau" className="hidden text-teal-700 hover:underline lg:inline">
            Đổi mật khẩu
          </Link>
          <button onClick={logout} className="hidden text-slate-500 hover:text-slate-900 lg:inline">
            Đăng xuất
          </button>
        </header>
        {me.user.must_change_password && (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:px-6">
            Bạn đang dùng mật khẩu do người khác đặt.{' '}
            <Link href="/doi-mat-khau" className="font-medium underline">
              Đổi mật khẩu ngay
            </Link>
            .
          </div>
        )}
        {me.user.user_type === 'guard' && <AppFirst />}
        <main className="p-3 sm:p-6">{allowed(pathname, can) ? children : <NotAllowed />}</main>
      </div>
    </div>
  );
}

/** Where the Android app is downloaded: the project's GitHub releases unless the build says otherwise. */
const APP_URL = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL || 'https://github.com/oldcyborg/intelshield/releases';
const APP_FIRST_KEY = 'patrol.app-first.hidden';

/**
 * Guards and team leaders do their field work in the app: the server refuses clock-in, patrol scans and the
 * rest without an approved phone, so a web page offering those buttons would only fail. This says where they live.
 * Hiding it is remembered per browser; storage can throw in a private window, so it is wrapped.
 */
function AppFirst() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(APP_FIRST_KEY) === '1');
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(APP_FIRST_KEY, '1');
    } catch {
      // Not remembered; it simply shows again next time.
    }
  };
  return (
    <div className="flex items-start gap-3 border-b border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 sm:px-6">
      <span className="flex-1">
        Chấm công, tuần tra, báo sự cố, sổ trực và giao ca làm trên <b>ứng dụng IntelShield</b> trong điện thoại. Trên web bạn xem được ca trực,
        lương, hợp đồng và đơn từ của mình.{' '}
        <Link href="/huong-dan" className="font-medium underline">
          Xem video
        </Link>
        {' · '}
        <a href={APP_URL} target="_blank" rel="noreferrer" className="font-medium underline">
          Tải ứng dụng
        </a>
      </span>
      <button aria-label="Ẩn thông báo" onClick={hide} className="rounded px-1.5 leading-none text-sky-700 hover:bg-sky-100">
        ✕
      </button>
    </div>
  );
}
