'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { METHOD_LABEL, ROUND_STATUS, SCAN_FLAG, stamp, time } from '@/lib/format';
import { RoundDetail } from '@/lib/types';

export default function RoundPage() {
  const { id } = useParams<{ id: string }>();
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<RoundDetail>(`/patrol/rounds/${id}`).then(setRound).catch((e) => setError(errorMessage(e))); }, [id]);
  if (!round) return <ErrorText error={error} />;
  const r = round;

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/tuan-tra" className="text-sm text-teal-700 hover:underline">← Bảng tuần tra</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{r.site_name} · {r.route_name} · {time(r.expected_start)}–{time(r.expected_end)}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${ROUND_STATUS[r.status].tone}`}>{ROUND_STATUS[r.status].label}</span>
      </div>
      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Người tuần</dt><dd>{r.employee_name ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Bắt đầu</dt><dd>{stamp(r.started_at)}{r.late && <span className="ml-1 text-amber-700">(trễ)</span>}</dd></div>
          <div><dt className="text-slate-500">Kết thúc</dt><dd>{stamp(r.ended_at)}{r.ended_by === 'system' && <span className="ml-1 text-slate-500">(hệ thống tự đóng)</span>}</dd></div>
          <div><dt className="text-slate-500">Điểm bắt buộc</dt><dd>{r.done_required}/{r.required_count}</dd></div>
        </dl>
      </Card>
      <Card title="Các điểm">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">#</th><th>Điểm</th><th>Xác nhận lúc</th><th>Cách</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {r.stops.map((s) => (
              <tr key={s.checkpoint_id} className={`border-t border-slate-100 ${!s.scanned_at && s.required && r.ended_at ? 'bg-red-50' : ''}`}>
                <td className="py-2 text-slate-400">{s.seq}</td>
                <td>{s.code} · {s.name}{!s.required && <span className="ml-1 text-xs text-slate-400">(không bắt buộc)</span>}{s.photo_required && <span className="ml-1 text-xs text-slate-500">· cần ảnh</span>}</td>
                <td>{s.scanned_at ? time(s.scanned_at) : <span className="text-slate-400">chưa</span>}</td>
                <td>{s.method ? METHOD_LABEL[s.method] : '—'}</td>
                <td className={s.validity === 'suspicious' ? 'text-red-700' : 'text-slate-500'}>{s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      <Card title="Các lần quét">
        <ul className="space-y-3 text-sm">
          {r.scans.map((s) => (
            <li key={s.id} className="flex gap-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              {s.photo_id && (
                <a href={`/api/files/${s.photo_id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${s.photo_id}`} alt={s.checkpoint_name} className="h-20 w-20 rounded border border-slate-200 object-cover" />
                </a>
              )}
              <div>
                <div><b>{s.checkpoint_code} · {s.checkpoint_name}</b> — {METHOD_LABEL[s.method]} lúc {stamp(s.scanned_at)} · {s.employee_name}</div>
                <div className="text-xs text-slate-500">
                  {s.captured_offline ? `quét khi mất sóng, gửi lúc ${stamp(s.server_time)}` : 'gửi ngay'}
                  {s.distance_m !== null && ` · cách điểm ${s.distance_m} m`}
                  {s.accuracy_m !== null && ` · GPS ±${s.accuracy_m} m`}
                  {s.lat && s.lng && <> · <a className="text-teal-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}>bản đồ</a></>}
                </div>
                {s.flags.length > 0 && <div className={`text-xs ${s.validity === 'suspicious' ? 'text-red-700' : 'text-amber-700'}`}>{s.flags.map((f) => SCAN_FLAG[f] ?? f).join(', ')}</div>}
              </div>
            </li>
          ))}
          {!r.scans.length && <li className="text-slate-400">Chưa có lần quét nào</li>}
        </ul>
      </Card>
    </div>
  );
}
