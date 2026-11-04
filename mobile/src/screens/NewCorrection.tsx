import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { Button, Card, ErrorText, Field, Input, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { day, localDate, time } from '../lib/format';
import { newClientId } from '../lib/queue';
import { CORRECTION_REASON, fromLocalInput, localInput } from '../lib/requests';

interface Shift {
  id: string;
  planned_start: string;
  planned_end: string;
  site_name: string;
  attendance: { check_in_at: string | null; check_out_at: string | null } | null;
}

/** A guard asks for a clock-in or clock-out to be added or changed: the leader proposes, a manager decides. */
export function NewCorrection() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const [shift, setShift] = useState<Shift | null>(null);
  const [form, setForm] = useState({ check_in: '', check_out: '', reason_code: 'phone_dead', reason: '' });
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [uploaded, setUploaded] = useState<{ photos: Blob[]; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(newClientId);

  useEffect(() => {
    api.request<Shift[]>(`/me/shifts?from=${localDate(-3)}&to=${localDate(0)}`)
      .then((all) => {
        const s = all.find((x) => x.id === assignmentId) ?? null;
        setShift(s);
        if (s) setForm((f) => ({ ...f, check_in: localInput(s.attendance?.check_in_at ?? s.planned_start), check_out: localInput(s.attendance?.check_out_at ?? s.planned_end) }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được ca'));
  }, [assignmentId]);

  if (!shift) return <Screen title="Bổ sung chấm công" back><ErrorText error={error} /></Screen>;
  const had = shift.attendance;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const file_ids = uploaded && uploaded.photos === photos ? uploaded.ids : await uploadAll((b, n) => api.upload(b, n), photos);
      setUploaded({ photos, ids: file_ids });
      const changesIn = form.check_in && form.check_in !== localInput(had?.check_in_at);
      const changesOut = form.check_out && form.check_out !== localInput(had?.check_out_at);
      await api.request('/attendance-corrections', {
        json: {
          client_uuid: clientId, assignment_id: shift!.id, reason_code: form.reason_code, reason: form.reason.trim() || undefined, file_ids,
          ...(changesIn ? { check_in_at: fromLocalInput(form.check_in) } : {}),
          ...(changesOut ? { check_out_at: fromLocalInput(form.check_out) } : {}),
        },
      });
      navigate('/don', { replace: true });
    } catch (e) {
      setError(e instanceof NetworkError ? 'Không có mạng — gửi đơn cần mạng.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Bổ sung chấm công" back>
      <Card>
        <div className="text-sm capitalize text-slate-500">{day(shift.planned_start)}</div>
        <div className="text-xl font-semibold">{time(shift.planned_start)} – {time(shift.planned_end)} · {shift.site_name}</div>
        <div className="text-base text-slate-600">Đang có: vào {time(had?.check_in_at)} · ra {time(had?.check_out_at)}</div>
      </Card>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Giờ vào ca"><Input type="datetime-local" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} /></Field>
        <Field label="Giờ ra ca (để trống nếu chưa ra)"><Input type="datetime-local" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(CORRECTION_REASON).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setForm({ ...form, reason_code: k })}
              className={`rounded-xl border px-3 py-3 text-base ${form.reason_code === k ? 'border-teal-700 bg-teal-50 font-semibold text-teal-800' : 'border-slate-300 bg-white'}`}>
              {v}
            </button>
          ))}
        </div>
        <Field label="Ghi thêm">
          <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg" placeholder="VD: máy hết pin lúc 18h, có ghi sổ giấy, anh Tuấn biết" />
        </Field>
        <Field label="Ảnh làm bằng chứng (sổ giấy, màn hình máy…), không bắt buộc">
          <PhotoStrip photos={photos} onChange={setPhotos} max={3} onError={setError} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || !form.check_in}>{busy ? 'Đang gửi…' : 'Gửi đơn'}</Button>
        <p className="text-sm text-slate-500">Đội trưởng xem lần quét tuần tra, sổ trực của bạn trong ca rồi đề xuất; quản lý duyệt. Duyệt xong giờ công được sửa.</p>
      </form>
    </Screen>
  );
}
