'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { EmployeePay } from '@/components/employee-pay';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, DOCUMENT_KIND } from '@/lib/format';
import { DeploymentView, EmployeeProfile } from '@/lib/types';

const FIELDS: { key: keyof EmployeeProfile; label: string; type?: string }[] = [
  { key: 'date_of_birth', label: 'Ngày sinh', type: 'date' },
  { key: 'national_id', label: 'Số CCCD' },
  { key: 'hire_date', label: 'Ngày vào làm', type: 'date' },
  { key: 'address', label: 'Địa chỉ' },
  { key: 'emergency_contact', label: 'Liên hệ khẩn cấp' },
];

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const manage = can('employee.manage') && me.team_visibility.all;
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [deployments, setDeployments] = useState<DeploymentView[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState({ kind: 'security_certificate', number: '', issued_on: '', expires_on: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
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
    const p = await api<EmployeeProfile>(`/employees/${id}/profile`);
    setProfile(p);
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, (p[f.key] as string | null) ?? ''])));
    if (can('deployment.view')) setDeployments(await api<DeploymentView[]>(`/deployments?employee_id=${id}`));
  }, [id, can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  if (!profile) return <ErrorText error={error} />;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/employees/${id}`, {
        method: 'PATCH',
        json: Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key] || null])),
      });
      await load();
    });
  }

  async function addDocument(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const file = docFile ? await uploadFile(docFile) : null;
      await api(`/employees/${id}/documents`, {
        method: 'POST',
        json: {
          kind: doc.kind,
          ...(doc.number ? { number: doc.number } : {}),
          ...(doc.issued_on ? { issued_on: doc.issued_on } : {}),
          ...(doc.expires_on ? { expires_on: doc.expires_on } : {}),
          ...(file ? { file_id: file.id } : {}),
        },
      });
      setDoc({ ...doc, number: '', issued_on: '', expires_on: '' });
      setDocFile(null);
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Link href="/nhan-vien" className="text-sm text-slate-500 hover:underline">← Nhân viên</Link>
        <h1 className="text-xl font-semibold">{profile.full_name}</h1>
        <span className="font-mono text-sm text-slate-400">{profile.code}</span>
        <span className="text-sm text-slate-500">{profile.team ? `Đội ${profile.team.name}` : 'Chưa vào đội'}</span>
      </div>
      <ErrorText error={error} />

      <Card title="Hồ sơ">
        {me.team_visibility.all ? (
          <form onSubmit={saveProfile} className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input type={f.type ?? 'text'} value={draft[f.key] ?? ''} disabled={!manage} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              </Field>
            ))}
            {manage && <Button type="submit">Lưu hồ sơ</Button>}
          </form>
        ) : (
          <p className="text-sm text-slate-500">Thông tin cá nhân chỉ hiển thị cho HR và ban giám đốc.</p>
        )}
      </Card>

      {can('employee.pay.view') && <EmployeePay employeeId={id} editable={can('employee.pay.manage')} />}

      <Card title="Giấy tờ, chứng chỉ">
        <div className="overflow-x-auto"><table className="mb-3 w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">Loại</th><th>Số</th><th>Ngày cấp</th><th>Hết hạn</th><th>File</th><th /></tr></thead>
          <tbody>
            {profile.documents.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="py-2">{DOCUMENT_KIND[d.kind] ?? d.kind}</td>
                <td>{d.number ?? '—'}</td>
                <td>{date(d.issued_on)}</td>
                <td>
                  {date(d.expires_on)}
                  {d.days_left !== null && d.days_left <= 30 && (
                    <span className={`ml-2 rounded px-1.5 text-xs ${d.days_left < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                      {d.days_left < 0 ? 'đã hết hạn' : `còn ${d.days_left} ngày`}
                    </span>
                  )}
                </td>
                <td>{d.file ? <a href={`/api/files/${d.file.id}`} className="text-teal-700 hover:underline">Tải về</a> : '—'}</td>
                <td className="text-right">
                  {manage && (
                    <Button variant="secondary" onClick={() => run(async () => { await api(`/employees/${id}/documents/${d.id}`, { method: 'DELETE' }); await load(); })}>
                      Xoá
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!profile.documents.length && <tr><td colSpan={6} className="py-4 text-center text-slate-400">Chưa có giấy tờ</td></tr>}
          </tbody>
        </table></div>
        {manage && (
          <form onSubmit={addDocument} className="grid grid-cols-2 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-6">
            <Field label="Loại">
              <Select value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>
                {Object.entries(DOCUMENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Số"><Input value={doc.number} onChange={(e) => setDoc({ ...doc, number: e.target.value })} /></Field>
            <Field label="Ngày cấp"><Input type="date" value={doc.issued_on} onChange={(e) => setDoc({ ...doc, issued_on: e.target.value })} /></Field>
            <Field label="Hết hạn"><Input type="date" value={doc.expires_on} onChange={(e) => setDoc({ ...doc, expires_on: e.target.value })} /></Field>
            <Field label="File (PDF/ảnh)">
              <input type="file" accept="application/pdf,image/jpeg,image/png" className="text-xs" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Button type="submit">Thêm</Button>
          </form>
        )}
      </Card>

      {can('deployment.view') && (
        <Card title="Lịch sử điều động">
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-2">Khách hàng</th><th>Từ</th><th>Đến</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2"><Link href={`/khach-hang/${d.client_id}`} className="text-teal-700 hover:underline">{d.client_name}</Link></td>
                  <td>{date(d.start_date)}</td>
                  <td>{d.end_date ? date(d.end_date) : 'nay'}</td>
                  <td className="text-slate-500">{d.end_reason ?? ''}</td>
                </tr>
              ))}
              {!deployments.length && <tr><td colSpan={4} className="py-4 text-center text-slate-400">Chưa từng được điều động</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
