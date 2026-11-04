import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { ContactList, SiteContact } from '../components/ContactList';
import { PhotoStrip, uploadAll } from '../components/PhotoStrip';
import { Badge, Button, Card, ErrorText, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { stamp } from '../lib/format';
import { IncidentStep, incidentActions } from '../lib/incident-rules';
import { INCIDENT_STATUS, SEVERITY, STEP_LABEL } from '../lib/labels';

interface Detail {
  id: string;
  code: string;
  title: string;
  severity: string;
  is_sos: boolean;
  status: string;
  site_id: string | null;
  site_name: string | null;
  client_name: string;
  description: string | null;
  reporter_name: string | null;
  source: string;
  client_reporter_name: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  lat: string | null;
  lng: string | null;
  resolution_note: string | null;
  rejected_reason: string | null;
  created_at: string;
  events: { id: string; type: string; actor_name: string | null; body: string | null; to_status: string | null; data: { level?: number }; created_at: string }[];
  files: { id: string }[];
  can_close: boolean;
  occurred_at: string;
  sent_late: boolean;
}

interface Assignee {
  user_id: string;
  full_name: string;
  on_shift: boolean;
}

/** Steps that need words from the person: what was done, or why. */
const NEEDS_TEXT: Partial<Record<IncidentStep, { field: 'note' | 'reason' | 'body'; prompt: string; required: boolean; photos: boolean }>> = {
  resolve: { field: 'note', prompt: 'Đã xử lý thế nào?', required: true, photos: true },
  reopen: { field: 'reason', prompt: 'Vì sao mở lại?', required: true, photos: false },
  reject: { field: 'reason', prompt: 'Vì sao là báo nhầm?', required: true, photos: false },
  comment: { field: 'body', prompt: 'Bình luận, cập nhật…', required: true, photos: true },
};

function describe(e: Detail['events'][number]): string {
  if (e.type === 'created') return 'báo sự cố';
  if (e.type === 'acknowledged') return 'tiếp nhận';
  if (e.type === 'assigned') return 'giao việc';
  if (e.type === 'comment') return 'bình luận';
  if (e.type === 'contact_called') return 'liên hệ đầu mối khách hàng';
  if (e.type === 'escalated') return `leo thang cấp ${e.data.level ?? ''}`;
  if (e.type === 'status_changed' && e.to_status) return `→ ${INCIDENT_STATUS[e.to_status]?.label ?? e.to_status}`;
  return e.type;
}

export function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const [i, setI] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<IncidentStep | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Assignee[] | null>(null);
  // Photos already uploaded for the current form: a retry after a failure reuses them.
  const [uploaded, setUploaded] = useState<{ photos: Blob[]; ids: string[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setI(await api.request<Detail>(`/incidents/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  // Someone else may act on it meanwhile: refresh while nobody is typing here.
  useEffect(() => {
    if (step || people) return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load, step, people]);

  async function run(path: string, json: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      setI(await api.request<Detail>(`/incidents/${id}/${path}`, { json }));
      setStep(null);
      setText('');
      setPhotos([]);
      setPeople(null);
      setUploaded(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Không có mạng — thao tác này cần mạng.' : e instanceof Error ? e.message : 'Có lỗi xảy ra');
      // The incident may have moved on (someone else acted): show it as it is now.
      if (!(e instanceof NetworkError)) void load();
    } finally {
      setBusy(false);
    }
  }

  async function choose(s: IncidentStep) {
    setError(null);
    if (s === 'assign') {
      try {
        setPeople(await api.request<Assignee[]>(`/incidents/${id}/assignees`));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
      }
      return;
    }
    if (NEEDS_TEXT[s]) {
      setStep(s);
      return;
    }
    await run(s);
  }

  async function submitText() {
    if (!step) return;
    const need = NEEDS_TEXT[step]!;
    if (need.required && !text.trim()) return setError(need.prompt);
    setBusy(true);
    try {
      let file_ids: string[] | undefined;
      if (need.photos && photos.length) {
        file_ids = uploaded && uploaded.photos === photos ? uploaded.ids : await uploadAll((b, n) => api.upload(b, n), photos);
        setUploaded({ photos, ids: file_ids });
      }
      setBusy(false);
      await run(step === 'comment' ? 'comments' : step, { [need.field]: text.trim(), ...(file_ids ? { file_ids } : {}) });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Không tải được ảnh');
    }
  }

  /** A call or Zalo to the client's contact goes on the timeline; the call itself never waits for it. */
  function contacted(c: SiteContact, channel: 'phone' | 'zalo' | 'email') {
    api.request<Detail>(`/incidents/${id}/contact-calls`, { json: { contact_id: c.id, channel } }).then(setI).catch(() => undefined);
  }

  if (!i || !me) return <Screen title="Sự cố" back><ErrorText error={error} /></Screen>;
  const steps = incidentActions(i, me.permissions, me.user.id);

  return (
    <Screen title={i.code} back>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY[i.severity]?.tone ?? ''}>{i.is_sos ? 'SOS' : SEVERITY[i.severity]?.label}</Badge>
          <Badge tone={INCIDENT_STATUS[i.status]?.tone ?? ''}>{INCIDENT_STATUS[i.status]?.label}</Badge>
        </div>
        <div className="mt-2 text-xl font-semibold">{i.title}</div>
        <div className="text-slate-600">{i.site_name ?? '—'} · {i.client_name}</div>
        <div className="text-sm text-slate-500">
          {stamp(i.created_at)} · {i.source === 'client_report' ? `Khách báo${i.client_reporter_name ? ` (${i.client_reporter_name})` : ''}, ghi bởi ${i.reporter_name}` : i.reporter_name}
        </div>
        {i.sent_late && <div className="text-sm font-medium text-amber-700">Xảy ra lúc {stamp(i.occurred_at)} — gửi muộn khi có sóng</div>}
        <div className="text-sm text-slate-500">Người xử lý: {i.assignee_name ?? 'chưa giao'}</div>
        {i.description && <p className="mt-2 whitespace-pre-wrap text-base">{i.description}</p>}
        {i.lat && i.lng && <a href={`https://www.google.com/maps?q=${i.lat},${i.lng}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-teal-700 underline">Xem vị trí trên bản đồ</a>}
        {i.resolution_note && <p className="mt-2 rounded-lg bg-teal-50 p-2"><b>Đã xử lý:</b> {i.resolution_note}</p>}
        {i.rejected_reason && <p className="mt-2 rounded-lg bg-slate-100 p-2"><b>Báo nhầm:</b> {i.rejected_reason}</p>}
        {i.files.length > 0 && <div className="mt-2 grid grid-cols-3 gap-2">{i.files.map((f) => <AuthImage key={f.id} fileId={f.id} className="aspect-square w-full" />)}</div>}
      </Card>

      <ErrorText error={error} />

      {people && (
        <Card>
          <div className="mb-2 font-semibold">Giao cho ai?</div>
          {people.map((p) => (
            <button key={p.user_id} disabled={busy} onClick={() => void run('assign', { user_id: p.user_id })} className="flex w-full items-center justify-between border-t border-slate-100 py-3 text-left text-lg">
              {p.full_name}
              {p.on_shift && <span className="text-sm text-teal-700">đang trực</span>}
            </button>
          ))}
          {!people.some((p) => p.user_id === me.user.id) && (
            <button disabled={busy} onClick={() => void run('assign', { user_id: me.user.id })} className="w-full border-t border-slate-100 py-3 text-left text-lg text-teal-700">Giao cho tôi</button>
          )}
          <Button tone="secondary" onClick={() => setPeople(null)}>Thôi</Button>
        </Card>
      )}

      {step ? (
        <Card>
          <div className="mb-2 font-semibold">{STEP_LABEL[step]}</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={NEEDS_TEXT[step]!.prompt} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
          {NEEDS_TEXT[step]!.photos && <div className="mt-2"><PhotoStrip photos={photos} onChange={setPhotos} onError={setError} /></div>}
          {step === 'resolve' && (i.severity === 'high' || i.severity === 'critical') && !i.files.length && (
            <p className="mt-2 text-sm text-amber-700">Sự cố mức cao cần ít nhất một ảnh.</p>
          )}
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void submitText()} disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi'}</Button>
            <Button tone="secondary" onClick={() => { setStep(null); setText(''); setPhotos([]); }}>Thôi</Button>
          </div>
        </Card>
      ) : !people && (
        <div className="grid grid-cols-2 gap-2">
          {steps.map((s) => (
            <Button key={s} tone={s === 'acknowledge' || s === 'resolve' || s === 'start' ? 'primary' : s === 'reject' ? 'danger' : 'secondary'} disabled={busy} onClick={() => void choose(s)} className={s === 'acknowledge' ? 'col-span-2' : ''}>
              {STEP_LABEL[s]}
            </Button>
          ))}
        </div>
      )}

      {i.site_id && !['closed', 'rejected'].includes(i.status) && (
        <>
          <h2 className="pt-1 text-sm font-semibold uppercase text-slate-500">Đầu mối liên hệ tại mục tiêu</h2>
          <ContactList siteId={i.site_id} onUse={contacted} empty="Chưa có đầu mối nào bạn được liên hệ" />
        </>
      )}

      <Card>
        <div className="mb-2 font-semibold">Dòng thời gian</div>
        <ol className="space-y-2">
          {i.events.map((e) => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3 text-base">
              <span className="text-sm text-slate-400">{stamp(e.created_at)}</span> · <b>{e.actor_name ?? 'Hệ thống'}</b> {describe(e)}
              {e.body && <p className="whitespace-pre-wrap text-slate-700">{e.body}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </Screen>
  );
}
