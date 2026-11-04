'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { ROUND_STATUS, time } from '@/lib/format';
import { RoundRow, RoundStatus, SiteRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function PatrolBoardPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [day, setDay] = useState(todayIso());
  const [data, setData] = useState<{ summary: Record<string, number>; rounds: RoundRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (siteId) setData(await api(`/patrol/rounds?site_id=${siteId}&date=${day}`));
  }, [siteId, day]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    const timer = setInterval(() => load().catch(() => undefined), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const tiles: { key: string; label: string; tone?: string }[] = [
    { key: 'completed', label: 'Đủ điểm' },
    { key: 'in_progress', label: 'Đang tuần' },
    { key: 'partial', label: 'Thiếu điểm', tone: 'border-amber-300' },
    { key: 'missed', label: 'Bỏ lỡ', tone: 'border-red-300' },
    { key: 'late', label: 'Bắt đầu trễ' },
    { key: 'suspicious', label: 'Có lần quét nghi vấn', tone: 'border-amber-300' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Tuần tra</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
      </div>
      <ErrorText error={error} />
      {!sites.length && !error && <p className="text-sm text-slate-500">Bạn chưa phụ trách mục tiêu nào.</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {tiles.map((t) => (
              <div key={t.key} className={`rounded-lg border bg-white p-3 ${data.summary[t.key] ? t.tone ?? 'border-slate-200' : 'border-slate-200'}`}>
                <div className="text-xs text-slate-500">{t.label}</div>
                <div className="text-xl font-semibold">{data.summary[t.key]}<span className="text-sm font-normal text-slate-400"> / {data.summary.total}</span></div>
              </div>
            ))}
          </div>
          <Card>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-2">Khung giờ</th><th>Tuyến</th><th>Trạng thái</th><th>Người tuần</th><th>Điểm</th><th>Ghi chú</th></tr>
              </thead>
              <tbody>
                {data.rounds.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2"><Link href={`/tuan-tra/${r.id}`} className="text-teal-700 hover:underline">{time(r.expected_start)}–{time(r.expected_end)}</Link></td>
                    <td>{r.route_name} <span className="text-xs text-slate-400">{r.schedule_name}</span></td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs ${ROUND_STATUS[r.status as RoundStatus].tone}`}>{ROUND_STATUS[r.status as RoundStatus].label}</span></td>
                    <td>{r.employee_name ?? '—'}</td>
                    <td>{r.started_at ? `${r.done_required}/${r.required_count}` : '—'}</td>
                    <td className="text-xs">
                      {r.late && <span className="mr-2 text-amber-700">bắt đầu trễ</span>}
                      {r.backdated && <span className="mr-2 text-red-700">báo bù muộn</span>}
                      {r.suspicious_count > 0 && <span className="mr-2 text-red-700">{r.suspicious_count} lần quét nghi vấn</span>}
                      {r.ended_by === 'system' && <span className="text-slate-500">hệ thống tự đóng</span>}
                    </td>
                  </tr>
                ))}
                {!data.rounds.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Không có vòng tuần nào trong ngày — mục tiêu đã có lịch tuần tra chưa?</td></tr>}
              </tbody>
            </table></div>
          </Card>
        </>
      )}
    </div>
  );
}
