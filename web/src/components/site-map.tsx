'use client';

import 'leaflet/dist/leaflet.css';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@/components/ui';

/** What a click or a drag on the map places: the site itself, the checkpoint being added, or one already there. */
export type MapTarget = { kind: 'site' } | { kind: 'new' } | { kind: 'checkpoint'; id: string };

export interface MapPoint {
  id: string;
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radius: number;
}

interface Props {
  site: { lat: number | null; lng: number | null; radius: number };
  checkpoints: MapPoint[];
  /** The checkpoint being added, once placed. */
  draft: { lat: number | null; lng: number | null; radius: number };
  target: MapTarget;
  onTarget: (t: MapTarget) => void;
  onPick: (t: MapTarget, lat: number, lng: number) => void;
  editable: boolean;
}

interface Place {
  label: string;
  lat: number;
  lng: number;
}

/** A Photon (komoot) search hit: GeoJSON, coordinates as [lng, lat]. */
interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

/**
 * Map and search providers that answer from Vietnamese networks; some resolvers send *.openstreetmap.org to
 * nowhere. Street map: the German OpenStreetMap community server. Satellite: Esri World Imagery. Search: Photon.
 */
const STREETS = {
  url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, máy chủ openstreetmap.de',
};
const SATELLITE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Ảnh vệ tinh &copy; Esri, Maxar, Earthstar Geographics',
};
const VIETNAM_BBOX = '102.1,8.2,109.5,23.4';

const placeLabel = (p: PhotonFeature['properties']) =>
  [p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.locality ?? p.district, p.city ?? p.state].filter(Boolean).join(', ');

const HANOI: [number, number] = [21.0285, 105.8542];
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const has = (p: { lat: number | null; lng: number | null }): p is { lat: number; lng: number } =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180;
const same = (a: MapTarget, b: MapTarget) => a.kind === b.kind && (a.kind !== 'checkpoint' || (b.kind === 'checkpoint' && a.id === b.id));

const pin = (color: string, label: string, active: boolean) =>
  `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center">
     <div style="background:${color};color:#fff;font:600 11px sans-serif;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);${active ? 'outline:2px solid #facc15' : ''}">${label}</div>
     <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${color}"></div>
   </div>`;

/**
 * The site on an OpenStreetMap map: its check-in circle and its checkpoints. Click the map (or drag the
 * highlighted pin) to place whatever is selected above it; search finds an address to start from.
 */
export function SiteMap({ site, checkpoints, draft, target, onTarget, onPick, editable }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import('leaflet') | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Map handlers are bound once: they read the latest choice through this ref.
  const latest = useRef({ target, onPick, editable });
  latest.current = { target, onPick, editable };

  // Leaflet touches `window`: loaded in the browser only, once.
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((leaflet) => {
      if (cancelled || !box.current || map.current) return;
      L.current = leaflet;
      const placed = [site, ...checkpoints].map((p) => ({ lat: p.lat, lng: p.lng })).filter(has);
      const m = leaflet.map(box.current, { zoomControl: true }).setView(placed.length ? [placed[0].lat, placed[0].lng] : HANOI, placed.length ? 18 : 12);
      const streets = leaflet.tileLayer(STREETS.url, { maxZoom: 19, attribution: STREETS.attribution }).addTo(m);
      const satellite = leaflet.tileLayer(SATELLITE.url, { maxZoom: 19, attribution: SATELLITE.attribution });
      leaflet.control.layers({ 'Bản đồ': streets, 'Vệ tinh': satellite }, undefined, { position: 'topright' }).addTo(m);
      if (placed.length > 1) m.fitBounds(leaflet.latLngBounds(placed.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 19 });
      m.on('click', (e) => {
        const { target: t, onPick: pick, editable: can } = latest.current;
        if (can) pick(t, round(e.latlng.lat), round(e.latlng.lng));
      });
      map.current = m;
      layer.current = leaflet.layerGroup().addTo(m);
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The first view only; later changes are drawn below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything on the map, redrawn whenever a position or the selection changes.
  useEffect(() => {
    const leaflet = L.current;
    const group = layer.current;
    if (!ready || !leaflet || !group) return;
    group.clearLayers();
    const draw = (p: { lat: number; lng: number }, radius: number, color: string, label: string, t: MapTarget) => {
      const active = editable && same(t, target);
      leaflet.circle([p.lat, p.lng], { radius, color, weight: active ? 3 : 1.5, fillOpacity: active ? 0.15 : 0.08, dashArray: active ? undefined : '4 4' }).addTo(group);
      const marker = leaflet.marker([p.lat, p.lng], {
        icon: leaflet.divIcon({ html: pin(color, label, active), className: '', iconSize: [0, 0] }),
        draggable: active,
        zIndexOffset: active ? 1000 : 0,
      }).addTo(group);
      marker.on('click', () => editable && onTarget(t));
      marker.on('dragend', () => {
        const at = marker.getLatLng();
        onPick(t, round(at.lat), round(at.lng));
      });
    };
    if (has(site)) draw(site, site.radius, '#0f766e', '🏢 Mục tiêu', { kind: 'site' });
    for (const c of checkpoints) if (has(c)) draw(c, c.radius, '#1d4ed8', c.code, { kind: 'checkpoint', id: c.id });
    if (has(draft)) draw(draft, draft.radius, '#ea580c', '＋ Điểm mới', { kind: 'new' });
  }, [ready, site, checkpoints, draft, target, editable, onPick, onTarget]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      // Results near what is on screen come first.
      const at = map.current?.getCenter();
      const near = at ? `&lat=${at.lat}&lon=${at.lng}` : '';
      const url = `https://photon.komoot.io/api/?limit=6&bbox=${VIETNAM_BBOX}${near}&q=${encodeURIComponent(query.trim())}`;
      const { features } = (await (await fetch(url)).json()) as { features: PhotonFeature[] };
      setPlaces(features.map((f) => ({ label: placeLabel(f.properties), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
    } catch {
      setPlaces([]);
    } finally {
      setSearching(false);
    }
  }

  function go(p: Place) {
    const lat = round(p.lat);
    const lng = round(p.lng);
    map.current?.flyTo([lat, lng], 18);
    if (editable) onPick(target, lat, lng);
    setPlaces(null);
  }

  const choice = target.kind === 'checkpoint' ? `cp:${target.id}` : target.kind;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <>
            <span className="text-sm text-slate-600">Bấm lên bản đồ để đặt:</span>
            <Select
              className="w-64"
              value={choice}
              onChange={(e) => {
                const v = e.target.value;
                onTarget(v === 'site' ? { kind: 'site' } : v === 'new' ? { kind: 'new' } : { kind: 'checkpoint', id: v.slice(3) });
              }}
            >
              <option value="site">🏢 Vị trí mục tiêu (vòng chấm công)</option>
              <option value="new">＋ Điểm tuần tra đang thêm</option>
              {checkpoints.map((c) => <option key={c.id} value={`cp:${c.id}`}>Dời điểm {c.code} · {c.name}</option>)}
            </Select>
          </>
        )}
        <form onSubmit={search} className="ml-auto flex gap-2">
          <Input className="w-72" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm địa chỉ, toà nhà…" />
          <Button type="submit" variant="secondary" disabled={searching}>{searching ? 'Đang tìm…' : 'Tìm'}</Button>
        </form>
      </div>
      {places && (
        <ul className="rounded-md border border-slate-200 bg-white text-sm shadow-sm">
          {places.map((p) => (
            <li key={`${p.lat},${p.lng}`}>
              <button type="button" onClick={() => go(p)} className="w-full px-3 py-2 text-left hover:bg-slate-50">{p.label}</button>
            </li>
          ))}
          {!places.length && <li className="px-3 py-2 text-slate-400">Không tìm thấy — thử tên đường, phường hoặc toà nhà khác, rồi bấm đúng vị trí trên bản đồ.</li>}
        </ul>
      )}
      {/* Its own stacking context: Leaflet's panes must not cover the page header. */}
      <div ref={box} className="relative z-0 h-[420px] w-full rounded-md border border-slate-200" />
      <p className="text-xs text-slate-500">
        {editable ? 'Ghim có viền vàng là thứ đang đặt — kéo ghim để chỉnh. Vòng tròn là bán kính cho phép. ' : ''}
        Góc phải trên bản đồ: chuyển sang ảnh "Vệ tinh" để thấy rõ toà nhà. Tìm địa chỉ chỉ để đưa bản đồ tới gần — hãy bấm đúng vị trí trên bản đồ.
      </p>
    </div>
  );
}
