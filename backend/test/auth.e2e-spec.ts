import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp, login, server } from './helpers';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  beforeAll(async () => ({ app, ds } = await createTestApp()));
  afterAll(async () => app.close());

  const loginMobile = (identifier: string, password: string) =>
    request(server(app)).post('/api/auth/login').set('X-Client', 'mobile').send({ identifier, password });

  it('accepts the phone number in whatever format the guard types it', async () => {
    const t = await createTenantWithAdmin(app, 'auth-fmt');
    const res = await loginMobile(t.phone.replace(/^0/, '+84 '), t.password).expect(200);
    expect(res.body.data.access_token).toEqual(expect.any(String));
    expect(res.body.data.refresh_token).toMatch(/^[0-9a-f-]{36}\./);
    expect(res.body.data.user).toMatchObject({ tenant_id: t.tenant.id, phone: t.phone, user_type: 'staff' });
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const t = await createTenantWithAdmin(app, 'auth-wrong');
    const wrong = await loginMobile(t.phone, 'not-the-password').expect(401);
    const unknown = await loginMobile('0999999999', 'whatever1').expect(401);
    expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(unknown.body).toEqual(wrong.body);
  });

  it('keeps tokens out of the body for the web and sets httpOnly cookies instead', async () => {
    const t = await createTenantWithAdmin(app, 'auth-web');
    const res = await request(server(app)).post('/api/auth/login').send({ identifier: t.phone, password: t.password }).expect(200);
    expect(res.body.data.access_token).toBeUndefined();
    expect(res.body.data.refresh_token).toBeUndefined();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('access_token='));
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));
    expect(access).toContain('HttpOnly');
    expect(refresh).toContain('Path=/api/auth');
    await request(server(app)).get('/api/auth/me').set('Cookie', access!.split(';')[0]).expect(200);
  });

  it('rotates the refresh token and kills the session when an old one comes back', async () => {
    const t = await createTenantWithAdmin(app, 'auth-rot');
    const first = (await loginMobile(t.phone, t.password).expect(200)).body.data;
    const refresh = (token: string) =>
      request(server(app)).post('/api/auth/refresh').set('X-Client', 'mobile').send({ refresh_token: token });

    const second = (await refresh(first.refresh_token).expect(200)).body.data;
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // Outside the short grace window an old token is a stolen copy.
    await ds.query(`UPDATE sessions SET rotated_at = now() - interval '5 minutes'`);
    const replay = await refresh(first.refresh_token).expect(401);
    expect(replay.body.error.code).toBe('AUTH_REFRESH_INVALID');
    // The legitimate holder is logged out too: we cannot tell which copy is the thief's.
    await refresh(second.refresh_token).expect(401);
    await client(app, second.access_token).get('/api/auth/me').expect(401);
  });

  it('makes the access token useless right after logout', async () => {
    const t = await createTenantWithAdmin(app, 'auth-out');
    await client(app, t.token).post('/api/auth/logout').expect(200);
    const res = await client(app, t.token).get('/api/auth/me').expect(401);
    expect(res.body.error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('shuts out a suspended company and a locked user immediately', async () => {
    const t = await createTenantWithAdmin(app, 'auth-susp');
    await ds.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [t.tenant.id]);
    await client(app, t.token).get('/api/auth/me').expect(401);
    const res = await loginMobile(t.phone, t.password).expect(403);
    expect(res.body.error.code).toBe('AUTH_TENANT_SUSPENDED');

    const u = await createTenantWithAdmin(app, 'auth-lock');
    await ds.query(`UPDATE users SET status = 'locked' WHERE id = $1`, [u.adminUserId]);
    await client(app, u.token).get('/api/auth/me').expect(401);
    await loginMobile(u.phone, u.password).expect(401);
  });

  it('reports permissions and company-wide visibility in /me', async () => {
    const t = await createTenantWithAdmin(app, 'auth-me');
    const res = await client(app, t.token).get('/api/auth/me').expect(200);
    expect(res.body.data.permissions).toContain('org.manage');
    expect(res.body.data.team_visibility).toEqual({ all: true, team_ids: [] });
    expect(res.body.data.user.full_name).toBe('Giám đốc auth-me');
  });

  it('changing the password ends every other session', async () => {
    const t = await createTenantWithAdmin(app, 'auth-pw');
    const other = await login(app, t.phone, t.password);
    const wrong = await client(app, t.token)
      .post('/api/auth/change-password', { current_password: 'nope-nope', new_password: 'NewPass@123' })
      .expect(400);
    expect(wrong.body.error.code).toBe('AUTH_WRONG_PASSWORD');
    await client(app, t.token)
      .post('/api/auth/change-password', { current_password: t.password, new_password: 'NewPass@123' })
      .expect(200);
    await client(app, other).get('/api/auth/me').expect(401);
    await client(app, t.token).get('/api/auth/me').expect(200);
    await login(app, t.phone, 'NewPass@123');
  });

  it('still lets anyone reach the health check', async () => {
    await request(server(app)).get('/api/health').expect(200);
  });
  it('survives two tabs refreshing with the same token at the same moment', async () => {
    const t = await createTenantWithAdmin(app, 'auth-race');
    const first = (await loginMobile(t.phone, t.password).expect(200)).body.data;
    const refresh = () =>
      request(server(app)).post('/api/auth/refresh').set('X-Client', 'mobile').send({ refresh_token: first.refresh_token });
    const [a, b] = await Promise.all([refresh(), refresh()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await client(app, a.body.data.access_token).get('/api/auth/me').expect(200);
    await client(app, b.body.data.access_token).get('/api/auth/me').expect(200);
    await request(server(app)).post('/api/auth/refresh').set('X-Client', 'mobile').send({ refresh_token: a.body.data.refresh_token }).expect(200);
    await request(server(app)).post('/api/auth/refresh').set('X-Client', 'mobile').send({ refresh_token: b.body.data.refresh_token }).expect(200);
  });
});
