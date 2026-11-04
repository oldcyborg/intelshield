'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { WEEKDAYS } from '@/lib/format';
import { PatrolScheduleView, RouteView } from '@/lib/types';

const EVERY: number[] = [30, 60, 90, 120, 180, 240];

/** When each route is walked: a time window, how often, which days. Rounds follow within a minute. */
export function SitePatrolSchedules({ siteId, routes, manage }: { siteId: string; routes: RouteView[]; manage: boolean }) {
  const [rows, setRows] = useState<PatrolScheduleView[]>([]);
  const [form, setForm] = useState({ route_id: '', name: '', start_time: '18:00', end_time: '06:00', interval_minutes: 120, days: [1, 2, 3, 4, 5, 6, 7] });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRows(await api<PatrolScheduleView[]>(`/sites/${siteId}/patrol-schedules`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);
  useEffect(() => { if (!form.route_id && routes[0]) setForm((f) => ({ ...f, route_id: routes[0].id })); }, [routes, form.route_id]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  function create(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/sites/${siteId}/patrol-schedules`, { method: 'POST', json: form });
      setForm({ ...form, name: '' });
    });
  }

  const dayText = (days: number[]) => (days.length === 7 ? 'mọi ngày' : WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.label).join(', '));

  return (
    <Card title="Lịch tuần tra">
      <ul className="mb-3 divide-y divide-slate-100 text-sm">
        {rows.map((s) => (
          <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${s.status === 'inactive' ? 'text-slate-400' : ''}`}>
            <span>
              <b>{s.name}</b> · {s.route_name} · {s.start_time}–{s.end_time} · mỗi {s.interval_minutes} phút ({s.rounds_per_day} vòng/ngày) · {dayText(s.days)}
            </span>
            {manage && (
              <span className="space-x-2">
                <Button variant="secondary" onClick={() => run(() => api(`/patrol-schedules/${s.id}`, { method: 'PATCH', json: { status: s.status === 'active' ? 'inactive' : 'active' } }))}>
                  {s.status === 'active' ? 'Tạm dừng' : 'Chạy lại'}
                </Button>
                <Button variant="secondary" onClick={() => window.confirm(`Xoá lịch "${s.name}"?`) && run(() => api(`/patrol-schedules/${s.id}`, { method: 'DELETE' }))}>Xoá</Button>
              </span>
            )}
          </li>
        ))}
        {!rows.length && <li className="py-2 text-slate-400">Chưa có lịch — chưa có vòng tuần nào được sinh</li>}
      </ul>
      {manage && routes.length > 0 && (
        <form onSubmit={create} className="grid grid-cols-2 items-end gap-3 md:grid-cols-6">
          <Field label="Tên lịch"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tuần tra đêm" required /></Field>
          <Field label="Tuyến">
            <Select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Từ"><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required /></Field>
          <Field label="Đến"><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required /></Field>
          <Field label="Mỗi">
            <Select value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })}>
              {EVERY.map((m) => <option key={m} value={m}>{m} phút</option>)}
            </Select>
          </Field>
          <Button type="submit" disabled={!form.days.length}>Thêm lịch</Button>
          <div className="col-span-2 flex flex-wrap gap-3 text-sm md:col-span-6">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.days.includes(d.value)}
                  onChange={() => setForm({ ...form, days: form.days.includes(d.value) ? form.days.filter((x) => x !== d.value) : [...form.days, d.value] })}
                />
                {d.label}
              </label>
            ))}
          </div>
        </form>
      )}
      {manage && !routes.length && <p className="text-sm text-slate-500">Tạo tuyến tuần tra trước, rồi đặt lịch cho tuyến.</p>}
      <p className="mt-2 text-xs text-slate-500">Giờ kết thúc nhỏ hơn giờ bắt đầu là qua đêm; bằng nhau là cả ngày. Hệ thống sinh sẵn các vòng của 24 giờ tới.</p>
      <ErrorText error={error} />
    </Card>
  );
}
