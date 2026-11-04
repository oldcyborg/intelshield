import http from 'http';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PushService } from '../src/notifications/push';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice, server } from './helpers';

describe('Notifications (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ntf');
  });
  afterAll(async () => app.close());

  const notify = (userIds: string[], priority: 'normal' | 'high' | 'critical', push = true) =>
    app.get(NotificationsService).notify(admin.tenant.id, userIds, { type: 'test', title: 'Có sự cố', body: 'Cầu thang B1', data: { incident_id: 'x' }, priority, push });

  it('keeps notifications to read later and marks them read', async () => {
    const u = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await notify([u.user.id], 'normal');
    await notify([u.user.id], 'high');
    const api = client(app, u.token);
    let list = (await api.get('/api/me/notifications?unread=true').expect(200)).body.data;
    expect(list.items).toHaveLength(2);
    expect(list.unread).toBe(2);
    await api.post(`/api/me/notifications/${list.items[0].id}/read`).expect(201);
    list = (await api.get('/api/me/notifications?unread=true').expect(200)).body.data;
    expect(list.unread).toBe(1);
    await api.post('/api/me/notifications/read-all').expect(201);
    expect((await api.get('/api/me/notifications?unread=true').expect(200)).body.data.unread).toBe(0);
  });

  it("pushes to the phones that registered, with the critical channel for emergencies", async () => {
    const g = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard' });
    const phone = await loginOnDevice(app, g.phone, g.password, 'ntf-phone-0001');
    await client(app, phone.token!).post('/api/me/push-token', { token: 'fcm-token-abc' }).expect(201);
    const web = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    expect((await client(app, web.token).post('/api/me/push-token', { token: 'nope' }).expect(403)).body.error.code).toBe('PUSH_DEVICE_REQUIRED');

    const push = app.get(PushService);
    push.sent.length = 0;
    await notify([g.user.id, web.user.id], 'critical');
    expect(push.sent).toEqual([expect.objectContaining({ tokens: ['fcm-token-abc'], message: expect.objectContaining({ priority: 'critical', title: 'Có sự cố' }) })]);
    push.sent.length = 0;
    await notify([g.user.id], 'normal', false);
    expect(push.sent).toEqual([]);
  });

  it('streams new notifications to an open browser tab', async () => {
    const u = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    const address = server(app).listening ? server(app).address() : await new Promise((resolve) => {
      const s = server(app).listen(0, () => resolve(s.address()));
    });
    const port = (address as { port: number }).port;
    const received = new Promise<string>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/me/events', headers: { Authorization: `Bearer ${u.token}` } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (chunk.includes('Có sự cố')) {
            resolve(chunk);
            req.destroy();
          }
        });
      });
      req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
      setTimeout(() => notify([u.user.id], 'high'), 300);
    });
    expect(await received).toContain('"type":"notification"');
  });
});
