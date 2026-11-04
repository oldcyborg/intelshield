import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { Button, ErrorText, Field, Input, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { localDate } from '../lib/format';
import { newClientId } from '../lib/queue';
import { dayCount, LEAVE_TYPE } from '../lib/requests';
import { Balance } from './MyRequests';

/** A guard asks for days off: the leader (or the manager) decides on their phone. */
export function NewLeave() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ type: 'personal', from_date: localDate(1), to_date: localDate(1), reason: '' });
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [uploaded, setUploaded] = useState<{ photos: Blob[]; ids: string[] } | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept for the life of the form: pressing twice, or again after a weak signal, sends one request.
  const [clientId] = useState(newClientId);

  useEffect(() => { api.request<Balance>('/me/leave-balance').then(setBalance).catch(() => undefined); }, []);

  const days = form.to_date >= form.from_date ? dayCount(form.from_date, form.to_date) : 0;
  const over = form.type === 'annual' && balance?.remaining !== null && balance?.remaining !== undefined && days > balance.remaining;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const file_ids = uploaded && uploaded.photos === photos ? uploaded.ids : await uploadAll((b, n) => api.upload(b, n), photos);
      setUploaded({ photos, ids: file_ids });
      await api.request('/leave-requests', { json: { client_uuid: clientId, ...form, reason: form.reason.trim() || undefined, file_ids } });
      navigate('/don', { replace: true });
    } catch (e) {
      setError(e instanceof NetworkError ? 'Không có mạng — gửi đơn cần mạng. Gọi điện cho đội trưởng nếu gấp.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Xin nghỉ" back>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(LEAVE_TYPE).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setForm({ ...form, type: k })}
              className={`rounded-xl border px-3 py-3 text-lg ${form.type === k ? 'border-teal-700 bg-teal-50 font-semibold text-teal-800' : 'border-slate-300 bg-white'}`}>
              {v}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Từ ngày"><Input type="date" value={form.from_date} onChange={(e) => setForm({ ...form, from_date: e.target.value, to_date: e.target.value > form.to_date ? e.target.value : form.to_date })} /></Field>
          <Field label="Đến ngày"><Input type="date" value={form.to_date} min={form.from_date} onChange={(e) => setForm({ ...form, to_date: e.target.value })} /></Field>
        </div>
        <p className="text-base">{days ? `${days} ngày` : 'Ngày kết thúc phải sau ngày bắt đầu'}</p>
        {form.type === 'annual' && balance?.allowance ? (
          <p className={`rounded-lg p-2 text-sm ${over ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
            Phép năm còn {balance.remaining} ngày{over ? ` — đơn này vượt ${days - balance.remaining!} ngày` : ''}
          </p>
        ) : null}
        <Field label="Lý do">
          <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg" placeholder="VD: về quê có việc gia đình" />
        </Field>
        <Field label="Ảnh kèm (giấy khám bệnh…), không bắt buộc">
          <PhotoStrip photos={photos} onChange={setPhotos} max={3} onError={setError} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || !days}>{busy ? 'Đang gửi…' : 'Gửi đơn'}</Button>
        <p className="text-sm text-slate-500">Đơn gửi tới đội trưởng. Nghỉ trong vòng 12 giờ tới thì báo cả quản lý — hãy gọi điện thêm cho đội trưởng.</p>
      </form>
    </Screen>
  );
}
