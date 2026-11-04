import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { BusinessException } from './common/errors/business.exception';
import { flattenValidationErrors } from './common/errors/validation';

/** Everything main.ts and the e2e tests must configure identically. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  // nginx is the only proxy; trust it for the client IP (rate limiting). On the same host that is loopback;
  // in Docker, nginx reaches the container through the bridge network: TRUST_PROXY=loopback,uniquelocal.
  app.set('trust proxy', (process.env.TRUST_PROXY ?? 'loopback').split(',').map((s) => s.trim()).filter(Boolean));
  app.use(helmet());
  app.use(cookieParser());

  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGIN must list explicit origins: cookies are sent with credentials');
  }
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BusinessException('VALIDATION_FAILED', flattenValidationErrors(errors)),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
