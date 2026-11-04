import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/client';

export interface SiteOption {
  id: string;
  name: string;
  client_name: string;
}

const KEY = 'intelshield.site';

/**
 * The sites the person can see; remembers the last one chosen on this phone. `reload` changing (the screen's
 * "Tải lại") fetches the list again — the first open may have had no signal.
 */
export function SitePicker({ value, onChange, reload = 0 }: { value: string; onChange: (id: string) => void; reload?: number }) {
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.request<SiteOption[]>('/sites');
      setSites(s);
      setError(null);
      if (!value || !s.some((x) => x.id === value)) {
        const remembered = localStorage.getItem(KEY);
        onChange(s.find((x) => x.id === remembered)?.id ?? s[0]?.id ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách mục tiêu');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void load(); }, [load, reload]);

  if (error && !sites) {
    return (
      <button onClick={() => void load()} className="w-full rounded-xl bg-red-50 px-3 py-3 text-left text-base text-red-700">
        {error} — chạm để thử lại
      </button>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => { localStorage.setItem(KEY, e.target.value); onChange(e.target.value); }}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base"
    >
      {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.client_name}</option>)}
      {sites && !sites.length && <option value="">Bạn chưa phụ trách mục tiêu nào</option>}
      {!sites && <option value="">Đang tải…</option>}
    </select>
  );
}
