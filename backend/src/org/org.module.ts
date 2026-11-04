import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';

@Module({
  imports: [AccessModule, AuditModule],
  providers: [OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
