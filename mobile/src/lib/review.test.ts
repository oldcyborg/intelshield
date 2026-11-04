import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, NetworkError, Session, TokenStore } from './api';
import { OfflineQueue } from './queue';

class MemoryStore implements TokenStore {
  constructor(public value: Session | null) {}
  async get() { return this.value; }
  async set(s: Session | null) { this.value = s; }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unauthorized = () => json(401, { error: { code: 'AUTH_UNAUTHENTICATED', message: 'Chưa đăng nhập' } });
let n = 0;
const fresh = (api: object) => new OfflineQueue(api as never, `review-queue-${++n}`);

describe('Plan 09a review — session', () => {
  it('keeps the guard signed in when the refresh cannot reach the server', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
      return unauthorized();
    });
    const api = new ApiClient('http://x/api', store, fetchFn);
    const signedOut = vi.fn();
    api.onSignedOut = signedOut;
    await expect(api.request('/a')).rejects.toBeInstanceOf(NetworkError);
    expect(store.value).toEqual({ access_token: 'old', refresh_token: 'R1' });
    expect(signedOut).not.toHaveBeenCalled();

    const busy = new ApiClient('http://x/api', store, vi.fn(async (url: string) => (url.endsWith('/auth/refresh') ? json(503, {}) : unauthorized())));
    await expect(busy.request('/a')).rejects.toBeInstanceOf(NetworkError);
    expect(store.value).not.toBeNull();
  });

  it('does not bring a session back when the user signs out during a refresh', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        await gate;
        return json(200, { data: { access_token: 'new', refresh_token: 'R2' } });
      }
      if (url.endsWith('/auth/logout')) return json(200, { data: { ok: true } });
      return unauthorized();
    });
    const api = new ApiClient('http://x/api', store, fetchFn);
    const pending = api.request('/a').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    const out = api.logout();
    release();
    await Promise.all([pending, out]);
    expect(store.value).toBeNull();
  });
});

describe('Plan 09a review — offline queue', () => {
  it('never loses an item added while a run is in progress', async () => {
    let q!: OfflineQueue;
    const sent: string[] = [];
    const request = vi.fn(async (path: string) => {
      if (path === '/a') await q.add({ kind: 'x', label: 'C', path: '/c', json: {} });
      sent.push(path);
      return {};
    });
    q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'x', label: 'A', path: '/a', json: {} });
    await q.flush();
    await q.flush();
    expect(sent).toEqual(['/a', '/c']);
    expect(await q.list()).toEqual([]);
  });

  it('keeps everything when the session is gone, instead of marking it failed', async () => {
    const q = fresh({ request: vi.fn(async () => { throw new ApiError('AUTH_UNAUTHENTICATED', 'Chưa đăng nhập', 401); }), upload: vi.fn() });
    await q.add({ kind: 'x', label: 'A', path: '/a', json: {} });
    await q.add({ kind: 'x', label: 'B', path: '/b', json: {} });
    expect(await q.flush()).toEqual({ sent: 0, failed: 0, left: 2 });
    expect(await q.failed()).toEqual([]);
  });

  it('sets an item aside after five server errors so the rest can go', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/broken') throw new ApiError('INTERNAL_ERROR', 'Lỗi máy chủ', 500);
      return {};
    });
    const q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'x', label: 'Broken', path: '/broken', json: {} });
    await q.add({ kind: 'x', label: 'Fine', path: '/fine', json: {} });
    for (let i = 0; i < 5; i++) await q.flush();
    expect((await q.failed()).map((x) => x.label)).toEqual(['Broken']);
    expect(await q.list()).toEqual([]);
    expect(request).toHaveBeenLastCalledWith('/fine', expect.anything());
  });

  it('puts a retried item back in its place in time, and can be emptied on sign-out', async () => {
    const q = fresh({ request: vi.fn(async () => { throw new ApiError('PATROL_ROUND_CLOSED', 'Đã quá giờ', 409); }), upload: vi.fn() });
    await q.add({ kind: 'x', label: 'First', path: '/1', json: {} });
    await q.flush();
    const blocked = fresh({ request: vi.fn(async () => { throw new NetworkError(); }), upload: vi.fn() });
    void blocked;
    const [first] = await q.failed();
    await q.add({ kind: 'x', label: 'Second', path: '/2', json: {} });
    await q.retry(first.id);
    expect((await q.list()).map((x) => x.label)).toEqual(['First', 'Second']);
    await q.clear();
    expect([await q.list(), await q.failed()]).toEqual([[], []]);
  });
});
