import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { OfflineQueue } from './queue';

let n = 0;
const fresh = (api: object) => new OfflineQueue(api as never, `timed-queue-${++n}`);

describe('OfflineQueue — when things happened', () => {
  it('sends the moment it was done, and says it was offline only when it went out late', async () => {
    const bodies: Record<string, unknown>[] = [];
    const q = fresh({ request: vi.fn(async (_p: string, init: { json: Record<string, unknown> }) => { bodies.push(init.json); return {}; }), upload: vi.fn() });
    const item = await q.add({ kind: 'scan', label: 'A', path: '/a', json: { x: 1 }, timed: true });
    await q.flush();
    expect(bodies[0]).toEqual({ x: 1, device_time: item.created_at, captured_offline: false });

    const late = fresh({ request: vi.fn(async (_p: string, init: { json: Record<string, unknown> }) => { bodies.push(init.json); return {}; }), upload: vi.fn() });
    const old = await late.add({ kind: 'scan', label: 'B', path: '/b', json: {}, timed: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(old.created_at) + 5 * 60_000));
    await late.flush();
    vi.useRealTimers();
    expect(bodies[1]).toEqual({ device_time: old.created_at, captured_offline: true });
  });

  it('counts "already done" answers as sent', async () => {
    const q = fresh({ request: vi.fn(async () => { throw new ApiError('LOGBOOK_ALREADY_EXITED', 'Đã ghi giờ ra rồi', 409); }), upload: vi.fn() });
    await q.add({ kind: 'exit', label: 'Ra', path: '/x', json: {}, okCodes: ['LOGBOOK_ALREADY_EXITED'] });
    expect(await q.flush()).toEqual({ sent: 1, failed: 0, left: 0 });
  });

  it('keeps what the screen needs to show "waiting" on the right checkpoint', async () => {
    const q = fresh({ request: vi.fn(), upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {}, meta: { round_id: 'r1', checkpoint_id: 'c1' } });
    expect((await q.list())[0].meta).toEqual({ round_id: 'r1', checkpoint_id: 'c1' });
  });
});
