'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, ErrorText, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, time } from '@/lib/format';
import { AssignmentRow, DeploymentView, SiteRow, TemplateView } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
};
const DAY_NAMES = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export default function RosterPage() {
  const { can } = useAuth();
  const manage = can('roster.manage');
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [week, setWeek] = useState(mondayOf(todayIso()));
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; code: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    const site = sites.find((s) => s.id === siteId);
    const [t, r] = await Promise.all([
      api<TemplateView[]>(`/sites/${siteId}/shift-templates`),
      api<AssignmentRow[]>(`/roster?site_id=${siteId}&from=${days[0]}&to=${days[6]}`),
    ]);
    setTemplates(t.filter((x) => x.status === 'active'));
    setRows(r);
    // People who can be rostered here: posted to the site's client during the week, plus anyone already rostered.
    const posted = site && can('deployment.view') ? await api<DeploymentView[]>(`/deployments?client_id=${site.client_id}&on=${days[0]}`) : [];
    const map = new Map<string, { id: string; name: string; code: string }>();
    for (const d of posted) map.set(d.employee_id, { id: d.employee_id, name: d.employee_name, code: d.employee_code });
    for (const a of r) map.set(a.employee_id, { id: a.employee_id, name: a.employee_name, code: a.employee_code });
    setPeople([...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
  }, [siteId, sites, days, can]);

  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setNote(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const copyLastWeek = () =>
    run(async () => {
      const res = await api<{ created: number; skipped: { employee_name: string; shift_date: string; reason: string }[] }>('/roster/copy-week', {
        method: 'POST', json: { site_id: siteId, from_week: addDays(week, -7), to_week: week },
      });
      setNote(`Đã chép ${res.created} ca.${res.skipped.length ? ` Bỏ qua ${res.skipped.length}: ${res.skipped.map((s) => `${s.employee_name} ngày ${date(s.shift_date)} (${s.reason})`).join('; ')}` : ''}`);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Xếp ca</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <div className="flex items-center gap-1">
          <Button variant="secondary" onClick={() => setWeek(addDays(week, -7))}>←</Button>
          <span className="w-48 text-center text-sm">{date(days[0])} – {date(days[6])}</span>
          <Button variant="secondary" onClick={() => setWeek(addDays(week, 7))}>→</Button>
        </div>
        {manage && <Button variant="secondary" onClick={copyLastWeek}>Chép từ tuần trước</Button>}
      </div>
      <ErrorText error={error} />
      {note && <p className="text-sm text-teal-700">{note}</p>}
      {!templates.length && siteId && <p className="text-sm text-amber-700">Mục tiêu chưa có mẫu ca. Vào trang mục tiêu để thêm.</p>}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="w-44 py-2">Nhân viên</th>
                {days.map((d, i) => <th key={d} className={d === todayIso() ? 'text-teal-700' : ''}>{DAY_NAMES[i]} {date(d).slice(0, 5)}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">{p.name}<div className="font-mono text-xs text-slate-400">{p.code}</div></td>
                  {days.map((d) => {
                    const cell = rows.filter((a) => a.employee_id === p.id && a.shift_date === d && a.status === 'planned');
                    return (
                      <td key={d} className="space-y-1 py-2 pr-1">
                        {cell.map((a) => (
                          <div key={a.id} className={`rounded px-1.5 py-0.5 text-xs ${a.attendance ? 'bg-teal-100 text-teal-800' : 'bg-slate-100'}`}>
                            {a.template_name ?? 'Ca lẻ'} {time(a.planned_start)}–{time(a.planned_end)}
                            {manage && !a.attendance && (
                              <button onClick={() => run(() => api(`/roster/${a.id}/cancel`, { method: 'POST' }))} className="ml-1 text-slate-400 hover:text-red-600" title="Huỷ ca">×</button>
                            )}
                          </div>
                        ))}
                        {manage && templates.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => e.target.value && run(() => api('/roster', { method: 'POST', json: { site_id: siteId, employee_id: p.id, template_id: e.target.value, shift_date: d } }))}
                            className="w-full rounded border border-dashed border-slate-300 bg-transparent px-1 text-xs text-slate-500"
                          >
                            <option value="">+ ca</option>
                            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} {t.start_time}</option>)}
                          </select>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!people.length && <tr><td colSpan={8} className="py-6 text-center text-slate-400">Chưa có ai được điều động tới khách của mục tiêu này</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-slate-500">Ca màu xanh là ca đã chấm công — không huỷ được. Mỗi ô chỉ nhận người đang được điều động tới khách vào ngày đó.</p>
    </div>
  );
}
