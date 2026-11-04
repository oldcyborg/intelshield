'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';

/** What one shift hands to the next at this site; guards tick each line when they hand over. */
export function SiteHandoverItems({ siteId, manage }: { siteId: string; manage: boolean }) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setItems(await api<string[]>(`/sites/${siteId}/handover-items`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function save(next: string[]) {
    setError(null);
    try {
      setItems(await api<string[]>(`/sites/${siteId}/handover-items`, { method: 'PUT', json: { items: next } }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Danh mục bàn giao ca">
      <ul className="mb-2 flex flex-wrap gap-2 text-sm">
        {items.map((i) => (
          <li key={i} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
            {i}
            {manage && <button onClick={() => save(items.filter((x) => x !== i))} className="text-slate-400 hover:text-red-600">×</button>}
          </li>
        ))}
        {!items.length && <li className="text-slate-400">Chưa có — bảo vệ chỉ ghi chú khi giao ca</li>}
      </ul>
      {manage && (
        <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void save([...items, draft.trim()]); setDraft(''); } }} className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="VD: Chìa khoá kho (3 chiếc)" />
          <Button type="submit">Thêm</Button>
        </form>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
