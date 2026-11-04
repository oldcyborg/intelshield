'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CLIENT_CHANNEL, INCIDENT_SOURCE, INCIDENT_STATUS, SEVERITY, stamp } from '@/lib/format';
import { IncidentCategory, IncidentRow, Severity, SiteRow } from '@/lib/types';

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Đang mở' },
  { value: 'new', label: 'Chưa ai nhận' },
  { value: 'resolved', label: 'Chờ đóng' },
  { value: 'closed', label: 'Đã đóng' },
  { value: 'rejected', label: 'Báo nhầm' },
  { value: '', label: 'Tất cả' },
];

export default function IncidentsPage() {
  return (
    <Suspense>
      <IncidentsList />
    </Suspense>
  );
}

function IncidentsList() {
  const { can } = useAuth();
  const query = useSearchParams();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A link such as the critical banner's /su-co?status=new sets the filter, also while already on this page.
  useEffect(() => {
    const wanted = query.get('status');
    if (wanted !== null) setStatus(wanted);
  }, [query]);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (severity) q.set('severity', severity);
    setRows(await api<IncidentRow[]>(`/incidents?${q}`));
  }, [status, severity]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    // The bell already reacts at once; the list catches up within half a minute.
    const timer = setInterval(() => load().catch(() => undefined), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Sự cố</h1>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-40">
          <option value="">Mọi mức độ</option>
          {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        {can('incident.manage') && <Button onClick={() => setCreating(!creating)}>{creating ? 'Đóng' : 'Ghi nhận sự cố'}</Button>}
      </div>
      <ErrorText error={error} />
      {creating && <ReportForm onDone={() => { setCreating(false); load().catch(() => undefined); }} />}
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Mã</th><th>Mức độ</th><th>Sự cố</th><th>Nơi</th><th>Người báo</th><th>Lúc</th><th>Trạng thái</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.status === 'new' && r.severity === 'critical' ? 'bg-red-50' : ''}`}>
                <td className="py-2 font-mono text-xs"><Link href={`/su-co/${r.id}`} className="text-teal-700 hover:underline">{r.code}</Link></td>
                <td><span className={`rounded px-1.5 py-0.5 text-xs ${SEVERITY[r.severity].tone}`}>{r.is_sos ? 'SOS' : SEVERITY[r.severity].label}</span></td>
                <td><Link href={`/su-co/${r.id}`} className="hover:underline">{r.title}</Link></td>
                <td>{r.site_name ?? '—'} <span className="text-xs text-slate-400">{r.client_name}</span></td>
                <td>{r.source === 'guard_app' ? r.reporter_name : `${INCIDENT_SOURCE[r.source]}${r.client_reporter_name ? ` · ${r.client_reporter_name}` : ''}`}</td>
                <td>{stamp(r.created_at)}</td>
                <td>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${INCIDENT_STATUS[r.status].tone}`}>{INCIDENT_STATUS[r.status].label}</span>
                  {r.status === 'new' && r.escalation_level > 1 && <span className="ml-1 text-xs text-red-700">đã leo thang cấp {r.escalation_level}</span>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-6 text-center text-slate-400">Không có sự cố nào</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}

/** Office staff writing down what happened, or what a client told them on the phone. */
function ReportForm({ onDone }: { onDone: () => void }) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [categories, setCategories] = useState<IncidentCategory[]>([]);
  const [form, setForm] = useState({ source: 'client_report', site_id: '', category_id: '', severity: '', description: '', client_reporter_name: '', client_channel: 'phone' });
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<SiteRow[]>('/sites'), api<IncidentCategory[]>('/incident-categories')])
      .then(([s, c]) => { setSites(s); setCategories(c); setForm((f) => ({ ...f, site_id: s[0]?.id ?? '', category_id: c[0]?.id ?? '' })); })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const file_ids = [];
      for (const p of photos) file_ids.push((await uploadFile(p)).id);
      const client = form.source === 'client_report';
      await api('/incidents', {
        method: 'POST',
        json: {
          source: form.source, site_id: form.site_id, category_id: form.category_id, description: form.description, file_ids,
          ...(form.severity ? { severity: form.severity as Severity } : {}),
          ...(client ? { client_reporter_name: form.client_reporter_name || undefined, client_channel: form.client_channel } : {}),
        },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card title="Ghi nhận sự cố">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nguồn">
          <Select value={form.source} onChange={set('source')}>
            <option value="client_report">Khách báo</option>
            <option value="staff">Nhân sự công ty phát hiện</option>
          </Select>
        </Field>
        <Field label="Mục tiêu">
          <Select value={form.site_id} onChange={set('site_id')} required>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Loại sự cố">
          <Select value={form.category_id} onChange={set('category_id')} required>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({SEVERITY[c.default_severity].label})</option>)}
          </Select>
        </Field>
        <Field label="Mức độ">
          <Select value={form.severity} onChange={set('severity')}>
            <option value="">Theo loại sự cố</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        {form.source === 'client_report' && (
          <>
            <Field label="Người báo bên khách">
              <Input value={form.client_reporter_name} onChange={set('client_reporter_name')} placeholder="VD: Chị Lan — BQL toà nhà" />
            </Field>
            <Field label="Báo qua">
              <Select value={form.client_channel} onChange={set('client_channel')}>
                {Object.entries(CLIENT_CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Field label="Mô tả">
            <textarea value={form.description} onChange={set('description')} required rows={3} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          </Field>
        </div>
        <Field label="Ảnh (tối đa 5)">
          <Input type="file" accept="image/jpeg,image/png" multiple onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))} />
        </Field>
        <div className="flex items-end justify-end gap-3 sm:col-span-2">
          <ErrorText error={error} />
          <Button type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi — báo người phụ trách'}</Button>
        </div>
      </form>
    </Card>
  );
}
