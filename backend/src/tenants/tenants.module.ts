import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [UsersModule, AuditModule],
  providers: [TenantsService],
  controllers: [PlatformTenantsController],
  exports: [TenantsService],
})
export class TenantsModule {}
