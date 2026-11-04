import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DevicesService } from './devices.service';

class DeviceFilter {
  @IsOptional() @IsIn(['pending', 'active', 'revoked'])
  status?: string;
}

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @RequirePermission('device.manage')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() filter: DeviceFilter) {
    return this.devices.list(user, filter.status);
  }

  @RequirePermission('device.manage')
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.approve(user, id);
  }

  @RequirePermission('device.manage')
  @Post(':id/revoke')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.revoke(user, id);
  }
}
