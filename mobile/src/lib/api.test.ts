import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, NetworkError, Session, TokenStore } from './api';

class MemoryStore implements TokenStore {
  constructor(public value: Session | null) {}
  async get() { return this.value; }
  async set(s: Session | null) { this.value = s; }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiClient', () => {
  it('sends Bearer and X-Client: mobile, and unwraps {data}', async () => {
    const fetchFn = vi.fn(async () => json(200, { data: { ok: 1 } }));
    const api = new ApiClient('http://x/api', new MemoryStore({ access_token: 'A', refresh_token: 'R' }), fetchFn);
    expect(await api.request('/me')).toEqual({ ok: 1 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://x/api/me');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer A', 'X-Client': 'mobile' });
  });

  it('refreshes once for many requests that hit 401 together, then retries them', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    let refreshes = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return json(200, { data: { access_token: 'new', refresh_token: 'R2' } });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, { data: url }) : json(401, { error: { code: 'AUTH_UNAUTHENTICATED', message: 'x' } });
    });
    const api = new ApiClient('http://x/api', store, fetchFn);
    const results = await Promise.all([api.request('/a'), api.request('/b'), api.request('/c')]);
    expect(results).toEqual(['http://x/api/a', 'http://x/api/b', 'http://x/api/c']);
    expect(refreshes).toBe(1);
    expect(store.value).toEqual({ access_token: 'new', refresh_token: 'R2' });
  });

  it('does not send an old refresh token again after someone else refreshed', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    const sent: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        sent.push(JSON.parse(String(init?.body)).refresh_token);
        return json(200, { data: { access_token: 'new', refresh_token: 'R2' } });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, { data: 1 }) : json(401, { error: { code: 'X', message: 'x' } });
    });
    const api = new ApiClient('http://x/api', store, fetchFn);
    await api.request('/a');
    // A request that read the old token before the refresh finished gets a 401 now:
    store.value = { access_token: 'new', refresh_token: 'R2' };
    await (api as unknown as { refresh: (used: string) => Promise<boolean> }).refresh('R1');
    expect(sent).toEqual(['R1']);
  });

  it('signs out when the refresh is refused', async () => {
    const store = new MemoryStore({ access_token: 'old', refresh_token: 'R1' });
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh') ? json(401, { error: { code: 'AUTH_REFRESH_INVALID', message: 'x' } }) : json(401, { error: { code: 'X', message: 'x' } }));
    const api = new ApiClient('http://x/api', store, fetchFn);
    const signedOut = vi.fn();
    api.onSignedOut = signedOut;
    await expect(api.request('/a')).rejects.toBeInstanceOf(ApiError);
    expect(store.value).toBeNull();
    expect(signedOut).toHaveBeenCalled();
  });

  it('turns error envelopes into ApiError and a dead network into NetworkError', async () => {
    const api = new ApiClient('http://x/api', new MemoryStore(null), vi.fn(async () => json(400, { error: { code: 'DEVICE_PENDING', message: 'Máy chờ duyệt', details: [1] } })));
    await expect(api.request('/auth/login', { json: {} })).rejects.toMatchObject({ code: 'DEVICE_PENDING', message: 'Máy chờ duyệt', status: 400, details: [1] });
    const offline = new ApiClient('http://x/api', new MemoryStore(null), vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(offline.request('/x')).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps the tokens from login and forgets them on logout', async () => {
    const store = new MemoryStore(null);
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/auth/login') ? json(200, { data: { access_token: 'A', refresh_token: 'R', user: { id: 'u' } } }) : json(200, { data: { ok: true } }));
    const api = new ApiClient('http://x/api', store, fetchFn);
    expect(await api.login('0900', 'pw', { device_id: 'd1', platform: 'android', label: 'Pixel' })).toEqual({ id: 'u' });
    expect(store.value).toEqual({ access_token: 'A', refresh_token: 'R' });
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ identifier: '0900', password: 'pw', device_id: 'd1', platform: 'android', device_label: 'Pixel' });
    await api.logout();
    expect(store.value).toBeNull();
  });
});
