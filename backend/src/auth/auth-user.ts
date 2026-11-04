import { BusinessException } from '../common/errors/business.exception';
import { UserType } from '../users/user.entity';

/** What a request knows about its caller. Re-read from the database on every request. */
export interface AuthUser {
  id: string;
  tenant_id: string | null;
  user_type: UserType;
  employee_id: string | null;
  session_id: string;
  /** Active device bound to this session, if any. Web sessions and unapproved phones have none. */
  device_id?: string | null;
}

/** The caller's company. Guards already refuse tenant routes to platform admins; this is the belt. */
export function tenantOf(user: AuthUser): string {
  if (!user.tenant_id) throw new BusinessException('AUTH_FORBIDDEN');
  return user.tenant_id;
}
