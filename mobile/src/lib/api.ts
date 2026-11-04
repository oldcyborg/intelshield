export interface Session {
  access_token: string;
  refresh_token: string;
}

export interface TokenStore {
  get(): Promise<Session | null>;
  set(session: Session | null): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** No connection, or the server could not be reached at all. */
export class NetworkError extends Error {
  constructor() {
    super('Không có mạng — sẽ gửi lại khi có sóng');
  }
}

type Init = { method?: string; json?: unknown; body?: FormData };
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

type RefreshResult = 'ok' | 'invalid' | 'unreachable';

export class ApiClient {
  private refreshing: Promise<RefreshResult> | null = null;
  /** Bumped on every sign-out: a refresh that started before it must not write tokens back. */
  private generation = 0;
  onSignedOut?: () => void;

  constructor(
    private readonly base: string,
    private readonly store: TokenStore,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  async request<T = unknown>(path: string, init: Init = {}, retry = true): Promise<T> {
    const session = await this.store.get();
    const headers: Record<string, string> = { 'X-Client': 'mobile' };
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    if (session) headers.Authorization = `Bearer ${session.access_token}`;
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method: init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET'),
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401 && retry && session && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
      const outcome = await this.refresh(session.refresh_token);
      if (outcome === 'ok') return this.request<T>(path, init, false);
      // Weak signal is not a reason to throw the guard out: only a refused refresh signs out.
      if (outcome === 'unreachable') throw new NetworkError();
      await this.signOut();
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Có lỗi xảy ra', res.status, body?.error?.details);
    return body.data as T;
  }

  /**
   * One refresh for everyone who hit 401 at once. A request that read the token before another refresh
   * finished just retries with the new one: presenting a used refresh token again ends the session.
   */
  private refresh(used: string): Promise<RefreshResult> {
    // Claimed synchronously: two callers in the same tick must share one refresh.
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = (async (): Promise<RefreshResult> => {
      try {
        const now = await this.store.get();
        if (!now) return 'invalid';
        if (now.refresh_token !== used) return 'ok';
        let res: Response;
        try {
          res = await this.fetchFn(`${this.base}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
            body: JSON.stringify({ refresh_token: used }),
          });
        } catch {
          return 'unreachable';
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
        if (!res.ok) return 'unreachable';
        const body = await res.json();
        if (generation !== this.generation) return 'invalid';
        await this.store.set({ access_token: body.data.access_token, refresh_token: body.data.refresh_token });
        return 'ok';
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async login<U>(identifier: string, password: string, device: { device_id: string; platform: string; label: string }): Promise<U> {
    const data = await this.request<Session & { user: U }>('/auth/login', {
      json: { identifier, password, device_id: device.device_id, platform: device.platform, device_label: device.label },
    });
    await this.store.set({ access_token: data.access_token, refresh_token: data.refresh_token });
    return data.user;
  }

  /** Ends the server session too (refreshing once if the access token has expired), then forgets the tokens. */
  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch {
      // Signing out locally matters more than telling the server.
    }
    this.generation += 1;
    await this.store.set(null);
  }

  async upload(file: Blob, name: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append('file', file, name);
    return this.request('/files', { body: form });
  }

  /** A protected file as a Blob (images on the app always go through the session). */
  async blob(path: string, retry = true): Promise<Blob> {
    const session = await this.store.get();
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, { headers: { 'X-Client': 'mobile', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) } });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401 && retry && session && (await this.refresh(session.refresh_token)) === 'ok') return this.blob(path, false);
    if (!res.ok) throw new ApiError('FILE_UNAVAILABLE', 'Không tải được ảnh', res.status);
    return res.blob();
  }

  async hasSession(): Promise<boolean> {
    return Boolean(await this.store.get());
  }

  private async signOut() {
    this.generation += 1;
    await this.store.set(null);
    this.onSignedOut?.();
  }
}
