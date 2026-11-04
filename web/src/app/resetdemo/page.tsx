'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface Account {
  role: string;
  name: string;
  phone: string;
  team?: string | null;
}

interface Info {
  exists: boolean;
  company?: string;
  built_at?: string;
  password: string;
  accounts: Account[];
}

const when = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 404 ? 'Link không đúng hoặc trang reset đang tắt.' : body?.error?.message ?? 'Có lỗi xảy ra');
  return body.data as T;
}

function ResetDemo() {
  const key = useSearchParams().get('key') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setInfo(await call<Info>(`/demo?key=${encodeURIComponent(key)}`));
  }, [key]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function reset() {
    if (!window.confirm('Xoá toàn bộ dữ liệu công ty demo và tạo lại từ bây giờ?')) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await call<{ figures: { shifts: number; attendances: number; violations: number } }>('/demo/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
      });
      setDone(`Đã tạo lại: ${r.figures.shifts} ca trực, ${r.figures.attendances} lần chấm công, ${r.figures.violations} vi phạm.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Dữ liệu demo IntelShield</h1>
        <p className="text-sm text-slate-600">
          Công ty demo: 1 giám đốc, 1 quản lý, 2 đội trưởng, 15 bảo vệ · Khách Mỹ Đình Pearl (Toà A, Toà B — mỗi toà 1 đội trưởng + 5 bảo vệ) ·
          Kho Long Biên thuê 5 bảo vệ trả theo tháng · chấm công 30 ngày trước và lịch 7 ngày tới.
        </p>
      </header>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {info && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{info.exists ? info.company : 'Chưa có công ty demo'}</div>
                {info.exists && <div className="text-sm text-slate-500">Tạo lúc {when(info.built_at)}</div>}
              </div>
              <button onClick={() => void reset()} disabled={busy}
                className="rounded-lg bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {busy ? 'Đang tạo lại… (khoảng 10–30 giây)' : 'Reset'}
              </button>
            </div>
            {done && <p className="mt-3 rounded-lg bg-teal-50 p-2 text-sm text-teal-800">{done}</p>}
            <p className="mt-3 text-xs text-slate-500">Reset xoá mọi thứ trong công ty demo (kể cả dữ liệu đã nhập khi dùng thử) rồi tạo lại, ngày giờ tính từ lúc bấm. Không ảnh hưởng công ty khác.</p>
          </section>

          {info.exists && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">Tài khoản đăng nhập</h2>
                <span className="text-sm">Mật khẩu chung: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{info.password}</code></span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500"><tr><th className="py-1.5">Số điện thoại</th><th>Họ tên</th><th>Vai trò</th><th>Đội</th></tr></thead>
                  <tbody>
                    {info.accounts.map((a) => (
                      <tr key={a.phone} className="border-t border-slate-100">
                        <td className="py-1.5 font-mono">{a.phone}</td>
                        <td>{a.name}</td>
                        <td>{a.role}</td>
                        <td className="text-slate-500">{a.team ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Web: đăng nhập ở <a href="/dang-nhap" className="text-teal-700 underline">trang đăng nhập</a>. App: lần đầu đăng nhập trên điện thoại, máy chờ duyệt — giám đốc vào web → Thiết bị để duyệt.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

export default function ResetDemoPage() {
  return (
    <Suspense fallback={<main className="p-8 text-slate-500">Đang tải…</main>}>
      <ResetDemo />
    </Suspense>
  );
}
