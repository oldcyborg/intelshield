'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { SEVERITY } from '@/lib/format';
import { IncidentCategory, Severity } from '@/lib/types';

/** The kinds of incident guards pick from, each with the severity it starts at. */
export function IncidentCategories() {
  const [rows, setRows] = useState<IncidentCategory[]>([]);
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [error, setError] = useState<string | null>(null);

  const load = () => api<IncidentCategory[]>('/incident-categories/all').then(setRows);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, []);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      await api('/incident-categories', { method: 'POST', json: { name, default_severity: severity } });
      setName('');
    });
  }

  return (
    <Card title="Loại sự cố">
      <p className="mb-2 text-sm text-slate-500">Mức độ ở đây quyết định ai được báo và bao lâu thì leo thang (xem các mốc ở trên).</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={`border-t border-slate-100 ${c.status === 'inactive' ? 'text-slate-400' : ''}`}>
              <td className="py-1.5">{c.name}</td>
              <td className="w-40">
                <Select value={c.default_severity} onChange={(e) => run(() => api(`/incident-categories/${c.id}`, { method: 'PATCH', json: { default_severity: e.target.value } }))}>
                  {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
              </td>
              <td className="w-28 text-right">
                <button
                  className="text-xs text-teal-700 hover:underline"
                  onClick={() => run(() => api(`/incident-categories/${c.id}`, { method: 'PATCH', json: { status: c.status === 'active' ? 'inactive' : 'active' } }))}
                >
                  {c.status === 'active' ? 'Ngừng dùng' : 'Dùng lại'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <form onSubmit={add} className="mt-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Loại mới, VD: Ngập nước" required />
        <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="w-40">
          {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Button type="submit">Thêm</Button>
      </form>
      <ErrorText error={error} />
    </Card>
  );
}
