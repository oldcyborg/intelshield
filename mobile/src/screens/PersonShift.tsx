import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthImage } from '../components/AuthImage';
import { Badge, Card, ErrorText, Screen } from '../components/ui';
import { api } from '../lib/client';
import { time } from '../lib/format';
import { ATTENDANCE_STATUS, SCAN_FLAG } from '../lib/labels';
import { BoardRow, recentDays } from './Team';

export function PersonShift() {
  const { siteId, assignmentId } = useParams<{ siteId: string; assignmentId: string }>();
  const [row, setRow] = useState<BoardRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recentDays(async (d) => (await api.request<{ rows: BoardRow[] }>(`/attendance/board?site_id=${siteId}&date=${d}`)).rows, (r) => r.planned_end)
      .then((rows) => {
        const found = rows.find((r) => r.id === assignmentId) ?? null;
        setRow(found);
        if (!found) setError('Không còn thấy ca này (đã kết thúc từ lâu hoặc đã huỷ)');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Có lỗi xảy ra'));
  }, [siteId, assignmentId]);

  if (!row) return <Screen title="Ca trực" back><ErrorText error={error} /></Screen>;
  const flags = (f: string[] | null) => (f ?? []).map((x) => SCAN_FLAG[x] ?? x).join(', ');
  return (
    <Screen title={row.employee_name} back>
      <Card>
        <Badge tone={ATTENDANCE_STATUS[row.status]?.tone ?? ''}>{ATTENDANCE_STATUS[row.status]?.label ?? row.status}</Badge>
        <div className="mt-2 text-lg">{row.template_name ?? 'Ca lẻ'} {time(row.planned_start)}–{time(row.planned_end)}</div>
        <div className="text-base text-slate-600">Mã NV {row.employee_code}</div>
      </Card>
      <Card>
        <div className="font-semibold">Vào ca {time(row.check_in_at)}{row.late_in && <span className="text-amber-700"> · trễ {row.late_minutes} phút</span>}</div>
        {row.check_in_distance_m !== null && <div className="text-sm text-slate-500">Cách mục tiêu {row.check_in_distance_m} m</div>}
        {flags(row.check_in_flags) && <div className="text-sm text-red-700">⚠ {flags(row.check_in_flags)}</div>}
        {row.check_in_selfie_id && <AuthImage fileId={row.check_in_selfie_id} className="mt-2 aspect-square w-40" />}
      </Card>
      {row.check_out_at && (
        <Card>
          <div className="font-semibold">Ra ca {time(row.check_out_at)}{row.early_out && <span className="text-amber-700"> · sớm {row.early_minutes} phút</span>}</div>
          {flags(row.check_out_flags) && <div className="text-sm text-red-700">⚠ {flags(row.check_out_flags)}</div>}
          {row.check_out_selfie_id && <AuthImage fileId={row.check_out_selfie_id} className="mt-2 aspect-square w-40" />}
        </Card>
      )}
    </Screen>
  );
}
