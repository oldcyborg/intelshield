const TAG = /^PTR1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{22})$/i;

/** The checkpoint a printed tag names. The signature is checked by the server; here it only picks the stop. */
export function parseTag(payload: string): string | null {
  const m = TAG.exec(payload.trim());
  return m ? m[1].toLowerCase() : null;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export type StopState = 'done' | 'queued' | 'todo';

/** Each stop as the guard should see it: confirmed by the server, waiting on this phone, or still to do. */
export function stopStates(stops: { checkpoint_id: string; scanned_at: string | null }[], queuedCheckpoints: string[]): Record<string, StopState> {
  const out: Record<string, StopState> = {};
  for (const s of stops) out[s.checkpoint_id] = s.scanned_at ? 'done' : queuedCheckpoints.includes(s.checkpoint_id) ? 'queued' : 'todo';
  return out;
}

export function progress(stops: { checkpoint_id: string; required: boolean }[], states: Record<string, StopState>) {
  const required = stops.filter((s) => s.required);
  return { done: required.filter((s) => states[s.checkpoint_id] !== 'todo').length, required: required.length };
}
