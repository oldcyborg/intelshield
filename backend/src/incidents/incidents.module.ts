import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { SitesModule } from '../sites/sites.module';
import { CategoriesService } from './categories.service';
import { IncidentsController } from './incidents.controller';
import { EscalationService } from './escalation.service';
import { IncidentsService } from './incidents.service';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [AccessModule, AuditModule, FilesModule, NotificationsModule, SettingsModule, SitesModule],
  providers: [CategoriesService, IncidentsService, WorkflowService, EscalationService],
  controllers: [IncidentsController],
  exports: [CategoriesService, IncidentsService, EscalationService],
})
export class IncidentsModule {}
