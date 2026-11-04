import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { stamp } from '../lib/format';
import { INCIDENT_STATUS, SEVERITY } from '../lib/labels';

export interface IncidentRow {
  id: string;
  code: string;
  title: string;
  severity: string;
  is_sos: boolean;
  status: string;
  site_name: string | null;
  client_name: string;
  reporter_name: string | null;
  source: string;
  created_at: string;
  escalation_level: number;
}

const FILTERS = [
  { value: 'open', label: 'Đang mở' },
  { value: 'new', label: 'Chưa ai nhận' },
  { value: '', label: 'Tất cả' },
];
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function Incidents() {
  const { can } = useAuth();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.request<IncidentRow[]>(`/incidents${status ? `?status=${status}` : ''}`);
      // Unanswered first, then the most serious, then the newest.
      list.sort((a, b) => Number(b.status === 'new') - Number(a.status === 'new') || RANK[a.severity] - RANK[b.severity] || b.created_at.localeCompare(a.created_at));
      setRows(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [status]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Screen title="Sự cố" action={can('incident.manage') ? <Link to="/su-co/moi" className="rounded-lg bg-white/20 px-3 py-1 text-base font-semibold">+ Ghi nhận</Link> : undefined}>
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setStatus(f.value)} className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${status === f.value ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>{f.label}</button>
        ))}
      </div>
      <ErrorText error={error} />
      {rows?.map((r) => (
        <Link key={r.id} to={`/su-co/${r.id}`} className="block">
          <Card className={r.status === 'new' && (r.severity === 'critical' || r.is_sos) ? 'border-red-400 bg-red-50' : ''}>
            <div className="flex items-center gap-2">
              <Badge tone={SEVERITY[r.severity]?.tone ?? ''}>{r.is_sos ? 'SOS' : SEVERITY[r.severity]?.label}</Badge>
              <Badge tone={INCIDENT_STATUS[r.status]?.tone ?? ''}>{INCIDENT_STATUS[r.status]?.label}</Badge>
              <span className="ml-auto text-sm text-slate-400">{stamp(r.created_at)}</span>
            </div>
            <div className="mt-1 text-lg font-semibold">{r.title}</div>
            <div className="text-sm text-slate-500">{r.site_name ?? r.client_name} · {r.source === 'client_report' ? 'Khách báo' : r.reporter_name}</div>
            {r.status === 'new' && r.escalation_level > 1 && <div className="text-sm text-red-700">Đã leo thang cấp {r.escalation_level}</div>}
          </Card>
        </Link>
      ))}
      {rows && !rows.length && <p className="py-10 text-center text-slate-400">Không có sự cố nào</p>}
    </Screen>
  );
}
