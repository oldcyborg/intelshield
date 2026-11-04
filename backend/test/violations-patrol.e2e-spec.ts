import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { addDays, todayLocal } from '../src/common/date';
import { RoundsScheduler } from '../src/patrol/rounds.scheduler';
import { ViolationsEngine } from '../src/violations/engine.service';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, loginOnDevice } from './helpers';

const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();

describe('Violations — patrol rules (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  let engine: ViolationsEngine;
  let scheduler: RoundsScheduler;
  const ids: Record<string, string> = {};
  const tags: Record<string, string> = {};
  let g: { employee: string; api: ReturnType<typeof client> };
  let late: { employee: string };
  let seq = 0;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    engine = app.get(ViolationsEngine);
    scheduler = app.get(RoundsScheduler);
    admin = await createTenantWithAdmin(app, 'vpt');
    api = client(app, admin.token);
    ids.client = (await api.post('/api/clients', { code: 'PK', name: 'Khách' }).expect(201)).body.data.id;
    ids.site = (await api.post('/api/sites', { client_id: ids.client, code: 'PS', name: 'Toà' }).expect(201)).body.data.id;
    ids.A = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'A', name: 'Cổng' }).expect(201)).body.data.id;
    ids.B = (await api.post(`/api/sites/${ids.site}/checkpoints`, { code: 'B', name: 'Kho' }).expect(201)).body.data.id;
    ids.route = (await api.post(`/api/sites/${ids.site}/routes`, { name: 'Vòng', checkpoints: [{ checkpoint_id: ids.A }, { checkpoint_id: ids.B }] }).expect(201)).body.data.id;
    for (const t of (await api.get(`/api/sites/${ids.site}/qr-sheet`).expect(200)).body.data.tags) tags[t.id] = t.payload;
    g = await person(-5 * HOUR, HOUR);
    late = await person(-30 * 60_000, HOUR);
  });
  afterAll(async () => app.close());

  async function person(startMs: number, endMs: number) {
    seq += 1;
    const employee = (await api.post('/api/employees', { code: `PG${seq}`, full_name: `PG${seq}` }).expect(201)).body.data.id;
    await api.post('/api/deployments', { employee_id: employee, client_id: ids.client, start_date: addDays(todayLocal(), -3) }).expect(201);
    await api.post('/api/roster', { site_id: ids.site, employee_id: employee, start_at: at(Date.now() + startMs), end_at: at(Date.now() + endMs) }).expect(201);
    const u = await createUserWithRoles(app, admin.tenant.id, ['guard'], [], { user_type: 'guard', employee_id: employee });
    return { employee, api: client(app, (await loginOnDevice(app, u.phone, u.password, `vpt-${seq}`)).token!) };
  }
  async function schedule() {
    seq += 1;
    return (await api.post(`/api/sites/${ids.site}/patrol-schedules`, { route_id: ids.route, name: `L${seq}`, start_time: '00:00', end_time: '00:00', interval_minutes: 60 }).expect(201)).body.data.id;
  }
  const scan = (round: string, body: object) =>
    g.api.post(`/api/patrol/rounds/${round}/scans`, { client_uuid: randomUUID(), device_time: new Date().toISOString(), method: 'qr', ...body });
  const of = (ref: string) => ds.query(`SELECT employee_id, type, status, detail, review_note FROM violations WHERE ref_id = $1 ORDER BY type`, [ref]);

  it('charges a missed round to whoever was on shift across it, nobody else', async () => {
    const s = await schedule();
    await scheduler.generate(new Date(Date.now() - 4 * HOUR));
    const [r] = await ds.query(`SELECT id FROM patrol_rounds WHERE schedule_id = $1 AND expected_end < now() - interval '2 hours' ORDER BY expected_start LIMIT 1`, [s]);
    await scheduler.markMissed(new Date());
    await engine.tick();
    const v = await of(r.id);
    expect(v.map((x: { employee_id: string; type: string }) => `${x.employee_id === g.employee}:${x.type}`)).toEqual(['true:missed_round']);
    ids.missed = r.id;
  });

  it('lists the missing checkpoints of a round closed short', async () => {
    const s = await schedule();
    await scheduler.generate(new Date());
    const [r] = await ds.query(`SELECT id, expected_end FROM patrol_rounds WHERE schedule_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [s]);
    await scan(r.id, { qr_payload: tags[ids.A] }).expect(201);
    await scheduler.closeOverdue(new Date(r.expected_end.getTime() + 16 * 60_000));
    await engine.tick();
    const [v] = await of(r.id);
    expect(v).toMatchObject({ type: 'missed_checkpoint', status: 'auto', detail: { missing: [{ code: 'B', name: 'Kho' }] } });
  });

  it('records each suspicious scan for the leader to look at', async () => {
    const s = await schedule();
    await scheduler.generate(new Date());
    const [r] = await ds.query(`SELECT id FROM patrol_rounds WHERE schedule_id = $1 AND expected_start - interval '10 minutes' <= now() AND expected_end > now() + interval '2 minutes' ORDER BY expected_start LIMIT 1`, [s]);
    await scan(r.id, { qr_payload: tags[ids.A], mock_location: true }).expect(201);
    await engine.tick();
    const [sc] = await ds.query(`SELECT id FROM patrol_scans WHERE round_id = $1`, [r.id]);
    const [v] = await of(sc.id);
    expect(v).toMatchObject({ type: 'suspicious_scan', detail: { checkpoint_code: 'A', round_id: r.id, flags: ['mock_location'] } });
  });

  it('forgives a missed round once it is reported in full, while the late report stays suspicious', async () => {
    const [r] = await ds.query(`SELECT expected_start FROM patrol_rounds WHERE id = $1`, [ids.missed]);
    const when = at(r.expected_start.getTime() + 5 * 60_000);
    await scan(ids.missed, { qr_payload: tags[ids.A], device_time: when, captured_offline: true }).expect(201);
    await scan(ids.missed, { qr_payload: tags[ids.B], device_time: when, captured_offline: true }).expect(201);
    await engine.tick();
    const [v] = await of(ids.missed);
    expect(v).toMatchObject({ type: 'missed_round', status: 'waived', review_note: 'Hệ thống: vòng đã được báo bù' });
    const scans = await ds.query(`SELECT id FROM patrol_scans WHERE round_id = $1`, [ids.missed]);
    const flagged = await ds.query(`SELECT detail FROM violations WHERE type = 'suspicious_scan' AND ref_id = ANY($1::uuid[])`, [scans.map((x: { id: string }) => x.id)]);
    expect(flagged).toHaveLength(2);
    expect(flagged[0].detail.flags).toContain('backdated');
    expect(late.employee).toBeTruthy();
  });
});
