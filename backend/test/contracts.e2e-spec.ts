import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

describe('Contracts (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  let seq = 0;
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'ctr');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newClient = async () => {
    seq += 1;
    return (await api.post('/api/clients', { code: `K${seq}`, name: `Khách ${seq}` }).expect(201)).body.data;
  };
  const newContract = async (overrides: object = {}) => {
    const c = await newClient();
    seq += 1;
    return (
      await api
        .post('/api/contracts', {
          client_id: c.id, contract_no: `HD-${seq}`, start_date: addDays(today, -60), end_date: addDays(today, 300),
          lines: [{ position: 'guard', headcount: 3, unit: 'per_guard_month', unit_price: 8500000 }],
          ...overrides,
        })
        .expect(201)
    ).body.data;
  };

  it('creates a draft with its first price line and signs it', async () => {
    const k = await newContract();
    expect(k).toMatchObject({ state: 'draft', status: 'draft' });
    expect(k.lines).toEqual([
      expect.objectContaining({ position: 'guard', headcount: 3, unit_price: '8500000', effective_from: addDays(today, -60), effective_to: null }),
    ]);
    const signed = await api.patch(`/api/contracts/${k.id}`, { state: 'signed', signed_at: addDays(today, -61) }).expect(200);
    expect(signed.body.data).toMatchObject({ state: 'signed', status: 'active', days_left: 300 });
  });

  it('changes a price mid-term without overlap or gap, and corrects a same-day change in place', async () => {
    const k = await newContract();
    await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: today, headcount: 4, unit: 'per_guard_month', unit_price: 9000000 }).expect(201);
    const after = (await api.get(`/api/contracts/${k.id}`).expect(200)).body.data.lines;
    expect(after.map((l: { unit_price: string; effective_from: string; effective_to: string | null }) => [l.unit_price, l.effective_from, l.effective_to])).toEqual([
      ['8500000', addDays(today, -60), addDays(today, -1)],
      ['9000000', today, null],
    ]);

    await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: today, headcount: 4, unit: 'per_guard_month', unit_price: 9200000 }).expect(201);
    const corrected = (await api.get(`/api/contracts/${k.id}`).expect(200)).body.data.lines;
    expect(corrected).toHaveLength(2);
    expect(corrected[1].unit_price).toBe('9200000');
  });

  it('refuses a price change that would rewrite a later price, or fall outside the contract', async () => {
    const k = await newContract();
    await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: today, headcount: 3, unit: 'per_guard_month', unit_price: 9000000 }).expect(201);
    const back = await api.post(`/api/contracts/${k.id}/prices`, { position: 'guard', effective_from: addDays(today, -10), headcount: 3, unit: 'per_guard_month', unit_price: 1 }).expect(409);
    expect(back.body.error.code).toBe('CONTRACT_LINE_OVERLAP');
    const outside = await api.post(`/api/contracts/${k.id}/prices`, { position: 'team_leader', effective_from: addDays(today, 400), headcount: 1, unit: 'per_guard_month', unit_price: 1 }).expect(400);
    expect(outside.body.error.code).toBe('CONTRACT_LINE_OUTSIDE');
  });

  it('adds a new position and ends one', async () => {
    const k = await newContract();
    await api.post(`/api/contracts/${k.id}/prices`, { position: 'team_leader', effective_from: today, headcount: 1, unit: 'per_shift', unit_price: 450000, shift_hours: 12 }).expect(201);
    await api.post(`/api/contracts/${k.id}/prices/team_leader/end`, { last_day: addDays(today, 30) }).expect(200);
    const lines = (await api.get(`/api/contracts/${k.id}`).expect(200)).body.data.lines;
    expect(lines.find((l: { position: string }) => l.position === 'team_leader')).toMatchObject({ effective_to: addDays(today, 30), shift_hours: '12.0' });
  });

  it('marks contracts inside the notice period as expiring, and lists them', async () => {
    const soon = await newContract({ start_date: addDays(today, -300), end_date: addDays(today, 10) });
    await api.patch(`/api/contracts/${soon.id}`, { state: 'signed' }).expect(200);
    const list = (await api.get('/api/contracts?status=expiring').expect(200)).body.data;
    expect(list.map((k: { id: string }) => k.id)).toContain(soon.id);
    expect(list.find((k: { id: string }) => k.id === soon.id)).toMatchObject({ status: 'expiring', days_left: 10 });
  });

  it('validates dates and keeps price lines inside the term when the term changes', async () => {
    const c = await newClient();
    const bad = await api.post('/api/contracts', { client_id: c.id, contract_no: 'BAD', start_date: today, end_date: addDays(today, -1), lines: [] }).expect(400);
    expect(bad.body.error.code).toBe('CONTRACT_DATES_INVALID');
    const k = await newContract();
    const shrink = await api.patch(`/api/contracts/${k.id}`, { start_date: addDays(today, -30) }).expect(400);
    expect(shrink.body.error.code).toBe('CONTRACT_LINE_OUTSIDE');
    await api.patch(`/api/contracts/${k.id}`, { end_date: addDays(today, 500) }).expect(200);
  });

  it('terminates a contract and then refuses edits', async () => {
    const k = await newContract();
    await api.patch(`/api/contracts/${k.id}`, { state: 'signed' }).expect(200);
    const res = await api.post(`/api/contracts/${k.id}/terminate`, { terminated_on: today }).expect(200);
    expect(res.body.data).toMatchObject({ state: 'terminated', status: 'terminated', terminated_on: today });
    expect((await api.patch(`/api/contracts/${k.id}`, { note: 'x' }).expect(409)).body.error.code).toBe('CONTRACT_NOT_EDITABLE');
  });

  it('attaches the signed scan and lets contract viewers download it', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const file = (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${admin.token}`).attach('file', pdf, 'hd.pdf').expect(201)).body.data;
    const k = await newContract({ file_id: file.id });
    expect(k.file).toMatchObject({ id: file.id, original_name: 'hd.pdf' });
    const accountant = await createUserWithRoles(app, admin.tenant.id, ['accountant']);
    await client(app, accountant.token).get(`/api/files/${file.id}`).expect(200);
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).get(`/api/files/${file.id}`).expect(404);
  });

  it('keeps prices from people without contract.view', async () => {
    const k = await newContract();
    const manager = await createUserWithRoles(app, admin.tenant.id, ['manager']);
    await client(app, manager.token).get(`/api/contracts/${k.id}`).expect(403);
  });

  it('refuses a duplicate contract number', async () => {
    const k = await newContract();
    const c = await newClient();
    const res = await api.post('/api/contracts', { client_id: c.id, contract_no: k.contract_no.toLowerCase(), start_date: today, end_date: today, lines: [] }).expect(409);
    expect(res.body.error.code).toBe('CONTRACT_NO_TAKEN');
  });
});
