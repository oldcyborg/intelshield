import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CreateRoleDto, SetPermissionsDto } from './dto';
import { PERMISSIONS } from './permissions';
import { RolesService } from './roles.service';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('role.view')
  @Get('permissions')
  catalog() {
    return Object.entries(PERMISSIONS).map(([code, label]) => ({ code, label }));
  }

  @RequirePermission('role.view')
  @Get('roles')
  list(@CurrentUser() user: AuthUser) {
    return this.roles.list(tenantOf(user));
  }

  @RequirePermission('role.manage')
  @Post('roles')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user, dto);
  }

  @RequirePermission('role.manage')
  @Put('roles/:id/permissions')
  setPermissions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPermissionsDto) {
    return this.roles.setPermissions(user, id, dto.permissions);
  }
}
