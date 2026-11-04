import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { MyRoundsFilter, RoundsFilter, ScanDto, ScheduleDto, StartRoundDto, UpdateScheduleDto } from './dto';
import { PatrolReadService } from './patrol-read.service';
import { PatrolRunService } from './patrol-run.service';
import { SchedulesService } from './schedules.service';

@Controller()
export class PatrolController {
  constructor(
    private readonly schedules: SchedulesService,
    private readonly run: PatrolRunService,
    private readonly read: PatrolReadService,
  ) {}

  @RequirePermission('site.view')
  @Get('sites/:siteId/patrol-schedules')
  listSchedules(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.schedules.list(user, siteId);
  }

  @RequirePermission('site.manage')
  @Post('sites/:siteId/patrol-schedules')
  createSchedule(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: ScheduleDto) {
    return this.schedules.create(user, siteId, dto);
  }

  @RequirePermission('site.manage')
  @Patch('patrol-schedules/:id')
  updateSchedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleDto) {
    return this.schedules.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('patrol-schedules/:id')
  removeSchedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.remove(user, id);
  }

  @RequirePermission('patrol.perform')
  @Get('me/rounds')
  myRounds(@CurrentUser() user: AuthUser, @Query() filter: MyRoundsFilter) {
    return this.run.myRounds(user, filter);
  }

  @RequirePermission('patrol.perform')
  @Post('patrol/rounds/:id/start')
  startRound(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartRoundDto) {
    return this.run.start(user, id, dto);
  }

  @RequirePermission('patrol.perform')
  @Post('patrol/rounds/:id/scans')
  scan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScanDto) {
    return this.run.scan(user, id, dto);
  }

  @RequirePermission('patrol.perform')
  @Post('patrol/rounds/:id/finish')
  finishRound(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartRoundDto) {
    return this.run.finish(user, id, dto);
  }

  @RequirePermission('patrol.view')
  @Get('patrol/rounds')
  listRounds(@CurrentUser() user: AuthUser, @Query() filter: RoundsFilter) {
    return this.read.list(user, filter);
  }

  @RequirePermission('patrol.view')
  @Get('patrol/today')
  today(@CurrentUser() user: AuthUser) {
    return this.read.today(user);
  }

  /** The guard who walked it, or anyone watching the site — the service decides. */
  @Get('patrol/rounds/:id')
  getRound(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.read.get(user, id);
  }
}
