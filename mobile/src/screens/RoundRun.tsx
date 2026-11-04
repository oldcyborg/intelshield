import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorText, Screen } from '../components/ui';
import { queue } from '../lib/client';
import { stamp, time } from '../lib/format';
import { ROUND_STATUS, SCAN_FLAG } from '../lib/labels';
import { Fix, getPosition, takePhoto } from '../lib/native';
import { distanceM, parseTag, progress, StopState, stopStates } from '../lib/patrol';
import { newClientId, QueueItem, storePhoto } from '../lib/queue';
import { loadMyRounds, MyRound, RoundStop, roundWindow } from '../lib/rounds';
import { scanQr } from '../lib/scanner';

/** A position if the phone can give one within a few seconds; a QR scan never waits long for GPS. */
async function quickFix(): Promise<Fix | null> {
  return Promise.race([getPosition().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8_000))]);
}

const STATE_LABEL: Record<StopState, { text: string; tone: string }> = {
  done: { text: '✓ Đã xác nhận', tone: 'text-teal-700' },
  queued: { text: '⏳ Chờ gửi', tone: 'text-amber-700' },
  todo: { text: 'Chưa', tone: 'text-slate-400' },
};

export function RoundRun() {
  const { id } = useParams<{ id: string }>();
  const [round, setRound] = useState<MyRound | null>(null);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [pending, setPending] = useState<QueueItem[]>([]);
  const [refused, setRefused] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [loaded, setLoaded] = useState(false);

  /** What waits on this phone first (instant), then the server's view of the round. */
  const load = useCallback(async () => {
    setPending((await queue.list()).filter((i) => i.meta?.round_id === id));
    setRefused((await queue.failed()).filter((i) => i.meta?.round_id === id));
    try {
      const r = await loadMyRounds();
      setRound(r.rounds.find((x) => x.id === id) ?? null);
      setOfflineAt(r.offline ? r.at : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setLoaded(true);
    }
  }, [id]);
  useEffect(() => {
    void load();
    return queue.subscribe(() => void load());
  }, [load]);

  if (!round) {
    return (
      <Screen title="Vòng tuần" back>
        <ErrorText error={error ?? (loaded ? 'Không thấy vòng này trong ca của bạn (hoặc chưa tải khi còn mạng)' : null)} />
      </Screen>
    );
  }

  const queuedCps = pending.filter((i) => i.kind === 'scan').map((i) => i.meta!.checkpoint_id);
  const states = stopStates(round.stops, queuedCps);
  const done = progress(round.stops, states);
  const phase = roundWindow(round);
  const takenByOther = Boolean(round.employee_id) && !round.mine;
  const finishing = pending.some((i) => i.kind === 'finish');
  const canAct = phase === 'open' && !takenByOther && !finishing;

  /** Kept on the phone first, then sent: what the guard did is never lost to a dead spot. */
  async function confirm(stop: RoundStop, method: 'qr' | 'gps' | 'photo', fix: Fix | null, payload?: string) {
    let photo: Blob | null = null;
    if (method === 'photo' || stop.photo_required) {
      setNotice(`Chụp ảnh tại ${stop.code} · ${stop.name}`);
      photo = await takePhoto('rear');
    }
    await queue.add({
      kind: 'scan',
      label: `${round!.route_name} ${time(round!.expected_start)} · ${stop.code}`,
      path: `/patrol/rounds/${round!.id}/scans`,
      json: {
        client_uuid: newClientId(), method, checkpoint_id: stop.checkpoint_id, mock_location: false,
        ...(payload ? { qr_payload: payload } : {}),
        ...(fix ? { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m } : {}),
      },
      photos: photo ? [{ field: 'photo_file_id', many: false, files: [await storePhoto(photo)] }] : undefined,
      timed: true,
      // A second copy of the same confirmation (a resend) is not an error.
      okCodes: ['PATROL_ALREADY_SCANNED'],
      meta: { round_id: round!.id, checkpoint_id: stop.checkpoint_id },
    });
    setPending((await queue.list()).filter((i) => i.meta?.round_id === round!.id));
    setNotice(`Đã ghi ${stop.code} · ${stop.name}`);
    void queue.flush().then(() => load());
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  const scan = () => act(async () => {
    const payload = await scanQr();
    const cp = parseTag(payload);
    if (!cp) throw new Error('Đây không phải tem điểm tuần tra của công ty');
    const stop = round.stops.find((s) => s.checkpoint_id === cp);
    if (!stop) throw new Error('Mã này không thuộc vòng tuần này');
    if (states[cp] !== 'todo') throw new Error(`${stop.code} đã được xác nhận rồi`);
    if (!stop.allowed_methods.includes('qr')) throw new Error(`${stop.code} không xác nhận bằng QR`);
    setNotice('Đang lấy vị trí…');
    await confirm(stop, 'qr', await quickFix(), payload);
  });

  const byGps = (stop: RoundStop) => act(async () => {
    setNotice('Đang lấy vị trí…');
    const fix = await getPosition();
    if (stop.lat && stop.lng) {
      const d = distanceM({ lat: Number(stop.lat), lng: Number(stop.lng) }, fix);
      if (d > stop.radius_m && !window.confirm(`Bạn đang cách ${stop.code} khoảng ${d} m (cho phép ${stop.radius_m} m). Vẫn xác nhận? Lần quét sẽ bị đánh dấu để đội trưởng xem.`)) {
        setNotice(null);
        return;
      }
    }
    await confirm(stop, 'gps', fix);
  });

  const byPhoto = (stop: RoundStop) => act(async () => {
    setNotice('Đang lấy vị trí…');
    await confirm(stop, 'photo', await quickFix());
  });

  const finish = () => act(async () => {
    if (done.done < done.required && !window.confirm(`Còn ${done.required - done.done} điểm bắt buộc chưa xác nhận. Vẫn kết thúc vòng?`)) return;
    await queue.add({ kind: 'finish', label: `Kết thúc vòng ${time(round.expected_start)}`, path: `/patrol/rounds/${round.id}/finish`, json: {}, timed: true, meta: { round_id: round.id } });
    setNotice('Đã ghi kết thúc vòng');
    void queue.flush().then(() => load());
  });

  return (
    <Screen title={`${time(round.expected_start)}–${time(round.expected_end)}`} back>
      {offlineAt && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Không có mạng — vẫn quét bình thường, máy sẽ tự gửi khi có sóng.</p>}
      <Card>
        <div className="flex items-center justify-between">
          <b className="text-lg">{round.route_name}</b>
          <Badge tone={ROUND_STATUS[round.status]?.tone ?? ''}>{ROUND_STATUS[round.status]?.label}</Badge>
        </div>
        <div className="text-slate-600">{round.site_name}</div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-teal-600" style={{ width: `${done.required ? (100 * done.done) / done.required : 0}%` }} /></div>
        <div className="mt-1 text-sm text-slate-500">{done.done}/{done.required} điểm bắt buộc</div>
        {takenByOther && <p className="mt-2 text-amber-700">Vòng này do {round.employee_name} đi.</p>}
        {phase === 'early' && <p className="mt-2 text-slate-600">Chưa đến giờ — mở từ 10 phút trước {time(round.expected_start)}.</p>}
        {phase === 'over' && !round.ended_at && <p className="mt-2 text-red-700">Đã quá giờ của vòng này.</p>}
      </Card>

      <ErrorText error={error} />
      {notice && <p className="rounded-lg bg-teal-50 p-3 text-base text-teal-800">{notice}</p>}
      {refused.map((i) => (
        <p key={i.id} className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Không được nhận: {i.label} — {i.error} (xem ở trang Tôi)</p>
      ))}

      {canAct && round.stops.some((s) => s.allowed_methods.includes('qr')) && (
        <Button onClick={() => void scan()} disabled={busy} className="py-5 text-xl">📷 Quét mã QR</Button>
      )}

      {round.stops.map((s) => {
        const state = states[s.checkpoint_id];
        return (
          <Card key={s.checkpoint_id} className={state === 'todo' ? '' : 'opacity-80'}>
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{s.seq}. {s.code} · {s.name}</span>
              <span className={`text-sm ${STATE_LABEL[state].tone}`}>{STATE_LABEL[state].text}</span>
            </div>
            <div className="text-sm text-slate-500">
              {s.allowed_methods.filter((m) => m !== 'nfc').map((m) => ({ qr: 'QR', gps: 'GPS', photo: 'Ảnh' }[m])).join(' / ')}
              {s.photo_required && ' · cần chụp ảnh'}{!s.required && ' · không bắt buộc'}
              {s.scanned_at && ` · lúc ${time(s.scanned_at)}`}
            </div>
            {s.flags.length > 0 && <div className="text-sm text-red-700">⚠ {s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</div>}
            {canAct && state === 'todo' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {s.allowed_methods.includes('gps') && <Button tone="secondary" disabled={busy} onClick={() => void byGps(s)}>📍 Xác nhận GPS</Button>}
                {s.allowed_methods.includes('photo') && <Button tone="secondary" disabled={busy} onClick={() => void byPhoto(s)}>📸 Chụp ảnh</Button>}
              </div>
            )}
          </Card>
        );
      })}

      {canAct && (round.started_at || pending.length > 0) && (
        <Button tone="secondary" onClick={() => void finish()} disabled={busy}>Kết thúc vòng</Button>
      )}
      {finishing && <p className="text-center text-sm text-amber-700">Đã ghi kết thúc vòng — chờ gửi</p>}
      {offlineAt && <p className="text-center text-xs text-slate-400">Danh sách lúc {stamp(offlineAt)}</p>}
    </Screen>
  );
}
