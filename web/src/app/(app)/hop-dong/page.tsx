'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONTRACT_STATUS, date, money, POSITION_LABEL, UNIT_LABEL } from '@/lib/format';
import { ContractStatus, ContractView } from '@/lib/types';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

function ContractsInner() {
  const { can } = useAuth();
  const manage = can('contract.manage');
  const router = useRouter();
  const selectedId = useSearchParams().get('id');
  const [status, setStatus] = useState<'' | ContractStatus>('');
  const [rows, setRows] = useState<ContractView[]>([]);
  const [selected, setSelected] = useState<ContractView | null>(null);
  const [price, setPrice] = useState({ position: 'guard', effective_from: todayIso(), headcount: '1', unit: 'per_guard_month', unit_price: '' });
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    setRows(await api<ContractView[]>(`/contracts${status ? `?status=${status}` : ''}`));
    setSelected(selectedId ? await api<ContractView>(`/contracts/${selectedId}`) : null);
  }, [status, selectedId]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const patch = (json: object) =>
    run(async () => {
      await api(`/contracts/${selected!.id}`, { method: 'PATCH', json });
      await load();
    });

  async function changePrice(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/contracts/${selected!.id}/prices`, {
        method: 'POST',
        json: { ...price, headcount: Number(price.headcount), unit_price: Number(price.unit_price) },
      });
      setPrice({ ...price, unit_price: '' });
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Hợp đồng</h1>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | '')} className="w-48">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      <ErrorText error={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Số HĐ</th><th>Khách hàng</th><th>Hết hạn</th><th>Trạng thái</th></tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr
                  key={k.id}
                  onClick={() => router.replace(`/hop-dong?id=${k.id}`)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selected?.id === k.id ? 'bg-teal-50' : ''}`}
                >
                  <td className="py-2 font-medium">{k.contract_no}</td>
                  <td>{k.client_name}</td>
                  <td>{date(k.end_date)}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[k.status].tone}`}>{CONTRACT_STATUS[k.status].label}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-slate-400">Không có hợp đồng</td></tr>}
            </tbody>
          </table></div>
        </Card>

        {selected && (
          <Card
            title={`HĐ ${selected.contract_no}`}
            actions={<span className={`rounded px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[selected.status].tone}`}>{CONTRACT_STATUS[selected.status].label}</span>}
          >
            <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-slate-500">Khách hàng</dt><dd><Link href={`/khach-hang/${selected.client_id}`} className="text-teal-700 hover:underline">{selected.client_name}</Link></dd></div>
              <div><dt className="text-slate-500">Thời hạn</dt><dd>{date(selected.start_date)} – {date(selected.end_date)}</dd></div>
              <div><dt className="text-slate-500">Ngày ký</dt><dd>{date(selected.signed_at)}</dd></div>
              <div><dt className="text-slate-500">Báo trước</dt><dd>{selected.notice_days} ngày{selected.auto_renew ? ' · tự gia hạn' : ''}</dd></div>
              <div className="col-span-2">
                <dt className="text-slate-500">Bản scan</dt>
                <dd>
                  {selected.file ? (
                    <a href={`/api/files/${selected.file.id}`} className="text-teal-700 hover:underline">{selected.file.original_name}</a>
                  ) : (
                    '—'
                  )}
                  {manage && selected.state !== 'terminated' && (
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="ml-3 text-xs"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void run(async () => { const up = await uploadFile(file); await api(`/contracts/${selected.id}`, { method: 'PATCH', json: { file_id: up.id } }); await load(); });
                      }}
                    />
                  )}
                </dd>
              </div>
            </dl>

            <h3 className="mb-1 text-sm font-semibold">Giá theo vị trí</h3>
            <div className="overflow-x-auto"><table className="mb-3 w-full text-left text-sm">
              <thead className="text-slate-500"><tr><th className="py-1">Vị trí</th><th>Số người</th><th>Đơn giá</th><th>Áp dụng</th></tr></thead>
              <tbody>
                {(selected.lines ?? []).map((l) => (
                  <tr key={l.id} className={`border-t border-slate-100 ${l.effective_to && l.effective_to < todayIso() ? 'text-slate-400' : ''}`}>
                    <td className="py-1">{POSITION_LABEL[l.position] ?? l.position}</td>
                    <td>{l.headcount}</td>
                    <td>{money(l.unit_price)}{UNIT_LABEL[l.unit]}{l.shift_hours ? ` (${l.shift_hours}h)` : ''}</td>
                    <td>{date(l.effective_from)} – {l.effective_to ? date(l.effective_to) : 'nay'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>

            {manage && selected.state !== 'terminated' && (
              <>
                <form onSubmit={changePrice} className="mb-3 grid grid-cols-2 items-end gap-2 md:grid-cols-3">
                  <Field label="Vị trí">
                    <Select value={price.position} onChange={(e) => setPrice({ ...price, position: e.target.value })}>
                      {Object.entries(POSITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Áp dụng từ"><Input type="date" value={price.effective_from} onChange={(e) => setPrice({ ...price, effective_from: e.target.value })} /></Field>
                  <Field label="Số người"><Input type="number" min={1} value={price.headcount} onChange={(e) => setPrice({ ...price, headcount: e.target.value })} /></Field>
                  <Field label="Đơn vị">
                    <Select value={price.unit} onChange={(e) => setPrice({ ...price, unit: e.target.value })}>
                      {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Đơn giá mới (đ)"><Input type="number" min={0} value={price.unit_price} onChange={(e) => setPrice({ ...price, unit_price: e.target.value })} required /></Field>
                  <Button type="submit">Đổi / thêm giá</Button>
                </form>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {selected.state === 'draft' && <Button onClick={() => patch({ state: 'signed', signed_at: todayIso() })}>Đánh dấu đã ký</Button>}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const end = window.prompt('Gia hạn đến ngày (YYYY-MM-DD):', selected.end_date);
                      if (end) void patch({ end_date: end });
                    }}
                  >
                    Gia hạn
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (window.confirm(`Chấm dứt hợp đồng ${selected.contract_no} từ hôm nay?`)) {
                        void run(async () => { await api(`/contracts/${selected.id}/terminate`, { method: 'POST', json: {} }); await load(); });
                      }
                    }}
                  >
                    Chấm dứt
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

export default function ContractsPage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Đang tải…</div>}>
      <ContractsInner />
    </Suspense>
  );
}
