const isProduction = () => process.env.NODE_ENV === 'production';

export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

/** A secret with a dev fallback that refuses to start production with a weak value. */
export function getSecretEnv(name: string, fallback: string, minLengthInProduction = 32): string {
  const value = getEnv(name, isProduction() ? undefined : fallback);
  if (isProduction() && value.length < minLengthInProduction) {
    throw new Error(`${name} must be at least ${minLengthInProduction} characters in production`);
  }
  return value;
}

export const DEV_JWT_SECRET = 'dev-access-secret-change-me-0123456789';
export const jwtSecret = () => getSecretEnv('JWT_SECRET', DEV_JWT_SECRET);
export const accessTtlSeconds = () => parseInt(getEnv('JWT_ACCESS_TTL_SECONDS', '900'), 10);
export const refreshTtlDays = () => parseInt(getEnv('JWT_REFRESH_TTL_DAYS', '30'), 10);
export const bcryptRounds = () => parseInt(getEnv('BCRYPT_ROUNDS', '12'), 10);
export const uploadDir = () => getEnv('UPLOAD_DIR', './uploads');
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
