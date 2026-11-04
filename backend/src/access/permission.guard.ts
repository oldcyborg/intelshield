import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser } from '../auth/auth-user';
import { ANY_PERMISSION_KEY, ANY_USER_KEY, IS_PUBLIC_KEY, PLATFORM_ONLY_KEY, REQUIRED_PERMISSION_KEY } from '../auth/decorators';
import { BusinessException } from '../common/errors/business.exception';
import { PermissionService } from './permission.service';

/**
 * Runs after JwtAuthGuard. Platform admins and tenant users live on separate
 * routes; a tenant route without @RequirePermission is open to any user of
 * that tenant, never to a platform admin.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) throw new BusinessException('AUTH_UNAUTHENTICATED');
    if (this.reflector.getAllAndOverride<boolean>(ANY_USER_KEY, targets)) return true;

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, targets)) {
      if (user.user_type !== 'platform_admin') throw new BusinessException('AUTH_FORBIDDEN');
      return true;
    }

    if (!user.tenant_id) throw new BusinessException('AUTH_FORBIDDEN');
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSION_KEY, targets) ?? [];
    if (required.length && !(await this.permissions.has(user.id, required))) {
      throw new BusinessException('AUTH_FORBIDDEN');
    }
    const any = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSION_KEY, targets) ?? [];
    if (any.length) {
      const held = await this.permissions.permissionsOf(user.id);
      if (!any.some((p) => held.has(p))) throw new BusinessException('AUTH_FORBIDDEN');
    }
    return true;
  }
}
