'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { localDay, MyShift, weekday } from '@/components/mine';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONTRACT_STATUS, date, DOCUMENT_KIND, INCIDENT_STATUS, POSITION_LABEL, SEVERITY, stamp, time } from '@/lib/format';
import { CompanyDashboard, IncidentRow, PatrolToday, ViolationSummary } from '@/lib/types';

function Tile({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${tone}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

/**
 * A guard opening the web sees their next shifts first; without this the page is a greeting and nothing else,
 * since everything below it is company data they are not shown.
 */
function MyNextShifts() {
  const [shifts, setShifts] = useState<MyShift[] | null>(null);
  useEffect(() => {
    api<MyShift[]>(`/me/shifts?from=${localDay(0)}&to=${localDay(7)}`).then(setShifts).catch(() => setShifts([]));
  }, []);
  if (!shifts) return null;
  const ahead = shifts.filter((s) => new Date(s.planned_end).getTime() >= Date.now()).slice(0, 3);
  return (
    <Card title="Ca sắp tới của bạn" actions={<Link href="/cua-toi" className="text-sm text-teal-700 hover:underline">Của tôi</Link>}>
      <ul className="divide-y divide-slate-100 text-sm">
        {ahead.map((s) => (
          <li key={s.id} className="py-2">
            <span className="capitalize text-slate-500">{weekday(s.planned_start)}</span> <b>{time(s.planned_start)}–{time(s.planned_end)}</b> · {s.site_name}
          </li>
        ))}
        {!ahead.length && <li className="py-2 text-slate-400">Không có ca nào trong 7 ngày tới</li>}
      </ul>
    </Card>
  );
}

export default function HomePage() {
  const { me, can } = useAuth();
  const [data, setData] = useState<CompanyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null);

  useEffect(() => {
    if (!can('incident.view')) return;
    const load = () => api<IncidentRow[]>('/incidents?status=open').then(setIncidents).catch(() => undefined);
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [can]);

  const [patrol, setPatrol] = useState<PatrolToday[] | null>(null);
  const [pending, setPending] = useState<ViolationSummary | null>(null);

  useEffect(() => {
    if (can('violation.view') && (can('violation.propose') || can('violation.review'))) api<ViolationSummary>('/violations/summary').then(setPending).catch(() => undefined);
  }, [can]);

  useEffect(() => {
    if (can('patrol.view')) api<PatrolToday[]>('/patrol/today').then(setPatrol).catch(() => undefined);
  }, [can]);

  useEffect(() => {
    if (can('client.view')) api<CompanyDashboard>('/dashboard/company').then(setData).catch((e) => setError(errorMessage(e)));
  }, [can]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Xin chào, {me.user.full_name}</h1>
      <ErrorText error={error} />
      {me.user.user_type === 'guard' && me.user.employee_id && <MyNextShifts />}
      {pending && pending.auto + pending.proposed_confirm + pending.proposed_waive > 0 && (
        <Link href="/vi-pham" className="block rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100">
          <b>Vi phạm chờ xử lý:</b> {pending.auto} mới
          {can('violation.review') && <>, {pending.proposed_confirm + pending.proposed_waive} đề xuất chờ duyệt</>}
          <span className="ml-2 text-teal-700">Xem →</span>
        </Link>
      )}
      {incidents && (
        <Card title={`Sự cố đang mở (${incidents.length})`} actions={<Link href="/su-co" className="text-sm text-teal-700 hover:underline">Tất cả</Link>}>
          <ul className="divide-y divide-slate-100 text-sm">
            {incidents.slice(0, 8).map((i) => (
              <li key={i.id} className={`flex items-center justify-between gap-3 py-2 ${i.status === 'new' ? 'font-medium' : ''}`}>
                <Link href={`/su-co/${i.id}`} className="text-teal-700 hover:underline">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${SEVERITY[i.severity].tone}`}>{i.is_sos ? 'SOS' : SEVERITY[i.severity].label}</span>
                  {i.title} · {i.site_name ?? i.client_name}
                </Link>
                <span className="shrink-0 text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${INCIDENT_STATUS[i.status].tone}`}>{INCIDENT_STATUS[i.status].label}</span>
                  <span className="ml-2 text-slate-400">{stamp(i.created_at)}</span>
                </span>
              </li>
            ))}
            {!incidents.length && <li className="py-2 text-slate-400">Không có sự cố đang mở</li>}
          </ul>
        </Card>
      )}
      {patrol && patrol.length > 0 && (
        <Card title="Tuần tra hôm nay" actions={<Link href="/tuan-tra" className="text-sm text-teal-700 hover:underline">Chi tiết</Link>}>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-1">Mục tiêu</th><th>Đủ điểm</th><th>Thiếu</th><th>Bỏ lỡ</th><th>Nghi vấn</th></tr></thead>
            <tbody>
              {patrol.map((p) => (
                <tr key={p.site_id} className="border-t border-slate-100">
                  <td className="py-1">{p.site_name}</td>
                  <td>{p.completed}/{p.total}</td>
                  <td className={p.partial ? 'text-amber-700' : ''}>{p.partial}</td>
                  <td className={p.missed ? 'font-medium text-red-700' : ''}>{p.missed}</td>
                  <td className={p.suspicious ? 'text-red-700' : ''}>{p.suspicious}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label="Bảo vệ đang làm" value={data.guards.active} />
            <Tile label="Đang được điều động hôm nay" value={data.guards.deployed} />
            <Tile label="Chưa có chỗ làm" value={data.guards.idle} tone={data.guards.idle ? 'border-amber-300' : ''} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {can('contract.view') && (
              <Card title="Hợp đồng cần xử lý">
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.expiring_contracts.map((k) => (
                    <li key={k.id} className="flex items-center justify-between py-2">
                      <Link href={`/hop-dong?id=${k.id}`} className="text-teal-700 hover:underline">{k.contract_no} · {k.client_name}</Link>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[k.status].tone}`}>
                        {k.status === 'expired' ? `hết hạn ${date(k.end_date)}` : `còn ${k.days_left} ngày`}
                      </span>
                    </li>
                  ))}
                  {!data.expiring_contracts.length && <li className="py-2 text-slate-400">Không có hợp đồng sắp hết hạn</li>}
                </ul>
              </Card>
            )}
            <Card title="Khách đang thiếu người">
              <ul className="divide-y divide-slate-100 text-sm">
                {data.shortfalls.map((s) => (
                  <li key={`${s.contract_id}-${s.position}`} className="flex items-center justify-between py-2">
                    <Link href={`/khach-hang/${s.client_id}`} className="text-teal-700 hover:underline">{s.client_name}</Link>
                    <span>{POSITION_LABEL[s.position] ?? s.position}: {s.deployed}/{s.headcount}</span>
                  </li>
                ))}
                {!data.shortfalls.length && <li className="py-2 text-slate-400">Các khách đều đủ người theo hợp đồng</li>}
              </ul>
            </Card>
            {me.team_visibility.all && can('employee.view') && (
              <Card title="Giấy tờ sắp hết hạn (30 ngày)">
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.expiring_documents.map((d) => (
                    <li key={`${d.employee_id}-${d.kind}-${d.expires_on}`} className="flex items-center justify-between py-2">
                      <Link href={`/nhan-vien/${d.employee_id}`} className="text-teal-700 hover:underline">{d.employee_name}</Link>
                      <span>{DOCUMENT_KIND[d.kind] ?? d.kind} · {d.days_left < 0 ? 'đã hết hạn' : `còn ${d.days_left} ngày`}</span>
                    </li>
                  ))}
                  {!data.expiring_documents.length && <li className="py-2 text-slate-400">Không có giấy tờ sắp hết hạn</li>}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
      {!can('client.view') && (
        <Card title="Phạm vi của bạn">
          <p className="text-sm text-slate-600">{me.team_visibility.all ? 'Toàn công ty' : `${me.team_visibility.team_ids.length} đội`}</p>
        </Card>
      )}
    </div>
  );
}
