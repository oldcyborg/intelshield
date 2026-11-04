import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingService } from './billing.service';
import { FinanceController } from './finance.controller';
import { FinanceSettingsService } from './finance-settings.service';
import { PayrollService } from './payroll.service';

/** Money: payroll from attendance, and (next) billing clients by contract. */
@Module({
  imports: [AccessModule, AuditModule, NotificationsModule],
  providers: [FinanceSettingsService, PayrollService, BillingService],
  controllers: [FinanceController],
  exports: [FinanceSettingsService],
})
export class FinanceModule {}
