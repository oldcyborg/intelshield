import request from 'supertest';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { buildDataSourceOptions } from '../src/database/data-source';
import { TenantsService } from '../src/tenants/tenants.service';
import { ScopeInput } from '../src/access/scope.types';
import { hashPassword } from '../src/auth/password';
import { NewUserInput, UsersService } from '../src/users/users.service';

/** Wipe the test database, replay every migration, and boot the real app. */
export async function createTestApp(): Promise<{ app: NestExpressApplication; ds: DataSource }> {
  const bootstrap = new DataSource(buildDataSourceOptions());
  await bootstrap.initialize();
  await bootstrap.query('DROP SCHEMA public CASCADE');
  await bootstrap.query('CREATE SCHEMA public');
  await bootstrap.runMigrations();
  await bootstrap.destroy();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, ds: app.get(DataSource) };
}

export const server = (app: NestExpressApplication) => app.getHttpServer();

export async function login(app: NestExpressApplication, identifier: string, password: string): Promise<string> {
  const res = await request(server(app))
    .post('/api/auth/login')
    .set('X-Client', 'mobile')
    .send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.access_token as string;
}

export async function createTenantWithAdmin(app: NestExpressApplication, code: string) {
  const phone = uniquePhone();
  const password = 'Admin@12345';
  const { tenant, admin_user_id } = await app.get(TenantsService).createTenant(
    { code, name: `Công ty ${code}`, admin: { full_name: `Giám đốc ${code}`, phone, password } },
    null,
  );
  return { tenant, adminUserId: admin_user_id, phone, password, token: await login(app, phone, password) };
}

/** supertest with a bearer token already attached. */
export function client(app: NestExpressApplication, token: string) {
  const s = server(app);
  const auth = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request(s).get(url).set(auth),
    post: (url: string, body: object = {}) => request(s).post(url).set(auth).send(body),
    patch: (url: string, body: object = {}) => request(s).patch(url).set(auth).send(body),
    put: (url: string, body: object = {}) => request(s).put(url).set(auth).send(body),
    delete: (url: string) => request(s).delete(url).set(auth),
  };
}

let phoneSeq = 0;
/** A fresh valid number per call. Each spec file gets a wiped database, so a counter is enough. */
export const uniquePhone = () => `09${String(++phoneSeq).padStart(8, '0')}`;

/** A user straight into the database with the given system or custom roles. */
export async function createUserWithRoles(
  app: NestExpressApplication,
  tenantId: string,
  roleCodes: string[],
  scopes: ScopeInput[] = [{ scope_type: 'tenant' }],
  extra: Partial<NewUserInput> = {},
) {
  const ds = app.get(DataSource);
  const roles: { id: string }[] = await ds.query(
    `SELECT id FROM roles WHERE tenant_id = $1 AND code = ANY($2) AND deleted_at IS NULL`,
    [tenantId, roleCodes],
  );
  if (roles.length !== roleCodes.length) throw new Error(`unknown role in ${roleCodes.join(',')}`);
  const phone = uniquePhone();
  const password = 'Passw0rd!x';
  const user = await ds.transaction((m) =>
    app.get(UsersService).insertUser(m, tenantId, {
      user_type: 'staff',
      full_name: `Người dùng ${phone}`,
      phone,
      password,
      role_ids: roles.map((r) => r.id),
      scopes,
      ...extra,
    }),
  );
  return { user, phone, password, token: await login(app, phone, password) };
}

export async function createPlatformAdmin(app: NestExpressApplication) {
  const email = `root${uniquePhone()}@patrol.vn`;
  const password = 'Platform@12345';
  await app.get(DataSource).query(
    `INSERT INTO users (user_type, full_name, email, password_hash) VALUES ('platform_admin', 'Quản trị nền tảng', $1, $2)`,
    [email, await hashPassword(password)],
  );
  return { email, password, token: await login(app, email, password) };
}

/** Signs in the way the mobile app does, from a given phone. Returns the HTTP status too: a new phone may be refused. */
export async function loginOnDevice(app: NestExpressApplication, identifier: string, password: string, deviceId: string) {
  const res = await request(server(app))
    .post('/api/auth/login')
    .set('X-Client', 'mobile')
    .send({ identifier, password, device_id: deviceId, platform: 'android' });
  return { status: res.status, body: res.body, token: res.body?.data?.access_token as string | undefined };
}
