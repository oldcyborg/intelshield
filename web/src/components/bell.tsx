'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { stamp } from '@/lib/format';
import { NotificationItem } from '@/lib/types';

/**
 * Unread count plus the latest notifications. The server pushes each one over SSE the moment it is
 * written; a slow poll covers proxies that buffer the stream and the gap while it reconnects.
 */
export function Bell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await api<{ items: NotificationItem[]; unread: number }>('/me/notifications');
    setItems(data.items);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const poll = setInterval(() => load().catch(() => undefined), 60_000);
    let stream: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 2_000;
    let stopped = false;
    const connect = () => {
      stream = new EventSource('/api/me/events');
      stream.onopen = () => { delay = 2_000; };
      stream.onmessage = (message) => {
        const event = JSON.parse(message.data) as { type?: string; title?: string; priority?: string } | undefined;
        if (event?.type !== 'notification') return;
        load().catch(() => undefined);
        if (event.priority === 'critical') setAlert(event.title ?? 'Sự cố khẩn cấp');
      };
      stream.onerror = () => {
        // The browser retries dropped streams itself, but a 401 (expired access token) closes it for good:
        // an ordinary request refreshes the session, then the stream is opened again.
        if (stopped || stream?.readyState !== EventSource.CLOSED) return;
        retry = setTimeout(() => { load().catch(() => undefined).finally(() => { if (!stopped) connect(); }); }, delay);
        delay = Math.min(delay * 2, 60_000);
      };
    };
    connect();
    return () => { stopped = true; clearInterval(poll); clearTimeout(retry); stream?.close(); };
  }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function go(n: NotificationItem) {
    setOpen(false);
    if (!n.read_at) await api(`/me/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    load().catch(() => undefined);
    if (n.data?.incident_id) router.push(`/su-co/${n.data.incident_id}`);
  }

  return (
    <div ref={box} className="relative">
      {alert && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-4 bg-red-600 px-4 py-3 text-white">
          <b>{alert}</b>
          <Link href="/su-co?status=new" onClick={() => setAlert(null)} className="rounded bg-white px-2 py-1 text-sm text-red-700">Xem ngay</Link>
          <button onClick={() => setAlert(null)} className="text-sm underline">Ẩn</button>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="relative rounded px-2 py-1 hover:bg-slate-100" aria-label="Thông báo">
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <b className="text-sm">Thông báo</b>
            {unread > 0 && (
              <button onClick={() => api('/me/notifications/read-all', { method: 'POST' }).then(load).catch(() => undefined)} className="text-xs text-teal-700 hover:underline">
                Đánh dấu đã đọc hết
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
            {items.map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${n.read_at ? 'text-slate-500' : ''}`}>
                  <div className={n.read_at ? '' : 'font-medium'}>
                    {n.priority === 'critical' && <span className="mr-1 text-red-600">●</span>}
                    {n.title}
                  </div>
                  {n.body && <div className="truncate text-xs text-slate-500">{n.body}</div>}
                  <div className="text-xs text-slate-400">{stamp(n.created_at)}</div>
                </button>
              </li>
            ))}
            {!items.length && <li className="px-3 py-6 text-center text-slate-400">Chưa có thông báo</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
