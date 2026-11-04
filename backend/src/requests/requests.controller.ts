import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CorrectionsService } from './corrections.service';
import { CorrectionDecisionDto, CorrectionDto, CorrectionFilter, LeaveDto, LeaveFilter, NoteDto, PayDto, YearQuery } from './dto';
import { LeaveService } from './leave.service';
import { PayService } from './pay.service';

const yearOf = (q: YearQuery) => (q.year ? Number(q.year) : undefined);

@Controller()
export class RequestsController {
  constructor(
    private readonly pay: PayService,
    private readonly leave: LeaveService,
    private readonly corrections: CorrectionsService,
  ) {}

  @RequirePermission('employee.pay.view')
  @Get('employees/:id/pay')
  getPay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: YearQuery) {
    return this.pay.get(user, id, yearOf(q));
  }

  @RequirePermission('employee.pay.manage')
  @Put('employees/:id/pay')
  setPay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto, @Query() q: YearQuery) {
    return this.pay.set(user, id, dto, yearOf(q));
  }

  /** Any user with a staff file: their own annual leave. */
  @Get('me/leave-balance')
  myBalance(@CurrentUser() user: AuthUser, @Query() q: YearQuery) {
    return this.pay.mine(user, yearOf(q));
  }

  /** Anyone with a staff file asks for themself; a leader or manager may write one for a person they look after. */
  @Post('leave-requests')
  askLeave(@CurrentUser() user: AuthUser, @Body() dto: LeaveDto) {
    return this.leave.create(user, dto);
  }

  @RequirePermission('leave.review')
  @Get('leave-requests')
  leaveList(@CurrentUser() user: AuthUser, @Query() filter: LeaveFilter) {
    return this.leave.list(user, filter);
  }

  @Get('me/leave-requests')
  myLeave(@CurrentUser() user: AuthUser) {
    return this.leave.mine(user);
  }

  @RequirePermission('leave.review')
  @Post('leave-requests/:id/approve')
  approveLeave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.leave.approve(user, id, dto.note);
  }

  @RequirePermission('leave.review')
  @Post('leave-requests/:id/reject')
  rejectLeave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.leave.reject(user, id, dto.note);
  }

  @Post('leave-requests/:id/cancel')
  cancelLeave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leave.cancel(user, id);
  }

  /** A guard for their own shift; a manager (attendance.correct.review) directly for someone else's. */
  @Post('attendance-corrections')
  askCorrection(@CurrentUser() user: AuthUser, @Body() dto: CorrectionDto) {
    return this.corrections.create(user, dto);
  }

  @RequirePermission('attendance.correct.propose')
  @Get('attendance-corrections')
  listCorrections(@CurrentUser() user: AuthUser, @Query() filter: CorrectionFilter) {
    return this.corrections.list(user, filter);
  }

  @Get('me/attendance-corrections')
  myCorrections(@CurrentUser() user: AuthUser) {
    return this.corrections.mine(user);
  }

  @Get('attendance-corrections/:id')
  correction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.corrections.get(user, id);
  }

  @RequirePermission('attendance.correct.propose')
  @Post('attendance-corrections/:id/propose')
  proposeCorrection(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectionDecisionDto) {
    return this.corrections.propose(user, id, dto);
  }

  @RequirePermission('attendance.correct.review')
  @Post('attendance-corrections/:id/review')
  reviewCorrection(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectionDecisionDto) {
    return this.corrections.review(user, id, dto);
  }

  @Post('attendance-corrections/:id/cancel')
  cancelCorrection(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.corrections.cancel(user, id);
  }
}
