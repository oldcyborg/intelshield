import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { EmployeesModule } from '../employees/employees.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ViolationsModule } from '../violations/violations.module';
import { CorrectionsService } from './corrections.service';
import { LeaveService } from './leave.service';
import { PayService } from './pay.service';
import { RequestsController } from './requests.controller';

@Module({
  imports: [AccessModule, AuditModule, EmployeesModule, FilesModule, NotificationsModule, ViolationsModule],
  providers: [PayService, LeaveService, CorrectionsService],
  controllers: [RequestsController],
})
export class RequestsModule {}
