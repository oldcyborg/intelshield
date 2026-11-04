import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AnswerDto, HandoverDto, HandoverFilter, HandoverItemsDto, ReceiverDto } from './dto';
import { HandoversService } from './handovers.service';

@Controller()
export class HandoversController {
  constructor(private readonly handovers: HandoversService) {}

  @Get('sites/:siteId/handover-items')
  items(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.handovers.items(user, siteId);
  }

  @RequirePermission('site.manage')
  @Put('sites/:siteId/handover-items')
  setItems(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: HandoverItemsDto) {
    return this.handovers.setItems(user, siteId, dto);
  }

  @RequirePermission('logbook.write')
  @Post('handovers')
  submit(@CurrentUser() user: AuthUser, @Body() dto: HandoverDto) {
    return this.handovers.submit(user, dto);
  }

  /** The giver or a reviewer; the service decides. */
  @Post('handovers/:id/receiver')
  setReceiver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiverDto) {
    return this.handovers.setReceiver(user, id, dto);
  }

  @Post('handovers/:id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    return this.handovers.answer(user, id, true, dto.note);
  }

  @Post('handovers/:id/dispute')
  dispute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    return this.handovers.answer(user, id, false, dto.note);
  }

  @RequirePermission('handover.review')
  @Post('handovers/:id/review')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    return this.handovers.review(user, id, dto.note);
  }

  @Get('sites/:siteId/handovers')
  list(@CurrentUser() user: AuthUser, @Param('siteId', ParseUUIDPipe) siteId: string, @Query() filter: HandoverFilter) {
    return this.handovers.list(user, siteId, filter.date);
  }

  @Get('me/handovers')
  mine(@CurrentUser() user: AuthUser) {
    return this.handovers.mine(user);
  }
}
