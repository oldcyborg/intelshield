'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { IncidentContacts } from '@/components/site-contacts';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CLIENT_CHANNEL, INCIDENT_SOURCE, INCIDENT_STATUS, SEVERITY, stamp } from '@/lib/format';
import { IncidentDetail, IncidentEvent, UserRow } from '@/lib/types';

function describe(e: IncidentEvent): string {
  if (e.type === 'created') return 'báo sự cố';
  if (e.type === 'acknowledged') return 'tiếp nhận';
  if (e.type === 'assigned') return 'giao việc';
  if (e.type === 'comment') return 'bình luận';
  if (e.type === 'contact_called') return 'liên hệ đầu mối khách hàng';
  if (e.type === 'escalated') return `chưa ai tiếp nhận — leo thang lên cấp ${e.data.level}`;
  if (e.type === 'status_changed' && e.to_status) return `chuyển sang "${INCIDENT_STATUS[e.to_status].label}"`;
  return e.type;
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setIncident(await api<IncidentDetail>(`/incidents/${id}`)), [id]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    if (can('user.view')) api<UserRow[]>('/users').then((u) => setUsers(u.filter((x) => x.status === 'active'))).catch(() => undefined);
  }, [load, can]);

  /** Every button posts here; the server decides whether this person may take this step now. */
  async function act(step: string, json: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    // Only a resolution or a comment carries photos; the other steps keep the selection for later.
    const withPhotos = step === 'resolve' || step === 'comments';
    try {
      const file_ids = [];
      if (withPhotos) for (const p of photos) file_ids.push((await uploadFile(p)).id);
      setIncident(await api<IncidentDetail>(`/incidents/${id}/${step}`, { method: 'POST', json: { ...json, ...(file_ids.length ? { file_ids } : {}) } }));
      if (step !== 'assign') setText('');
      if (withPhotos) setPhotos([]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!incident) return <ErrorText error={error} />;
  const i = incident;
  const manage = can('incident.manage');
  const mine = i.assignee_user_id === me.user.id;
  const needsText = (step: string, field: string) => () => {
    if (!text.trim()) return setError(step === 'resolve' ? 'Ghi rõ đã xử lý thế nào vào ô bên dưới' : 'Ghi lý do vào ô bên dưới');
    act(step, { [field]: text.trim() });
  };

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/su-co" className="text-sm text-teal-700 hover:underline">← Danh sách sự cố</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{i.code} · {i.title}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${SEVERITY[i.severity].tone}`}>{i.is_sos ? 'SOS' : SEVERITY[i.severity].label}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${INCIDENT_STATUS[i.status].tone}`}>{INCIDENT_STATUS[i.status].label}</span>
      </div>

      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Nơi xảy ra</dt><dd>{i.site_name ?? '—'} · {i.client_name}</dd></div>
          <div>
            <dt className="text-slate-500">Lúc báo</dt>
            <dd>
              {stamp(i.created_at)}
              {i.sent_late && i.occurred_at && <span className="ml-1 text-amber-700">(xảy ra {stamp(i.occurred_at)} — gửi muộn khi có sóng)</span>}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Nguồn</dt>
            <dd>
              {INCIDENT_SOURCE[i.source]}: {i.source === 'client_report' ? `${i.client_reporter_name ?? 'khách'}${i.client_channel ? ` qua ${CLIENT_CHANNEL[i.client_channel]}` : ''} — ghi bởi ${i.reporter_name}` : i.reporter_name}
            </dd>
          </div>
          <div><dt className="text-slate-500">Người xử lý</dt><dd>{i.assignee_name ?? 'Chưa giao'}</dd></div>
          {i.lat !== null && i.lng !== null && (
            <div><dt className="text-slate-500">Vị trí</dt><dd><a className="text-teal-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${i.lat},${i.lng}`}>Xem bản đồ</a></dd></div>
          )}
        </dl>
        {i.description && <p className="mt-3 whitespace-pre-wrap text-sm">{i.description}</p>}
        {i.resolution_note && <p className="mt-3 rounded bg-teal-50 p-2 text-sm"><b>Đã xử lý:</b> {i.resolution_note}</p>}
        {i.rejected_reason && <p className="mt-3 rounded bg-slate-100 p-2 text-sm"><b>Báo nhầm:</b> {i.rejected_reason}</p>}
        {!!i.files.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {i.files.map((f) => (
              <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${f.id}`} alt={f.original_name} className="h-24 w-24 rounded border border-slate-200 object-cover" />
              </a>
            ))}
          </div>
        )}
      </Card>

      <IncidentContacts incident={i} onChange={setIncident} />

      <Card title="Xử lý">
        <div className="flex flex-wrap gap-2">
          {manage && i.status === 'new' && <Button onClick={() => act('acknowledge')} disabled={busy}>Tôi tiếp nhận</Button>}
          {(manage || mine) && i.status === 'acknowledged' && <Button onClick={() => act('start')} disabled={busy}>Bắt đầu xử lý</Button>}
          {(manage || mine) && (i.status === 'acknowledged' || i.status === 'in_progress') && (
            <Button onClick={needsText('resolve', 'note')} disabled={busy}>Đã xử lý xong</Button>
          )}
          {(manage || can('incident.close')) && i.status === 'resolved' && <Button onClick={() => act('close')} disabled={busy}>Đóng sự cố</Button>}
          {manage && i.status === 'resolved' && <Button variant="secondary" onClick={needsText('reopen', 'reason')} disabled={busy}>Mở lại</Button>}
          {manage && ['new', 'acknowledged', 'in_progress'].includes(i.status) && (
            <Button variant="secondary" onClick={needsText('reject', 'reason')} disabled={busy}>Báo nhầm</Button>
          )}
          {manage && !['closed', 'rejected'].includes(i.status) && (
            users.length ? (
              <Select value="" onChange={(e) => e.target.value && act('assign', { user_id: e.target.value })} className="w-56" disabled={busy}>
                <option value="">Giao cho…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            ) : (
              <Button variant="secondary" onClick={() => act('assign', { user_id: me.user.id })} disabled={busy}>Giao cho tôi</Button>
            )
          )}
        </div>
        {(i.severity === 'high' || i.severity === 'critical') && ['acknowledged', 'in_progress'].includes(i.status) && !i.files.length && (
          <p className="mt-2 text-xs text-amber-700">Sự cố mức cao cần ít nhất một ảnh trước khi báo đã xử lý — đính kèm ảnh ở dưới.</p>
        )}
        <form
          className="mt-3 space-y-2"
          onSubmit={(e: FormEvent) => { e.preventDefault(); if (text.trim()) act('comments', { body: text.trim() }); }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Ghi chú, cách xử lý, lý do…" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          <div className="flex items-center gap-2">
            <Input type="file" accept="image/jpeg,image/png" multiple onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))} className="w-72" />
            <Button type="submit" variant="secondary" disabled={busy}>Gửi bình luận</Button>
          </div>
          <ErrorText error={error} />
        </form>
      </Card>

      <Card title="Dòng thời gian">
        <ol className="space-y-2 text-sm">
          {i.events.map((e) => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3">
              <span className="text-slate-500">{stamp(e.created_at)}</span> · <b>{e.actor_name ?? 'Hệ thống'}</b> {describe(e)}
              {e.body && <p className="whitespace-pre-wrap text-slate-700">{e.body}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
