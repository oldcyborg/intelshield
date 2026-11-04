import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { EmployeesController, MyDocumentsController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [AccessModule, AuditModule, FilesModule],
  providers: [EmployeesService],
  controllers: [EmployeesController, MyDocumentsController],
  exports: [EmployeesService],
})
export class EmployeesModule {}
