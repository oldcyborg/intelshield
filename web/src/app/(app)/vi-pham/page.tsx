'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { stamp, VIOLATION_STATUS, VIOLATION_TYPE, violationText } from '@/lib/format';
import { SiteRow, ViolationRow } from '@/lib/types';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Chờ xử lý' },
  { value: 'auto', label: 'Mới — chưa xem' },
  { value: 'proposed_confirm', label: 'Đề xuất xác nhận' },
  { value: 'proposed_waive', label: 'Đề xuất miễn' },
  { value: 'confirmed', label: 'Đã xác nhận' },
  { value: 'waived', label: 'Đã miễn' },
  { value: '', label: 'Tất cả' },
];

export default function ViolationsPage() {
  const { me, can } = useAuth();
  const [rows, setRows] = useState<ViolationRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [filter, setFilter] = useState({ status: 'open', type: '', site_id: '' });
  const [error, setError] = useState<string | null>(null);
  const reviewer = can('violation.review');
  const proposer = can('violation.propose');

  const load = useCallback(async () => {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    setRows(await api<ViolationRow[]>(`/violations?${q}`));
  }, [filter]);

  useEffect(() => { api<SiteRow[]>('/sites').then(setSites).catch(() => undefined); }, []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function decide(v: ViolationRow, step: 'propose' | 'review', decision: 'confirm' | 'waive') {
    const final = v.status === 'confirmed' || v.status === 'waived';
    const flips = final && v.status !== (decision === 'confirm' ? 'confirmed' : 'waived');
    const ask = decision === 'waive' ? 'Lý do miễn (bắt buộc):' : flips ? 'Lý do đổi quyết định đã duyệt (bắt buộc):' : 'Ghi chú (không bắt buộc):';
    const note = window.prompt(ask) ?? undefined;
    if (note === undefined) return;
    setError(null);
    try {
      await api(`/violations/${v.id}/${step}`, { method: 'POST', json: { decision, ...(note ? { note } : {}) } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Vi phạm</h1>
        <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className="w-52">
          {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
        <Select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className="w-48">
          <option value="">Mọi loại</option>
          {Object.entries(VIOLATION_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={filter.site_id} onChange={(e) => setFilter({ ...filter, site_id: e.target.value })} className="w-64">
          <option value="">Mọi mục tiêu</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
      </div>
      <p className="text-sm text-slate-500">Hệ thống tự ghi theo mốc của từng mục tiêu. Đội trưởng đề xuất, quản lý duyệt; chỉ vi phạm đã xác nhận mới tính vào lương.</p>
      <ErrorText error={error} />
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Lúc</th><th>Nhân viên</th><th>Mục tiêu</th><th>Vi phạm</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const own = Boolean(me.user.employee_id) && v.employee_id === me.user.employee_id;
              const final = v.status === 'confirmed' || v.status === 'waived';
              const roundId = v.ref_type === 'round' ? v.ref_id : v.detail.round_id;
              return (
                <tr key={v.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 whitespace-nowrap">{stamp(v.occurred_at)}</td>
                  <td>{v.employee_name} <span className="font-mono text-xs text-slate-400">{v.employee_code}</span></td>
                  <td>{v.site_name}</td>
                  <td>
                    <b>{VIOLATION_TYPE[v.type]}</b> — {violationText(v)}
                    {roundId && <Link href={`/tuan-tra/${roundId}`} className="ml-2 text-xs text-teal-700 hover:underline">xem vòng</Link>}
                    {v.proposed_by_name && <div className="text-xs text-slate-500">Đề xuất: {v.proposed_by_name}{v.proposed_note ? ` — ${v.proposed_note}` : ''}</div>}
                    {v.reviewed_at && <div className="text-xs text-slate-500">Duyệt: {v.reviewed_by_name ?? 'Hệ thống'}{v.review_note ? ` — ${v.review_note}` : ''}</div>}
                  </td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${VIOLATION_STATUS[v.status].tone}`}>{VIOLATION_STATUS[v.status].label}</span></td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {!own && v.can_judge !== false && reviewer && (
                      <>
                        <Button variant="secondary" onClick={() => decide(v, 'review', 'confirm')}>Xác nhận</Button>
                        <Button variant="secondary" onClick={() => decide(v, 'review', 'waive')}>Miễn</Button>
                      </>
                    )}
                    {!own && v.can_judge !== false && !reviewer && proposer && !final && (
                      <>
                        <Button variant="secondary" onClick={() => decide(v, 'propose', 'confirm')}>Đề xuất xác nhận</Button>
                        <Button variant="secondary" onClick={() => decide(v, 'propose', 'waive')}>Đề xuất miễn</Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Không có vi phạm nào</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
