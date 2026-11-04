import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { SettingsPatchDto } from './dto';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Every user of the company may read the defaults the app applies to them. */
  @Get('settings')
  company(@CurrentUser() user: AuthUser) {
    return this.settings.company(user);
  }

  @RequirePermission('tenant.settings.manage')
  @Patch('settings')
  updateCompany(@CurrentUser() user: AuthUser, @Body() dto: SettingsPatchDto) {
    return this.settings.updateCompany(user, dto);
  }

  @RequirePermission('site.view')
  @Get('sites/:id/settings')
  site(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.site(user, id);
  }

  @RequirePermission('site.manage')
  @Patch('sites/:id/settings')
  updateSite(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettingsPatchDto) {
    return this.settings.updateSite(user, id, dto);
  }
}
