import { HttpException } from '@nestjs/common';
import { ERROR_CODES, ErrorCode } from './error-codes';

/** The only exception business code throws. Status and Vietnamese message come from the code. */
export class BusinessException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
  ) {
    super(ERROR_CODES[code].message, ERROR_CODES[code].status);
  }
}
