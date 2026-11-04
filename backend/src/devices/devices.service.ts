import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccessService } from '../access/access.service';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { BusinessException } from '../common/errors/business.exception';
import { Device } from './device.entity';

export interface DeviceInput {
  device_id: string;
  platform?: string | null;
  label?: string | null;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records the phone a user signs in from and decides whether it may be used.
   * A guard's first phone becomes theirs; any other phone waits for HR, so a
   * colleague's phone cannot be used to clock in for them.
   */
  async bind(user: { id: string; tenant_id: string | null; user_type: string }, input: DeviceInput): Promise<string> {
    const tenantId = user.tenant_id;
    if (!tenantId) throw new BusinessException('AUTH_FORBIDDEN');
    const restricted = user.user_type === 'guard';
    // Decide inside the transaction, refuse after it commits: a phone waiting for approval
    // must stay recorded so HR can see and approve it.
    const device = await this.ds.transaction(async (m) => {
      await m.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
      let device = await m.findOneBy(Device, { user_id: user.id, device_id: input.device_id });
      if (!device) {
        // Only the very first phone is trusted on sight. Once a guard has had one — even if HR revoked it —
        // every other phone waits for approval; otherwise a revoke would be undone by sending a new id.
        const hadPhone = restricted && (await m.exists(Device, { where: { user_id: user.id, restricted: true } }));
        device = await m.save(
          m.create(Device, {
            tenant_id: tenantId, user_id: user.id, device_id: input.device_id, platform: input.platform ?? null,
            label: input.label ?? null, restricted, status: restricted && hadPhone ? 'pending' : 'active',
          }),
        );
      }
      await m.update(Device, { id: device.id }, { last_seen_at: new Date(), platform: input.platform ?? device.platform });
      return device;
    });
    if (device.status === 'pending') throw new BusinessException('DEVICE_PENDING');
    if (device.status === 'revoked') throw new BusinessException('DEVICE_REVOKED');
    return device.id;
  }

  async list(actor: AuthUser, status?: string) {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    return this.ds.query(
      `SELECT d.id, d.user_id, u.full_name, u.phone, e.code AS employee_code, d.device_id, d.platform, d.label,
              d.restricted, d.status, d.created_at, d.last_seen_at, d.decided_at
         FROM devices d JOIN users u ON u.id = d.user_id LEFT JOIN employees e ON e.id = u.employee_id
        WHERE d.tenant_id = $1 AND ($2::text IS NULL OR d.status = $2)
        ORDER BY (d.status = 'pending') DESC, d.created_at DESC`,
      [tenantId, status ?? null],
    );
  }

  /** The new phone becomes the only one: the old one is revoked and its sessions end. */
  async approve(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const device = await this.get(tenantId, id);
    await this.access.assertCanManageUser(actor, device.user_id);
    await this.ds.transaction(async (m) => {
      // Two approvals for one guard queue up here instead of colliding on the one-active-phone index.
      await m.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [device.user_id]);
      if (device.restricted) {
        const result = await m.query(
          `UPDATE devices SET status = 'revoked', decided_by = $3, decided_at = now(), updated_at = now()
            WHERE user_id = $1 AND id <> $2 AND status = 'active' AND restricted RETURNING id`,
          [device.user_id, id, actor.id],
        );
        const others: { id: string }[] = Array.isArray(result[0]) ? result[0] : result;
        if (others.length) {
          await m.query(`UPDATE sessions SET revoked_at = now() WHERE device_id = ANY($1::uuid[]) AND revoked_at IS NULL`, [others.map((o) => o.id)]);
        }
      }
      await m.update(Device, { id }, { status: 'active', decided_by: actor.id, decided_at: new Date() });
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'device.approve', entity_type: 'user', entity_id: device.user_id,
        data: { device: device.device_id },
      });
    });
    return { ok: true };
  }

  async revoke(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    const device = await this.get(tenantId, id);
    await this.access.assertCanManageUser(actor, device.user_id);
    await this.ds.transaction(async (m) => {
      await m.update(Device, { id }, { status: 'revoked', decided_by: actor.id, decided_at: new Date() });
      await m.query(`UPDATE sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL`, [id]);
      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'device.revoke', entity_type: 'user', entity_id: device.user_id,
        data: { device: device.device_id },
      });
    });
    return { ok: true };
  }

  private async get(tenantId: string, id: string): Promise<Device> {
    const device = await this.ds.getRepository(Device).findOneBy({ id, tenant_id: tenantId });
    if (!device) throw new BusinessException('NOT_FOUND');
    return device;
  }
}
