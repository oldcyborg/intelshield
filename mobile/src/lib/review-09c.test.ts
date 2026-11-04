import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './api';
import { OfflineQueue } from './queue';
import { roundWindow } from './rounds';

let n = 0;
const fresh = (api: object) => new OfflineQueue(api as never, `review9c-${++n}`);

describe('Plan 09c review — queue outcomes and urgency', () => {
  it('tells sent, waiting and refused apart', async () => {
    const q = fresh({
      request: vi.fn(async (path: string) => {
        if (path === '/refused') throw new ApiError('INCIDENT_NO_SITE', 'Bạn chưa được điều động', 400);
        if (path === '/offline') throw new NetworkError();
        return {};
      }),
      upload: vi.fn(),
    });
    const sent = await q.add({ kind: 'sos', label: 'A', path: '/ok', json: {} });
    expect(await q.send(sent.id)).toEqual({ state: 'sent' });
    const refused = await q.add({ kind: 'sos', label: 'B', path: '/refused', json: {} });
    expect(await q.send(refused.id)).toEqual({ state: 'refused', reason: 'Bạn chưa được điều động' });
    const waiting = await q.add({ kind: 'sos', label: 'C', path: '/offline', json: {} });
    expect(await q.send(waiting.id)).toEqual({ state: 'waiting' });
  });

  it('sends an SOS before whatever was already waiting', async () => {
    const sent: string[] = [];
    const q = fresh({ request: vi.fn(async (path: string) => { sent.push(path); return {}; }), upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'scan', path: '/scan', json: {} });
    await q.add({ kind: 'sos', label: 'SOS', path: '/sos', json: {}, urgent: true });
    await q.flush();
    expect(sent).toEqual(['/sos', '/scan']);
  });

  it('lets a waiting item gain details (the SOS position) before it goes', async () => {
    const bodies: unknown[] = [];
    const q = fresh({ request: vi.fn(async (_p: string, init: { json: unknown }) => { bodies.push(init.json); return {}; }), upload: vi.fn() });
    const item = await q.add({ kind: 'sos', label: 'SOS', path: '/sos', json: { client_uuid: 'u' }, urgent: true });
    await q.patch(item.id, { lat: 21, lng: 105 });
    await q.flush();
    expect(bodies).toEqual([{ client_uuid: 'u', lat: 21, lng: 105 }]);
  });
});

describe('Plan 09c review — round window like the server', () => {
  const r = { expected_start: '2026-10-14T01:00:00Z', expected_end: '2026-10-14T02:00:00Z', ended_at: null, started_at: null };
  it('lets a round be started only until its window ends', () => {
    expect(roundWindow(r, Date.parse('2026-10-14T00:55:00Z'))).toBe('open');
    expect(roundWindow(r, Date.parse('2026-10-14T02:05:00Z'))).toBe('over');
  });
  it('keeps a started round open for the tolerance after its window', () => {
    expect(roundWindow({ ...r, started_at: '2026-10-14T01:30:00Z' }, Date.parse('2026-10-14T02:10:00Z'))).toBe('open');
    expect(roundWindow({ ...r, started_at: '2026-10-14T01:30:00Z' }, Date.parse('2026-10-14T02:20:00Z'))).toBe('over');
  });
});
