import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles } from './helpers';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Incidents — who can be assigned (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ias');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'AK', name: 'Khách' }).expect(201)).body.data.id;
    ids.team = (await api.post('/api/org/teams', { name: 'Đội' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'AS', name: 'Toà', responsible_team_id: ids.team }).expect(201)).body.data.id;
    ids.site2 = (await api.post('/api/sites', { client_id: ids.client, code: 'AS2', name: 'Kho' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  async function person(name: string, opts: { team?: boolean; shiftAt?: string; start?: number; end?: number; account?: boolean }) {
    seq += 1;
    const e = (await api.post('/api/employees', { code: `AG${seq}`, full_name: name }).expect(201)).body.data.id;
    if (opts.team) await api.post(`/api/org/teams/${ids.team}/members`, { employee_id: e }).expect(201);
    await api.post('/api/deployments', { employee_id: e, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    if (opts.shiftAt) await api.post('/api/roster', { site_id: opts.shiftAt, employee_id: e, start_at: minutes(opts.start ?? -60), end_at: minutes(opts.end ?? 300) }).expect(201);
    if (opts.account === false) return { employee: e, user: null };
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: e });
    return { employee: e, user: u.user.id as string };
  }

  it('offers the guards on shift there first, then the team that runs the site', async () => {
    const onShift = await person('Đang trực', { shiftAt: ids.site });
    const teammate = await person('Cùng đội', { team: true });
    const later = await person('Ca chiều', { shiftAt: ids.site, start: 300, end: 600 });
    const elsewhere = await person('Mục tiêu khác', { shiftAt: ids.site2 });
    const noAccount = await person('Chưa có tài khoản', { team: true, account: false });
    const category = (await api.get('/api/incident-categories').expect(200)).body.data[0].id;
    const i = (await api.post('/api/incidents', { site_id: ids.site, category_id: category, description: 'x', source: 'staff' }).expect(201)).body.data;
    const list = (await api.get(`/api/incidents/${i.id}/assignees`).expect(200)).body.data as { user_id: string; full_name: string; on_shift: boolean }[];
    expect(list[0]).toMatchObject({ user_id: onShift.user, full_name: 'Đang trực', on_shift: true });
    const users = list.map((x) => x.user_id);
    expect(users).toEqual(expect.arrayContaining([teammate.user, later.user]));
    expect(users).not.toContain(elsewhere.user);
    expect(list.map((x) => x.full_name)).not.toContain(noAccount && 'Chưa có tài khoản');
    const guard = client(app, (await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard' })).token);
    await guard.get(`/api/incidents/${i.id}/assignees`).expect(403);
  });
});
