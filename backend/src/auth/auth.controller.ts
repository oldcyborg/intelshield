import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { BusinessException } from '../common/errors/business.exception';
import { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { clearAuthCookies, isMobileClient, setAuthCookies } from './cookies';
import { AnyUser, CurrentUser, Public } from './decorators';
import { ChangePasswordDto, LoginDto, RefreshDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    setAuthCookies(res, result);
    return isMobileClient(req) ? result : { user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refresh_token ?? (req.cookies as Record<string, string> | undefined)?.refresh_token;
    if (!token) throw new BusinessException('AUTH_REFRESH_INVALID');
    const tokens = await this.auth.refresh(token);
    setAuthCookies(res, tokens);
    return isMobileClient(req) ? tokens : { ok: true };
  }

  @AnyUser()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.session_id);
    clearAuthCookies(res);
    return { ok: true };
  }

  @AnyUser()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @AnyUser()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto);
    return { ok: true };
  }
}
