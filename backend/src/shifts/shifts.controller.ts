import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CopyWeekDto, CreateAssignmentDto, RosterFilter, SubstituteDto, TemplateDto, UpdateTemplateDto } from './dto';
import { RosterService } from './roster.service';
import { TemplatesService } from './templates.service';

@Controller()
export class ShiftsController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly roster: RosterService,
  ) {}

  @RequirePermission('site.view')
  @Get('sites/:id/shift-templates')
  listTemplates(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.list(user, id);
  }

  @RequirePermission('site.manage')
  @Post('sites/:id/shift-templates')
  createTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TemplateDto) {
    return this.templates.create(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Patch('shift-templates/:id')
  updateTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(user, id, dto);
  }

  @RequirePermission('site.manage')
  @Delete('shift-templates/:id')
  removeTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(user, id);
  }

  @RequirePermission('roster.view')
  @Get('roster')
  list(@CurrentUser() user: AuthUser, @Query() filter: RosterFilter) {
    return this.roster.list(user, filter);
  }

  @RequirePermission('roster.manage')
  @Post('roster')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAssignmentDto) {
    return this.roster.create(user, dto);
  }

  @RequirePermission('roster.manage')
  @Post('roster/copy-week')
  copyWeek(@CurrentUser() user: AuthUser, @Body() dto: CopyWeekDto) {
    return this.roster.copyWeek(user, dto);
  }

  @RequirePermission('roster.manage')
  @Post('roster/:id/substitute')
  substitute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubstituteDto) {
    return this.roster.substitute(user, id, dto);
  }

  @RequirePermission('roster.manage')
  @Post('roster/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roster.cancel(user, id);
  }
}
