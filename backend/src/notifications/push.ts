import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getEnv } from '../config/env';

export interface PushMessage {
  title: string;
  body: string;
  priority: 'normal' | 'high' | 'critical';
  data: Record<string, string>;
}

const DEAD_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
const FCM_APP_NAME = 'patrol-push';

/**
 * Sends to the phones of the given users. Only active devices with a registered
 * token receive. FCM relays to APNs, so one channel covers Android and iOS.
 */
@Injectable()
export class PushService {
  /** Messages the `memory` driver recorded — tests read this. */
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];
  private readonly logger = new Logger('Push');
  private readonly driver: 'fcm' | 'log' | 'memory';
  private fcm: { send: (tokens: string[], message: PushMessage) => Promise<string[]> } | null = null;

  constructor(private readonly ds: DataSource) {
    const configured = getEnv('PUSH_DRIVER', '');
    const account = getEnv('FCM_SERVICE_ACCOUNT', '');
    this.driver = (configured || (account ? 'fcm' : 'log')) as 'fcm' | 'log' | 'memory';
    if (this.driver === 'fcm') this.fcm = this.buildFcm(account);
    if (this.driver === 'log') this.logger.warn('FCM_SERVICE_ACCOUNT chưa cấu hình — thông báo vẫn lưu và hiện trên web, nhưng chưa đẩy tới điện thoại.');
  }

  async send(userIds: string[], message: PushMessage): Promise<void> {
    if (!userIds.length) return;
    const rows: { id: string; push_token: string }[] = await this.ds.query(
      `SELECT id, push_token FROM devices WHERE user_id = ANY($1::uuid[]) AND status = 'active' AND push_token IS NOT NULL`,
      [userIds],
    );
    if (!rows.length) return;
    const tokens = rows.map((r) => r.push_token);
    if (this.driver === 'memory') {
      this.sent.push({ tokens, message });
      return;
    }
    if (this.driver === 'log' || !this.fcm) {
      this.logger.log(`[push:${message.priority}] ${message.title} → ${tokens.length} máy`);
      return;
    }
    const dead = await this.fcm.send(tokens, message);
    if (dead.length) {
      await this.ds.query(`UPDATE devices SET push_token = NULL WHERE push_token = ANY($1::text[])`, [dead]);
    }
  }

  private buildFcm(account: string) {
    try {
      // Loaded only when configured, so tests and unconfigured servers never touch Google.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { cert, getApps, initializeApp } = require('firebase-admin/app');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getMessaging } = require('firebase-admin/messaging');
      const fbApp = getApps().find((a: { name: string }) => a.name === FCM_APP_NAME) ?? initializeApp({ credential: cert(JSON.parse(account)) }, FCM_APP_NAME);
      return {
        send: async (tokens: string[], message: PushMessage): Promise<string[]> => {
          const urgent = message.priority !== 'normal';
          const result = await getMessaging(fbApp).sendEachForMulticast({
            tokens,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: {
              priority: urgent ? 'high' : 'normal',
              notification: { channelId: message.priority === 'critical' ? 'critical' : 'default', sound: 'default' },
            },
            apns: {
              headers: { 'apns-priority': urgent ? '10' : '5' },
              payload: { aps: { sound: 'default', 'interruption-level': message.priority === 'critical' ? 'time-sensitive' : 'active' } },
            },
          });
          return result.responses
            .map((r: { success: boolean; error?: { code: string } }, i: number) => (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code) ? tokens[i] : null))
            .filter((t: string | null): t is string => t !== null);
        },
      };
    } catch (error) {
      this.logger.error(`FCM_SERVICE_ACCOUNT không hợp lệ: ${(error as Error).message}`);
      return null;
    }
  }
}
