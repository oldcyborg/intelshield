import { Controller, Get } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermission('client.view')
  @Get('company')
  company(@CurrentUser() user: AuthUser) {
    return this.dashboard.company(user);
  }
}
