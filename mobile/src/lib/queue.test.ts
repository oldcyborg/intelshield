import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './api';
import { OfflineQueue } from './queue';

let n = 0;
const fresh = (api: object) => new OfflineQueue(api as never, `test-queue-${++n}`);
const photo = () => ({ type: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff]).buffer });

describe('OfflineQueue', () => {
  it('sends in the order things happened', async () => {
    const sent: string[] = [];
    const q = fresh({ request: vi.fn(async (path: string) => { sent.push(path); return {}; }), upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    await q.add({ kind: 'scan', label: 'B', path: '/b', json: {} });
    expect(await q.flush()).toEqual({ sent: 2, failed: 0, left: 0 });
    expect(sent).toEqual(['/a', '/b']);
    expect(await q.list()).toEqual([]);
  });

  it('stops at the first network failure and keeps everything', async () => {
    const request = vi.fn(async () => { throw new NetworkError(); });
    const q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    await q.add({ kind: 'scan', label: 'B', path: '/b', json: {} });
    expect(await q.flush()).toEqual({ sent: 0, failed: 0, left: 2 });
    expect(request).toHaveBeenCalledTimes(1);
    expect((await q.list()).map((i) => i.label)).toEqual(['A', 'B']);
  });

  it('sets aside what the server refuses, with its reason, and goes on', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/bad') throw new ApiError('PATROL_ROUND_CLOSED', 'Đã quá giờ của vòng tuần này', 409);
      return {};
    });
    const q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'Bad', path: '/bad', json: {} });
    await q.add({ kind: 'scan', label: 'Good', path: '/good', json: {} });
    expect(await q.flush()).toEqual({ sent: 1, failed: 1, left: 0 });
    const [f] = await q.failed();
    expect(f).toMatchObject({ label: 'Bad', error: 'Đã quá giờ của vòng tuần này' });
    await q.discard(f.id);
    expect(await q.failed()).toEqual([]);
  });

  it('waits on server errors (5xx) like on a dead network', async () => {
    const q = fresh({ request: vi.fn(async () => { throw new ApiError('INTERNAL_ERROR', 'x', 500); }), upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    expect(await q.flush()).toEqual({ sent: 0, failed: 0, left: 1 });
  });

  it('uploads photos first, once, and puts their ids where they belong', async () => {
    let fail = true;
    const bodies: Record<string, unknown>[] = [];
    const upload = vi.fn(async () => ({ id: `f${upload.mock.calls.length}` }));
    const request = vi.fn(async (_path: string, init: { json: Record<string, unknown> }) => {
      if (fail) throw new NetworkError();
      bodies.push(init.json);
      return {};
    });
    const q = fresh({ request, upload });
    await q.add({ kind: 'incident', label: 'Sự cố', path: '/incidents', json: { description: 'x' }, photos: [{ field: 'file_ids', many: true, files: [photo(), photo()] }] });
    await q.add({ kind: 'scan', label: 'Điểm', path: '/scan', json: {}, photos: [{ field: 'photo_file_id', many: false, files: [photo()] }] });
    await q.flush();
    expect(upload).toHaveBeenCalledTimes(2);
    fail = false;
    await q.flush();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(bodies).toEqual([{ description: 'x', file_ids: ['f1', 'f2'] }, { photo_file_id: 'f3' }]);
  });

  it('runs one flush at a time', async () => {
    const request = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return {}; });
    const q = fresh({ request, upload: vi.fn() });
    await q.add({ kind: 'scan', label: 'A', path: '/a', json: {} });
    await Promise.all([q.flush(), q.flush()]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
