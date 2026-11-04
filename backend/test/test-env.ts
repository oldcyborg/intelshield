import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Runs before any application module is imported, so these win over backend/.env
// (dotenv never overrides a variable that is already set).
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST_TEST ?? 'localhost';
process.env.DB_PORT = process.env.DB_PORT_TEST ?? '5433';
process.env.DB_USERNAME = process.env.DB_USERNAME_TEST ?? 'patrol';
process.env.DB_PASSWORD = process.env.DB_PASSWORD_TEST ?? 'patrol';
process.env.DB_DATABASE = process.env.DB_DATABASE_TEST ?? 'patrol_test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef';
process.env.BCRYPT_ROUNDS = '4';
process.env.LOGIN_RATE_LIMIT = '1000';
// Uploads from tests land in a throwaway folder, never in the dev uploads directory.
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'patrol-uploads-'));
process.env.PUSH_DRIVER = 'memory';
process.env.ESCALATION_TICK = 'off';
process.env.PATROL_TICK = 'off';
process.env.VIOLATION_TICK = 'off';
process.env.HANDOVER_TICK = 'off';
