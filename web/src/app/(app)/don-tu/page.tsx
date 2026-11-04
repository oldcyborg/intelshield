'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CORRECTION_REASON, CORRECTION_STATUS, date, LEAVE_STATUS, LEAVE_TYPE, stamp, time } from '@/lib/format';
import { randomId } from '@/lib/ids';
import { CorrectionRow, Employee, LeaveRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function RequestsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'leave' | 'correction'>(can('leave.review') ? 'leave' : 'correction');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Đơn từ</h1>
        <div className="flex rounded-md border border-slate-300 text-sm">
          {can('leave.review') && <button className={`px-3 py-1.5 ${tab === 'leave' ? 'bg-teal-700 text-white' : ''}`} onClick={() => setTab('leave')}>Đơn nghỉ</button>}
          {can('attendance.correct.propose') && (
            <button className={`px-3 py-1.5 ${tab === 'correction' ? 'bg-teal-700 text-white' : ''}`} onClick={() => setTab('correction')}>Bổ sung chấm công</button>
          )}
        </div>
      </div>
      {tab === 'leave' ? <LeaveTab /> : <CorrectionTab />}
    </div>
  );
}

function LeaveTab() {
  const { me } = useAuth();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [people, setPeople] = useState<Employee[]>([]);
  const [stand, setStand] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ employee_id: '', type: 'sick', from_date: todayIso(), to_date: todayIso(), reason: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await api<LeaveRow[]>(`/leave-requests${status ? `?status=${status}` : ''}`));
  }, [status]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);
  useEffect(() => { api<Employee[]>('/employees').then((e) => setPeople(e.filter((p) => p.status === 'active'))).catch(() => undefined); }, []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const decide = (r: LeaveRow, way: 'approve' | 'reject') =>
    run(async () => {
      const note = window.prompt(way === 'reject' ? 'Lý do không duyệt (bắt buộc):' : 'Ghi chú (không bắt buộc):');
      if (note === null) return;
      await api(`/leave-requests/${r.id}/${way}`, { method: 'POST', json: note.trim() ? { note: note.trim() } : {} });
    });

  function fileFor(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api('/leave-requests', { method: 'POST', json: { client_uuid: randomId(), ...draft, reason: draft.reason || undefined } });
      setDraft({ ...draft, reason: '' });
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="pending">Chờ duyệt</option>
          <option value="approved">Đã duyệt</option>
          <option value="rejected">Không duyệt</option>
          <option value="">Tất cả</option>
        </Select>
        <p className="text-sm text-slate-500">Duyệt: các ca chưa vào trong những ngày nghỉ được huỷ, vắng ca đã ghi được miễn. Gọi người trực thay ngay dưới mỗi ca.</p>
      </div>
      <ErrorText error={error} />
      {rows.map((r) => {
        const own = Boolean(me.user.employee_id) && r.employee_id === me.user.employee_id;
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <b>{r.employee_name}</b>
              <span className="font-mono text-xs text-slate-400">{r.employee_code}</span>
              <span>{LEAVE_TYPE[r.type]} · {r.from_date === r.to_date ? date(r.from_date) : `${date(r.from_date)} – ${date(r.to_date)}`} · {r.days} ngày</span>
              {r.urgent && r.status === 'pending' && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">gấp</span>}
              <span className={`rounded px-1.5 py-0.5 text-xs ${LEAVE_STATUS[r.status].tone}`}>{LEAVE_STATUS[r.status].label}</span>
              <span className="text-xs text-slate-400">gửi {stamp(r.created_at)}{r.created_by_name !== r.employee_name ? ` · ${r.created_by_name} ghi thay` : ''}</span>
            </div>
            {r.reason && <p className="mt-1 text-sm text-slate-700">{r.reason}</p>}
            {r.file_ids.map((f) => <a key={f} href={`/api/files/${f}`} className="mr-2 text-xs text-teal-700 hover:underline">ảnh đính kèm</a>)}
            {r.balance && (
              <p className="mt-1 text-sm">
                Phép năm {r.balance.year}: còn {r.balance.remaining}/{r.balance.allowance} ngày
                {r.balance.remaining !== null && r.status === 'pending' && r.days > r.balance.remaining && <span className="ml-2 text-red-700">vượt {r.days - r.balance.remaining} ngày</span>}
              </p>
            )}
            {r.decided_at && <p className="mt-1 text-xs text-slate-500">{r.decided_by_name} · {stamp(r.decided_at)}{r.decision_note ? ` — ${r.decision_note}` : ''}</p>}
            <div className="mt-2 space-y-1 text-sm">
              {r.shifts.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2">
                  <span>{date(s.planned_start.slice(0, 10))} {time(s.planned_start)}–{time(s.planned_end)} · {s.site_name}</span>
                  {s.status === 'cancelled' && !s.substitute && (
                    <>
                      <span className="text-xs text-amber-700">đã huỷ — chưa có người thay</span>
                      <Select className="w-48" value={stand[s.id] ?? ''} onChange={(e) => setStand({ ...stand, [s.id]: e.target.value })}>
                        <option value="">Chọn người trực thay…</option>
                        {people.filter((p) => p.id !== r.employee_id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </Select>
                      <Button variant="secondary" disabled={!stand[s.id]} onClick={() => run(() => api(`/roster/${s.id}/substitute`, { method: 'POST', json: { employee_id: stand[s.id] } }))}>
                        Gọi trực thay
                      </Button>
                    </>
                  )}
                  {s.substitute && <span className="text-xs text-teal-700">{s.substitute} trực thay</span>}
                  {s.status === 'planned' && s.checked_in && <span className="text-xs text-slate-500">đã vào ca — giữ nguyên</span>}
                </div>
              ))}
              {!r.shifts.length && <span className="text-xs text-slate-400">Không có ca nào trong những ngày này</span>}
            </div>
            {r.status === 'pending' && !own && (
              <div className="mt-2 flex gap-2">
                <Button onClick={() => void decide(r, 'approve')}>Duyệt</Button>
                <Button variant="secondary" onClick={() => void decide(r, 'reject')}>Không duyệt</Button>
              </div>
            )}
            {r.status === 'pending' && own && <p className="mt-2 text-xs text-slate-500">Đơn của bạn — người quản lý trực tiếp duyệt.</p>}
          </Card>
        );
      })}
      {!rows.length && <p className="py-6 text-center text-slate-400">Không có đơn nghỉ nào</p>}

      <Card title="Ghi đơn nghỉ thay (bảo vệ gọi điện xin nghỉ)">
        <form onSubmit={fileFor} className="grid grid-cols-1 items-end gap-3 md:grid-cols-6">
          <Field label="Nhân viên">
            <Select value={draft.employee_id} onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}>
              <option value="">Chọn…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Loại">
            <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              {Object.entries(LEAVE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Từ ngày"><Input type="date" value={draft.from_date} onChange={(e) => setDraft({ ...draft, from_date: e.target.value })} /></Field>
          <Field label="Đến ngày"><Input type="date" value={draft.to_date} onChange={(e) => setDraft({ ...draft, to_date: e.target.value })} /></Field>
          <Field label="Lý do"><Input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></Field>
          <Button type="submit" disabled={!draft.employee_id}>Ghi đơn</Button>
        </form>
      </Card>
    </>
  );
}

function CorrectionTab() {
  const { me, can } = useAuth();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<CorrectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reviewer = can('attendance.correct.review');

  const load = useCallback(async () => {
    setRows(await api<CorrectionRow[]>(`/attendance-corrections${status ? `?status=${status}` : ''}`));
  }, [status]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function decide(c: CorrectionRow, decision: 'approve' | 'reject') {
    const against = (c.status === 'proposed_approve' && decision === 'reject') || (c.status === 'proposed_reject' && decision === 'approve');
    const needs = decision === 'reject' || (reviewer && against);
    const note = window.prompt(needs ? 'Lý do (bắt buộc):' : 'Ghi chú (không bắt buộc):');
    if (note === null) return;
    setError(null);
    try {
      await api(`/attendance-corrections/${c.id}/${reviewer ? 'review' : 'propose'}`, { method: 'POST', json: { decision, ...(note.trim() ? { note: note.trim() } : {}) } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="open">Đang chờ</option>
          <option value="approved">Đã duyệt</option>
          <option value="rejected">Không duyệt</option>
          <option value="">Tất cả</option>
        </Select>
        <p className="text-sm text-slate-500">Đội trưởng đề xuất, quản lý duyệt. Đối chiếu với lần quét tuần tra, sổ trực và giao ca của người đó trong ca trước khi quyết định.</p>
      </div>
      <ErrorText error={error} />
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Nhân viên</th><th>Ca</th><th>Đề nghị</th><th>Đang có</th><th>Lý do</th><th>Đối chiếu</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const own = Boolean(me.user.employee_id) && c.employee_id === me.user.employee_id;
              const open = ['pending', 'proposed_approve', 'proposed_reject'].includes(c.status);
              const was = c.status === 'approved' ? c.before : c.current;
              const ev = c.evidence;
              return (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">{c.employee_name}<div className="text-xs text-slate-400">{c.site_name}</div></td>
                  <td className="whitespace-nowrap">{date(c.planned_start.slice(0, 10))}<div className="text-xs">{time(c.planned_start)}–{time(c.planned_end)}</div></td>
                  <td className="whitespace-nowrap">
                    {c.check_in_at && <div>Vào {time(c.check_in_at)}</div>}
                    {c.check_out_at && <div>Ra {time(c.check_out_at)}</div>}
                  </td>
                  <td className="whitespace-nowrap text-slate-500">
                    <div>Vào {time(was?.check_in_at)}</div>
                    <div>Ra {time(was?.check_out_at)}</div>
                  </td>
                  <td>
                    {CORRECTION_REASON[c.reason_code]}{c.reason ? `: ${c.reason}` : ''}
                    {c.file_ids.map((f) => <a key={f} href={`/api/files/${f}`} className="ml-2 text-xs text-teal-700 hover:underline">ảnh</a>)}
                  </td>
                  <td className="text-xs">
                    <div>{ev.scans ? `${ev.scans} lần quét (${time(ev.first_scan_at)}–${time(ev.last_scan_at)})` : 'không có lần quét'}</div>
                    <div>{ev.logbook} dòng sổ trực</div>
                    {ev.handovers.map((h, i) => <div key={i}>{h.role === 'gave' ? 'giao ca' : 'nhận ca'} {time(h.at)}</div>)}
                  </td>
                  <td>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${CORRECTION_STATUS[c.status].tone}`}>{CORRECTION_STATUS[c.status].label}</span>
                    {c.proposed_by_name && <div className="text-xs text-slate-500">{c.proposed_by_name}{c.proposed_note ? `: ${c.proposed_note}` : ''}</div>}
                    {c.reviewed_by_name && <div className="text-xs text-slate-500">{c.reviewed_by_name}{c.review_note ? `: ${c.review_note}` : ''}</div>}
                  </td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {open && !own && c.can_judge !== false && (
                      <>
                        <Button variant="secondary" onClick={() => void decide(c, 'approve')}>{reviewer ? 'Duyệt' : 'Đề xuất duyệt'}</Button>
                        <Button variant="secondary" onClick={() => void decide(c, 'reject')}>{reviewer ? 'Từ chối' : 'Đề xuất từ chối'}</Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="py-6 text-center text-slate-400">Không có đơn nào</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </>
  );
}
