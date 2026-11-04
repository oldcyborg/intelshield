import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { RouteDto } from './dto';
import { RoutesService } from './routes.service';

@Controller()
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @RequirePermission('site.view')
  @Get('sites/:id/routes')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.routes.list(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/routes')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RouteDto) {
    return this.routes.create(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Put('routes/:id')
  replace(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RouteDto) {
    return this.routes.replace(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('routes/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.routes.remove(user, id);
  }
}
