import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { SitePicker } from '../components/SitePicker';
import { Badge, Button, Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { localDate, time } from '../lib/format';
import { ATTENDANCE_STATUS, LOGBOOK_TYPE, ROUND_STATUS } from '../lib/labels';

export interface BoardRow {
  id: string;
  employee_name: string;
  employee_code: string;
  template_name: string | null;
  planned_start: string;
  planned_end: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number | null;
  early_minutes: number | null;
  check_in_flags: string[] | null;
  check_out_flags: string[] | null;
  check_in_distance_m: number | null;
  check_in_selfie_id: string | null;
  check_out_selfie_id: string | null;
  late_in: boolean;
  early_out: boolean;
}

interface RoundRow {
  id: string;
  expected_start: string;
  expected_end: string;
  status: string;
  late: boolean;
  employee_name: string | null;
  route_name: string;
  required_count: number;
  done_required: number;
  suspicious_count: number;
  started_at: string | null;
}

interface LogLine {
  id: string;
  type: string;
  body: string | null;
  data: Record<string, string | number | undefined>;
  occurred_at: string;
  exited_at: string | null;
  author_name: string;
  files: { id: string }[];
}

type Part = 'shifts' | 'rounds' | 'book';

const SIX_HOURS = 6 * 3_600_000;

/**
 * Before midday the night shift that began yesterday is still on: fetch both days and keep what is still
 * running or ended less than six hours ago.
 */
export async function recentDays<T>(fetchDay: (day: string) => Promise<T[]>, endOf: (row: T) => string): Promise<T[]> {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(new Date()));
  const today = await fetchDay(localDate(0));
  if (hour >= 12) return today;
  const yesterday = (await fetchDay(localDate(-1))).filter((r) => new Date(endOf(r)).getTime() > Date.now() - SIX_HOURS);
  return [...yesterday, ...today];
}

const lineText = (l: LogLine) => {
  const d = l.data;
  if (l.type === 'visitor') return [d.visitor_name, d.visitor_org && `(${d.visitor_org})`, d.meet_whom && `gặp ${d.meet_whom}`].filter(Boolean).join(' ');
  if (l.type === 'vehicle') return [d.plate, d.vehicle_kind, d.cargo].filter(Boolean).join(' · ');
  if (l.type === 'asset') return [d.item, d.quantity, d.counterpart].filter(Boolean).join(' · ');
  return l.body ?? '';
};

export function Team() {
  const { can } = useAuth();
  const parts = ([
    can('attendance.view') && { key: 'shifts', label: 'Ca trực' },
    can('patrol.view') && { key: 'rounds', label: 'Vòng tuần' },
    can('logbook.view') && { key: 'book', label: 'Sổ trực' },
  ].filter(Boolean) as { key: Part; label: string }[]);
  const [part, setPart] = useState<Part>(parts[0]?.key ?? 'shifts');
  const [siteId, setSiteId] = useState('');
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [rounds, setRounds] = useState<{ summary: Record<string, number>; rounds: RoundRow[] } | null>(null);
  const [book, setBook] = useState<{ inside: LogLine[]; today: LogLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Only the latest request may fill the screen: a slow answer for another site or part is dropped.
  const latest = useRef(0);

  useEffect(() => {
    setBoard(null);
    setRounds(null);
    setBook(null);
  }, [siteId]);

  const load = useCallback(async () => {
    if (!siteId) return;
    const ticket = ++latest.current;
    const day = localDate(0);
    try {
      if (part === 'shifts') {
        const rows = await recentDays(
          async (d) => (await api.request<{ rows: BoardRow[] }>(`/attendance/board?site_id=${siteId}&date=${d}`)).rows,
          (r) => r.planned_end,
        );
        if (ticket === latest.current) setBoard(rows);
      }
      if (part === 'rounds') {
        const days = await recentDays(async (d) => [await api.request<{ summary: Record<string, number>; rounds: RoundRow[] }>(`/patrol/rounds?site_id=${siteId}&date=${d}`)], () => new Date().toISOString());
        const merged = days.flatMap((x) => x.rounds).filter((r) => new Date(r.expected_end).getTime() > Date.now() - SIX_HOURS || days.length === 1);
        const summary: Record<string, number> = {};
        for (const r of merged) summary[r.status] = (summary[r.status] ?? 0) + 1;
        if (ticket === latest.current) setRounds({ summary, rounds: days.length === 1 ? days[0].rounds : merged });
      }
      if (part === 'book') {
        const [inside, today] = await Promise.all([
          api.request<LogLine[]>(`/sites/${siteId}/logbook/inside`),
          api.request<LogLine[]>(`/sites/${siteId}/logbook?date=${day}`),
        ]);
        if (ticket === latest.current) setBook({ inside, today });
      }
      if (ticket === latest.current) setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [siteId, part]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const count = (s: string) => board?.filter((r) => r.status === s).length ?? 0;

  return (
    <Screen title="Đội" action={<button className="text-sm underline" onClick={() => { setReload((n) => n + 1); void load(); }}>Tải lại</button>}>
      <SitePicker value={siteId} onChange={setSiteId} reload={reload} />
      {parts.length > 1 && (
        <div className="flex gap-2">
          {parts.map((p) => (
            <button key={p.key} onClick={() => setPart(p.key)} className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${part === p.key ? 'bg-teal-700 text-white' : 'border border-slate-300 bg-white text-slate-600'}`}>{p.label}</button>
          ))}
        </div>
      )}
      <ErrorText error={error} />

      {part === 'shifts' && board && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card className="p-2"><div className="text-2xl font-semibold text-teal-700">{count('on_duty')}</div><div className="text-sm text-slate-500">Đang trực</div></Card>
            <Card className="p-2"><div className="text-2xl font-semibold text-amber-700">{count('late')}</div><div className="text-sm text-slate-500">Trễ</div></Card>
            <Card className="p-2"><div className="text-2xl font-semibold text-red-700">{count('absent')}</div><div className="text-sm text-slate-500">Vắng</div></Card>
          </div>
          {board.map((r) => (
            <Link key={r.id} to={`/doi/ca/${siteId}/${r.id}`} className="block">
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">{r.employee_name}</span>
                  <Badge tone={ATTENDANCE_STATUS[r.status]?.tone ?? ''}>{ATTENDANCE_STATUS[r.status]?.label ?? r.status}</Badge>
                </div>
                <div className="text-sm text-slate-500">
                  {r.template_name ?? 'Ca lẻ'} {time(r.planned_start)}–{time(r.planned_end)}
                  {r.check_in_at && ` · vào ${time(r.check_in_at)}`}{r.late_in && <span className="text-amber-700"> (trễ {r.late_minutes}′)</span>}
                  {r.check_out_at && ` · ra ${time(r.check_out_at)}`}
                </div>
                {[...(r.check_in_flags ?? []), ...(r.check_out_flags ?? [])].length > 0 && <div className="text-sm text-red-700">⚠ Có dấu hiệu nghi vấn</div>}
              </Card>
            </Link>
          ))}
          {!board.length && <p className="py-6 text-center text-slate-400">Không có ca nào đang hay sắp diễn ra</p>}
        </>
      )}

      {part === 'rounds' && rounds && (
        <>
          {can('patrol.perform') && <Link to="/tuan-tra" className="block"><Button tone="secondary">🚶 Đi tuần</Button></Link>}
          <Card className="grid grid-cols-4 gap-1 p-2 text-center text-sm">
            {(['completed', 'in_progress', 'partial', 'missed'] as const).map((k) => (
              <div key={k}><div className="text-xl font-semibold">{rounds.summary[k] ?? 0}</div><div className="text-slate-500">{ROUND_STATUS[k].label}</div></div>
            ))}
          </Card>
          {rounds.rounds.map((r) => (
            <Link key={r.id} to={`/doi/vong/${r.id}`} className="block">
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">{time(r.expected_start)}–{time(r.expected_end)}</span>
                  <Badge tone={ROUND_STATUS[r.status]?.tone ?? ''}>{ROUND_STATUS[r.status]?.label}</Badge>
                </div>
                <div className="text-sm text-slate-500">{r.route_name} · {r.employee_name ?? 'chưa ai đi'}{r.started_at ? ` · ${r.done_required}/${r.required_count} điểm` : ''}</div>
                {(r.late || r.suspicious_count > 0) && <div className="text-sm text-red-700">{r.late ? 'Bắt đầu trễ. ' : ''}{r.suspicious_count ? `${r.suspicious_count} lần quét nghi vấn` : ''}</div>}
              </Card>
            </Link>
          ))}
          {!rounds.rounds.length && <p className="py-6 text-center text-slate-400">Hôm nay không có vòng tuần</p>}
        </>
      )}

      {part === 'book' && book && (
        <>
          {can('logbook.write') && <Link to={`/so-truc/${siteId}`} className="block"><Button tone="secondary">📖 Ghi sổ trực</Button></Link>}
          {book.inside.length > 0 && (
            <Card>
              <div className="mb-1 font-semibold">Đang ở trong ({book.inside.length})</div>
              {book.inside.map((l) => <div key={l.id} className="border-t border-slate-100 py-1.5 text-base">{LOGBOOK_TYPE[l.type]} · {lineText(l)} <span className="text-sm text-slate-400">vào {time(l.occurred_at)}</span></div>)}
            </Card>
          )}
          {book.today.map((l) => (
            <Card key={l.id}>
              <div className="text-sm text-slate-400">{time(l.occurred_at)} · {LOGBOOK_TYPE[l.type]} · {l.author_name}</div>
              <div className="text-base">{lineText(l)}{l.exited_at && <span className="text-sm text-slate-500"> · ra {time(l.exited_at)}</span>}</div>
              {l.type !== 'note' && l.type !== 'other' && l.body && <div className="text-sm text-slate-600">{l.body}</div>}
              {l.files.length > 0 && <div className="mt-2 flex gap-2">{l.files.map((f) => <AuthImage key={f.id} fileId={f.id} className="h-16 w-16" />)}</div>}
            </Card>
          ))}
          {!book.today.length && <p className="py-6 text-center text-slate-400">Hôm nay chưa ghi sổ</p>}
        </>
      )}
    </Screen>
  );
}
