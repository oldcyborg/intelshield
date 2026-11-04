import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SosButton } from '../components/SosButton';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cached } from '../lib/cache';
import { api } from '../lib/client';
import { day, localDate, time } from '../lib/format';
import { correctionFor, CORRECTION_STATUS } from '../lib/requests';
import { IncomingHandover } from './TakeHandover';

interface Shift {
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

const HOUR = 3_600_000;

/** What the guard can do with this shift right now (same windows as the backend). */
function nextStep(s: Shift, now: number): 'in' | 'out' | null {
  const start = new Date(s.planned_start).getTime();
  const end = new Date(s.planned_end).getTime();
  if (!s.attendance?.check_in_at) return now >= start - HOUR && now <= end ? 'in' : null;
  if (!s.attendance.check_out_at) return now <= end + 6 * HOUR ? 'out' : null;
  return null;
}

/** The way to ask for a missing or wrong clock-in/out, or where that request stands. */
function CorrectionLine({ s, now }: { s: Shift; now: number }) {
  const ask = correctionFor(s, now);
  if (ask === 'missing') {
    return <Link to={`/don/cham-cong/${s.id}`} className="mt-3 block"><Button tone="secondary">🕒 Bổ sung chấm công</Button></Link>;
  }
  if (s.correction && ['pending', 'proposed_approve', 'proposed_reject'].includes(s.correction)) {
    return <Link to="/don" className="mt-2 block text-sm text-amber-700 underline">Đơn bổ sung chấm công: {CORRECTION_STATUS[s.correction].label.toLowerCase()}</Link>;
  }
  if (ask === 'adjust') return <Link to={`/don/cham-cong/${s.id}`} className="mt-2 block text-sm text-slate-500 underline">Giờ chấm công sai? Xin điều chỉnh</Link>;
  return null;
}

export function Shifts() {
  const navigate = useNavigate();
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const { can } = useAuth();
  const [incoming, setIncoming] = useState<IncomingHandover[]>([]);
  useEffect(() => {
    api.request<IncomingHandover[]>('/me/handovers').then(setIncoming).catch(() => undefined);
  }, [shifts]);

  const load = useCallback(async () => {
    try {
      const r = await cached(`shifts.${localDate(0)}`, () => api.request<Shift[]>(`/me/shifts?from=${localDate(-2)}&to=${localDate(1)}`));
      setShifts(r.data);
      setOfflineAt(r.offline ? r.at : null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const now = Date.now();
  const live = (shifts ?? []).filter((s) => new Date(s.planned_end).getTime() + 6 * HOUR > now);
  const past = (shifts ?? []).filter((s) => !live.includes(s));

  return (
    <Screen title="Ca trực" action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      {offlineAt && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Không có mạng — đang dùng lịch ca lúc {time(offlineAt)}. Tuần tra và sổ trực vẫn ghi được.</p>}
      <ErrorText error={error} />
      {incoming.map((h) => (
        <Link key={h.id} to={`/nhan-ca/${h.id}`} className="block">
          <Card className="border-amber-400 bg-amber-50">
            <b className="text-lg">📋 {h.from_name} giao ca cho bạn</b>
            <div className="text-base text-amber-800">Kiểm tra và xác nhận biên bản →</div>
          </Card>
        </Link>
      ))}
      {shifts && !shifts.length && <p className="py-10 text-center text-slate-500">Bạn chưa được xếp ca nào từ hôm kia tới ngày mai.</p>}
      {live.map((s) => {
        const step = nextStep(s, now);
        const a = s.attendance;
        return (
          <Card key={s.id} className={step ? 'border-teal-400' : ''}>
            <div className="text-sm capitalize text-slate-500">{day(s.planned_start)}</div>
            <div className="text-2xl font-semibold">{time(s.planned_start)} – {time(s.planned_end)}</div>
            <div className="text-lg">{s.site_name}{s.template_name ? ` · ${s.template_name}` : ''}</div>
            {s.site_address && <div className="text-sm text-slate-500">{s.site_address}</div>}
            {a?.check_in_at && (
              <div className="mt-2 text-base">
                Vào ca {time(a.check_in_at)}{a.late_minutes ? <span className="text-amber-700"> (trễ {a.late_minutes} phút)</span> : null}
                {a.check_out_at && <> · Ra ca {time(a.check_out_at)}</>}
              </div>
            )}
            {step && (
              <Button className="mt-3" tone={step === 'in' ? 'primary' : 'secondary'} onClick={() => navigate(`/check/${s.id}/${step}`)}>
                {step === 'in' ? 'Vào ca' : 'Ra ca'}
              </Button>
            )}
            <CorrectionLine s={s} now={now} />
            {now >= new Date(s.planned_start).getTime() - HOUR && now <= new Date(s.planned_end).getTime() + 2 * HOUR && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {can('patrol.perform') && <Link to="/tuan-tra"><Button tone="secondary">🚶 Tuần tra</Button></Link>}
                {can('logbook.write') && <Link to={`/so-truc/${s.site_id}`}><Button tone="secondary">📖 Sổ trực</Button></Link>}
                {can('incident.report') && <Link to={`/bao-su-co?site=${s.site_id}`}><Button tone="secondary">⚠️ Báo sự cố</Button></Link>}
                {can('contact.view.guard') && <Link to={`/lien-he/${s.site_id}`}><Button tone="secondary">📇 Đầu mối</Button></Link>}
                {can('logbook.write') && a?.check_in_at && Math.abs(now - new Date(s.planned_end).getTime()) <= 2 * HOUR && (
                  <Link to={`/giao-ca/${s.site_id}/${s.id}`}><Button tone="secondary">🔁 Giao ca</Button></Link>
                )}
              </div>
            )}
          </Card>
        );
      })}
      {past.length > 0 && <h2 className="pt-2 text-sm font-semibold uppercase text-slate-400">Đã qua</h2>}
      {past.map((s) => (
        <Card key={s.id} className="opacity-70">
          <div className="text-sm capitalize text-slate-500">{day(s.planned_start)}</div>
          <div className="text-lg">{time(s.planned_start)} – {time(s.planned_end)} · {s.site_name}</div>
          <div className="text-sm text-slate-500">
            {s.attendance?.check_in_at ? `Vào ${time(s.attendance.check_in_at)}${s.attendance.check_out_at ? ` · Ra ${time(s.attendance.check_out_at)}` : ' · chưa ra ca'}` : 'Không vào ca'}
            {s.attendance?.corrected && ' · đã điều chỉnh'}
          </div>
          <CorrectionLine s={s} now={now} />
        </Card>
      ))}
      {can('incident.report') && <div className="pt-4"><SosButton /></div>}
    </Screen>
  );
}
