import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DataSource } from 'typeorm';
import { jwtSecret } from '../config/env';
import { AuthUser } from './auth-user';

export interface JwtPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly ds: DataSource) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies as Record<string, string> | undefined)?.access_token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  /**
   * One query per request decides whether the token still means anything: the
   * session is open, the user active, the company not suspended. Logout, locking
   * and suspension therefore take effect on the next request, not at token expiry.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const rows: Omit<AuthUser, 'session_id'>[] = await this.ds.query(
      `SELECT u.id, u.tenant_id, u.user_type, u.employee_id, d.id AS device_id
         FROM users u
         JOIN sessions s ON s.id = $2 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
         LEFT JOIN devices d ON d.id = s.device_id AND d.status = 'active'
         LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
          AND (u.tenant_id IS NULL OR t.status = 'active')`,
      [payload.sub, payload.sid],
    );
    if (!rows.length) throw new UnauthorizedException();
    return { ...rows[0], session_id: payload.sid };
  }
}
