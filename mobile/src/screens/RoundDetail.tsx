import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { stamp, time } from '../lib/format';
import { ROUND_STATUS, SCAN_FLAG } from '../lib/labels';

interface Round {
  site_name: string;
  route_name: string;
  expected_start: string;
  expected_end: string;
  status: string;
  late: boolean;
  employee_name: string | null;
  started_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  required_count: number;
  done_required: number;
  stops: { checkpoint_id: string; code: string; name: string; required: boolean; scanned_at: string | null; method: string | null; validity: string | null; flags: string[] }[];
  scans: { id: string; checkpoint_code: string; checkpoint_name: string; method: string; scanned_at: string; captured_offline: boolean; distance_m: number | null; photo_id: string | null; flags: string[]; validity: string }[];
}

const METHOD: Record<string, string> = { qr: 'QR', gps: 'GPS', photo: 'Ảnh' };

export function RoundDetail() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.request<Round>(`/patrol/rounds/${id}`).then(setR).catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra')); }, [id]);

  if (!r) return <Screen title="Vòng tuần" back><ErrorText error={error} /></Screen>;
  return (
    <Screen title={`${time(r.expected_start)}–${time(r.expected_end)}`} back>
      <Card>
        <Badge tone={ROUND_STATUS[r.status]?.tone ?? ''}>{ROUND_STATUS[r.status]?.label}</Badge>
        <div className="mt-2 text-lg font-semibold">{r.route_name} · {r.site_name}</div>
        <div className="text-base text-slate-600">{r.employee_name ?? 'Chưa ai đi'}{r.started_at && ` · bắt đầu ${time(r.started_at)}`}{r.late && <span className="text-amber-700"> (trễ)</span>}</div>
        {r.ended_at && <div className="text-sm text-slate-500">Kết thúc {time(r.ended_at)}{r.ended_by === 'system' ? ' (hệ thống tự đóng)' : ''} · {r.done_required}/{r.required_count} điểm bắt buộc</div>}
      </Card>
      <Card>
        {r.stops.map((s) => (
          <div key={s.checkpoint_id} className={`flex items-center justify-between border-t border-slate-100 py-2 first:border-0 ${!s.scanned_at && s.required && r.ended_at ? 'text-red-700' : ''}`}>
            <span>{s.scanned_at ? '✓' : '○'} {s.code} · {s.name}{!s.required && <span className="text-sm text-slate-400"> (không bắt buộc)</span>}</span>
            <span className="text-sm text-slate-500">{s.scanned_at ? `${time(s.scanned_at)} ${METHOD[s.method ?? ''] ?? ''}` : ''}</span>
          </div>
        ))}
      </Card>
      {r.scans.map((s) => (
        <Card key={s.id} className={s.validity === 'suspicious' ? 'border-red-300' : ''}>
          <div className="font-semibold">{s.checkpoint_code} · {s.checkpoint_name}</div>
          <div className="text-sm text-slate-500">{METHOD[s.method]} lúc {stamp(s.scanned_at)}{s.captured_offline ? ' · gửi bù khi mất sóng' : ''}{s.distance_m !== null ? ` · cách ${s.distance_m} m` : ''}</div>
          {s.flags.length > 0 && <div className="text-sm text-red-700">⚠ {s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</div>}
          {s.photo_id && <AuthImage fileId={s.photo_id} className="mt-2 h-32 w-32" />}
        </Card>
      ))}
    </Screen>
  );
}
