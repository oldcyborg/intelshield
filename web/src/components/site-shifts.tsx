'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { TemplateView } from '@/lib/types';

export function SiteShifts({ siteId, manage }: { siteId: string; manage: boolean }) {
  const [rows, setRows] = useState<TemplateView[]>([]);
  const [form, setForm] = useState({ name: '', start_time: '06:00', end_time: '18:00', headcount: '1' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRows(await api<TemplateView[]>(`/sites/${siteId}/shift-templates`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  async function create(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/sites/${siteId}/shift-templates`, { method: 'POST', json: { ...form, headcount: Number(form.headcount) } });
      setForm({ ...form, name: '' });
    });
  }

  return (
    <Card title="Mẫu ca">
      <ul className="mb-3 divide-y divide-slate-100 text-sm">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span>
              <b>{t.name}</b> · {t.start_time}–{t.end_time}{t.overnight ? ' (qua đêm)' : ''} · cần {t.headcount} người
            </span>
            {manage && <Button variant="secondary" onClick={() => run(() => api(`/shift-templates/${t.id}`, { method: 'DELETE' }))}>Xoá</Button>}
          </li>
        ))}
        {!rows.length && <li className="py-2 text-slate-400">Chưa có mẫu ca — đội trưởng cần ít nhất một mẫu để xếp ca</li>}
      </ul>
      {manage && (
        <form onSubmit={create} className="grid grid-cols-2 items-end gap-3 md:grid-cols-5">
          <Field label="Tên ca"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ca ngày" required /></Field>
          <Field label="Bắt đầu"><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required /></Field>
          <Field label="Kết thúc"><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required /></Field>
          <Field label="Số người"><Input type="number" min={1} max={100} value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} /></Field>
          <Button type="submit">Thêm mẫu ca</Button>
        </form>
      )}
      <p className="mt-2 text-xs text-slate-500">Giờ kết thúc nhỏ hơn giờ bắt đầu là ca qua đêm (VD 18:00–06:00).</p>
      <ErrorText error={error} />
    </Card>
  );
}
