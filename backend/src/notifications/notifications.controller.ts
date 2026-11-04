import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Sse } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Observable } from 'rxjs';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { PushTokenDto } from '../incidents/dto';
import { EventsService } from './events.service';
import { NotificationsService } from './notifications.service';

class NotificationFilter {
  @IsOptional() @IsIn(['true', 'false'])
  unread?: string;
}

/** Every route is the caller's own: no permission beyond belonging to the company. */
@Controller('me')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser, @Query() filter: NotificationFilter) {
    return this.notifications.mine(user, filter.unread === 'true');
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.readAll(user);
  }

  @Post('notifications/:id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.read(user, id);
  }

  @Post('push-token')
  pushToken(@CurrentUser() user: AuthUser, @Body() dto: PushTokenDto) {
    return this.notifications.registerPushToken(user, dto.token);
  }

  /** Live updates for the web. The envelope interceptor turns each event into `{ data: event }`, which is an SSE message. */
  @Sse('events')
  stream(@CurrentUser() user: AuthUser): Observable<Record<string, unknown>> {
    return this.events.stream(user.id);
  }
}
