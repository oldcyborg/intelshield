import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

describe('Incidents — workflow (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let guard: { api: ReturnType<typeof client>; token: string; userId: string };
  let leader: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'wf');
    api = client(app, admin.token);
    const cats = (await api.get('/api/incident-categories').expect(200)).body.data as { id: string; name: string }[];
    ids.medium = cats.find((c) => c.name === 'Hư hỏng thiết bị')!.id;
    ids.high = cats.find((c) => c.name === 'Trộm cắp')!.id;
    ids.client = (await api.post('/api/clients', { code: 'WK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'WS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    const emp = async (code: string) => {
      const e = (await api.post('/api/employees', { code, full_name: code }).expect(201)).body.data.id;
      await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
      await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
      return e;
    };
    const lead = await emp('LEAD');
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: lead }).expect(200);
    leader = client(app, (await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead })).token);
    const g = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: await emp('GUARD') });
    guard = { api: client(app, g.token), token: g.token, userId: g.user.id };
    manager = client(app, (await createUserWithRoles(app, admin.tenant.id, ['manager'])).token);
  });
  afterAll(async () => app.close());

  const report = async (category: 'medium' | 'high') =>
    (await guard.api.post('/api/incidents', { site_id: ids.site, category_id: ids[category], description: 'Hỏng khoá cửa' }).expect(201)).body.data;
  const photo = async () =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${guard.token}`).attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg').expect(201)).body.data.id;

  it('walks an incident from report to closed and keeps the whole timeline', async () => {
    const i = await report('medium');
    await leader.post(`/api/incidents/${i.id}/acknowledge`).expect(201);
    const mine = (await guard.api.get('/api/me/notifications').expect(200)).body.data.items;
    expect(mine.map((n: { type: string }) => n.type)).toContain('incident.acknowledged');
    await leader.post(`/api/incidents/${i.id}/assign`, { user_id: guard.userId }).expect(201);
    await guard.api.post(`/api/incidents/${i.id}/start`).expect(201);
    expect((await guard.api.post(`/api/incidents/${i.id}/resolve`, {}).expect(400)).body.error.code).toBe('INCIDENT_NOTE_REQUIRED');
    await guard.api.post(`/api/incidents/${i.id}/resolve`, { note: 'Đã thay khoá mới' }).expect(201);
    expect((await leader.post(`/api/incidents/${i.id}/close`).expect(403)).body.error.code).toBe('INCIDENT_CLOSE_NOT_ALLOWED');
    const closed = (await manager.post(`/api/incidents/${i.id}/close`).expect(201)).body.data;
    expect(closed).toMatchObject({ status: 'closed', resolution_note: 'Đã thay khoá mới', assignee_user_id: guard.userId });
    expect(closed.events.map((e: { type: string; to_status: string | null }) => `${e.type}:${e.to_status ?? ''}`)).toEqual([
      'created:new', 'acknowledged:acknowledged', 'assigned:', 'status_changed:in_progress', 'status_changed:resolved', 'status_changed:closed',
    ]);
  });

  it('asks for a photo before a high incident is marked resolved', async () => {
    const i = await report('high');
    await leader.post(`/api/incidents/${i.id}/acknowledge`).expect(201);
    await leader.post(`/api/incidents/${i.id}/start`).expect(201);
    expect((await leader.post(`/api/incidents/${i.id}/resolve`, { note: 'Đã báo công an' }).expect(400)).body.error.code).toBe('INCIDENT_PHOTO_REQUIRED');
    await guard.api.post(`/api/incidents/${i.id}/comments`, { body: 'Ảnh hiện trường', file_ids: [await photo()] }).expect(201);
    await leader.post(`/api/incidents/${i.id}/resolve`, { note: 'Đã báo công an' }).expect(201);
  });

  it("lets team leaders close up to the level the site allows", async () => {
    await api.patch(`/api/sites/${ids.site}/settings`, { incident_close_by_leader_up_to: 'medium' }).expect(200);
    const medium = await report('medium');
    for (const step of ['acknowledge', 'start']) await leader.post(`/api/incidents/${medium.id}/${step}`).expect(201);
    await leader.post(`/api/incidents/${medium.id}/resolve`, { note: 'xong' }).expect(201);
    await leader.post(`/api/incidents/${medium.id}/close`).expect(201);

    const high = await report('high');
    await guard.api.post(`/api/incidents/${high.id}/comments`, { body: 'ảnh', file_ids: [await photo()] }).expect(201);
    for (const step of ['acknowledge', 'start']) await leader.post(`/api/incidents/${high.id}/${step}`).expect(201);
    await leader.post(`/api/incidents/${high.id}/resolve`, { note: 'xong' }).expect(201);
    await leader.post(`/api/incidents/${high.id}/close`).expect(403);
    await api.patch(`/api/sites/${ids.site}/settings`, { incident_close_by_leader_up_to: null }).expect(200);
  });

  it('refuses moves that skip steps, and marks false alarms only with a reason', async () => {
    const i = await report('medium');
    expect((await manager.post(`/api/incidents/${i.id}/close`).expect(409)).body.error.code).toBe('INCIDENT_BAD_TRANSITION');
    expect((await manager.post(`/api/incidents/${i.id}/reject`, {}).expect(400)).body.error.code).toBe('INCIDENT_REASON_REQUIRED');
    await manager.post(`/api/incidents/${i.id}/reject`, { reason: 'Bảo vệ báo nhầm, cửa vẫn khoá' }).expect(201);
    await leader.post(`/api/incidents/${i.id}/acknowledge`).expect(409);

    const j = await report('medium');
    await guard.api.post(`/api/incidents/${j.id}/acknowledge`).expect(403);
    for (const step of ['acknowledge', 'start']) await leader.post(`/api/incidents/${j.id}/${step}`).expect(201);
    await leader.post(`/api/incidents/${j.id}/resolve`, { note: 'xong' }).expect(201);
    await leader.post(`/api/incidents/${j.id}/reopen`, {}).expect(400);
    const back = (await leader.post(`/api/incidents/${j.id}/reopen`, { reason: 'Khoá lại hỏng' }).expect(201)).body.data;
    expect(back.status).toBe('in_progress');
  });

  it('keeps the timeline append-only', async () => {
    const i = await report('medium');
    await expect(ds.query(`UPDATE incident_events SET body = 'sửa' WHERE incident_id = $1`, [i.id])).rejects.toThrow(/append-only/);
    await expect(ds.query(`DELETE FROM incident_events WHERE incident_id = $1`, [i.id])).rejects.toThrow(/append-only/);
  });
});
