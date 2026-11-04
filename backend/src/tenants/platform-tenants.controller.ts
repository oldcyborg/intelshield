import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, PlatformOnly } from '../auth/decorators';
import { CreateTenantDto, UpdateTenantDto } from './dto';
import { TenantsService } from './tenants.service';

@PlatformOnly()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(dto, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto, user);
  }
}
