import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators';
import { BusinessException } from '../common/errors/business.exception';
import { DEMO_CODE, DEMO_PASSWORD, DemoService } from './demo.service';
import { DemoKeyDto } from './dto';

/**
 * The /resetdemo page: anyone holding the link (with its key) may see the demo accounts and rebuild the demo
 * company. Off unless DEMO_RESET_KEY is set; only ever touches the company coded "demo".
 */
@Controller('demo')
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    private readonly ds: DataSource,
  ) {}

  @Public()
  @Get()
  async info(@Query() q: DemoKeyDto) {
    this.check(q.key);
    const [tenant] = await this.ds.query(`SELECT id, name, created_at FROM tenants WHERE code = $1`, [DEMO_CODE]);
    if (!tenant) return { exists: false, password: DEMO_PASSWORD, accounts: [] };
    const accounts = await this.ds.query(
      `SELECT r.name AS role, u.full_name AS name, u.phone, t.name AS team
         FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         LEFT JOIN team_members tm ON tm.employee_id = u.employee_id AND tm.end_date IS NULL
         LEFT JOIN teams t ON t.id = tm.team_id
        WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
        ORDER BY u.phone`,
      [tenant.id],
    );
    return { exists: true, company: tenant.name, built_at: tenant.created_at, password: DEMO_PASSWORD, accounts };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('reset')
  @HttpCode(200)
  reset(@Body() dto: DemoKeyDto) {
    this.check(dto.key);
    return this.demo.reset();
  }

  /** Without the right key the page simply does not exist. */
  private check(key: string | undefined): void {
    const expected = process.env.DEMO_RESET_KEY?.trim();
    if (!expected || !key) throw new BusinessException('NOT_FOUND');
    const a = Buffer.from(key);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BusinessException('NOT_FOUND');
  }
}
