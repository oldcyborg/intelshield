import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { SitePicker } from '../components/SitePicker';
import { Button, ErrorText, Field, Input, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { SEVERITY } from '../lib/labels';

interface Category {
  id: string;
  name: string;
  default_severity: string;
}

const CHANNELS = [
  { value: 'in_person', label: 'Trực tiếp' },
  { value: 'phone', label: 'Điện thoại' },
  { value: 'zalo', label: 'Zalo' },
  { value: 'email', label: 'Email' },
];

/** A leader or manager writing down an incident on the spot — their own finding, or what the client just reported. */
export function NewIncident() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ source: 'client_report', site_id: '', category_id: '', severity: '', description: '', client_reporter_name: '', client_channel: 'in_person' });
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ photos: Blob[]; ids: string[] } | null>(null);

  useEffect(() => {
    api.request<Category[]>('/incident-categories').then((c) => { setCategories(c); setForm((f) => ({ ...f, category_id: c[0]?.id ?? '' })); })
      .catch((e) => setError(`Không tải được loại sự cố: ${e instanceof Error ? e.message : ''} — quay lại rồi mở lại màn này`));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const file_ids = uploaded && uploaded.photos === photos ? uploaded.ids : await uploadAll((b, n) => api.upload(b, n), photos);
      setUploaded({ photos, ids: file_ids });
      const client = form.source === 'client_report';
      const created = await api.request<{ id: string }>('/incidents', {
        json: {
          source: form.source, site_id: form.site_id, category_id: form.category_id, description: form.description, file_ids,
          ...(form.severity ? { severity: form.severity } : {}),
          ...(client ? { client_channel: form.client_channel, ...(form.client_reporter_name.trim() ? { client_reporter_name: form.client_reporter_name.trim() } : {}) } : {}),
        },
      });
      navigate(`/su-co/${created.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof NetworkError ? 'Không có mạng — ghi nhận sự cố cần mạng.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <Screen title="Ghi nhận sự cố" back>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[{ v: 'client_report', l: 'Khách báo' }, { v: 'staff', l: 'Tôi phát hiện' }].map((o) => (
            <button key={o.v} type="button" onClick={() => setForm({ ...form, source: o.v })} className={`rounded-xl py-3 text-base font-medium ${form.source === o.v ? 'bg-teal-700 text-white' : 'border border-slate-300 bg-white'}`}>{o.l}</button>
          ))}
        </div>
        <Field label="Mục tiêu"><SitePicker value={form.site_id} onChange={(id) => setForm((f) => ({ ...f, site_id: id }))} /></Field>
        <Field label="Loại sự cố">
          <select value={form.category_id} onChange={set('category_id')} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({SEVERITY[c.default_severity]?.label})</option>)}
          </select>
        </Field>
        <Field label="Mức độ">
          <select value={form.severity} onChange={set('severity')} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            <option value="">Theo loại sự cố</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        {form.source === 'client_report' && (
          <>
            <Field label="Người báo bên khách"><Input value={form.client_reporter_name} onChange={set('client_reporter_name')} placeholder="VD: Chị Lan — BQL" /></Field>
            <Field label="Báo qua">
              <select value={form.client_channel} onChange={set('client_channel')} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Mô tả">
          <textarea value={form.description} onChange={set('description')} required rows={4} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
        </Field>
        <Field label="Ảnh (tối đa 5)"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || !form.site_id || !form.category_id}>{busy ? 'Đang gửi…' : 'Gửi — báo người phụ trách'}</Button>
      </form>
    </Screen>
  );
}
