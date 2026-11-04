import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from './access/access.module';
import { PermissionGuard } from './access/permission.guard';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { EmployeesModule } from './employees/employees.module';
import { FinanceModule } from './finance/finance.module';
import { RequestsModule } from './requests/requests.module';
import { DemoModule } from './demo/demo.module';
import { OrgModule } from './org/org.module';
import { FilesModule } from './files/files.module';
import { ClientsModule } from './clients/clients.module';
import { ContractsModule } from './contracts/contracts.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SitesModule } from './sites/sites.module';
import { SettingsModule } from './settings/settings.module';
import { DevicesModule } from './devices/devices.module';
import { ShiftsModule } from './shifts/shifts.module';
import { LogbookModule } from './logbook/logbook.module';
import { ViolationsModule } from './violations/violations.module';
import { PatrolModule } from './patrol/patrol.module';
import { NotificationsModule } from './notifications/notifications.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AttendanceModule } from './attendance/attendance.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { getEnv } from './config/env';
import { buildDataSourceOptions } from './database/data-source';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: buildDataSourceOptions }),
    // Applied only where @UseGuards(ThrottlerGuard) says so — today, the login route.
    ThrottlerModule.forRootAsync({
      useFactory: () => [{ ttl: 60_000, limit: parseInt(getEnv('LOGIN_RATE_LIMIT', '10'), 10) }],
    }),
    AuditModule,
    AccessModule,
    UsersModule,
    TenantsModule,
    AuthModule,
    EmployeesModule,
    FinanceModule,
    RequestsModule,
    DemoModule,
    OrgModule,
    FilesModule,
    ClientsModule,
    ContractsModule,
    DeploymentsModule,
    DashboardModule,
    SitesModule,
    SettingsModule,
    DevicesModule,
    ShiftsModule,
    AttendanceModule,
    IncidentsModule,
    NotificationsModule,
    PatrolModule,
    ViolationsModule,
    LogbookModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
