'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Employee } from '@/lib/types';

const EMPTY = { code: '', full_name: '', phone: '' };

export default function EmployeesPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<Employee[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<Employee[]>('/employees'));
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
      await api('/employees', {
        method: 'POST',
        json: { code: form.code, full_name: form.full_name, ...(form.phone ? { phone: form.phone } : {}) },
      });
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleStatus(employee: Employee) {
    setError(null);
    try {
      await api(`/employees/${employee.id}`, {
        method: 'PATCH',
        json: { status: employee.status === 'active' ? 'inactive' : 'active' },
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Nhân viên</h1>
      {can('employee.manage') && (
        <Card title="Thêm nhân viên">
          <form onSubmit={create} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
            <Field label="Mã nhân viên">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </Field>
            <Field label="Họ tên">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </Field>
            <Field label="Số điện thoại">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
              <th>Họ tên</th>
              <th>Điện thoại</th>
              <th>Đội</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="py-2 font-mono">{e.code}</td>
                <td>
                  <Link href={`/nhan-vien/${e.id}`} className="text-teal-700 hover:underline">
                    {e.full_name}
                  </Link>
                </td>
                <td>{e.phone ?? '—'}</td>
                <td>{e.team?.name ?? <span className="text-slate-400">Chưa vào đội</span>}</td>
                <td>{e.status === 'active' ? 'Đang làm' : <span className="text-slate-400">Đã nghỉ</span>}</td>
                <td className="text-right">
                  {can('employee.manage') && (
                    <Button variant="secondary" onClick={() => toggleStatus(e)}>
                      {e.status === 'active' ? 'Cho nghỉ' : 'Đi làm lại'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Chưa có nhân viên nào trong phạm vi của bạn
                </td>
              </tr>
            )}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
