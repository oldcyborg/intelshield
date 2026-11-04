import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Permission } from '../access/permissions';
import { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const ANY_USER_KEY = 'anyUser';
export const PLATFORM_ONLY_KEY = 'platformOnly';
export const REQUIRED_PERMISSION_KEY = 'requiredPermission';
export const ANY_PERMISSION_KEY = 'anyPermission';

/** No token at all. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
/** Any signed-in account, platform admins included (own profile, logout, password). */
export const AnyUser = () => SetMetadata(ANY_USER_KEY, true);
/** Platform admins only. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY_KEY, true);
/**
 * Every listed permission is required. Always a permission, never a role:
 * a company that wants accountants to see teams grants `org.view`, it does not wait for a release.
 */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSION_KEY, permissions);
/** At least one of the listed permissions (the service decides what each one allows). */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSION_KEY, permissions);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user;
});
