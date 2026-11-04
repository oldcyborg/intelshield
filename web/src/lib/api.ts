export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const NO_REFRESH = ['/auth/login', '/auth/refresh'];
let refreshing: Promise<boolean> | null = null;

/**
 * One refresh for every request that hit 401 at the same moment. Two parallel
 * refreshes would present the same token twice, and the backend treats a reused
 * refresh token as theft and ends the session.
 */
function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  retry = true,
): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (res.status === 401 && retry && !NO_REFRESH.includes(path)) {
    if (await refreshOnce()) return api<T>(path, init, false);
    if (typeof window !== 'undefined' && window.location.pathname !== '/dang-nhap') {
      window.location.href = '/dang-nhap';
    }
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Có lỗi xảy ra', res.status);
  }
  return body.data as T;
}

/** Upload one file; the server checks its real type and size. Returns its id to attach elsewhere. */
export async function uploadFile(file: File): Promise<import('./types').FileView> {
  const form = new FormData();
  form.append('file', file);
  return api('/files', { method: 'POST', body: form });
}
