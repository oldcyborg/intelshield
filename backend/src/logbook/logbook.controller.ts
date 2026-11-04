import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { ExitDto, LogbookDto, LogbookFilter } from './dto';
import { LogbookService } from './logbook.service';

/** Who may write or read depends on shifts at the site as much as on permissions; the services decide. */
@Controller()
export class LogbookController {
  constructor(private readonly logbook: LogbookService) {}

  @Post('sites/:siteId/logbook')
  write(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: LogbookDto) {
    return this.logbook.write(user, siteId, dto);
  }

  @Post('logbook/:id/exit')
  exit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExitDto) {
    return this.logbook.exit(user, id, dto);
  }

  @Get('sites/:siteId/logbook/inside')
  inside(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.logbook.inside(user, siteId);
  }

  @Get('sites/:siteId/logbook')
  list(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Query() filter: LogbookFilter) {
    return this.logbook.list(user, siteId, filter);
  }
}
