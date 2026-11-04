'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { CONTACT_LEVEL } from '@/lib/format';
import { ContactLevel, IncidentDetail, SiteContact } from '@/lib/types';

const EMPTY = { full_name: '', title: '', phone: '', zalo: '', email: '', hours: '', priority: '1', visibility: 'staff' as ContactLevel, note: '' };
type Draft = typeof EMPTY;

const toDraft = (c: SiteContact): Draft => ({
  full_name: c.full_name, title: c.title ?? '', phone: c.phone ?? '', zalo: c.zalo ?? '', email: c.email ?? '',
  hours: c.hours ?? '', priority: String(c.priority), visibility: c.visibility, note: c.note ?? '',
});
const toJson = (d: Draft) => ({
  full_name: d.full_name.trim(), title: d.title.trim() || null, phone: d.phone.trim() || null, zalo: d.zalo.trim() || null,
  email: d.email.trim() || null, hours: d.hours.trim() || null, priority: Number(d.priority) || 1, visibility: d.visibility, note: d.note.trim() || null,
});

/** How to reach someone: tel / Zalo / mail links, each reported back through `onUse` (the incident timeline). */
function Reach({ c, onUse }: { c: SiteContact; onUse?: (channel: 'phone' | 'zalo' | 'email') => void }) {
  const link = 'text-teal-700 hover:underline';
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {c.phone && <a className={link} href={`tel:${c.phone}`} onClick={() => onUse?.('phone')}>📞 {c.phone}</a>}
      {c.zalo && <a className={link} href={`https://zalo.me/${c.zalo}`} target="_blank" rel="noreferrer" onClick={() => onUse?.('zalo')}>💬 Zalo</a>}
      {c.email && <a className={link} href={`mailto:${c.email}`} onClick={() => onUse?.('email')}>✉️ {c.email}</a>}
    </span>
  );
}

function Level({ level }: { level: string }) {
  const l = CONTACT_LEVEL[level];
  return <span className={`rounded px-1.5 py-0.5 text-xs ${l.tone}`} title={`Ai xem được: ${l.hint}`}>{l.label}</span>;
}

function ContactForm({ draft, setDraft, onSubmit, onCancel, submit }: {
  draft: Draft; setDraft: (d: Draft) => void; onSubmit: (e: FormEvent) => void; onCancel?: () => void; submit: string;
}) {
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Họ tên"><Input value={draft.full_name} onChange={set('full_name')} required /></Field>
        <Field label="Chức danh"><Input value={draft.title} onChange={set('title')} placeholder="Trưởng BQL, kỹ thuật trực…" /></Field>
        <Field label="Số điện thoại"><Input value={draft.phone} onChange={set('phone')} /></Field>
        <Field label="Zalo (số)"><Input value={draft.zalo} onChange={set('zalo')} /></Field>
        <Field label="Email"><Input type="email" value={draft.email} onChange={set('email')} /></Field>
        <Field label="Giờ liên hệ"><Input value={draft.hours} onChange={set('hours')} placeholder="Giờ hành chính, 24/7…" /></Field>
        <Field label="Thứ tự gọi"><Input type="number" min={1} max={99} value={draft.priority} onChange={set('priority')} /></Field>
        <Field label="Ai được xem và liên hệ">
          <Select value={draft.visibility} onChange={set('visibility')}>
            {Object.entries(CONTACT_LEVEL).map(([k, v]) => <option key={k} value={k}>{v.label} — {v.hint}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Ghi chú"><Input value={draft.note} onChange={set('note')} placeholder="Gọi khi nào, việc gì…" /></Field>
      <div className="flex gap-2">
        <Button type="submit">{submit}</Button>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Huỷ</Button>}
      </div>
    </form>
  );
}

/** The site's contacts at the client, on the site page: what this person may see, and editing for contact.manage. */
export function SiteContacts({ siteId, manage }: { siteId: string; manage: boolean }) {
  const [rows, setRows] = useState<SiteContact[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setRows(await api<SiteContact[]>(`/sites/${siteId}/contacts`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  return (
    <Card title="Đầu mối liên hệ tại mục tiêu">
      <p className="mb-3 text-xs text-slate-500">
        Mỗi đầu mối chọn ai được xem và liên hệ: Văn phòng (chỉ quản lý, HR, kế toán), Đội trưởng (thêm đội trưởng phụ trách) hoặc Bảo vệ (thêm bảo vệ đang có ca tại đây).
      </p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr><th className="py-2">#</th><th>Đầu mối</th><th>Liên hệ</th><th>Giờ</th><th>Ai xem được</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((c) => editing?.id === c.id ? (
            <tr key={c.id} className="border-t border-slate-100"><td colSpan={6} className="py-3">
              <ContactForm
                draft={editing.draft} setDraft={(d) => setEditing({ id: c.id, draft: d })} submit="Lưu" onCancel={() => setEditing(null)}
                onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/site-contacts/${c.id}`, { method: 'PATCH', json: toJson(editing.draft) }))) setEditing(null); }}
              />
            </td></tr>
          ) : (
            <tr key={c.id} className="border-t border-slate-100 align-top">
              <td className="py-2 text-slate-400">{c.priority}</td>
              <td>
                <div className="font-medium">{c.full_name}</div>
                {c.title && <div className="text-xs text-slate-500">{c.title}</div>}
                {c.note && <div className="text-xs text-slate-500">{c.note}</div>}
              </td>
              <td><Reach c={c} /></td>
              <td>{c.hours ?? '—'}</td>
              <td><Level level={c.visibility} /></td>
              <td className="space-x-2 text-right">
                {manage && (
                  <>
                    <Button variant="secondary" onClick={() => setEditing({ id: c.id, draft: toDraft(c) })}>Sửa</Button>
                    <Button variant="secondary" onClick={() => window.confirm(`Xoá đầu mối ${c.full_name}?`) && void run(() => api(`/site-contacts/${c.id}`, { method: 'DELETE' }))}>Xoá</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="py-4 text-center text-slate-400">Chưa có đầu mối nào bạn được xem</td></tr>}
        </tbody>
      </table></div>
      {manage && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold">Thêm đầu mối</h3>
          <ContactForm
            draft={draft} setDraft={setDraft} submit="Thêm đầu mối"
            onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/sites/${siteId}/contacts`, { method: 'POST', json: toJson(draft) }))) setDraft(EMPTY); }}
          />
        </div>
      )}
      <ErrorText error={error} />
    </Card>
  );
}

/**
 * On an incident: the site's contacts this person may reach. Tapping a number calls; "Đã liên hệ" (or the link
 * itself) writes the contact into the incident timeline so everyone knows the client has been told.
 */
export function IncidentContacts({ incident, onChange }: { incident: IncidentDetail; onChange: (i: IncidentDetail) => void }) {
  const [rows, setRows] = useState<SiteContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const siteId = incident.site_id;

  useEffect(() => {
    if (!siteId) return;
    api<SiteContact[]>(`/sites/${siteId}/contacts`).then(setRows).catch(() => setRows([]));
  }, [siteId]);

  async function logged(c: SiteContact, channel: 'phone' | 'zalo' | 'email') {
    setError(null);
    try {
      onChange(await api<IncidentDetail>(`/incidents/${incident.id}/contact-calls`, { method: 'POST', json: { contact_id: c.id, channel } }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!siteId || !rows?.length) return null;
  return (
    <Card title="Đầu mối liên hệ tại mục tiêu">
      <ul className="space-y-2 text-sm">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
            <div>
              <span className="font-medium">{c.full_name}</span>
              {c.title && <span className="text-slate-500"> · {c.title}</span>}
              {c.hours && <span className="text-xs text-slate-400"> · {c.hours}</span>}
              <div className="mt-0.5"><Reach c={c} onUse={(ch) => void logged(c, ch)} /></div>
            </div>
            <Button variant="secondary" onClick={() => void logged(c, c.phone ? 'phone' : c.zalo ? 'zalo' : 'email')}>Ghi đã liên hệ</Button>
          </li>
        ))}
      </ul>
      <ErrorText error={error} />
    </Card>
  );
}
