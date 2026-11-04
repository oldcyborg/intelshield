import { PointerEvent, useEffect, useRef, useState } from 'react';
import { queue } from '../lib/client';
import { getPosition } from '../lib/native';
import { newClientId } from '../lib/queue';

const HOLD_MS = 2_000;
const FIX_WAIT_MS = 6_000;

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'waiting' } | { kind: 'refused'; reason: string };

/**
 * Hold two seconds. The SOS is kept on the phone the moment the hold completes — nothing is lost if the phone
 * is dropped — then gets the position if the phone finds one within a few seconds, and goes out first in line.
 */
export function SosButton() {
  const [held, setHeld] = useState(0);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const firing = useRef(false);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setHeld(0);
  };
  useEffect(() => stop, []);

  async function fire() {
    if (firing.current) return;
    firing.current = true;
    stop();
    setState({ kind: 'sending' });
    try {
      const item = await queue.add({ kind: 'sos', label: 'SOS', path: '/incidents/sos', json: { client_uuid: newClientId() }, urgent: true, timed: true });
      const fix = await Promise.race([getPosition().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), FIX_WAIT_MS))]);
      if (fix) await queue.patch(item.id, { lat: fix.lat, lng: fix.lng });
      const outcome = await queue.send(item.id);
      setState(outcome.state === 'refused' ? { kind: 'refused', reason: outcome.reason } : { kind: outcome.state });
    } finally {
      firing.current = false;
    }
  }

  function start(e: PointerEvent<HTMLButtonElement>) {
    if (state.kind === 'sending' || timer.current) return;
    // Keep the press even if the finger slides a little: the pointer stays with this button.
    e.currentTarget.setPointerCapture(e.pointerId);
    const began = Date.now();
    timer.current = setInterval(() => {
      const t = Date.now() - began;
      setHeld(Math.min(1, t / HOLD_MS));
      if (t >= HOLD_MS) void fire();
    }, 50);
  }

  if (state.kind === 'sent' || state.kind === 'waiting' || state.kind === 'refused') {
    const ok = state.kind === 'sent';
    return (
      <div className={`rounded-2xl p-4 text-center ${ok ? 'bg-red-50' : 'bg-red-600 text-white'}`}>
        <div className="text-2xl font-bold">{ok ? '🚨 ĐÃ GỬI SOS' : '⚠️ CHƯA GỬI ĐƯỢC SOS'}</div>
        <p className="mt-1 text-base">
          {ok && 'Đội trưởng và quản lý đã được báo. Giữ an toàn, chờ hỗ trợ.'}
          {state.kind === 'waiting' && 'Không có mạng. Máy sẽ tự gửi khi có sóng — GỌI ĐIỆN NGAY cho đội trưởng.'}
          {state.kind === 'refused' && `Hệ thống không nhận: ${state.reason}. GỌI ĐIỆN NGAY cho đội trưởng.`}
        </p>
        <button onClick={() => setState({ kind: 'idle' })} className="mt-2 text-sm underline">Đóng</button>
      </div>
    );
  }

  return (
    <button
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      disabled={state.kind === 'sending'}
      style={{ touchAction: 'none' }}
      className="relative w-full select-none overflow-hidden rounded-2xl bg-red-600 py-5 text-2xl font-bold text-white shadow-lg active:bg-red-700"
    >
      <span className="absolute inset-y-0 left-0 bg-red-900/40" style={{ width: `${held * 100}%` }} />
      <span className="relative">{state.kind === 'sending' ? 'Đang gửi SOS…' : held > 0 ? 'Giữ tiếp…' : 'SOS — giữ 2 giây'}</span>
    </button>
  );
}
