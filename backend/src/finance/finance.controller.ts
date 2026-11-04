import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermission } from '../auth/decorators';
import { AdjustmentsDto, BillingFilter, ExtraLineDto, FinanceSettingsDto, MonthDto, PaidDto, PaymentDto, ReasonDto, ShortfallDto, StatementPatchDto } from './dto';
import { BillingService } from './billing.service';
import { FinanceSettingsService } from './finance-settings.service';
import { PayrollService } from './payroll.service';

@Controller()
export class FinanceController {
  constructor(
    private readonly settings: FinanceSettingsService,
    private readonly payroll: PayrollService,
    private readonly billing: BillingService,
  ) {}

  @RequireAnyPermission('payroll.view', 'billing.view')
  @Get('finance/settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  /** Pay rules need payroll.manage, billing terms billing.manage — checked field by field. */
  @RequireAnyPermission('payroll.manage', 'billing.manage')
  @Put('finance/settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: FinanceSettingsDto) {
    return this.settings.update(user, dto);
  }

  @RequirePermission('payroll.view')
  @Get('payroll')
  list(@CurrentUser() user: AuthUser) {
    return this.payroll.list(user);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll')
  create(@CurrentUser() user: AuthUser, @Body() dto: MonthDto) {
    return this.payroll.create(user, dto.month);
  }

  @RequirePermission('payroll.view')
  @Get('payroll/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.get(user, id);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/:id/recompute')
  recompute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.recompute(user, id);
  }

  @RequirePermission('payroll.manage')
  @Put('payroll-lines/:id/adjustments')
  adjust(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustmentsDto) {
    return this.payroll.setAdjustments(user, id, dto.items);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/:id/lock')
  lock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.lock(user, id);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/:id/unlock')
  unlock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.payroll.unlock(user, id, dto.reason);
  }

  @RequirePermission('payroll.manage')
  @Post('payroll/:id/paid')
  paid(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaidDto) {
    return this.payroll.paid(user, id, dto.paid_on, dto.note);
  }

  @RequirePermission('billing.view')
  @Get('billing')
  listBilling(@CurrentUser() user: AuthUser, @Query() filter: BillingFilter) {
    return this.billing.list(user, filter);
  }

  @RequirePermission('billing.view')
  @Get('billing/debts')
  debts(@CurrentUser() user: AuthUser) {
    return this.billing.debts(user);
  }

  @RequirePermission('billing.manage')
  @Post('billing')
  generate(@CurrentUser() user: AuthUser, @Body() dto: MonthDto) {
    return this.billing.generate(user, dto.month);
  }

  @RequirePermission('billing.view')
  @Get('billing/:id')
  getStatement(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.get(user, id);
  }

  @RequirePermission('billing.manage')
  @Patch('billing/:id')
  patchStatement(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatementPatchDto) {
    return this.billing.patch(user, id, dto);
  }

  @RequirePermission('billing.manage')
  @Post('billing/:id/recompute')
  recomputeStatement(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.recompute(user, id);
  }

  @RequirePermission('billing.manage')
  @Post('billing/:id/lines')
  addExtra(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtraLineDto) {
    return this.billing.addExtra(user, id, dto);
  }

  @RequirePermission('billing.manage')
  @Patch('billing-lines/:id/shortfall')
  shortfall(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShortfallDto) {
    return this.billing.setShortfall(user, id, dto);
  }

  @RequirePermission('billing.manage')
  @Delete('billing-lines/:id')
  removeExtra(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.removeExtra(user, id);
  }

  @RequirePermission('billing.manage')
  @Post('billing/:id/issue')
  issue(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.issue(user, id);
  }

  @RequirePermission('billing.manage')
  @Post('billing/:id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.billing.reopen(user, id, dto.reason);
  }

  @RequirePermission('billing.manage')
  @Post('billing/:id/payments')
  addPayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDto) {
    return this.billing.addPayment(user, id, dto);
  }

  @RequirePermission('billing.manage')
  @Post('billing-payments/:id/remove')
  removePayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.billing.removePayment(user, id, dto.reason);
  }

  /** Anyone signed in with an employee file: their own locked payslips. */
  @Get('me/payslips')
  myPayslips(@CurrentUser() user: AuthUser) {
    return this.payroll.myPayslips(user);
  }

  @Get('me/payslips/:periodId')
  myPayslip(@CurrentUser() user: AuthUser, @Param('periodId', ParseUUIDPipe) periodId: string) {
    return this.payroll.myPayslip(user, periodId);
  }
}
