import type { Request, Response } from 'express';
import { accessTtlSeconds, refreshTtlDays } from '../config/env';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

const base = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' });

export function setAuthCookies(res: Response, tokens: TokenPair): void {
  res.cookie('access_token', tokens.access_token, { ...base(), path: '/', maxAge: accessTtlSeconds() * 1000 });
  // Only the auth routes ever see the refresh token.
  res.cookie('refresh_token', tokens.refresh_token, {
    ...base(),
    path: '/api/auth',
    maxAge: refreshTtlDays() * 86_400_000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', { ...base(), path: '/' });
  res.clearCookie('refresh_token', { ...base(), path: '/api/auth' });
}

/** The app asks for tokens in the body; a browser never gets them where scripts could read them. */
export const isMobileClient = (req: Request) => req.headers['x-client'] === 'mobile';
