'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { DeviceRow } from '@/lib/types';

const STATUS: Record<DeviceRow['status'], string> = { pending: 'Chờ duyệt', active: 'Đang dùng', revoked: 'Đã thu hồi' };

export default function DevicesPage() {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setRows(await api<DeviceRow[]>('/devices')), []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const act = async (id: string, action: 'approve' | 'revoke') => {
    setError(null);
    try {
      await api(`/devices/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Thiết bị</h1>
      <p className="text-sm text-slate-500">
        Mỗi bảo vệ chỉ chấm công được từ một điện thoại. Khi họ đổi máy, máy mới hiện ở đây để duyệt; duyệt xong, máy cũ bị đăng xuất.
      </p>
      <ErrorText error={error} />
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">Người dùng</th><th>Máy</th><th>Lần đầu</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={`border-t border-slate-100 ${d.status === 'pending' ? 'bg-amber-50' : ''}`}>
                <td className="py-2">{d.full_name} <span className="text-xs text-slate-400">{d.employee_code ?? d.phone}</span></td>
                <td className="font-mono text-xs">{d.platform ?? '?'} · {d.device_id}</td>
                <td>{date(d.created_at.slice(0, 10))}</td>
                <td>{STATUS[d.status]}{!d.restricted && <span className="ml-1 text-xs text-slate-400">(văn phòng)</span>}</td>
                <td className="space-x-2 text-right">
                  {d.status === 'pending' && <Button onClick={() => act(d.id, 'approve')}>Duyệt</Button>}
                  {d.status !== 'revoked' && <Button variant="secondary" onClick={() => act(d.id, 'revoke')}>Thu hồi</Button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có thiết bị nào đăng nhập từ ứng dụng</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
