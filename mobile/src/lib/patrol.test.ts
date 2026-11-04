import { describe, expect, it } from 'vitest';
import { distanceM, parseTag, progress, stopStates } from './patrol';

const CP = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('parseTag', () => {
  it('reads the checkpoint out of a printed tag', () => {
    expect(parseTag(`PTR1.${CP}.abcdefghijklmnopqrstuv`)).toBe(CP);
    expect(parseTag(`  PTR1.${CP}.abcdefghijklmnopqrstuv \n`)).toBe(CP);
  });
  it('refuses anything that is not one of our tags', () => {
    expect(parseTag('https://example.com')).toBeNull();
    expect(parseTag(`PTR1.${CP}.short`)).toBeNull();
    expect(parseTag('PTR1.not-a-uuid.abcdefghijklmnopqrstuv')).toBeNull();
  });
});

describe('distanceM', () => {
  it('measures metres between two points', () => {
    expect(distanceM({ lat: 21.028511, lng: 105.776742 }, { lat: 21.028511, lng: 105.776742 })).toBe(0);
    const d = distanceM({ lat: 21.028511, lng: 105.776742 }, { lat: 21.0294, lng: 105.776742 });
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe('stopStates and progress', () => {
  const stops = [
    { checkpoint_id: 'a', required: true, scanned_at: '2026-10-13T01:00:00Z' },
    { checkpoint_id: 'b', required: true, scanned_at: null },
    { checkpoint_id: 'c', required: false, scanned_at: null },
  ];
  it('shows what the server has, what waits on the phone, and what is left', () => {
    const states = stopStates(stops, ['b']);
    expect(states).toEqual({ a: 'done', b: 'queued', c: 'todo' });
    expect(progress(stops, states)).toEqual({ done: 2, required: 2 });
    expect(progress(stops, stopStates(stops, []))).toEqual({ done: 1, required: 2 });
  });
});
