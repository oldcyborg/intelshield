'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ClientView } from '@/lib/types';

const EMPTY = { code: '', name: '', management_mode: 'managed', contact_name: '', contact_phone: '' };

export default function ClientsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<ClientView[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<ClientView[]>('/clients'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/clients', {
        method: 'POST',
        json: Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')),
      });
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Khách hàng</h1>
      {can('client.manage') && (
        <Card title="Thêm khách hàng">
          <form onSubmit={create} className="grid grid-cols-1 items-end gap-3 md:grid-cols-6">
            <Field label="Mã">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </Field>
            <div className="md:col-span-2">
              <Field label="Tên khách hàng">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
            </div>
            <Field label="Hình thức">
              <Select value={form.management_mode} onChange={(e) => setForm({ ...form, management_mode: e.target.value })}>
                <option value="managed">Công ty quản lý</option>
                <option value="self_managed">Khách tự quản lý</option>
              </Select>
            </Field>
            <Field label="Người liên hệ">
              <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            </Field>
            <Button type="submit">Thêm</Button>
          </form>
        </Card>
      )}
      <ErrorText error={error} />
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2">Mã</th>
              <th>Khách hàng</th>
              <th>Hình thức</th>
              <th>Phụ trách</th>
              <th className="text-right">Bảo vệ hôm nay</th>
              <th className="text-right">HĐ hiệu lực</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="py-2 font-mono">{c.code}</td>
                <td>
                  <Link href={`/khach-hang/${c.id}`} className="font-medium text-teal-700 hover:underline">
                    {c.name}
                  </Link>
                  {c.status === 'inactive' && <span className="ml-2 text-xs text-slate-400">ngừng</span>}
                </td>
                <td>{c.management_mode === 'managed' ? 'Công ty quản lý' : 'Khách tự quản lý'}</td>
                <td>{c.account_manager_name ?? '—'}</td>
                <td className="text-right">{c.guards_today}</td>
                <td className="text-right">{c.active_contracts}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">Chưa có khách hàng nào trong phạm vi của bạn</td>
              </tr>
            )}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
