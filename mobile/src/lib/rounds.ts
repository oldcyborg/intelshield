import { cached } from './cache';
import { api } from './client';

export interface RoundStop {
  checkpoint_id: string;
  seq: number;
  required: boolean;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: ('qr' | 'gps' | 'photo' | 'nfc')[];
  photo_required: boolean;
  scanned_at: string | null;
  method: string | null;
  validity: string | null;
  flags: string[];
}

export interface MyRound {
  id: string;
  site_id: string;
  site_name: string;
  route_name: string;
  schedule_name: string;
  expected_start: string;
  expected_end: string;
  status: string;
  late: boolean;
  started_at: string | null;
  ended_at: string | null;
  employee_name: string | null;
  employee_id: string | null;
  mine: boolean;
  required_count: number;
  done_required: number;
  stops: RoundStop[];
}

/** Today's rounds of my shifts, kept on the phone for when there is no signal. */
export async function loadMyRounds() {
  const { data, offline, at } = await cached('rounds', () => api.request<MyRound[]>('/me/rounds'));
  return { rounds: data, offline, at };
}

const MIN = 60_000;
/**
 * Like the server: a round can be started from 10 minutes before its window until the window ends; once started,
 * scans count until the site's tolerance after it (15 minutes by default — a site may allow longer).
 */
export function roundWindow(r: Pick<MyRound, 'expected_start' | 'expected_end' | 'ended_at' | 'started_at'>, now = Date.now()): 'early' | 'open' | 'over' {
  if (r.ended_at) return 'over';
  if (now < Date.parse(r.expected_start) - 10 * MIN) return 'early';
  const last = Date.parse(r.expected_end) + (r.started_at ? 15 * MIN : 0);
  if (now > last) return 'over';
  return 'open';
}
