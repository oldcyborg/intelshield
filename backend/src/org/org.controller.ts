import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AddMemberDto, CreateGroupDto, CreateTeamDto, LeaveTeamDto, SetLeaderDto, UpdateGroupDto, UpdateTeamDto } from './dto';
import { OrgService } from './org.service';

@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @RequirePermission('org.view')
  @Get('chart')
  chart(@CurrentUser() user: AuthUser) {
    return this.org.chart(user);
  }

  @RequirePermission('org.view')
  @Get('teams')
  teams(@CurrentUser() user: AuthUser) {
    return this.org.teams(user);
  }

  @RequirePermission('org.view')
  @Get('teams/:id/members')
  members(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.members(user, id);
  }

  @RequirePermission('org.manage')
  @Post('groups')
  createGroup(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.org.createGroup(user, dto);
  }

  @RequirePermission('org.manage')
  @Patch('groups/:id')
  updateGroup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto) {
    return this.org.updateGroup(user, id, dto);
  }

  @RequirePermission('org.manage')
  @Delete('groups/:id')
  deleteGroup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.deleteGroup(user, id);
  }

  @RequirePermission('org.manage')
  @Post('teams')
  createTeam(@CurrentUser() user: AuthUser, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(user, dto);
  }

  @RequirePermission('org.manage')
  @Patch('teams/:id')
  updateTeam(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    return this.org.updateTeam(user, id, dto);
  }

  @RequirePermission('org.manage')
  @Delete('teams/:id')
  deleteTeam(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.org.deleteTeam(user, id);
  }

  @RequirePermission('org.member.manage')
  @Put('teams/:id/leader')
  setLeader(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLeaderDto) {
    return this.org.setLeader(user, id, dto.employee_id ?? null);
  }

  @RequirePermission('org.member.manage')
  @Post('teams/:id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.org.addMember(user, id, dto);
  }

  @RequirePermission('org.member.manage')
  @Post('teams/:id/members/:employeeId/leave')
  @HttpCode(200)
  leave(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: LeaveTeamDto,
  ) {
    return this.org.leave(user, id, employeeId, dto);
  }
}
