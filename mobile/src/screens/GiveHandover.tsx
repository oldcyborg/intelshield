import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { ApiError, NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { time } from '../lib/format';

type Mark = 'ok' | 'missing' | 'issue';
interface Choice {
  assignment_id: string;
  name: string;
  planned_start: string;
}

/** The outgoing guard ticks the site's checklist; the next guard confirms on their own phone. Needs the network. */
export function GiveHandover() {
  const { siteId, assignmentId } = useParams<{ siteId: string; assignmentId: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<string[] | null>(null);
  const [marks, setMarks] = useState<Record<string, { status: Mark; note: string }>>({});
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [uploaded, setUploaded] = useState<{ photos: Blob[]; ids: string[] } | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    api.request<string[]>(`/sites/${siteId}/handover-items`).then((list) => {
      setItems(list);
      setMarks(Object.fromEntries(list.map((l) => [l, { status: 'ok' as Mark, note: '' }])));
    }).catch((e) => setError(e instanceof Error ? e.message : 'Không tải được danh mục bàn giao'));
  }, [siteId]);

  async function submit(to?: string) {
    setBusy(true);
    setError(null);
    try {
      const file_ids = uploaded && uploaded.photos === photos ? uploaded.ids : await uploadAll((b, n) => api.upload(b, n), photos);
      setUploaded({ photos, ids: file_ids });
      const h = await api.request<{ to_name: string | null }>('/handovers', {
        json: {
          from_assignment_id: assignmentId, ...(to ? { to_assignment_id: to } : {}), notes: notes.trim() || undefined, file_ids,
          items: (items ?? []).map((label) => ({ label, status: marks[label].status, ...(marks[label].note.trim() ? { note: marks[label].note.trim() } : {}) })),
        },
      });
      setSent(h.to_name ?? '');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HANDOVER_RECEIVER_REQUIRED') setChoices(e.details as Choice[]);
      else if (e instanceof ApiError && e.code === 'HANDOVER_ALREADY') setSent('');
      else setError(e instanceof NetworkError ? 'Không có mạng — giao ca cần mạng để người nhận thấy ngay.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) {
    return (
      <Screen title="Giao ca" back>
        <div className="py-8 text-center">
          <div className="text-5xl">✅</div>
          <p className="mt-3 text-xl font-semibold">Đã giao ca{sent ? ` cho ${sent}` : ''}</p>
          <p className="text-slate-500">{sent ? 'Người nhận sẽ xác nhận trên máy của họ.' : 'Chưa có người nhận ca — đội trưởng sẽ chọn người nhận.'}</p>
        </div>
        <Button onClick={() => navigate('/')}>Về ca trực</Button>
      </Screen>
    );
  }

  return (
    <Screen title="Giao ca" back>
      <ErrorText error={error} />
      {choices && (
        <Card>
          <b>Có nhiều người nhận ca — chọn người nhận:</b>
          {choices.map((c) => (
            <button key={c.assignment_id} disabled={busy} onClick={() => void submit(c.assignment_id)} className="flex w-full justify-between border-t border-slate-100 py-3 text-left text-lg">
              {c.name}<span className="text-sm text-slate-500">vào {time(c.planned_start)}</span>
            </button>
          ))}
        </Card>
      )}
      {items?.map((label) => (
        <Card key={label}>
          <div className="text-lg font-semibold">{label}</div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {([['ok', 'Đủ'], ['missing', 'Thiếu'], ['issue', 'Có vấn đề']] as [Mark, string][]).map(([v, t]) => (
              <button key={v} type="button" onClick={() => setMarks({ ...marks, [label]: { ...marks[label], status: v } })} className={`rounded-lg py-2 text-base ${marks[label]?.status === v ? (v === 'ok' ? 'bg-teal-700 text-white' : 'bg-red-600 text-white') : 'border border-slate-300'}`}>{t}</button>
            ))}
          </div>
          {marks[label]?.status !== 'ok' && (
            <input value={marks[label].note} onChange={(e) => setMarks({ ...marks, [label]: { ...marks[label], note: e.target.value } })} placeholder="Thiếu gì, hỏng gì…" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          )}
        </Card>
      ))}
      {items && !items.length && <p className="text-slate-500">Mục tiêu chưa có danh mục bàn giao — ghi chú việc cần bàn giao bên dưới.</p>}
      <Card>
        <b>Ghi chú cho ca sau</b>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Việc còn dở, khách hẹn, lưu ý…" className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-base" />
        <div className="mt-2"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></div>
      </Card>
      <Button onClick={() => void submit()} disabled={busy || !items}>{busy ? 'Đang gửi…' : 'Giao ca'}</Button>
    </Screen>
  );
}
