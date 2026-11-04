import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PhotoStrip } from '../components/PhotoStrip';
import { Button, ErrorText, Field, Screen } from '../components/ui';
import { cached } from '../lib/cache';
import { api, queue } from '../lib/client';
import { SEVERITY } from '../lib/labels';
import { Fix, getPosition } from '../lib/native';
import { newClientId, storePhoto } from '../lib/queue';

interface Category {
  id: string;
  name: string;
  default_severity: string;
}

export function ReportIncident() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const siteId = params.get('site');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [severity, setSeverity] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ state: 'sent' } | { state: 'waiting' } | { state: 'refused'; reason: string } | null>(null);

  useEffect(() => {
    cached('categories', () => api.request<Category[]>('/incident-categories'))
      .then(({ data }) => { setCategories(data); setCategoryId(data[0]?.id ?? ''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được loại sự cố'));
    getPosition().then(setFix).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const item = await queue.add({
        kind: 'incident',
        label: `Sự cố: ${categories.find((c) => c.id === categoryId)?.name ?? ''}`,
        path: '/incidents',
        json: {
          client_uuid: newClientId(), category_id: categoryId, description,
          ...(severity ? { severity } : {}), ...(siteId ? { site_id: siteId } : {}), ...(fix ? { lat: fix.lat, lng: fix.lng } : {}),
        },
        photos: photos.length ? [{ field: 'file_ids', many: true, files: await Promise.all(photos.map(storePhoto)) }] : undefined,
        urgent: true,
        timed: true,
      });
      setDone(await queue.send(item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen title="Báo sự cố" back>
        <div className="py-8 text-center">
          <div className="text-5xl">{done.state === 'sent' ? '✅' : done.state === 'waiting' ? '⏳' : '⛔'}</div>
          <p className="mt-3 text-xl font-semibold">
            {done.state === 'sent' && 'Đã báo — đội trưởng đã nhận thông báo'}
            {done.state === 'waiting' && 'Đã lưu trên máy — sẽ tự gửi khi có sóng'}
            {done.state === 'refused' && `Không gửi được: ${done.reason}`}
          </p>
          {done.state !== 'sent' && <p className="mt-2 text-red-700">Việc gấp: gọi điện cho đội trưởng ngay.</p>}
        </div>
        <Button onClick={() => navigate('/')}>Về ca trực</Button>
      </Screen>
    );
  }

  return (
    <Screen title="Báo sự cố" back>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Loại sự cố">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Mức độ">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base">
            <option value="">Theo loại sự cố</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Chuyện gì đang xảy ra?">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
        </Field>
        <Field label="Ảnh (tối đa 5)"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></Field>
        <p className="text-sm text-slate-500">{fix ? `Đã gắn vị trí (±${fix.accuracy_m} m)` : 'Đang lấy vị trí… (không bắt buộc)'}</p>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || !categoryId}>{busy ? 'Đang gửi…' : 'Gửi báo cáo'}</Button>
      </form>
    </Screen>
  );
}
