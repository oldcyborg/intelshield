import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push';

@Module({
  providers: [PushService, EventsService, NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService, EventsService, PushService],
})
export class NotificationsModule {}
