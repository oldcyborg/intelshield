import { Injectable, Logger } from '@nestjs/common';
import {
  DataSource, EntityManager, EntitySubscriberInterface, IsNull, QueryRunner, TransactionCommitEvent, TransactionRollbackEvent,
} from 'typeorm';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { EventsService } from './events.service';
import { Notification } from './notification.entity';
import { PushService } from './push';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  priority: 'normal' | 'high' | 'critical';
  /** Also send to phones. Low-severity matters stay in the app (spec §6.2). */
  push: boolean;
}

const TITLE_MAX = 200;

type Delivery = () => Promise<void>;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  /** Deliveries waiting for their transaction to commit; dropped if it rolls back. */
  private readonly pending = new WeakMap<QueryRunner, Delivery[]>();

  constructor(
    private readonly ds: DataSource,
    private readonly events: EventsService,
    private readonly push: PushService,
  ) {
    const take = (runner: QueryRunner) => {
      const list = this.pending.get(runner) ?? [];
      this.pending.delete(runner);
      return list;
    };
    const subscriber: EntitySubscriberInterface = {
      afterTransactionCommit: async (event: TransactionCommitEvent) => {
        for (const deliver of take(event.queryRunner)) await deliver();
      },
      afterTransactionRollback: (event: TransactionRollbackEvent) => {
        take(event.queryRunner);
      },
    };
    ds.subscribers.push(subscriber);
  }

  /**
   * Store, stream, push. Storing happens in `m` when given, so it rolls back with the change that caused it;
   * streaming and pushing wait for the commit, so nobody is alerted about something that never happened,
   * and no phone call to Firebase runs while rows are locked.
   */
  async notify(tenantId: string, userIds: string[], input: NotifyInput, m: EntityManager = this.ds.manager): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const title = input.title.length > TITLE_MAX ? `${input.title.slice(0, TITLE_MAX - 1)}…` : input.title;
    const rows = ids.map((user_id) =>
      m.create(Notification, { tenant_id: tenantId, user_id, type: input.type, title, body: input.body, data: input.data, priority: input.priority }),
    );
    await m.save(rows);
    const deliver: Delivery = async () => {
      for (const row of rows) {
        this.events.emit([row.user_id], { type: 'notification', id: row.id, kind: input.type, title, body: input.body, data: input.data, priority: input.priority });
      }
      if (!input.push) return;
      try {
        await this.push.send(ids, { title, body: input.body, priority: input.priority, data: { type: input.type, ...input.data } });
      } catch (error) {
        // The notification is stored and on the web; a failed push must never undo what caused it.
        this.logger.error(`Đẩy thông báo lỗi: ${(error as Error).message}`);
      }
    };
    const runner = m.queryRunner;
    if (runner?.isTransactionActive) this.pending.set(runner, [...(this.pending.get(runner) ?? []), deliver]);
    else await deliver();
  }

  async mine(actor: AuthUser, unreadOnly: boolean) {
    const where = { user_id: actor.id, tenant_id: tenantOf(actor), ...(unreadOnly ? { read_at: IsNull() } : {}) };
    const [items, unread] = await Promise.all([
      this.ds.getRepository(Notification).find({ where, order: { created_at: 'DESC' }, take: 50 }),
      this.ds.getRepository(Notification).count({ where: { user_id: actor.id, read_at: IsNull() } }),
    ]);
    return { items, unread };
  }

  async read(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const result = await this.ds.getRepository(Notification).update({ id, user_id: actor.id, read_at: IsNull() }, { read_at: new Date() });
    if (!result.affected) {
      const exists = await this.ds.getRepository(Notification).exists({ where: { id, user_id: actor.id } });
      if (!exists) throw new BusinessException('NOT_FOUND');
    }
    return { ok: true };
  }

  async readAll(actor: AuthUser): Promise<{ ok: true }> {
    await this.ds.getRepository(Notification).update({ user_id: actor.id, read_at: IsNull() }, { read_at: new Date() });
    return { ok: true };
  }

  /** The phone the caller signed in from receives pushes from now on. */
  async registerPushToken(actor: AuthUser, token: string): Promise<{ ok: true }> {
    if (!actor.device_id) throw new BusinessException('PUSH_DEVICE_REQUIRED');
    // A token belongs to one installation: take it away from any other device row that still holds it.
    await this.ds.query(`UPDATE devices SET push_token = NULL WHERE push_token = $1 AND id <> $2`, [token, actor.device_id]);
    await this.ds.query(`UPDATE devices SET push_token = $2, push_token_updated_at = now() WHERE id = $1`, [actor.device_id, token]);
    return { ok: true };
  }
}
