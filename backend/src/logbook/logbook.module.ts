import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SitesModule } from '../sites/sites.module';
import { HandoverWatcher } from './handover.watcher';
import { HandoversController } from './handovers.controller';
import { HandoversService } from './handovers.service';
import { LogbookController } from './logbook.controller';
import { LogbookService } from './logbook.service';
import { Presence } from './presence';

@Module({
  imports: [AccessModule, AuditModule, FilesModule, NotificationsModule, SitesModule],
  providers: [Presence, LogbookService, HandoversService, HandoverWatcher],
  controllers: [LogbookController, HandoversController],
  exports: [Presence, HandoverWatcher],
})
export class LogbookModule {}
