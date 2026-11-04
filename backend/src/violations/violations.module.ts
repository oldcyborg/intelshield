import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ViolationsEngine } from './engine.service';
import { ViolationsController } from './violations.controller';
import { ViolationsService } from './violations.service';

@Module({
  imports: [AccessModule, AuditModule, NotificationsModule, SettingsModule],
  providers: [ViolationsEngine, ViolationsService],
  controllers: [ViolationsController],
  exports: [ViolationsEngine],
})
export class ViolationsModule {}
