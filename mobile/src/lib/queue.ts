import { createStore, get, set, UseStore } from 'idb-keyval';
import { ApiClient, ApiError, NetworkError } from './api';

export interface StoredPhoto {
  type: string;
  data: ArrayBuffer;
}

export interface PhotoSlot {
  /** Field of the request that receives the uploaded ids. */
  field: string;
  /** true: an array of ids (file_ids); false: one id (photo_file_id). */
  many: boolean;
  files: StoredPhoto[];
  /** Ids already uploaded, so a resend never uploads twice. */
  uploaded?: string[];
}

export interface QueueItem {
  id: string;
  kind: string;
  label: string;
  path: string;
  json: Record<string, unknown>;
  photos?: PhotoSlot[];
  /** For screens: which round/checkpoint/line this is about. */
  meta?: Record<string, string>;
  /** Sent with the moment it was done: device_time, and captured_offline when it goes out more than a minute later. */
  timed?: boolean;
  /** Error codes that mean "already done" — the item counts as sent. */
  okCodes?: string[];
  /** Goes before everything already waiting (SOS, incidents). */
  urgent?: boolean;
  created_at: string;
  attempts: number;
  error?: string;
}

type Api = Pick<ApiClient, 'request' | 'upload'>;
type NewItem = Omit<QueueItem, 'id' | 'created_at' | 'attempts' | 'error'>;
const MAX_SERVER_ERRORS = 5;
/** Sent within this long of being done: the server's clock counts, as if online. */
const ONLINE_MS = 60_000;

const uuid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));

/**
 * What was done without signal, kept on the phone and sent in the order it happened.
 * A dead network or a server error stops the run and keeps everything; a refusal (4xx) is set aside with its reason.
 */
export class OfflineQueue {
  private readonly db: UseStore;
  private running: Promise<{ sent: number; failed: number; left: number }> | null = null;
  private listeners = new Set<() => void>();
  /** Every write to the stored lists goes through here, one after another: no read-modify-write races. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: Api,
    dbName = 'intelshield-queue',
  ) {
    this.db = createStore(dbName, 'items');
  }

  async list(): Promise<QueueItem[]> {
    return (await get<QueueItem[]>('pending', this.db)) ?? [];
  }

  async failed(): Promise<QueueItem[]> {
    return (await get<QueueItem[]>('failed', this.db)) ?? [];
  }

  async add(item: NewItem): Promise<QueueItem> {
    const full: QueueItem = { ...item, id: uuid(), created_at: this.stamp(), attempts: 0 };
    await this.mutate(async () => {
      const pending = await this.list();
      if (!full.urgent) return set('pending', [...pending, full], this.db);
      // After the urgent ones already waiting, before everything else.
      const at = pending.findIndex((i) => !i.urgent);
      const next = at === -1 ? [...pending, full] : [...pending.slice(0, at), full, ...pending.slice(at)];
      return set('pending', next, this.db);
    });
    this.emit();
    return full;
  }

  /** Add details to an item still waiting (an SOS position that arrived after the press). False once it has gone. */
  async patch(id: string, extra: Record<string, unknown>): Promise<boolean> {
    let found = false;
    await this.mutate(async () => {
      const pending = await this.list();
      const next = pending.map((i) => {
        if (i.id !== id) return i;
        found = true;
        return { ...i, json: { ...i.json, ...extra } };
      });
      if (found) await set('pending', next, this.db);
    });
    return found;
  }

  /**
   * Try to send now and say what became of this item: sent, still waiting (no signal, server trouble),
   * or refused by the server with its reason — so a screen never says "sent" for something refused.
   */
  async send(id: string): Promise<{ state: 'sent' } | { state: 'waiting' } | { state: 'refused'; reason: string }> {
    await this.flush();
    // A run already going may have started before this item was added: one more pass picks it up.
    if ((await this.list()).some((i) => i.id === id)) await this.flush();
    if ((await this.list()).some((i) => i.id === id)) return { state: 'waiting' };
    const refused = (await this.failed()).find((i) => i.id === id);
    if (refused) return { state: 'refused', reason: refused.error ?? 'Máy chủ không nhận' };
    return { state: 'sent' };
  }

  flush(): Promise<{ sent: number; failed: number; left: number }> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  /** Back to the queue in its place in time, so a retried clock-in still goes before a later clock-out. */
  async retry(id: string): Promise<void> {
    await this.mutate(async () => {
      const failed = await this.failed();
      const item = failed.find((i) => i.id === id);
      if (!item) return;
      await set('failed', failed.filter((i) => i.id !== id), this.db);
      const pending = [...(await this.list()), { ...item, error: undefined, attempts: 0 }];
      pending.sort((x, y) => x.created_at.localeCompare(y.created_at));
      await set('pending', pending, this.db);
    });
    this.emit();
  }

  async discard(id: string): Promise<void> {
    await this.mutate(async () => set('failed', (await this.failed()).filter((i) => i.id !== id), this.db));
    this.emit();
  }

  /** On sign-out: one person's unsent work must never go out under the next person's account. */
  async clear(): Promise<void> {
    await this.mutate(async () => {
      await set('pending', [], this.db);
      await set('failed', [], this.db);
    });
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async run() {
    let sent = 0;
    let failed = 0;
    for (;;) {
      const [item] = await this.list();
      if (!item) break;
      try {
        const json = { ...item.json };
        for (const slot of item.photos ?? []) {
          const ids = slot.uploaded ?? [];
          for (let i = ids.length; i < slot.files.length; i++) {
            const f = slot.files[i];
            const { id } = await this.api.upload(new Blob([f.data], { type: f.type }), `photo-${i + 1}.jpg`);
            ids.push(id);
            slot.uploaded = ids;
            await this.update(item);
          }
          json[slot.field] = slot.many ? ids : ids[0];
        }
        if (item.timed) {
          json.device_time = item.created_at;
          json.captured_offline = Date.now() - Date.parse(item.created_at) > ONLINE_MS;
        }
        await this.api.request(item.path, { json });
        await this.remove(item.id);
        sent += 1;
      } catch (error) {
        if (error instanceof ApiError && item.okCodes?.includes(error.code)) {
          await this.remove(item.id);
          sent += 1;
          this.emit();
          continue;
        }
        if (this.waitable(error)) {
          item.attempts += 1;
          // A server error that keeps coming back for one item must not hold up everything behind it.
          if (error instanceof ApiError && error.status >= 500 && item.attempts >= MAX_SERVER_ERRORS) {
            await this.setAside(item, error.message);
            failed += 1;
            this.emit();
            continue;
          }
          await this.update(item);
          break;
        }
        await this.setAside(item, error instanceof Error ? error.message : 'Lỗi không rõ');
        failed += 1;
      }
      this.emit();
    }
    this.emit();
    return { sent, failed, left: (await this.list()).length };
  }

  /** Worth keeping and trying later: no network, server trouble, or no valid session (sign in again, then it goes). */
  private waitable(error: unknown): boolean {
    if (error instanceof NetworkError) return true;
    if (!(error instanceof ApiError)) return false;
    return error.status >= 500 || error.status === 401 || error.status === 408 || error.status === 429
      || error.code.startsWith('AUTH_') || error.code.startsWith('DEVICE_');
  }

  private update(item: QueueItem) {
    return this.mutate(async () => set('pending', (await this.list()).map((i) => (i.id === item.id ? item : i)), this.db));
  }

  private remove(id: string) {
    return this.mutate(async () => set('pending', (await this.list()).filter((i) => i.id !== id), this.db));
  }

  private setAside(item: QueueItem, reason: string) {
    return this.mutate(async () => {
      await set('pending', (await this.list()).filter((i) => i.id !== item.id), this.db);
      await set('failed', [...(await this.failed()), { ...item, error: reason }], this.db);
    });
  }

  /** Strictly increasing creation times, so two things done in the same millisecond keep their order. */
  private last = 0;
  private stamp(): string {
    this.last = Math.max(Date.now(), this.last + 1);
    return new Date(this.last).toISOString();
  }

  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/** A photo Blob as the queue keeps it (IndexedDB stores ArrayBuffers on every WebView). */
export async function storePhoto(blob: Blob): Promise<StoredPhoto> {
  return { type: blob.type || 'image/jpeg', data: await blob.arrayBuffer() };
}

export { uuid as newClientId };
