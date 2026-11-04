'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { CLOSE_BY_LEADER, SETTING_FIELDS } from '@/lib/format';
import { SettingKey, SiteSettingsView } from '@/lib/types';

/** Each value either follows the company or is set for this site; one switch per row moves between the two. */
export function SiteSettings({ siteId, manage }: { siteId: string; manage: boolean }) {
  const [data, setData] = useState<SiteSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setData(await api<SiteSettingsView>(`/sites/${siteId}/settings`)), [siteId]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const patch = async (key: SettingKey, value: number | string | null) => {
    setError(null);
    try {
      setData(await api<SiteSettingsView>(`/sites/${siteId}/settings`, { method: 'PATCH', json: { [key]: value } }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!data) return <ErrorText error={error} />;
  return (
    <Card title="Cài đặt riêng của mục tiêu">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="text-slate-500"><tr><th className="py-2">Cài đặt</th><th>Giá trị đang dùng</th><th>Theo</th><th /></tr></thead>
        <tbody>
          {SETTING_FIELDS.map((f) => {
            const own = data.source[f.key] === 'site';
            const value = data.values[f.key];
            return (
              <tr key={f.key} className="border-t border-slate-100">
                <td className="py-2">{f.label}</td>
                <td className="w-48">
                  {own && manage ? (
                    f.key === 'incident_close_by_leader_up_to' ? (
                      <Select value={String(value)} onChange={(e) => patch(f.key, e.target.value)}>
                        {Object.entries(CLOSE_BY_LEADER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    ) : (
                      <Input type="number" min={f.min} max={f.max} defaultValue={Number(value)} onBlur={(e) => e.target.value !== String(value) && patch(f.key, Number(e.target.value))} />
                    )
                  ) : (
                    <span>{f.key === 'incident_close_by_leader_up_to' ? CLOSE_BY_LEADER[String(value)] : `${value} ${f.unit ?? ''}`}</span>
                  )}
                </td>
                <td className={own ? 'font-medium text-teal-700' : 'text-slate-500'}>{own ? 'Riêng mục tiêu' : 'Công ty'}</td>
                <td className="text-right">
                  {manage && (own ? (
                    <Button variant="secondary" onClick={() => patch(f.key, null)}>Dùng giá trị công ty</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => patch(f.key, data.company[f.key])}>Đặt riêng</Button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <ErrorText error={error} />
    </Card>
  );
}
