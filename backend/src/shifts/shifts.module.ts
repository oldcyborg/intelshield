import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { SitesModule } from '../sites/sites.module';
import { ViolationsModule } from '../violations/violations.module';
import { RosterService } from './roster.service';
import { ShiftsController } from './shifts.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [AccessModule, AuditModule, SitesModule, ViolationsModule],
  providers: [TemplatesService, RosterService],
  controllers: [ShiftsController],
  exports: [TemplatesService, RosterService],
})
export class ShiftsModule {}
