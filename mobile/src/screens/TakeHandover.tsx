import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { stamp } from '../lib/format';

export interface IncomingHandover {
  id: string;
  site_name: string;
  from_name: string;
  submitted_at: string;
  items: { label: string; status: string; note?: string }[];
  notes: string | null;
  file_ids: string[];
}

export function TakeHandover() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [h, setH] = useState<IncomingHandover | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.request<IncomingHandover[]>('/me/handovers')
      .then((list) => {
        const found = list.find((x) => x.id === id) ?? null;
        setH(found);
        if (!found) setError('Biên bản này không còn chờ bạn xác nhận');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra'));
  }, [id]);

  async function answer(accept: boolean) {
    if (!accept && !reason.trim()) return setError('Ghi lý do không đồng ý');
    setBusy(true);
    setError(null);
    try {
      await api.request(`/handovers/${id}/${accept ? 'accept' : 'dispute'}`, { json: accept ? {} : { note: reason.trim() } });
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (!h) return <Screen title="Nhận ca" back><ErrorText error={error} /></Screen>;
  return (
    <Screen title="Nhận ca" back>
      <Card>
        <div className="text-lg"><b>{h.from_name}</b> giao ca · {h.site_name}</div>
        <div className="text-sm text-slate-400">{stamp(h.submitted_at)}</div>
        {h.items.map((i) => (
          <div key={i.label} className={`border-t border-slate-100 py-2 text-base ${i.status === 'ok' ? '' : 'font-semibold text-red-700'}`}>
            {i.status === 'ok' ? '✓' : '✗'} {i.label}{i.status !== 'ok' && ` — ${i.status === 'missing' ? 'thiếu' : 'có vấn đề'}`}{i.note ? `: ${i.note}` : ''}
          </div>
        ))}
        {h.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2">Ghi chú: {h.notes}</p>}
        {h.file_ids.length > 0 && <div className="mt-2 grid grid-cols-3 gap-2">{h.file_ids.map((f) => <AuthImage key={f} fileId={f} className="aspect-square w-full" />)}</div>}
      </Card>
      <p className="text-slate-600">Kiểm lại từng món trước khi đồng ý.</p>
      <ErrorText error={error} />
      {disputing ? (
        <Card>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Thiếu gì, khác gì so với biên bản?" className="w-full rounded-xl border border-slate-300 p-3 text-base" />
          <div className="mt-2 flex gap-2">
            <Button tone="danger" onClick={() => void answer(false)} disabled={busy}>Gửi — không đồng ý</Button>
            <Button tone="secondary" onClick={() => setDisputing(false)}>Thôi</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void answer(true)} disabled={busy}>Đồng ý nhận ca</Button>
          <Button tone="danger" onClick={() => setDisputing(true)} disabled={busy}>Không đồng ý</Button>
        </div>
      )}
    </Screen>
  );
}
