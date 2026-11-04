import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccessService } from './access.service';
import { PermissionGuard } from './permission.guard';
import { PermissionService } from './permission.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { ScopeService } from './scope.service';

@Module({
  imports: [AuditModule],
  providers: [PermissionService, ScopeService, AccessService, RolesService, PermissionGuard],
  controllers: [RolesController],
  exports: [PermissionService, ScopeService, AccessService, PermissionGuard],
})
export class AccessModule {}
