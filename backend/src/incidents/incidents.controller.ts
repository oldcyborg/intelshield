import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CategoriesService } from './categories.service';
import {
  AssignDto, CategoryDto, CommentDto, ContactCallDto, IncidentFilter, NoteDto, ReasonDto, ReportIncidentDto, SosDto, UpdateCategoryDto,
} from './dto';
import { IncidentsService } from './incidents.service';
import { WorkflowService } from './workflow.service';

@Controller()
export class IncidentsController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly incidents: IncidentsService,
    private readonly workflow: WorkflowService,
  ) {}

  /** Any user of the company: guards need the list to report. */
  @Get('incident-categories')
  listCategories(@CurrentUser() user: AuthUser) {
    return this.categories.list(user);
  }

  @RequirePermission('tenant.settings.manage')
  @Get('incident-categories/all')
  allCategories(@CurrentUser() user: AuthUser) {
    return this.categories.list(user, true);
  }

  @RequirePermission('tenant.settings.manage')
  @Post('incident-categories')
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CategoryDto) {
    return this.categories.create(user, dto);
  }

  @RequirePermission('tenant.settings.manage')
  @Patch('incident-categories/:id')
  updateCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(user, id, dto);
  }

  @RequirePermission('incident.report')
  @Post('incidents')
  report(@CurrentUser() user: AuthUser, @Body() dto: ReportIncidentDto) {
    return this.incidents.report(user, dto);
  }

  @RequirePermission('incident.report')
  @Post('incidents/sos')
  sos(@CurrentUser() user: AuthUser, @Body() dto: SosDto) {
    return this.incidents.sos(user, dto);
  }

  /** Signed-in users of the company; the service narrows the list to what each may see. */
  @Get('incidents')
  list(@CurrentUser() user: AuthUser, @Query() filter: IncidentFilter) {
    return this.incidents.list(user, filter);
  }

  @RequirePermission('incident.manage')
  @Get('incidents/:id/assignees')
  assignees(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.assignees(user, id);
  }

  @Get('incidents/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.get(user, id);
  }

  @Post('incidents/:id/acknowledge')
  acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.acknowledge(user, id);
  }

  @Post('incidents/:id/assign')
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.workflow.assign(user, id, dto.user_id);
  }

  @Post('incidents/:id/start')
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.start(user, id);
  }

  @Post('incidents/:id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.workflow.resolve(user, id, dto);
  }

  @Post('incidents/:id/close')
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.close(user, id);
  }

  @Post('incidents/:id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.workflow.reopen(user, id, dto.reason);
  }

  @Post('incidents/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.workflow.reject(user, id, dto.reason);
  }

  @Post('incidents/:id/comments')
  comment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) {
    return this.workflow.comment(user, id, dto);
  }

  @Post('incidents/:id/contact-calls')
  contactCalled(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactCallDto) {
    return this.workflow.contactCalled(user, id, dto);
  }
}
