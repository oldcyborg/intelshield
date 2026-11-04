import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { EscalationService } from '../src/incidents/escalation.service';
import { PushService } from '../src/notifications/push';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe('Incidents — routing and escalation (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  const users: Record<string, { id: string; api: ReturnType<typeof client> }> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'esc');
    api = client(app, admin.token);
    users.director = { id: admin.adminUserId, api };
    const cats = (await api.get('/api/incident-categories').expect(200)).body.data as { id: string; name: string }[];
    ids.low = cats.find((c) => c.name === 'Vệ sinh / an toàn')!.id;
    ids.medium = cats.find((c) => c.name === 'Hư hỏng thiết bị')!.id;
    ids.high = cats.find((c) => c.name === 'Trộm cắp')!.id;
    ids.client = (await api.post('/api/clients', { code: 'EK', name: 'Khách' }).expect(201)).body.data.id;

    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager'], []);
    users.manager = { id: manager.user.id, api: client(app, manager.token) };
    ids.group = (await api.post('/api/org/groups', { name: 'Nhóm', manager_user_id: manager.user.id }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội', team_group_id: ids.group }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'ES', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'ES2', name: 'Toà 2', responsible_team_id: ids.team }).expect(201)).body.data.id;

    const lead = await member('LEAD', ids.team);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead });
    const phone = await loginOnDevice(app, leader.phone, leader.password, 'esc-leader-phone');
    await client(app, phone.token!).post('/api/me/push-token', { token: 'tok-leader' }).expect(201);
    users.leader = { id: leader.user.id, api: client(app, leader.token) };
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: await member('GUARD', ids.team) });
    users.guard = { id: g.user.id, api: client(app, g.token) };
  });
  afterAll(async () => app.close());

  async function member(code: string, team: string) {
    const e = (await api.post('/api/employees', { code: `${code}${++seq}`, full_name: code }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    return e;
  }
  const report = async (category: string, site = ids.site, by = users.guard) =>
    (await by.api.post('/api/incidents', { site_id: site, category_id: ids[category], description: 'test' }).expect(201)).body.data;
  const got = async (who: string, incidentId: string) =>
    Number((await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND data->>'incident_id' = $2`, [users[who].id, incidentId]))[0].n);
  const tick = (minutes: number) => app.get(EscalationService).tick(later(minutes));

  it('keeps a low incident with the team leader, in the app only', async () => {
    const push = app.get(PushService);
    push.sent.length = 0;
    const i = await report('low');
    expect([await got('leader', i.id), await got('manager', i.id), await got('director', i.id)]).toEqual([1, 0, 0]);
    expect(push.sent).toEqual([]);
    await tick(600);
    expect(await got('manager', i.id)).toBe(0);
  });

  it('chases a medium incident up the chain until someone takes it', async () => {
    const push = app.get(PushService);
    push.sent.length = 0;
    const i = await report('medium');
    expect([await got('leader', i.id), await got('manager', i.id)]).toEqual([1, 0]);
    expect(push.sent[0]).toMatchObject({ tokens: ['tok-leader'], message: expect.objectContaining({ priority: 'high' }) });
    await tick(29);
    expect(await got('manager', i.id)).toBe(0);
    await tick(31);
    expect(await got('manager', i.id)).toBe(1);
    await tick(62);
    expect(await got('director', i.id)).toBe(1);
    const events = (await api.get(`/api/incidents/${i.id}`).expect(200)).body.data.events;
    expect(events.filter((e: { type: string }) => e.type === 'escalated')).toHaveLength(2);
  });

  it('stops chasing once someone acknowledges', async () => {
    const i = await report('medium');
    await users.leader.api.post(`/api/incidents/${i.id}/acknowledge`).expect(201);
    await tick(31);
    expect(await got('manager', i.id)).toBe(0);
  });

  it("uses the site's own thresholds", async () => {
    await api.patch(`/api/sites/${ids.site2}/settings`, { incident_escalate_high_minutes: 5 }).expect(200);
    const fast = await report('high', ids.site2);
    const normal = await report('high');
    expect([await got('leader', fast.id), await got('manager', fast.id), await got('director', fast.id)]).toEqual([1, 1, 0]);
    await tick(6);
    expect(await got('director', fast.id)).toBe(1);
    expect(await got('director', normal.id)).toBe(0);
    await tick(11);
    expect(await got('director', normal.id)).toBe(1);
  });

  it('wakes everyone for an SOS and keeps reminding until acknowledged', async () => {
    const push = app.get(PushService);
    push.sent.length = 0;
    await api.post('/api/roster', { site_id: ids.site, employee_id: (await ds.query(`SELECT employee_id FROM users WHERE id = $1`, [users.guard.id]))[0].employee_id, start_at: later(-10).toISOString(), end_at: later(300).toISOString() }).expect(201);
    const sos = (await users.guard.api.post('/api/incidents/sos', { lat: 21, lng: 105 }).expect(201)).body.data;
    expect([await got('leader', sos.id), await got('manager', sos.id), await got('director', sos.id)]).toEqual([1, 1, 1]);
    expect(push.sent[0].message.priority).toBe('critical');
    await tick(4);
    expect([await got('leader', sos.id), await got('manager', sos.id), await got('director', sos.id)]).toEqual([2, 2, 2]);
    await users.manager.api.post(`/api/incidents/${sos.id}/acknowledge`).expect(201);
    await tick(8);
    expect(await got('director', sos.id)).toBe(2);
  });

  it('skips empty levels: a team without a leader goes straight to its manager', async () => {
    const lonely = (await api.post('/api/org/teams', { name: 'Đội không trưởng', team_group_id: ids.group }).expect(201)).body.data.id;
    const site = (await api.post('/api/sites', { client_id: ids.client, code: 'ES3', name: 'Kho', responsible_team_id: lonely }).expect(201)).body.data.id;
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: await member('LONE', lonely) });
    const i = (await client(app, g.token).post('/api/incidents', { site_id: site, category_id: ids.medium, description: 'x' }).expect(201)).body.data;
    expect(await got('manager', i.id)).toBe(1);
  });

  it("tells the client's account manager about what the client reported", async () => {
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant']);
    users.account = { id: accountant.user.id, api: client(app, accountant.token) };
    await api.patch(`/api/clients/${ids.client}`, { account_manager_id: accountant.user.id }).expect(200);
    const i = (await api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'Khách gọi báo', source: 'client_report', client_channel: 'phone' }).expect(201)).body.data;
    expect([await got('account', i.id), await got('leader', i.id)]).toEqual([1, 1]);
  });
});
