'use client';

import { useCallback, useEffect, useState } from 'react';
import { randomId } from '@/lib/ids';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ATTENDANCE_STATUS, FLAG_LABEL, fromLocalInput, localInput, time } from '@/lib/format';
import { BoardRow, SiteRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function AttendancePage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState('');
  const [day, setDay] = useState(todayIso());
  const [board, setBoard] = useState<{ settings: { late_after_minutes: number; absent_after_minutes: number }; rows: BoardRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { can, me } = useAuth();
  const [editing, setEditing] = useState<{ row: BoardRow; check_in: string; check_out: string; reason: string } | null>(null);

  useEffect(() => {
    api<SiteRow[]>('/sites').then((s) => { setSites(s); if (s[0]) setSiteId(s[0].id); }).catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    if (siteId) setBoard(await api(`/attendance/board?site_id=${siteId}&date=${day}`));
  }, [siteId, day]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    const timer = setInterval(() => load().catch(() => undefined), 60_000); // statuses move with the clock
    return () => clearInterval(timer);
  }, [load]);

  async function saveCorrection() {
    if (!editing) return;
    const { row } = editing;
    const checkIn = fromLocalInput(editing.check_in);
    const checkOut = fromLocalInput(editing.check_out);
    setError(null);
    try {
      await api('/attendance-corrections', {
        method: 'POST',
        json: {
          client_uuid: randomId(), assignment_id: row.id, reason_code: 'other', reason: editing.reason.trim(),
          ...(checkIn && editing.check_in !== localInput(row.check_in_at) ? { check_in_at: checkIn } : {}),
          ...(checkOut && editing.check_out !== localInput(row.check_out_at) ? { check_out_at: checkOut } : {}),
        },
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const corrector = can('attendance.correct.review');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Chấm công</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-72">
          {sites.map((s) => <option key={s.id} value={s.id}>{s.client_name} · {s.name}</option>)}
        </Select>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
      </div>
      <ErrorText error={error} />
      {board && (
        <>
          <p className="text-sm text-slate-500">
            Mục tiêu này tính trễ sau {board.settings.late_after_minutes} phút, vắng sau {board.settings.absent_after_minutes} phút. Bảng tự cập nhật mỗi phút.
          </p>
          <Card>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-2">Nhân viên</th><th>Ca</th><th>Trạng thái</th><th>Vào ca</th><th>Ra ca</th><th>Ghi chú</th><th /></tr>
              </thead>
              <tbody>
                {board.rows.map((r) => {
                  const flags = [...(r.check_in_flags ?? []), ...(r.check_out_flags ?? [])].map((f) => FLAG_LABEL[f] ?? f);
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="py-2">{r.employee_name} <span className="font-mono text-xs text-slate-400">{r.employee_code}</span></td>
                      <td>{r.template_name ?? 'Ca lẻ'} {time(r.planned_start)}–{time(r.planned_end)}</td>
                      <td>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${ATTENDANCE_STATUS[r.status].tone}`}>{r.leave_request_id ? 'Nghỉ có đơn' : ATTENDANCE_STATUS[r.status].label}</span>
                        {r.corrected_at && <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">đã điều chỉnh</span>}
                      </td>
                      <td>
                        {time(r.check_in_at)}
                        {r.late_in && <span className="ml-1 text-xs text-amber-700">trễ {r.late_minutes}′</span>}
                        {r.check_in_selfie_id && <a href={`/api/files/${r.check_in_selfie_id}`} className="ml-2 text-xs text-teal-700 hover:underline">ảnh</a>}
                      </td>
                      <td>
                        {time(r.check_out_at)}
                        {r.early_out && <span className="ml-1 text-xs text-amber-700">sớm {r.early_minutes}′</span>}
                        {r.check_out_selfie_id && <a href={`/api/files/${r.check_out_selfie_id}`} className="ml-2 text-xs text-teal-700 hover:underline">ảnh</a>}
                      </td>
                      <td className="text-xs text-red-700">{flags.join(', ')}{r.check_in_distance_m !== null && r.check_in_distance_m !== undefined ? <span className="ml-1 text-slate-400">cách {r.check_in_distance_m} m</span> : null}</td>
                      <td className="text-right">
                        {corrector && r.status !== 'cancelled' && r.status !== 'upcoming' && r.employee_id !== me.user.employee_id && (
                          <Button variant="secondary" onClick={() => setEditing({
                            row: r, check_in: localInput(r.check_in_at ?? r.planned_start), reason: '',
                            // A shift still running has no clock-out to write yet.
                            check_out: localInput(r.check_out_at ?? (Date.parse(r.planned_end) < Date.now() ? r.planned_end : null)),
                          })}>
                            Sửa giờ
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!board.rows.length && <tr><td colSpan={7} className="py-6 text-center text-slate-400">Không có ca nào trong ngày</td></tr>}
              </tbody>
            </table></div>
          </Card>
          {editing && (
            <Card title={`Sửa chấm công · ${editing.row.employee_name} · ca ${time(editing.row.planned_start)}–${time(editing.row.planned_end)}`}>
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
                <label className="block space-y-1 text-sm text-slate-600">Giờ vào
                  <Input type="datetime-local" value={editing.check_in} onChange={(e) => setEditing({ ...editing, check_in: e.target.value })} />
                </label>
                <label className="block space-y-1 text-sm text-slate-600">Giờ ra (để trống nếu chưa ra)
                  <Input type="datetime-local" value={editing.check_out} onChange={(e) => setEditing({ ...editing, check_out: e.target.value })} />
                </label>
                <label className="block space-y-1 text-sm text-slate-600 md:col-span-2">Lý do (bắt buộc, lưu vào nhật ký)
                  <Input value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} placeholder="VD: bảo vệ báo qua điện thoại, đội trưởng xác nhận có mặt" />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button disabled={!editing.reason.trim()} onClick={() => void saveCorrection()}>Lưu</Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>Huỷ</Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Giờ mới có hiệu lực ngay, giờ cũ được giữ lại trong đơn. Vi phạm vắng/trễ/ra sớm chưa duyệt của ca được tính lại.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
