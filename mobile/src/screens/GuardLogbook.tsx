import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { PhotoStrip } from '../components/PhotoStrip';
import { Button, Card, ErrorText, Field, Input, Screen } from '../components/ui';
import { cached } from '../lib/cache';
import { api, queue } from '../lib/client';
import { localDate, time } from '../lib/format';
import { LOGBOOK_TYPE } from '../lib/labels';
import { newClientId, QueueItem, storePhoto } from '../lib/queue';

interface Line {
  id: string;
  type: string;
  body: string | null;
  data: Record<string, string | number | undefined>;
  occurred_at: string;
  exited_at: string | null;
  author_name: string;
  files: { id: string }[];
}

type Kind = 'visitor' | 'vehicle' | 'asset' | 'note';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'visitor', label: '🚶 Khách' },
  { key: 'vehicle', label: '🚗 Xe' },
  { key: 'asset', label: '📦 Tài sản' },
  { key: 'note', label: '📝 Ghi chú' },
];
const ASSET_ACTIONS = [
  { value: 'received', label: 'Nhận' },
  { value: 'handed_out', label: 'Giao' },
  { value: 'lent', label: 'Cho mượn' },
  { value: 'returned', label: 'Trả lại' },
];
const EMPTY = { visitor_name: '', visitor_org: '', meet_whom: '', purpose: '', plate: '', vehicle_kind: '', cargo: '', item: '', quantity: '1', asset_action: 'received', counterpart: '', body: '' };

const text = (l: Pick<Line, 'type' | 'data' | 'body'>) => {
  const d = l.data;
  if (l.type === 'visitor') return [d.visitor_name, d.visitor_org && `(${d.visitor_org})`, d.meet_whom && `gặp ${d.meet_whom}`].filter(Boolean).join(' ');
  if (l.type === 'vehicle') return [d.plate, d.vehicle_kind, d.cargo].filter(Boolean).join(' · ');
  if (l.type === 'asset') return [d.item, d.quantity, d.counterpart].filter(Boolean).join(' · ');
  return l.body ?? '';
};

export function GuardLogbook() {
  const { siteId } = useParams<{ siteId: string }>();
  const [inside, setInside] = useState<Line[]>([]);
  const [today, setToday] = useState<Line[]>([]);
  const [waiting, setWaiting] = useState<QueueItem[]>([]);
  const [refused, setRefused] = useState<QueueItem[]>([]);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        cached(`inside.${siteId}`, () => api.request<Line[]>(`/sites/${siteId}/logbook/inside`)),
        cached(`book.${siteId}.${localDate(0)}`, () => api.request<Line[]>(`/sites/${siteId}/logbook?date=${localDate(0)}`)),
      ]);
      setInside(a.data);
      setToday(b.data);
      setOfflineAt(a.offline ? a.at : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
    setWaiting((await queue.list()).filter((i) => i.meta?.site_id === siteId));
    setRefused((await queue.failed()).filter((i) => i.meta?.site_id === siteId));
  }, [siteId]);
  useEffect(() => {
    void load();
    return queue.subscribe(() => void load());
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const fields: Record<string, unknown> =
        kind === 'visitor' ? { visitor_name: form.visitor_name, visitor_org: form.visitor_org || undefined, meet_whom: form.meet_whom || undefined, purpose: form.purpose || undefined }
          : kind === 'vehicle' ? { plate: form.plate.toUpperCase(), vehicle_kind: form.vehicle_kind || undefined, cargo: form.cargo || undefined }
            : kind === 'asset' ? { item: form.item, quantity: Number(form.quantity) || 1, asset_action: form.asset_action, counterpart: form.counterpart || undefined }
              : { body: form.body };
      if (kind !== 'note' && form.body.trim()) fields.body = form.body.trim();
      const json = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''));
      await queue.add({
        kind: 'logbook',
        label: `Sổ trực: ${LOGBOOK_TYPE[kind]} ${text({ type: kind, data: json as Line['data'], body: (json.body as string) ?? null })}`,
        path: `/sites/${siteId}/logbook`,
        json: { client_uuid: newClientId(), type: kind, ...json },
        photos: photos.length ? [{ field: 'file_ids', many: true, files: await Promise.all(photos.map(storePhoto)) }] : undefined,
        timed: true,
        meta: { site_id: siteId! },
      });
      setKind(null);
      setForm(EMPTY);
      setPhotos([]);
      void queue.flush().then(() => load());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  async function exit(line: Line) {
    await queue.add({
      kind: 'exit', label: `Ra: ${text(line)}`, path: `/logbook/${line.id}/exit`, json: {}, timed: true,
      okCodes: ['LOGBOOK_ALREADY_EXITED'], meta: { site_id: siteId!, line_id: line.id },
    });
    void queue.flush().then(() => load());
  }

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const leaving = new Set(waiting.filter((i) => i.kind === 'exit').map((i) => i.meta!.line_id));

  return (
    <Screen title="Sổ trực" back>
      {offlineAt && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Không có mạng — đang dùng sổ lúc {time(offlineAt)}. Dòng mới vẫn ghi được, máy tự gửi khi có sóng.</p>}
      <ErrorText error={error} />
      {refused.map((i) => <p key={i.id} className="rounded-lg bg-red-50 p-2 text-sm text-red-700">Không được nhận: {i.label} — {i.error} (xem ở trang Tôi)</p>)}
      {!kind ? (
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => <Button key={k.key} tone="secondary" onClick={() => setKind(k.key)}>{k.label}</Button>)}
        </div>
      ) : (
        <Card>
          <form onSubmit={save} className="space-y-3">
            <b className="text-lg">{KINDS.find((k) => k.key === kind)!.label}</b>
            {kind === 'visitor' && (
              <>
                <Field label="Tên khách"><Input value={form.visitor_name} onChange={set('visitor_name')} required /></Field>
                <Field label="Đơn vị"><Input value={form.visitor_org} onChange={set('visitor_org')} /></Field>
                <Field label="Gặp ai"><Input value={form.meet_whom} onChange={set('meet_whom')} /></Field>
                <Field label="Việc gì"><Input value={form.purpose} onChange={set('purpose')} /></Field>
              </>
            )}
            {kind === 'vehicle' && (
              <>
                <Field label="Biển số"><Input value={form.plate} onChange={set('plate')} required autoCapitalize="characters" /></Field>
                <Field label="Loại xe"><Input value={form.vehicle_kind} onChange={set('vehicle_kind')} placeholder="Xe máy, xe tải…" /></Field>
                <Field label="Hàng hoá"><Input value={form.cargo} onChange={set('cargo')} /></Field>
              </>
            )}
            {kind === 'asset' && (
              <>
                <Field label="Món"><Input value={form.item} onChange={set('item')} required /></Field>
                <div className="grid grid-cols-4 gap-1">
                  {ASSET_ACTIONS.map((a) => (
                    <button key={a.value} type="button" onClick={() => setForm({ ...form, asset_action: a.value })} className={`rounded-lg py-2 text-sm ${form.asset_action === a.value ? 'bg-teal-700 text-white' : 'border border-slate-300'}`}>{a.label}</button>
                  ))}
                </div>
                <Field label="Số lượng"><Input type="number" min={1} value={form.quantity} onChange={set('quantity')} /></Field>
                <Field label="Với ai"><Input value={form.counterpart} onChange={set('counterpart')} /></Field>
              </>
            )}
            <Field label={kind === 'note' ? 'Nội dung' : 'Ghi chú thêm'}>
              <textarea value={form.body} onChange={set('body')} required={kind === 'note'} rows={kind === 'note' ? 4 : 2} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
            </Field>
            <Field label="Ảnh (tuỳ chọn)"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Ghi sổ</Button>
              <Button type="button" tone="secondary" onClick={() => { setKind(null); setPhotos([]); }}>Thôi</Button>
            </div>
          </form>
        </Card>
      )}

      {waiting.filter((i) => i.kind === 'logbook').map((i) => <p key={i.id} className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">⏳ Chờ gửi: {i.label}</p>)}

      {inside.length > 0 && (
        <Card>
          <b>Đang ở trong ({inside.length})</b>
          {inside.map((l) => (
            <div key={l.id} className="flex items-center justify-between border-t border-slate-100 py-2">
              <span className="text-base">{LOGBOOK_TYPE[l.type]} · {text(l)} <span className="text-sm text-slate-400">vào {time(l.occurred_at)}</span></span>
              {leaving.has(l.id) ? <span className="text-sm text-amber-700">chờ gửi</span> : <button onClick={() => void exit(l)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-base">Ra</button>}
            </div>
          ))}
        </Card>
      )}

      <h2 className="pt-2 text-sm font-semibold uppercase text-slate-500">Hôm nay</h2>
      {today.map((l) => (
        <Card key={l.id}>
          <div className="text-sm text-slate-400">{time(l.occurred_at)} · {LOGBOOK_TYPE[l.type]} · {l.author_name}</div>
          <div className="text-base">{text(l)}{l.exited_at && <span className="text-sm text-slate-500"> · ra {time(l.exited_at)}</span>}</div>
          {l.type !== 'note' && l.body && <div className="text-sm text-slate-600">{l.body}</div>}
          {l.files.length > 0 && <div className="mt-2 flex gap-2">{l.files.map((f) => <AuthImage key={f.id} fileId={f.id} className="h-16 w-16" />)}</div>}
        </Card>
      ))}
      {!today.length && <p className="text-center text-slate-400">Chưa có dòng nào hôm nay</p>}
    </Screen>
  );
}
