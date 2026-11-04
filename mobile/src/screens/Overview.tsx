import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorText, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { SEVERITY } from '../lib/labels';

interface Data {
  incidents?: { severity: string; status: string }[];
  patrol?: { site_id: string; site_name: string; total: number; completed: number; partial: number; missed: number; suspicious: number }[];
  violations?: { auto: number; proposed_confirm: number; proposed_waive: number };
  company?: { guards: { active: number; deployed: number; idle: number }; shortfalls: unknown[]; expiring_contracts: unknown[] };
}

export function Overview() {
  const { can } = useAuth();
  const [data, setData] = useState<Data>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const settled = await Promise.allSettled([
        can('incident.view') ? api.request<Data['incidents']>('/incidents?status=open') : undefined,
        can('patrol.view') ? api.request<Data['patrol']>('/patrol/today') : undefined,
        can('violation.view') ? api.request<Data['violations']>('/violations/summary') : undefined,
        can('client.view') ? api.request<Data['company']>('/dashboard/company') : undefined,
      ]);
      const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
      setData({ incidents: value(settled[0]) as Data['incidents'], patrol: value(settled[1]) as Data['patrol'], violations: value(settled[2]) as Data['violations'], company: value(settled[3]) as Data['company'] });
      const failed = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      setError(failed ? `Một phần chưa tải được: ${failed.reason instanceof Error ? failed.reason.message : ''}` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    }
  }, [can]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const open = data.incidents ?? [];
  const fresh = open.filter((i) => i.status === 'new').length;
  const troubled = (data.patrol ?? []).filter((p) => p.missed || p.partial || p.suspicious).sort((a, b) => b.missed - a.missed || b.partial - a.partial);
  const pending = data.violations ? data.violations.auto + data.violations.proposed_confirm + data.violations.proposed_waive : 0;

  return (
    <Screen title="Tổng quan" action={<button className="text-sm underline" onClick={() => void load()}>Tải lại</button>}>
      <ErrorText error={error} />
      {data.incidents && (
        <Link to="/su-co" className="block">
          <Card className={fresh ? 'border-red-400' : ''}>
            <div className="flex items-center justify-between"><b className="text-lg">Sự cố đang mở</b><span className="text-2xl font-semibold">{open.length}</span></div>
            {fresh > 0 && <div className="text-red-700">{fresh} chưa ai tiếp nhận</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              {(['critical', 'high', 'medium', 'low'] as const).map((s) => {
                const n = open.filter((i) => i.severity === s).length;
                return n ? <span key={s} className={`rounded-md px-2 py-0.5 text-sm ${SEVERITY[s].tone}`}>{SEVERITY[s].label}: {n}</span> : null;
              })}
            </div>
          </Card>
        </Link>
      )}
      {data.patrol && (
        <Link to="/doi" className="block">
          <Card className={troubled.some((p) => p.missed) ? 'border-red-400' : ''}>
            <b className="text-lg">Tuần tra hôm nay</b>
            {troubled.length ? troubled.slice(0, 6).map((p) => (
              <div key={p.site_id} className="flex justify-between border-t border-slate-100 py-1.5 text-base">
                <span>{p.site_name}</span>
                <span className="text-sm">{p.missed ? <span className="text-red-700">{p.missed} bỏ lỡ </span> : null}{p.partial ? <span className="text-amber-700">{p.partial} thiếu </span> : null}{p.suspicious ? <span className="text-red-700">{p.suspicious} nghi vấn</span> : null}</span>
              </div>
            )) : <div className="text-slate-500">Các mục tiêu đều tuần tra đủ</div>}
          </Card>
        </Link>
      )}
      {data.violations && (
        <Link to="/duyet" className="block">
          <Card className={pending ? 'border-amber-300' : ''}>
            <div className="flex items-center justify-between"><b className="text-lg">Vi phạm chờ xử lý</b><span className="text-2xl font-semibold">{pending}</span></div>
            {data.violations.proposed_confirm + data.violations.proposed_waive > 0 && <div className="text-amber-700">{data.violations.proposed_confirm + data.violations.proposed_waive} đề xuất của đội trưởng chờ duyệt</div>}
          </Card>
        </Link>
      )}
      {data.company && (
        <Card>
          <b className="text-lg">Nhân sự & hợp đồng</b>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xl font-semibold">{data.company.guards.active}</div><div className="text-sm text-slate-500">Đang làm</div></div>
            <div><div className="text-xl font-semibold">{data.company.guards.deployed}</div><div className="text-sm text-slate-500">Được điều động</div></div>
            <div><div className={`text-xl font-semibold ${data.company.guards.idle ? 'text-amber-700' : ''}`}>{data.company.guards.idle}</div><div className="text-sm text-slate-500">Chưa có chỗ</div></div>
          </div>
          {data.company.shortfalls.length > 0 && <div className="mt-2 text-amber-700">{data.company.shortfalls.length} vị trí khách đang thiếu người</div>}
          {data.company.expiring_contracts.length > 0 && <div className="text-amber-700">{data.company.expiring_contracts.length} hợp đồng sắp hết hạn — xem trên web</div>}
        </Card>
      )}
    </Screen>
  );
}
