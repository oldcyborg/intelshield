import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const nextMonday = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, ((8 - day) % 7) || 7);
};

describe('Roster (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  const W = addDays(nextMonday(today), 14); // a Monday safely in the future
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ros');
    api = client(app, admin.token);
    const emp = async (code: string) => (await api.post('/api/employees', { code, full_name: `NV ${code}` }).expect(201)).body.data.id;
    for (const code of ['L', 'G1', 'G2', 'G3', 'G4']) ids[code] = await emp(code);
    ids.team = (await api.post('/api/org/teams', { name: 'Đội A' }).expect(201)).body.data.id;
    ids.other = (await api.post('/api/org/teams', { name: 'Đội B' }).expect(201)).body.data.id;
    for (const code of ['L', 'G1', 'G2']) await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: ids[code] }).expect(201);
    await api.post(`/api/org/teams/${ids.other}/members`, { employee_id: ids.G3 }).expect(201);
    await api.put(`/api/org/teams/${ids.team}/leader`, { employee_id: ids.L }).expect(200);
    ids.client = (await api.post('/api/clients', { code: 'RK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'RS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    for (const code of ['L', 'G1', 'G2', 'G3']) {
      ids[`dep_${code}`] = (await api.post('/api/deployments', { employee_id: ids[code], client_id: ids.client, start_date: addDays(today, -30) }).expect(201)).body.data.id;
    }
    ids.night = (await api.post(`/api/sites/${ids.site}/shift-templates`, { name: 'Ca đêm', start_time: '22:00', end_time: '06:00' }).expect(201)).body.data.id;
    ids.day = (await api.post(`/api/sites/${ids.site}/shift-templates`, { name: 'Ca ngày', start_time: '06:00', end_time: '18:00', headcount: 2 }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const shift = (employee: string, template: string, date: string) =>
    api.post('/api/roster', { site_id: ids.site, employee_id: ids[employee], template_id: ids[template], shift_date: date });

  it('lists templates and marks overnight ones', async () => {
    const list = (await api.get(`/api/sites/${ids.site}/shift-templates`).expect(200)).body.data;
    expect(list.find((t: { id: string }) => t.id === ids.night)).toMatchObject({ start_time: '22:00', end_time: '06:00', overnight: true });
    expect(list.find((t: { id: string }) => t.id === ids.day)).toMatchObject({ overnight: false, headcount: 2 });
  });

  it('builds a night shift that ends the next morning, in Vietnam time', async () => {
    const res = (await shift('G1', 'night', W).expect(201)).body.data;
    expect(res).toMatchObject({ shift_date: W, planned_start: `${W}T15:00:00.000Z`, planned_end: `${W}T23:00:00.000Z`, template_name: 'Ca đêm' });
  });

  it('refuses overlapping shifts and people not posted to the client', async () => {
    await shift('G1', 'day', W).expect(201); // 06:00–18:00 the same day does not touch 22:00–06:00
    expect((await shift('G1', 'night', W).expect(409)).body.error.code).toBe('ROSTER_OVERLAP');
    expect((await shift('G4', 'day', W).expect(400)).body.error.code).toBe('ROSTER_NOT_DEPLOYED');
  });

  it('lets a team leader roster their own team and nobody else', async () => {
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: ids.L });
    const asLeader = client(app, leader.token);
    await asLeader.post('/api/roster', { site_id: ids.site, employee_id: ids.G2, template_id: ids.day, shift_date: W }).expect(201);
    const res = await asLeader.post('/api/roster', { site_id: ids.site, employee_id: ids.G3, template_id: ids.day, shift_date: W }).expect(403);
    expect(res.body.error.code).toBe('ROSTER_NOT_YOUR_TEAM');
    const week = (await asLeader.get(`/api/roster?site_id=${ids.site}&from=${W}&to=${addDays(W, 6)}`).expect(200)).body.data;
    expect(week.length).toBeGreaterThanOrEqual(3);
  });

  it('copies a week, skipping people no longer posted there and saying why', async () => {
    await api.post(`/api/deployments/${ids.dep_G2}/end`, { last_day: addDays(W, 6) }).expect(200);
    const res = (await api.post('/api/roster/copy-week', { site_id: ids.site, from_week: W, to_week: addDays(W, 7) }).expect(201)).body.data;
    expect(res.created).toBe(2); // G1's night and day
    expect(res.skipped).toEqual([expect.objectContaining({ employee_name: 'NV G2', shift_date: addDays(W, 7) })]);
    expect((await api.post('/api/roster/copy-week', { site_id: ids.site, from_week: addDays(W, 1), to_week: addDays(W, 8) }).expect(400)).body.error.code).toBe('ROSTER_WEEK_INVALID');
  });

  it('hands a shift to a substitute and cancels shifts', async () => {
    const original = (await shift('G1', 'night', addDays(W, 2)).expect(201)).body.data;
    const sub = (await api.post(`/api/roster/${original.id}/substitute`, { employee_id: ids.G3 }).expect(201)).body.data;
    expect(sub).toMatchObject({ employee_id: ids.G3, substitute_for_id: original.id, planned_start: original.planned_start });
    const week = (await api.get(`/api/roster?site_id=${ids.site}&from=${addDays(W, 2)}&to=${addDays(W, 2)}`).expect(200)).body.data;
    expect(week.find((a: { id: string }) => a.id === original.id).status).toBe('cancelled');
    await api.post(`/api/roster/${sub.id}/cancel`).expect(201);
  });

  it('takes one-off shifts with explicit times, up to 24 hours', async () => {
    const start = `${addDays(W, 3)}T01:00:00.000Z`;
    const ok = await api.post('/api/roster', { site_id: ids.site, employee_id: ids.G1, start_at: start, end_at: `${addDays(W, 3)}T05:00:00.000Z` }).expect(201);
    expect(ok.body.data.template_id).toBeNull();
    await api.post('/api/roster', { site_id: ids.site, employee_id: ids.G1, start_at: `${addDays(W, 4)}T00:00:00.000Z`, end_at: `${addDays(W, 5)}T01:00:00.000Z` }).expect(400);
  });
});
