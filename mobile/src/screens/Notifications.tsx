import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { stamp } from '../lib/format';
import { routeFor } from '../lib/nav';
import { useAuth } from '../lib/auth';
import { useUnread } from '../lib/unread';

interface Item {
  id: string;
  type: string;
  title: string;
  body: string | null;
  priority: 'normal' | 'high' | 'critical';
  data: Record<string, string>;
  read_at: string | null;
  created_at: string;
}

export function Notifications() {
  const { refresh } = useUnread();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.request<{ items: Item[] }>('/me/notifications')).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function read(n: Item) {
    setOpen(open === n.id ? null : n.id);
    if (!n.read_at) {
      await api.request(`/me/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
      await Promise.all([load(), refresh()]);
    }
    // Open what the notification is about.
    const target = routeFor({ ...(n.data ?? {}), type: n.type }, me?.permissions ?? []);
    if (target !== '/thong-bao') navigate(target);
  }

  return (
    <Screen
      title="Thông báo"
      back
      action={items.some((n) => !n.read_at) ? (
        <button className="text-sm underline" onClick={async () => { await api.request('/me/notifications/read-all', { method: 'POST' }).catch(() => undefined); await Promise.all([load(), refresh()]); }}>Đọc hết</button>
      ) : undefined}
    >
      <ErrorText error={error} />
      {items.map((n) => (
        <Card key={n.id} className={n.priority === 'critical' && !n.read_at ? 'border-red-400 bg-red-50' : ''}>
          <button className="w-full text-left" onClick={() => void read(n)}>
            <div className={`text-lg ${n.read_at ? 'text-slate-600' : 'font-semibold'}`}>{n.priority === 'critical' && '🚨 '}{n.title}</div>
            <div className="text-sm text-slate-400">{stamp(n.created_at)}</div>
            {(open === n.id || !n.read_at) && n.body && <p className="mt-1 text-base text-slate-700">{n.body}</p>}
          </button>
        </Card>
      ))}
      {!items.length && !error && <p className="py-10 text-center text-slate-400">Chưa có thông báo</p>}
    </Screen>
  );
}
