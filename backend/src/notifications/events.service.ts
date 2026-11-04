import { Injectable } from '@nestjs/common';
import { filter, map, merge, Observable, Subject, interval } from 'rxjs';

/**
 * In-process fan-out for Server-Sent Events. One backend process on one VPS (spec §2),
 * so a Subject is enough; several processes would need Redis pub/sub instead.
 */
@Injectable()
export class EventsService {
  private readonly bus = new Subject<{ userIds: string[]; event: Record<string, unknown> }>();

  emit(userIds: string[], event: Record<string, unknown>): void {
    if (userIds.length) this.bus.next({ userIds, event });
  }

  /** Events for one user, plus a heartbeat every 25 s so proxies keep the connection open. */
  stream(userId: string): Observable<Record<string, unknown>> {
    return merge(
      this.bus.pipe(filter((m) => m.userIds.includes(userId)), map((m) => m.event)),
      interval(25_000).pipe(map(() => ({ type: 'ping' }))),
    );
  }
}
