import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { queue } from '../lib/client';
import { stamp, time } from '../lib/format';
import { ROUND_STATUS } from '../lib/labels';
import { loadMyRounds, MyRound, roundWindow } from '../lib/rounds';

export function MyRounds() {
  const [rounds, setRounds] = useState<MyRound[] | null>(null);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await loadMyRounds();
      setRounds(r.rounds);
      setOfflineAt(r.offline ? r.at : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
    const counts: Record<string, number> = {};
    for (const i of await queue.list()) if (i.meta?.round_id) counts[i.meta.round_id] = (counts[i.meta.round_id] ?? 0) + 1;
    setWaiting(counts);
  }, []);
  useEffect(() => {
    void load();
    const off = queue.subscribe(() => void load());
    return off;
  }, [load]);

  const now = Date.now();
  const groups = [
    { title: 'Đang mở', items: (rounds ?? []).filter((r) => roundWindow(r, now) === 'open') },
    { title: 'Sắp tới', items: (rounds ?? []).filter((r) => roundWindow(r, now) === 'early') },
    { title: 'Đã qua', items: (rounds ?? []).filter((r) => roundWindow(r, now) === 'over') },
  ];

  return (
    <Screen title="Tuần tra" back action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      {offlineAt && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Không có mạng — đang dùng danh sách lúc {stamp(offlineAt)}</p>}
      <ErrorText error={error} />
      {rounds && !rounds.length && <p className="py-10 text-center text-slate-500">Hôm nay ca của bạn không có vòng tuần nào.</p>}
      {groups.map((g) => g.items.length > 0 && (
        <div key={g.title} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-slate-500">{g.title}</h2>
          {g.items.map((r) => (
            <Link key={r.id} to={`/tuan-tra/${r.id}`} className="block">
              <Card className={g.title === 'Đang mở' ? 'border-teal-400' : ''}>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-semibold">{time(r.expected_start)}–{time(r.expected_end)}</span>
                  <Badge tone={ROUND_STATUS[r.status]?.tone ?? ''}>{ROUND_STATUS[r.status]?.label}</Badge>
                </div>
                <div className="text-base">{r.route_name} · {r.site_name}</div>
                <div className="text-sm text-slate-500">
                  {r.mine ? `${r.stops.filter((s) => s.scanned_at).length}/${r.stops.length} điểm` : r.employee_name ? `${r.employee_name} đang đi` : `${r.stops.length} điểm`}
                  {waiting[r.id] ? <span className="text-amber-700"> · {waiting[r.id]} chờ gửi</span> : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ))}
    </Screen>
  );
}
