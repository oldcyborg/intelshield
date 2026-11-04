import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AttendanceService } from './attendance.service';
import { BoardFilter, CheckDto, MyShiftsFilter } from './dto';

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** Any user of the company: their own shifts only. */
  @Get('me/shifts')
  myShifts(@CurrentUser() user: AuthUser, @Query() filter: MyShiftsFilter) {
    return this.attendance.myShifts(user, filter);
  }

  @Post('attendance/check-in')
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckDto) {
    return this.attendance.checkIn(user, dto);
  }

  @Post('attendance/check-out')
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: CheckDto) {
    return this.attendance.checkOut(user, dto);
  }

  @RequirePermission('attendance.view')
  @Get('attendance/board')
  board(@CurrentUser() user: AuthUser, @Query() filter: BoardFilter) {
    return this.attendance.board(user, filter);
  }
}
