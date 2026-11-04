import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { CheckpointsController } from './checkpoints.controller';
import { SiteContactsController } from './contacts.controller';
import { SiteContactsService } from './contacts.service';
import { CheckpointsService } from './checkpoints.service';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [SitesService, CheckpointsService, RoutesService, SiteContactsService],
  controllers: [SitesController, CheckpointsController, RoutesController, SiteContactsController],
  exports: [SitesService, CheckpointsService, RoutesService, SiteContactsService],
})
export class SitesModule {}
