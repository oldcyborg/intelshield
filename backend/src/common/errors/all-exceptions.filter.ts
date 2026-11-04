import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BusinessException } from './business.exception';
import { ERROR_CODES } from './error-codes';

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

const CODE_BY_STATUS: Record<number, keyof typeof ERROR_CODES> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_UNAUTHENTICATED',
  403: 'AUTH_FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'FILE_TOO_LARGE',
  429: 'RATE_LIMITED',
};

export function toErrorBody(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof BusinessException) {
    const error: ErrorBody['error'] = { code: exception.code, message: exception.message };
    if (exception.details !== undefined) error.details = exception.details;
    return { status: exception.getStatus(), body: { error } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = CODE_BY_STATUS[status];
    return code
      ? { status, body: { error: { code, message: ERROR_CODES[code].message } } }
      : { status, body: { error: { code: `HTTP_${status}`, message: exception.message } } };
  }
  // PostgreSQL said no: an impossible date (2026-02-30) is the client's mistake; a unique or
  // exclusion violation here means another request won a race the service checks could not see.
  const pgCode = (exception as { code?: string } | null)?.code;
  if (pgCode === '22007' || pgCode === '22008' || pgCode === '23502' || pgCode === '23514') {
    return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: ERROR_CODES.VALIDATION_FAILED.message } } };
  }
  if (pgCode === '23505' || pgCode === '23P01') {
    return { status: 409, body: { error: { code: 'CONFLICT', message: ERROR_CODES.CONFLICT.message } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: ERROR_CODES.INTERNAL_ERROR.message } } };
}

/**
 * Unexpected errors are logged with their stack but never echoed: SQL messages
 * leak table names and data.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    if (response.headersSent) {
      response.end();
      return;
    }
    const { status, body } = toErrorBody(exception);
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(status).json(body);
  }
}
