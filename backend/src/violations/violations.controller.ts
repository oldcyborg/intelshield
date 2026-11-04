import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { DecisionDto, ViolationFilter } from './dto';
import { ViolationsService } from './violations.service';

@Controller()
export class ViolationsController {
  constructor(private readonly violations: ViolationsService) {}

  @RequirePermission('violation.view')
  @Get('violations')
  list(@CurrentUser() user: AuthUser, @Query() filter: ViolationFilter) {
    return this.violations.list(user, filter);
  }

  @RequirePermission('violation.view')
  @Get('violations/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.violations.summary(user);
  }

  @RequirePermission('violation.propose')
  @Post('violations/:id/propose')
  propose(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.violations.propose(user, id, dto);
  }

  @RequirePermission('violation.review')
  @Post('violations/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.violations.review(user, id, dto);
  }

  /** Any signed-in person of the company: their own record. */
  @Get('me/violations')
  mine(@CurrentUser() user: AuthUser) {
    return this.violations.mine(user);
  }
}
