import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { EscalationService } from '../src/incidents/escalation.service';
import { EventsService } from '../src/notifications/events.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PushService } from '../src/notifications/push';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe('Plan 05 review fixes (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let leader: { id: string; api: ReturnType<typeof client> };
  let otherLeader: { id: string; api: ReturnType<typeof client> };
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'rv5');
    api = client(app, admin.token);
    const cats = (await api.get('/api/incident-categories').expect(200)).body.data as { id: string; name: string }[];
    ids.medium = cats.find((c) => c.name === 'Hư hỏng thiết bị')!.id;
    ids.high = cats.find((c) => c.name === 'Trộm cắp')!.id;
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội 1' }).expect(201)).body.data.id;
    ids.team2 = (await api.post('/api/org/teams', { name: 'Đội 2' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    leader = await leaderOf(ids.team);
    otherLeader = await leaderOf(ids.team2);
  });
  afterAll(async () => app.close());

  async function member(team: string) {
    const e = (await api.post('/api/employees', { code: `RV${++seq}`, full_name: `NV ${seq}` }).expect(201)).body.data.id;
    await api.post(`/api/org/teams/${team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    return e;
  }
  async function leaderOf(team: string) {
    const e = await member(team);
    await api.put(`/api/org/teams/${team}/leader`, { employee_id: e }).expect(200);
    const u = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: e });
    return { id: u.user.id, api: client(app, u.token) };
  }
  async function guard(team = ids.team) {
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: await member(team) });
    return { id: u.user.id, api: client(app, u.token) };
  }
  const got = async (userId: string, incidentId: string) =>
    Number((await ds.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND data->>'incident_id' = $2`, [userId, incidentId]))[0].n);

  it('accepts a full-length title and still escalates it', async () => {
    const g = await guard();
    const title = 'T'.repeat(200);
    const high = (await g.api.post('/api/incidents', { site_id: ids.site, category_id: ids.high, title, description: 'x' }).expect(201)).body.data;
    const medium = (await g.api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, title, description: 'x' }).expect(201)).body.data;
    await app.get(EscalationService).tick(later(31));
    const events = (await api.get(`/api/incidents/${medium.id}`).expect(200)).body.data.events;
    expect(events.map((e: { type: string }) => e.type)).toContain('escalated');
    expect(high.id).toBeTruthy();
  });

  it('keeps escalating the others when one incident fails', async () => {
    const g = await guard();
    const bad = (await g.api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'x' }).expect(201)).body.data;
    const good = (await g.api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'y' }).expect(201)).body.data;
    await ds.query(`UPDATE incidents SET next_escalation_at = now() - interval '1 hour' WHERE id = $1`, [bad.id]);
    const notify = app.get(NotificationsService);
    const original = notify.notify.bind(notify);
    const spy = jest.spyOn(notify, 'notify').mockImplementation(async (tenantId, userIds, input, m) => {
      if (input.data.incident_id === bad.id) throw new Error('boom');
      return original(tenantId, userIds, input, m);
    });
    try {
      await app.get(EscalationService).tick(later(31));
    } finally {
      spy.mockRestore();
    }
    const events = (await api.get(`/api/incidents/${good.id}`).expect(200)).body.data.events;
    expect(events.map((e: { type: string }) => e.type)).toContain('escalated');
  });

  it('lets the person an incident is assigned to see and work it', async () => {
    const reporter = await guard();
    const helper = await guard();
    const i = (await reporter.api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'x' }).expect(201)).body.data;
    await leader.api.post(`/api/incidents/${i.id}/acknowledge`).expect(201);
    await leader.api.post(`/api/incidents/${i.id}/assign`, { user_id: helper.id }).expect(201);
    await helper.api.get(`/api/incidents/${i.id}`).expect(200);
    expect((await helper.api.get('/api/incidents').expect(200)).body.data.map((r: { id: string }) => r.id)).toContain(i.id);
    await helper.api.post(`/api/incidents/${i.id}/start`).expect(201);
  });

  it('pushes and streams only after the change is committed', async () => {
    const push = app.get(PushService);
    const seen: unknown[] = [];
    const sub = app.get(EventsService).stream(leader.id).subscribe((e) => seen.push(e));
    push.sent.length = 0;
    await expect(ds.transaction(async (m) => {
      await app.get(NotificationsService).notify(admin.tenant.id, [leader.id], { type: 't', title: 'x', body: '', data: {}, priority: 'high', push: true }, m);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    await ds.transaction(async (m) => {
      await app.get(NotificationsService).notify(admin.tenant.id, [leader.id], { type: 't', title: 'kept', body: '', data: {}, priority: 'normal', push: false }, m);
    });
    await new Promise((r) => setTimeout(r, 50));
    sub.unsubscribe();
    expect(seen.filter((e) => (e as { type?: string }).type === 'notification').map((e) => (e as { title: string }).title)).toEqual(['kept']);
    expect(push.sent).toEqual([]);
  });

  it('does not let a team leader dismiss an incident above what they may close', async () => {
    const g = await guard();
    const i = (await g.api.post('/api/incidents', { site_id: ids.site, category_id: ids.high, description: 'x' }).expect(201)).body.data;
    expect((await leader.api.post(`/api/incidents/${i.id}/reject`, { reason: 'nhầm' }).expect(403)).body.error.code).toBe('INCIDENT_REJECT_NOT_ALLOWED');
  });

  it("routes an office report to the site's own team, not the reporter's", async () => {
    // Team 2's leader sees the client through their own people and logs a call about team 1's site.
    const r = (await otherLeader.api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'Khách gọi', source: 'client_report' }).expect(201)).body.data;
    expect(await got(leader.id, r.id)).toBe(1);
  });

  it('clears the old resolution when an incident is reopened', async () => {
    const g = await guard();
    const i = (await g.api.post('/api/incidents', { site_id: ids.site, category_id: ids.medium, description: 'x' }).expect(201)).body.data;
    for (const step of ['acknowledge', 'start']) await leader.api.post(`/api/incidents/${i.id}/${step}`).expect(201);
    await leader.api.post(`/api/incidents/${i.id}/resolve`, { note: 'xong' }).expect(201);
    const back = (await leader.api.post(`/api/incidents/${i.id}/reopen`, { reason: 'chưa xong' }).expect(201)).body.data;
    expect(back.resolution_note).toBeNull();
  });
});
