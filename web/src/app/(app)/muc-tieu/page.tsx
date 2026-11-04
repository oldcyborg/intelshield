'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { SiteRow } from '@/lib/types';

export default function SitesPage() {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SiteRow[]>('/sites').then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Mục tiêu</h1>
      <p className="text-sm text-slate-500">Thêm mục tiêu mới từ trang của từng khách hàng.</p>
      <ErrorText error={error} />
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-2">Mã</th><th>Mục tiêu</th><th>Khách hàng</th><th>Đội phụ trách</th><th className="text-right">Điểm</th><th className="text-right">Tuyến</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-2 font-mono">{s.code}</td>
                <td><Link href={`/muc-tieu/${s.id}`} className="font-medium text-teal-700 hover:underline">{s.name}</Link></td>
                <td>{s.client_name}</td>
                <td>{s.responsible_team_name ?? '—'}</td>
                <td className="text-right">{s.checkpoint_count}</td>
                <td className="text-right">{s.route_count}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Chưa có mục tiêu nào trong phạm vi của bạn</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
