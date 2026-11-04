import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CreateDocumentDto, CreateEmployeeDto, UpdateDocumentDto, UpdateEmployeeDto } from './dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermission('employee.view')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.employees.list(user);
  }

  @RequirePermission('employee.view')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(user, id);
  }

  @RequirePermission('employee.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(user, dto);
  }

  @RequirePermission('employee.manage')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(user, id, dto);
  }

  @RequirePermission('employee.view')
  @Get(':id/profile')
  profile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.profile(user, id);
  }

  @RequirePermission('employee.manage')
  @Post(':id/documents')
  addDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDocumentDto) {
    return this.employees.addDocument(user, id, dto);
  }

  @RequirePermission('employee.manage')
  @Patch(':id/documents/:docId')
  updateDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.employees.updateDocument(user, id, docId, dto);
  }

  @RequirePermission('employee.manage')
  @Delete(':id/documents/:docId')
  removeDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.employees.removeDocument(user, id, docId);
  }
}

/** Any signed-in person of the company: their own papers. */
@Controller()
export class MyDocumentsController {
  constructor(private readonly employees: EmployeesService) {}

  @Get('me/documents')
  mine(@CurrentUser() user: AuthUser) {
    return this.employees.myDocuments(user);
  }
}
