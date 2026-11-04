import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { SitesModule } from '../sites/sites.module';
import { PatrolController } from './patrol.controller';
import { PatrolReadService } from './patrol-read.service';
import { PatrolRunService } from './patrol-run.service';
import { RoundProgress } from './round-progress';
import { RoundsScheduler } from './rounds.scheduler';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [AccessModule, AuditModule, SitesModule, NotificationsModule, SettingsModule, FilesModule],
  providers: [SchedulesService, RoundProgress, RoundsScheduler, PatrolRunService, PatrolReadService],
  controllers: [PatrolController],
  exports: [RoundsScheduler],
})
export class PatrolModule {}
