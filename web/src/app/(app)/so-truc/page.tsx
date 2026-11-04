'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { HANDOVER_STATUS, LOGBOOK_TYPE, logbookText, stamp, time } from '@/lib/format';
import { randomId as newId } from '@/lib/ids';
import { HandoverRow, LogbookRow, SiteRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function LogbookPage() {
  const { can } = useAuth();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [day, setDay] = useState(todayIso());
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<LogbookRow[]>([]);
  const [inside, setInside] = useState<LogbookRow[]>([]);
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Search once typing pauses, not on every key.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    const query = new URLSearchParams({ date: day, ...(type ? { type } : {}), ...(search ? { q: search } : {}) });
    const [book, in_, hand] = await Promise.all([
      api<LogbookRow[]>(`/sites/${siteId}/logbook?${query}`),
      api<LogbookRow[]>(`/sites/${siteId}/logbook/inside`),
      api<HandoverRow[]>(`/sites/${siteId}/handovers?date=${day}`),
    ]);
    setRows(book);
    setInside(in_);
    setHandovers(hand);
  }, [siteId, day, type, search]);

  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/sites/${siteId}/logbook`, { method: 'POST', json: { client_uuid: newId(), device_time: new Date().toISOString(), type: 'note', body: note } });
      setNote('');
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Sổ trực & giao ca</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
      </div>
      <ErrorText error={error} />

      {inside.length > 0 && (
        <Card title={`Đang ở trong (${inside.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {inside.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-1.5">
                <span><b>{LOGBOOK_TYPE[l.type]}</b> · {logbookText(l)} <span className="text-slate-400">vào {stamp(l.occurred_at)}</span></span>
                {can('logbook.manage') && (
                  <Button variant="secondary" onClick={() => run(() => api(`/logbook/${l.id}/exit`, { method: 'POST', json: { device_time: new Date().toISOString() } }))}>Ghi giờ ra</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Sổ trực">
        <div className="mb-3 flex flex-wrap gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-44">
            <option value="">Mọi loại</option>
            {Object.entries(LOGBOOK_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm: biển số, tên khách, nội dung…" className="w-72" />
        </div>
        {can('logbook.manage') && (
          <form onSubmit={addNote} className="mb-3 flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú từ văn phòng…" required />
            <Button type="submit">Ghi</Button>
          </form>
        )}
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((l) => (
            <li key={l.id} className="flex gap-3 py-2">
              <span className="w-12 shrink-0 text-slate-500">{time(l.occurred_at)}</span>
              <div className="flex-1">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{LOGBOOK_TYPE[l.type]}</span>
                {logbookText(l)}
                {l.type !== 'note' && l.type !== 'other' && l.body && <span className="text-slate-500"> — {l.body}</span>}
                {l.exited_at && <span className="ml-2 text-xs text-slate-500">ra {time(l.exited_at)}</span>}
                <div className="text-xs text-slate-400">{l.author_name}{l.captured_offline ? ' · gửi bù khi mất sóng' : ''}</div>
                {l.files.length > 0 && (
                  <div className="mt-1 flex gap-1">
                    {l.files.map((f) => (
                      <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${f.id}`} alt="" className="h-14 w-14 rounded border border-slate-200 object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
          {!rows.length && <li className="py-6 text-center text-slate-400">Chưa có dòng nào trong ngày</li>}
        </ul>
      </Card>

      <Card title="Giao ca trong ngày">
        <ul className="space-y-3 text-sm">
          {handovers.map((h) => (
            <li key={h.id} className="rounded border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{h.from_name}</b> → <b>{h.to_name ?? 'chưa rõ người nhận'}</b>
                <span className="text-slate-400">{stamp(h.submitted_at)}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${HANDOVER_STATUS[h.status].tone}`}>{HANDOVER_STATUS[h.status].label}</span>
                {h.reviewed_at && <span className="text-xs text-teal-700">Đã duyệt · {h.reviewed_by_name}</span>}
              </div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {h.items.map((i) => (
                  <li key={i.label} className={i.status === 'ok' ? 'text-slate-600' : 'font-medium text-red-700'}>
                    {i.status === 'ok' ? '✓' : '✗'} {i.label}{i.status !== 'ok' && ` — ${i.status === 'missing' ? 'thiếu' : 'có vấn đề'}`}{i.note ? `: ${i.note}` : ''}
                  </li>
                ))}
              </ul>
              {h.notes && <p className="mt-1 text-slate-600">Ghi chú: {h.notes}</p>}
              {h.receiver_note && <p className="mt-1 text-red-700">Người nhận: {h.receiver_note}</p>}
              {h.review_note && <p className="mt-1 text-slate-600">Đội trưởng: {h.review_note}</p>}
              {h.file_ids.length > 0 && (
                <div className="mt-2 flex gap-1">
                  {h.file_ids.map((f) => (
                    <a key={f} href={`/api/files/${f}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/files/${f}`} alt="" className="h-14 w-14 rounded border border-slate-200 object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {can('handover.review') && !h.reviewed_at && (h.status !== 'submitted' || !h.to_name) && (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => {
                    const text = window.prompt('Nhận xét khi duyệt (không bắt buộc):');
                    if (text !== null) void run(() => api(`/handovers/${h.id}/review`, { method: 'POST', json: text.trim() ? { note: text.trim() } : {} }));
                  }}
                >
                  Duyệt biên bản
                </Button>
              )}
            </li>
          ))}
          {!handovers.length && <li className="text-slate-400">Chưa có biên bản giao ca nào trong ngày</li>}
        </ul>
      </Card>
    </div>
  );
}
