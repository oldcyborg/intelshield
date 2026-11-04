import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { api } from '../lib/client';
import { Card, ErrorText } from './ui';

export interface SiteContact {
  id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  zalo: string | null;
  email: string | null;
  hours: string | null;
  note: string | null;
}

/**
 * The client's people at a site that this person may reach (the server decides which), closest first.
 * `onUse` hears each call or Zalo tap — on an incident it is written to the timeline.
 */
export function ContactList({ siteId, onUse, empty }: { siteId: string; onUse?: (c: SiteContact, channel: 'phone' | 'zalo' | 'email') => void; empty?: string }) {
  const [rows, setRows] = useState<SiteContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.request<SiteContact[]>(`/sites/${siteId}/contacts`).then(setRows).catch((e) => {
      // Not this person's site to reach: simply no contacts.
      if (e instanceof ApiError && e.status === 404) setRows([]);
      else setError(e instanceof Error ? e.message : 'Không tải được đầu mối');
    });
  }, [siteId]);

  if (error) return <ErrorText error={error} />;
  if (!rows) return null;
  if (!rows.length) return empty ? <p className="py-6 text-center text-slate-400">{empty}</p> : null;
  const button = 'flex flex-1 items-center justify-center rounded-xl py-3 text-base font-semibold';
  return (
    <>
      {rows.map((c) => (
        <Card key={c.id}>
          <div className="text-lg font-semibold">{c.full_name}</div>
          <div className="text-sm text-slate-500">{[c.title, c.hours].filter(Boolean).join(' · ')}</div>
          {c.note && <div className="text-sm text-slate-600">{c.note}</div>}
          <div className="mt-3 flex gap-2">
            {c.phone && <a href={`tel:${c.phone}`} onClick={() => onUse?.(c, 'phone')} className={`${button} bg-teal-700 text-white`}>📞 Gọi {c.phone}</a>}
            {c.zalo && <a href={`https://zalo.me/${c.zalo}`} target="_blank" rel="noreferrer" onClick={() => onUse?.(c, 'zalo')} className={`${button} border border-slate-300 bg-white`}>💬 Zalo</a>}
            {!c.phone && !c.zalo && c.email && <a href={`mailto:${c.email}`} onClick={() => onUse?.(c, 'email')} className={`${button} border border-slate-300 bg-white`}>✉️ Email</a>}
          </div>
        </Card>
      ))}
    </>
  );
}
