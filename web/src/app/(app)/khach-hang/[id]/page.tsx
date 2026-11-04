'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONTRACT_STATUS, date, POSITION_LABEL, UNIT_LABEL } from '@/lib/format';
import { ClientView, ContractView, DeploymentView, Employee, SiteRow, UserRow } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [clientRow, setClient] = useState<ClientView | null>(null);
  const [contracts, setContracts] = useState<ContractView[]>([]);
  const [deployments, setDeployments] = useState<DeploymentView[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [staff, setStaff] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteForm, setSiteForm] = useState({ code: '', name: '', address: '' });
  const [contractForm, setContractForm] = useState({
    contract_no: '', start_date: todayIso(), end_date: '', notice_days: '30',
    position: 'guard', headcount: '1', unit: 'per_guard_month', unit_price: '',
  });
  const [deployForm, setDeployForm] = useState({ employee_id: '', contract_id: '', start_date: todayIso() });

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    setClient(await api<ClientView>(`/clients/${id}`));
    if (can('site.view')) setSites(await api<SiteRow[]>(`/sites?client_id=${id}`));
    if (can('contract.view')) setContracts(await api<ContractView[]>(`/contracts?client_id=${id}`));
    if (can('deployment.view')) setDeployments(await api<DeploymentView[]>(`/deployments?client_id=${id}`));
    if (can('deployment.manage') && can('employee.view')) setEmployees(await api<Employee[]>('/employees'));
    if (can('client.manage') && can('user.view')) setStaff((await api<UserRow[]>('/users')).filter((u) => u.user_type === 'staff'));
  }, [id, can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  if (!clientRow) return <ErrorText error={error} />;
  const today = todayIso();
  const current = deployments.filter((d) => d.start_date <= today && (!d.end_date || d.end_date >= today));
  const planned = deployments.filter((d) => d.start_date > today);
  const past = deployments.filter((d) => d.end_date && d.end_date < today);
  const usable = contracts.filter((k) => k.state === 'signed' && ['active', 'expiring', 'upcoming'].includes(k.status));

  async function createContract(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const f = contractForm;
      await api('/contracts', {
        method: 'POST',
        json: {
          client_id: id, contract_no: f.contract_no, start_date: f.start_date, end_date: f.end_date,
          notice_days: Number(f.notice_days),
          lines: f.unit_price
            ? [{ position: f.position, headcount: Number(f.headcount), unit: f.unit, unit_price: Number(f.unit_price) }]
            : [],
        },
      });
      setContractForm({ ...contractForm, contract_no: '', end_date: '', unit_price: '' });
      await load();
    });
  }

  async function deploy(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/deployments', {
        method: 'POST',
        json: {
          employee_id: deployForm.employee_id,
          client_id: id,
          start_date: deployForm.start_date,
          ...(deployForm.contract_id ? { contract_id: deployForm.contract_id } : {}),
        },
      });
      setDeployForm({ ...deployForm, employee_id: '' });
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Link href="/khach-hang" className="text-sm text-slate-500 hover:underline">← Khách hàng</Link>
        <h1 className="text-xl font-semibold">{clientRow.name}</h1>
        <span className="font-mono text-sm text-slate-400">{clientRow.code}</span>
      </div>
      <ErrorText error={error} />

      <Card title="Thông tin">
        <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
          <div><dt className="text-slate-500">Hình thức</dt><dd>{clientRow.management_mode === 'managed' ? 'Công ty quản lý' : 'Khách tự quản lý'}</dd></div>
          <div><dt className="text-slate-500">Người liên hệ</dt><dd>{clientRow.contact_name ?? '—'} {clientRow.contact_phone ?? ''}</dd></div>
          <div><dt className="text-slate-500">Mã số thuế</dt><dd>{clientRow.tax_code ?? '—'}</dd></div>
          <div className="md:col-span-2"><dt className="text-slate-500">Địa chỉ</dt><dd>{clientRow.address ?? '—'}</dd></div>
          <div>
            <dt className="text-slate-500">Người phụ trách bên công ty</dt>
            <dd>
              {can('client.manage') && staff.length ? (
                <Select
                  value={clientRow.account_manager_id ?? ''}
                  onChange={(e) =>
                    run(async () => {
                      await api(`/clients/${id}`, { method: 'PATCH', json: { account_manager_id: e.target.value || null } });
                      await load();
                    })
                  }
                >
                  <option value="">— Chưa có —</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </Select>
              ) : (
                clientRow.account_manager_name ?? '—'
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {can('site.view') && clientRow.management_mode === 'managed' && (
        <Card title={`Mục tiêu (${sites.length})`}>
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {sites.map((s) => (
              <li key={s.id} className="flex justify-between py-2">
                <Link href={`/muc-tieu/${s.id}`} className="font-medium text-teal-700 hover:underline">{s.name}</Link>
                <span className="text-slate-500">{s.checkpoint_count} điểm · {s.route_count} tuyến · {s.responsible_team_name ?? 'chưa có đội phụ trách'}</span>
              </li>
            ))}
            {!sites.length && <li className="py-2 text-slate-400">Chưa có mục tiêu</li>}
          </ul>
          {can('site.manage') && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api('/sites', { method: 'POST', json: { client_id: id, code: siteForm.code, name: siteForm.name, ...(siteForm.address ? { address: siteForm.address } : {}) } });
                  setSiteForm({ code: '', name: '', address: '' });
                  await load();
                });
              }}
              className="grid grid-cols-1 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-4"
            >
              <Field label="Mã mục tiêu"><Input value={siteForm.code} onChange={(e) => setSiteForm({ ...siteForm, code: e.target.value })} required /></Field>
              <Field label="Tên"><Input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} required /></Field>
              <Field label="Địa chỉ"><Input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} /></Field>
              <Button type="submit">Thêm mục tiêu</Button>
            </form>
          )}
        </Card>
      )}

      {can('contract.view') && (
        <Card title="Hợp đồng">
          <div className="overflow-x-auto"><table className="mb-3 w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Số HĐ</th><th>Thời hạn</th><th>Trạng thái</th><th className="text-right">Còn</th></tr>
            </thead>
            <tbody>
              {contracts.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <Link href={`/hop-dong?id=${k.id}`} className="font-medium text-teal-700 hover:underline">{k.contract_no}</Link>
                  </td>
                  <td>{date(k.start_date)} – {date(k.end_date)}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[k.status].tone}`}>{CONTRACT_STATUS[k.status].label}</span></td>
                  <td className="text-right">{k.days_left >= 0 ? `${k.days_left} ngày` : '—'}</td>
                </tr>
              ))}
              {!contracts.length && <tr><td colSpan={4} className="py-4 text-center text-slate-400">Chưa có hợp đồng</td></tr>}
            </tbody>
          </table></div>
          {can('contract.manage') && (
            <form onSubmit={createContract} className="grid grid-cols-2 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-5">
              <Field label="Số hợp đồng"><Input value={contractForm.contract_no} onChange={(e) => setContractForm({ ...contractForm, contract_no: e.target.value })} required /></Field>
              <Field label="Từ ngày"><Input type="date" value={contractForm.start_date} onChange={(e) => setContractForm({ ...contractForm, start_date: e.target.value })} required /></Field>
              <Field label="Đến ngày"><Input type="date" value={contractForm.end_date} onChange={(e) => setContractForm({ ...contractForm, end_date: e.target.value })} required /></Field>
              <Field label="Báo trước (ngày)"><Input type="number" min={0} max={365} value={contractForm.notice_days} onChange={(e) => setContractForm({ ...contractForm, notice_days: e.target.value })} /></Field>
              <div />
              <Field label="Vị trí">
                <Select value={contractForm.position} onChange={(e) => setContractForm({ ...contractForm, position: e.target.value })}>
                  {Object.entries(POSITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Số người"><Input type="number" min={1} value={contractForm.headcount} onChange={(e) => setContractForm({ ...contractForm, headcount: e.target.value })} /></Field>
              <Field label="Đơn vị">
                <Select value={contractForm.unit} onChange={(e) => setContractForm({ ...contractForm, unit: e.target.value })}>
                  {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Đơn giá (đ)"><Input type="number" min={0} value={contractForm.unit_price} onChange={(e) => setContractForm({ ...contractForm, unit_price: e.target.value })} /></Field>
              <Button type="submit">Tạo hợp đồng (nháp)</Button>
            </form>
          )}
        </Card>
      )}

      {can('deployment.view') && (
        <Card
          title={`Bảo vệ đang làm (${current.length})`}
          actions={<button onClick={() => setShowHistory(!showHistory)} className="text-sm text-teal-700 hover:underline">{showHistory ? 'Ẩn lịch sử' : 'Xem lịch sử'}</button>}
        >
          <div className="overflow-x-auto"><table className="mb-3 w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Nhân viên</th><th>Vị trí</th><th>Theo HĐ</th><th>Từ ngày</th><th /></tr>
            </thead>
            <tbody>
              {[...current, ...planned, ...(showHistory ? past : [])].map((d) => (
                <tr key={d.id} className={`border-t border-slate-100 ${d.end_date && d.end_date < today ? 'text-slate-400' : ''}`}>
                  <td className="py-2">
                    <Link href={`/nhan-vien/${d.employee_id}`} className="hover:underline">{d.employee_name}</Link>{' '}
                    <span className="font-mono text-slate-400">{d.employee_code}</span>
                  </td>
                  <td>{POSITION_LABEL[d.position] ?? d.position}</td>
                  <td>{d.contract_no ?? '—'}</td>
                  <td>
                    {date(d.start_date)}
                    {d.end_date && ` – ${date(d.end_date)}`}
                    {d.start_date > today && <span className="ml-1 text-xs text-sky-700">(sắp tới)</span>}
                    {d.end_reason && <div className="text-xs">{d.end_reason}</div>}
                  </td>
                  <td className="text-right">
                    {can('deployment.manage') && !d.end_date && d.start_date <= today && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const reason = window.prompt(`Kết thúc điều động ${d.employee_name} hôm nay. Lý do:`);
                          if (reason !== null) {
                            void run(async () => {
                              await api(`/deployments/${d.id}/end`, { method: 'POST', json: { last_day: today, ...(reason ? { reason } : {}) } });
                              await load();
                            });
                          }
                        }}
                      >
                        Rút về
                      </Button>
                    )}
                    {can('deployment.manage') && d.start_date > today && (
                      <Button variant="secondary" onClick={() => run(async () => { await api(`/deployments/${d.id}`, { method: 'DELETE' }); await load(); })}>
                        Huỷ
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!current.length && !planned.length && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Chưa có bảo vệ nào</td></tr>}
            </tbody>
          </table></div>
          {can('deployment.manage') && (
            <form onSubmit={deploy} className="grid grid-cols-1 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-4">
              <Field label="Điều động nhân viên">
                <Select value={deployForm.employee_id} onChange={(e) => setDeployForm({ ...deployForm, employee_id: e.target.value })} required>
                  <option value="">— Chọn nhân viên —</option>
                  {employees.filter((e) => e.status === 'active').map((e) => (
                    <option key={e.id} value={e.id}>{e.code} · {e.full_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Theo hợp đồng">
                <Select value={deployForm.contract_id} onChange={(e) => setDeployForm({ ...deployForm, contract_id: e.target.value })}>
                  <option value="">— Không gắn —</option>
                  {usable.map((k) => <option key={k.id} value={k.id}>{k.contract_no}</option>)}
                </Select>
              </Field>
              <Field label="Từ ngày"><Input type="date" value={deployForm.start_date} onChange={(e) => setDeployForm({ ...deployForm, start_date: e.target.value })} required /></Field>
              <Button type="submit">Điều động</Button>
            </form>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Điều động một người đang làm ở khách khác sẽ tự kết thúc chỗ cũ vào ngày hôm trước.
          </p>
        </Card>
      )}
    </div>
  );
}
