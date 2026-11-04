import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { IsNull, Not, Repository } from 'typeorm';
import { PermissionService } from '../access/permission.service';
import { ScopeService } from '../access/scope.service';
import { BusinessException } from '../common/errors/business.exception';
import { parseIdentifier } from '../common/identifiers';
import { refreshTtlDays } from '../config/env';
import { DevicesService } from '../devices/devices.service';
import { Tenant } from '../tenants/tenant.entity';
import { User, UserType } from '../users/user.entity';
import { AuthUser } from './auth-user';
import { TokenPair } from './cookies';
import { ChangePasswordDto, LoginDto } from './dto';
import { JwtPayload } from './jwt.strategy';
import { hashPassword, randomSecret, sha256, verifyPassword } from './password';
import { Session } from './session.entity';

/** Two tabs, or an app resuming with parallel calls, may present one refresh token twice within this window. */
const ROTATION_GRACE_SECONDS = 30;

export interface Profile {
  id: string;
  tenant_id: string | null;
  user_type: UserType;
  full_name: string;
  phone: string | null;
  email: string | null;
  employee_id: string | null;
  must_change_password: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly jwt: JwtService,
    private readonly permissions: PermissionService,
    private readonly scopes: ScopeService,
    private readonly devices: DevicesService,
  ) {}

  async login(dto: LoginDto): Promise<TokenPair & { user: Profile }> {
    const identifier = parseIdentifier(dto.identifier);
    const qb = this.users.createQueryBuilder('u').addSelect('u.password_hash');
    if ('email' in identifier) qb.where('lower(u.email) = :email', { email: identifier.email });
    else qb.where('u.phone = :phone', { phone: identifier.phone });
    const user = await qb.getOne();

    if (!user || user.status !== 'active' || !(await verifyPassword(dto.password, user.password_hash))) {
      throw new BusinessException('AUTH_INVALID_CREDENTIALS');
    }
    await this.assertTenantActive(user.tenant_id);

    const deviceId = dto.device_id
      ? await this.devices.bind(user, { device_id: dto.device_id, platform: dto.platform, label: dto.device_label })
      : null;
    const tokens = await this.openSession(user.id, dto.device_label ?? null, deviceId);
    await this.users.update(user.id, { last_login_at: new Date() });
    return { ...tokens, user: await this.profile(user.id) };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret || !isUUID(sessionId)) throw new BusinessException('AUTH_REFRESH_INVALID');

    const presented = sha256(secret);
    const next = randomSecret();
    // Check and rotate in one statement: of two requests carrying the same token, exactly one wins.
    const result = await this.sessions.manager.query(
      `UPDATE sessions
          SET prev_token_hash = token_hash, token_hash = $3, rotated_at = now(), last_used_at = now(), expires_at = $4
        WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [sessionId, presented, sha256(next), this.refreshExpiry()],
    );
    const rotated: { user_id: string }[] = Array.isArray(result[0]) ? result[0] : result;
    if (rotated.length) {
      await this.assertUserActive(rotated[0].user_id);
      return this.sign(rotated[0].user_id, sessionId, next);
    }

    const session = await this.sessions.findOneBy({ id: sessionId });
    if (!session || session.revoked_at || session.expires_at <= new Date()) {
      throw new BusinessException('AUTH_REFRESH_INVALID');
    }
    const graceStart = Date.now() - ROTATION_GRACE_SECONDS * 1000;
    if (session.prev_token_hash === presented && session.rotated_at && session.rotated_at.getTime() > graceStart) {
      // Lost a race with a parallel refresh of the same token: give this caller its own session.
      await this.assertUserActive(session.user_id);
      return this.openSession(session.user_id, session.device_label, session.device_id);
    }
    // An old token came back after the grace window: two parties hold this session. End it for both.
    await this.sessions.update(session.id, { revoked_at: new Date() });
    throw new BusinessException('AUTH_REFRESH_INVALID');
  }

  private async assertUserActive(userId: string): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user || user.status !== 'active') throw new BusinessException('AUTH_REFRESH_INVALID');
    await this.assertTenantActive(user.tenant_id);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId, revoked_at: IsNull() }, { revoked_at: new Date() });
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const row = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.id = :id', { id: user.id })
      .getOne();
    if (!row || !(await verifyPassword(dto.current_password, row.password_hash))) {
      throw new BusinessException('AUTH_WRONG_PASSWORD');
    }
    await this.users.update(user.id, { password_hash: await hashPassword(dto.new_password), must_change_password: false });
    await this.sessions.update(
      { user_id: user.id, id: Not(user.session_id), revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  async me(user: AuthUser) {
    const profile = await this.profile(user.id);
    if (!user.tenant_id) return { user: profile, permissions: [], team_visibility: { all: false, team_ids: [] }, device: null };
    const [permissions, visibility] = await Promise.all([
      this.permissions.permissionsOf(user.id),
      this.scopes.teamVisibility(user),
    ]);
    const [device] = user.device_id
      ? await this.users.manager.query(`SELECT device_id, platform, status FROM devices WHERE id = $1`, [user.device_id])
      : [null];
    return {
      user: profile,
      device: device ?? null,
      permissions: [...permissions].sort(),
      team_visibility: visibility.all ? { all: true, team_ids: [] } : { all: false, team_ids: visibility.teamIds },
    };
  }

  private async profile(userId: string): Promise<Profile> {
    const u = await this.users.findOneByOrFail({ id: userId });
    return {
      id: u.id,
      tenant_id: u.tenant_id,
      user_type: u.user_type,
      full_name: u.full_name,
      phone: u.phone,
      email: u.email,
      employee_id: u.employee_id,
      must_change_password: u.must_change_password,
    };
  }

  private async assertTenantActive(tenantId: string | null): Promise<void> {
    if (!tenantId) return;
    const tenant = await this.tenants.findOneBy({ id: tenantId });
    if (!tenant || tenant.status !== 'active') throw new BusinessException('AUTH_TENANT_SUSPENDED');
  }

  private async openSession(userId: string, deviceLabel: string | null, deviceId: string | null = null): Promise<TokenPair> {
    const session = await this.sessions.save(
      this.sessions.create({
        user_id: userId,
        device_label: deviceLabel,
        device_id: deviceId,
        token_hash: '',
        last_used_at: new Date(),
        expires_at: this.refreshExpiry(),
      }),
    );
    return this.issue(session, randomSecret());
  }

  /** Refresh token = "<session id>.<secret>"; only the secret's hash is stored. */
  private async issue(session: Session, secret: string): Promise<TokenPair> {
    await this.sessions.update(session.id, {
      token_hash: sha256(secret),
      last_used_at: new Date(),
      expires_at: this.refreshExpiry(),
    });
    return this.sign(session.user_id, session.id, secret);
  }

  private async sign(userId: string, sessionId: string, secret: string): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, sid: sessionId };
    return { access_token: await this.jwt.signAsync(payload), refresh_token: `${sessionId}.${secret}` };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + refreshTtlDays() * 86_400_000);
  }
}
