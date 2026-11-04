'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { IncidentCategories } from '@/components/incident-categories';
import { api } from '@/lib/api';
import { CLOSE_BY_LEADER, SETTING_FIELDS } from '@/lib/format';
import { CompanySettings, SettingsValues } from '@/lib/types';

export default function CompanySettingsPage() {
  const [data, setData] = useState<CompanySettings | null>(null);
  const [draft, setDraft] = useState<SettingsValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<CompanySettings>('/settings').then((d) => { setData(d); setDraft(d.values); }).catch((e) => setError(errorMessage(e)));
  }, []);

  if (!data || !draft) return <ErrorText error={error} />;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const next = await api<CompanySettings>('/settings', { method: 'PATCH', json: draft });
      setData(next);
      setDraft(next.values);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Cài đặt công ty</h1>
      <p className="text-sm text-slate-500">Đây là giá trị chung. Mục tiêu nào cần khác thì đặt riêng trong trang của mục tiêu đó.</p>
      <Card>
        <form onSubmit={save} className="space-y-3">
          {SETTING_FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''} — mặc định hệ thống: ${f.key === 'incident_close_by_leader_up_to' ? CLOSE_BY_LEADER[data.defaults[f.key]] : data.defaults[f.key]}`}>
              {f.key === 'incident_close_by_leader_up_to' ? (
                <Select value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value as SettingsValues['incident_close_by_leader_up_to'] })}>
                  {Object.entries(CLOSE_BY_LEADER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              ) : (
                <Input type="number" min={f.min} max={f.max} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })} required />
              )}
            </Field>
          ))}
          <ErrorText error={error} />
          {saved && <p className="text-sm text-teal-700">Đã lưu. Các mục tiêu không đặt riêng sẽ dùng giá trị mới ngay.</p>}
          <Button type="submit">Lưu cài đặt</Button>
        </form>
      </Card>
      <IncidentCategories />
    </div>
  );
}
