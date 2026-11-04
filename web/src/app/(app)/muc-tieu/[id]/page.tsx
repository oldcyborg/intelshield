'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { SiteContacts } from '@/components/site-contacts';
import { SiteSettings } from '@/components/site-settings';
import { SiteHandoverItems } from '@/components/site-handover-items';
import { MapPoint, MapTarget, SiteMap } from '@/components/site-map';
import { SitePatrolSchedules } from '@/components/site-patrol-schedules';
import { SiteShifts } from '@/components/site-shifts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { METHOD_LABEL, PHOTO_RULE } from '@/lib/format';
import { CheckMethod, CheckpointView, PhotoRule, RouteView, SiteDetail, TeamRow } from '@/lib/types';

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export default function SitePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const manage = can('site.manage');
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>([]);
  const [routes, setRoutes] = useState<RouteView[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [info, setInfo] = useState({ name: '', address: '', lat: '', lng: '', geofence_radius_m: '150', responsible_team_id: '' });
  const [postName, setPostName] = useState('');
  const [cp, setCp] = useState({ code: '', name: '', lat: '', lng: '', radius_m: '30', methods: ['qr'] as CheckMethod[], photo_rule: 'never' as PhotoRule });
  const [draftRoute, setDraftRoute] = useState<{ id: string | null; name: string; stops: { checkpoint_id: string; required: boolean }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<MapTarget>({ kind: 'site' });
  // Checkpoints dragged to a new place on the map, waiting for "Lưu".
  const [moves, setMoves] = useState<Record<string, { lat: number; lng: number }>>({});

  const pick = useCallback((t: MapTarget, lat: number, lng: number) => {
    if (t.kind === 'site') setInfo((i) => ({ ...i, lat: String(lat), lng: String(lng) }));
    else if (t.kind === 'new') setCp((c) => ({ ...c, lat: String(lat), lng: String(lng) }));
    else setMoves((m) => ({ ...m, [t.id]: { lat, lng } }));
  }, []);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    const s = await api<SiteDetail>(`/sites/${id}`);
    setSite(s);
    setInfo({
      name: s.name, address: s.address ?? '', lat: s.lat ?? '', lng: s.lng ?? '',
      geofence_radius_m: String(s.geofence_radius_m), responsible_team_id: s.responsible_team_id ?? '',
    });
    setCheckpoints(await api<CheckpointView[]>(`/sites/${id}/checkpoints`));
    setRoutes(await api<RouteView[]>(`/sites/${id}/routes`));
    if (manage && can('org.view')) setTeams(await api<TeamRow[]>('/org/teams'));
  }, [id, manage, can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  if (!site) return <ErrorText error={error} />;
  const active = checkpoints.filter((c) => c.status === 'active');
  const nameOf = (cid: string) => checkpoints.find((c) => c.id === cid)?.name ?? '?';
  const siteMoved = info.lat !== (site.lat ?? '') || info.lng !== (site.lng ?? '');
  const points: MapPoint[] = active.map((c) => ({
    id: c.id, code: c.code, name: c.name, radius: c.radius_m,
    lat: moves[c.id]?.lat ?? num(c.lat ?? ''), lng: moves[c.id]?.lng ?? num(c.lng ?? ''),
  }));

  async function saveMove(cid: string) {
    await run(async () => {
      await api(`/checkpoints/${cid}`, { method: 'PATCH', json: moves[cid] });
      setMoves(({ [cid]: _, ...rest }) => rest);
      await load();
    });
  }

  async function saveInfo(event?: FormEvent) {
    event?.preventDefault();
    await run(async () => {
      await api(`/sites/${id}`, {
        method: 'PATCH',
        json: {
          name: info.name, address: info.address || null, lat: num(info.lat), lng: num(info.lng),
          geofence_radius_m: Number(info.geofence_radius_m), responsible_team_id: info.responsible_team_id || null,
        },
      });
      await load();
    });
  }

  async function addCheckpoint(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`/sites/${id}/checkpoints`, {
        method: 'POST',
        json: {
          code: cp.code, name: cp.name, radius_m: Number(cp.radius_m), allowed_methods: cp.methods, photo_rule: cp.photo_rule,
          ...(cp.lat && cp.lng ? { lat: Number(cp.lat), lng: Number(cp.lng) } : {}),
        },
      });
      setCp({ ...cp, code: '', name: '', lat: '', lng: '' });
      await load();
    });
  }

  async function saveRoute() {
    if (!draftRoute) return;
    await run(async () => {
      const json = { name: draftRoute.name, checkpoints: draftRoute.stops };
      if (draftRoute.id) await api(`/routes/${draftRoute.id}`, { method: 'PUT', json });
      else await api(`/sites/${id}/routes`, { method: 'POST', json });
      setDraftRoute(null);
      await load();
    });
  }

  const moveStop = (index: number, delta: number) => {
    if (!draftRoute) return;
    const stops = [...draftRoute.stops];
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    [stops[index], stops[target]] = [stops[target], stops[index]];
    setDraftRoute({ ...draftRoute, stops });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href={`/khach-hang/${site.client_id}`} className="text-sm text-slate-500 hover:underline">← {site.client_name}</Link>
        <h1 className="text-xl font-semibold">{site.name}</h1>
        <span className="font-mono text-sm text-slate-400">{site.code}</span>
        {manage && (
          <a href={`/in-tem/${site.id}`} target="_blank" rel="noreferrer" className="ml-auto text-sm font-medium text-teal-700 hover:underline">
            In tem QR ↗
          </a>
        )}
      </div>
      <ErrorText error={error} />

      <Card title="Thông tin mục tiêu">
        <form onSubmit={saveInfo} className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
          <Field label="Tên"><Input value={info.name} disabled={!manage} onChange={(e) => setInfo({ ...info, name: e.target.value })} required /></Field>
          <Field label="Địa chỉ"><Input value={info.address} disabled={!manage} onChange={(e) => setInfo({ ...info, address: e.target.value })} /></Field>
          <Field label="Đội phụ trách">
            <Select value={info.responsible_team_id} disabled={!manage} onChange={(e) => setInfo({ ...info, responsible_team_id: e.target.value })}>
              <option value="">{site.responsible_team_name ?? '— Chưa có —'}</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Vĩ độ (lat)"><Input value={info.lat} disabled={!manage} placeholder="21.028511" onChange={(e) => setInfo({ ...info, lat: e.target.value })} /></Field>
          <Field label="Kinh độ (lng)"><Input value={info.lng} disabled={!manage} placeholder="105.776742" onChange={(e) => setInfo({ ...info, lng: e.target.value })} /></Field>
          <Field label="Bán kính vào ca (m)"><Input type="number" min={20} max={2000} value={info.geofence_radius_m} disabled={!manage} onChange={(e) => setInfo({ ...info, geofence_radius_m: e.target.value })} /></Field>
          {manage && <Button type="submit">Lưu</Button>}
        </form>
        <p className="mt-2 text-xs text-slate-500">Toạ độ chọn trên bản đồ bên dưới, hoặc nhập tay.</p>
      </Card>

      <Card title="Bản đồ mục tiêu và điểm tuần tra">
        <SiteMap
          site={{ lat: num(info.lat), lng: num(info.lng), radius: Number(info.geofence_radius_m) || 150 }}
          checkpoints={points}
          draft={{ lat: num(cp.lat), lng: num(cp.lng), radius: Number(cp.radius_m) || 30 }}
          target={target}
          onTarget={setTarget}
          onPick={pick}
          editable={manage}
        />
        {manage && (siteMoved || Object.keys(moves).length > 0) && (
          <div className="mt-3 space-y-2 rounded-md bg-amber-50 p-3 text-sm">
            {siteMoved && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1">Vị trí mục tiêu mới: {info.lat}, {info.lng}</span>
                <Button onClick={() => void saveInfo()}>Lưu vị trí mục tiêu</Button>
                <Button variant="secondary" onClick={() => setInfo({ ...info, lat: site.lat ?? '', lng: site.lng ?? '' })}>Huỷ</Button>
              </div>
            )}
            {Object.entries(moves).map(([cid, at]) => (
              <div key={cid} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">Dời điểm {checkpoints.find((c) => c.id === cid)?.code} tới {at.lat}, {at.lng}</span>
                <Button onClick={() => void saveMove(cid)}>Lưu</Button>
                <Button variant="secondary" onClick={() => setMoves(({ [cid]: _, ...rest }) => rest)}>Huỷ</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Chốt gác">
        <ul className="mb-2 flex flex-wrap gap-2 text-sm">
          {site.posts.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
              {p.name}
              {manage && <button onClick={() => run(async () => { await api(`/posts/${p.id}`, { method: 'DELETE' }); await load(); })} className="text-slate-400 hover:text-red-600">×</button>}
            </li>
          ))}
          {!site.posts.length && <li className="text-slate-400">Chưa có chốt gác</li>}
        </ul>
        {manage && (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/sites/${id}/posts`, { method: 'POST', json: { name: postName } }); setPostName(''); await load(); }); }} className="flex items-end gap-2">
            <Field label="Thêm chốt"><Input value={postName} onChange={(e) => setPostName(e.target.value)} required /></Field>
            <Button type="submit">Thêm</Button>
          </form>
        )}
      </Card>

      <SiteContacts siteId={site.id} manage={can('contact.manage')} />
      <SiteShifts siteId={site.id} manage={manage} />
      <SiteSettings siteId={site.id} manage={manage} />

      <Card title={`Điểm tuần tra (${active.length})`}>
        <div className="overflow-x-auto"><table className="mb-3 w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">Mã</th><th>Tên</th><th>Phương thức</th><th>Vị trí</th><th /></tr></thead>
          <tbody>
            {checkpoints.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${c.status === 'inactive' ? 'text-slate-400' : ''}`}>
                <td className="py-2 font-mono">{c.code}</td>
                <td>{c.name}</td>
                <td>
                  {c.allowed_methods.map((m) => METHOD_LABEL[m]).join(', ')}
                  {manage ? (
                    <select
                      value={c.photo_rule}
                      onChange={(e) => run(async () => { await api(`/checkpoints/${c.id}`, { method: 'PATCH', json: { photo_rule: e.target.value } }); await load(); })}
                      className="ml-2 rounded border border-slate-300 px-1 text-xs"
                    >
                      {Object.entries(PHOTO_RULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : c.photo_rule !== 'never' ? <span className="ml-1 text-xs text-slate-500">· {PHOTO_RULE[c.photo_rule]}</span> : null}
                </td>
                <td>{c.lat ? `${c.lat}, ${c.lng} (±${c.radius_m}m)` : '—'}</td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  {manage && (
                    <>
                      <Button variant="secondary" onClick={() => {
                        if (window.confirm(`In lại tem cho "${c.name}"? Tem cũ sẽ không quét được nữa.`)) {
                          void run(async () => { await api(`/checkpoints/${c.id}/rotate-qr`, { method: 'POST' }); });
                        }
                      }}>Đổi mã</Button>
                      <Button variant="secondary" onClick={() => run(async () => { await api(`/checkpoints/${c.id}`, { method: 'PATCH', json: { status: c.status === 'active' ? 'inactive' : 'active' } }); await load(); })}>
                        {c.status === 'active' ? 'Ngừng' : 'Dùng lại'}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!checkpoints.length && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Chưa có điểm tuần tra</td></tr>}
          </tbody>
        </table></div>
        {manage && (
          <form onSubmit={addCheckpoint} className="grid grid-cols-2 items-end gap-3 border-t border-slate-100 pt-3 md:grid-cols-4">
            <Field label="Mã điểm"><Input value={cp.code} onChange={(e) => setCp({ ...cp, code: e.target.value })} required /></Field>
            <Field label="Tên điểm"><Input value={cp.name} onChange={(e) => setCp({ ...cp, name: e.target.value })} required /></Field>
            <Field label="Vĩ độ (nếu dùng GPS — chọn trên bản đồ)"><Input value={cp.lat} onChange={(e) => setCp({ ...cp, lat: e.target.value })} /></Field>
            <Field label="Kinh độ"><Input value={cp.lng} onChange={(e) => setCp({ ...cp, lng: e.target.value })} /></Field>
            <Field label="Phương thức">
              <div className="flex flex-wrap gap-3 text-sm">
                {(Object.keys(METHOD_LABEL) as CheckMethod[]).map((m) => (
                  <label key={m} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={cp.methods.includes(m)}
                      onChange={() => setCp({ ...cp, methods: cp.methods.includes(m) ? cp.methods.filter((x) => x !== m) : [...cp.methods, m] })}
                    />
                    {METHOD_LABEL[m]}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Bán kính (m)"><Input type="number" min={5} max={500} value={cp.radius_m} onChange={(e) => setCp({ ...cp, radius_m: e.target.value })} /></Field>
            <Field label="Ảnh kèm theo">
              <Select value={cp.photo_rule} onChange={(e) => setCp({ ...cp, photo_rule: e.target.value as PhotoRule })}>
                {Object.entries(PHOTO_RULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Button type="submit">Thêm điểm</Button>
          </form>
        )}
      </Card>

      <Card
        title="Tuyến tuần tra"
        actions={manage && !draftRoute ? <Button variant="secondary" onClick={() => setDraftRoute({ id: null, name: '', stops: [] })}>Tạo tuyến</Button> : undefined}
      >
        <ul className="space-y-2 text-sm">
          {routes.map((r) => (
            <li key={r.id} className="rounded border border-slate-200 p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.name}</span>
                {manage && (
                  <span className="space-x-2">
                    <Button variant="secondary" onClick={() => setDraftRoute({ id: r.id, name: r.name, stops: r.checkpoints.map((s) => ({ checkpoint_id: s.checkpoint_id, required: s.required })) })}>Sửa</Button>
                    <Button variant="secondary" onClick={() => run(async () => { await api(`/routes/${r.id}`, { method: 'DELETE' }); await load(); })}>Xoá</Button>
                  </span>
                )}
              </div>
              <ol className="mt-1 list-decimal pl-5 text-slate-600">
                {r.checkpoints.map((s) => <li key={s.seq}>{s.name}{s.required ? '' : ' (không bắt buộc)'}</li>)}
              </ol>
            </li>
          ))}
          {!routes.length && !draftRoute && <li className="text-slate-400">Chưa có tuyến</li>}
        </ul>

        {draftRoute && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <Field label="Tên tuyến"><Input value={draftRoute.name} onChange={(e) => setDraftRoute({ ...draftRoute, name: e.target.value })} /></Field>
            <ol className="space-y-1 text-sm">
              {draftRoute.stops.map((s, i) => (
                <li key={s.checkpoint_id} className="flex items-center gap-2">
                  <span className="w-6 text-right text-slate-400">{i + 1}.</span>
                  <span className="flex-1">{nameOf(s.checkpoint_id)}</span>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={s.required} onChange={() => setDraftRoute({ ...draftRoute, stops: draftRoute.stops.map((x, j) => (j === i ? { ...x, required: !x.required } : x)) })} />
                    bắt buộc
                  </label>
                  <button onClick={() => moveStop(i, -1)} className="px-1 text-slate-500">↑</button>
                  <button onClick={() => moveStop(i, 1)} className="px-1 text-slate-500">↓</button>
                  <button onClick={() => setDraftRoute({ ...draftRoute, stops: draftRoute.stops.filter((_, j) => j !== i) })} className="px-1 text-red-600">×</button>
                </li>
              ))}
            </ol>
            <Select
              value=""
              onChange={(e) => e.target.value && setDraftRoute({ ...draftRoute, stops: [...draftRoute.stops, { checkpoint_id: e.target.value, required: true }] })}
            >
              <option value="">+ Thêm điểm vào cuối tuyến</option>
              {active.filter((c) => !draftRoute.stops.some((s) => s.checkpoint_id === c.id)).map((c) => (
                <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
              ))}
            </Select>
            <div className="space-x-2">
              <Button onClick={saveRoute} disabled={!draftRoute.name || !draftRoute.stops.length}>Lưu tuyến</Button>
              <Button variant="secondary" onClick={() => setDraftRoute(null)}>Huỷ</Button>
            </div>
          </div>
        )}
      </Card>

      <SitePatrolSchedules siteId={site.id} routes={routes} manage={manage} />
      <SiteHandoverItems siteId={site.id} manage={manage} />
    </div>
  );
}
