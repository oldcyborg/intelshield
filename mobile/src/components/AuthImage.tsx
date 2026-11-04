import { useEffect, useState } from 'react';
import { api } from '../lib/client';

const LIMIT = 40;
const cache = new Map<string, string>();

function remember(id: string, url: string) {
  cache.set(id, url);
  // Cheap phones have little memory: keep the most recent images only.
  while (cache.size > LIMIT) {
    const [oldest, old] = cache.entries().next().value as [string, string];
    URL.revokeObjectURL(old);
    cache.delete(oldest);
  }
}

/** On sign-out: no image of the previous person stays in memory. */
export function clearImageCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

/** An image behind the session: fetched once, tap to see it full screen, tap a failed one to retry. */
export function AuthImage({ fileId, className = '' }: { fileId: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(cache.get(fileId) ?? null);
  const [big, setBig] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const known = cache.get(fileId);
    if (known) {
      setSrc(known);
      return;
    }
    setSrc(null);
    setFailed(false);
    let live = true;
    api.blob(`/files/${fileId}`)
      .then((b) => {
        const url = URL.createObjectURL(b);
        remember(fileId, url);
        if (live) setSrc(url);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [fileId, attempt]);

  if (failed) return <button onClick={() => setAttempt((n) => n + 1)} className={`flex items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500 ${className}`}>Không tải được — chạm để thử lại</button>;
  if (!src) return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
  return (
    <>
      <img src={src} alt="" onClick={() => setBig(true)} className={`rounded-lg object-cover ${className}`} />
      {big && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setBig(false)}>
          <img src={src} alt="" className="max-h-full max-w-full" />
        </div>
      )}
    </>
  );
}
