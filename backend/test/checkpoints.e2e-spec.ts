import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { client, createTenantWithAdmin, createTestApp } from './helpers';

describe('Checkpoints and QR (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let api: ReturnType<typeof client>;
  let siteId: string;
  let seq = 0;
  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    const admin = await createTenantWithAdmin(app, 'cp');
    api = client(app, admin.token);
    const c = (await api.post('/api/clients', { code: 'CPK', name: 'Khách CP' }).expect(201)).body.data;
    siteId = (await api.post('/api/sites', { client_id: c.id, code: 'CPS', name: 'Toà CP' }).expect(201)).body.data.id;
  });
  afterAll(async () => app.close());

  const newCheckpoint = async (extra: object = {}) =>
    (await api.post(`/api/sites/${siteId}/checkpoints`, { code: `P${++seq}`, name: `Điểm ${seq}`, ...extra }).expect(201)).body.data;

  it('creates QR checkpoints by default and never exposes the secret', async () => {
    const cp = await newCheckpoint();
    expect(cp).toMatchObject({ allowed_methods: ['qr'], radius_m: 30, photo_rule: 'never', status: 'active' });
    expect(cp).not.toHaveProperty('qr_secret');
    const list = (await api.get(`/api/sites/${siteId}/checkpoints`).expect(200)).body.data;
    expect(JSON.stringify(list)).not.toContain('qr_secret');
  });

  it('requires a location for GPS checkpoints, also when edited later', async () => {
    const bad = await api.post(`/api/sites/${siteId}/checkpoints`, { code: `G${++seq}`, name: 'GPS', allowed_methods: ['gps'] }).expect(400);
    expect(bad.body.error.code).toBe('CHECKPOINT_GPS_NEEDS_LOCATION');
    const gps = await newCheckpoint({ allowed_methods: ['gps', 'photo'], lat: 21.03, lng: 105.85, radius_m: 25 });
    expect(gps.lat).toBe('21.030000');
    await api.patch(`/api/checkpoints/${gps.id}`, { lat: null, lng: null }).expect(400);
    const qrOnly = await newCheckpoint();
    await api.patch(`/api/checkpoints/${qrOnly.id}`, { allowed_methods: ['gps'] }).expect(400);
  });

  it('prints signed tags that resolve to their checkpoint, until the tag is re-printed', async () => {
    const cp = await newCheckpoint({ name: 'Cầu thang bộ tầng 1' });
    const sheet = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data;
    expect(sheet.site).toMatchObject({ id: siteId, name: 'Toà CP', client_name: 'Khách CP' });
    const tag = sheet.tags.find((t: { id: string }) => t.id === cp.id);
    expect(tag.payload).toMatch(/^PTR1\./);

    const resolved = (await api.post('/api/checkpoints/resolve-qr', { payload: tag.payload }).expect(201)).body.data;
    expect(resolved).toMatchObject({ id: cp.id, name: 'Cầu thang bộ tầng 1', site_name: 'Toà CP' });

    await api.post(`/api/checkpoints/${cp.id}/rotate-qr`).expect(201);
    expect((await api.post('/api/checkpoints/resolve-qr', { payload: tag.payload }).expect(400)).body.error.code).toBe('QR_INVALID');
    const fresh = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data.tags.find((t: { id: string }) => t.id === cp.id);
    await api.post('/api/checkpoints/resolve-qr', { payload: fresh.payload }).expect(201);
  });

  it('leaves inactive checkpoints off the sheet and refuses their tags', async () => {
    const cp = await newCheckpoint();
    const tag = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data.tags.find((t: { id: string }) => t.id === cp.id);
    await api.patch(`/api/checkpoints/${cp.id}`, { status: 'inactive' }).expect(200);
    const sheet = (await api.get(`/api/sites/${siteId}/qr-sheet`).expect(200)).body.data;
    expect(sheet.tags.map((t: { id: string }) => t.id)).not.toContain(cp.id);
    await api.post('/api/checkpoints/resolve-qr', { payload: tag.payload }).expect(400);
  });

  it("rejects another company's tag and a forged one", async () => {
    const other = await createTenantWithAdmin(app, 'cp-other');
    const apiB = client(app, other.token);
    const cB = (await apiB.post('/api/clients', { code: 'BK', name: 'B' }).expect(201)).body.data;
    const sB = (await apiB.post('/api/sites', { client_id: cB.id, code: 'BS', name: 'B' }).expect(201)).body.data;
    const cpB = (await apiB.post(`/api/sites/${sB.id}/checkpoints`, { code: 'BP', name: 'B' }).expect(201)).body.data;
    const tagB = (await apiB.get(`/api/sites/${sB.id}/qr-sheet`).expect(200)).body.data.tags[0].payload;
    expect(cpB.id).toBeTruthy();
    await api.post('/api/checkpoints/resolve-qr', { payload: tagB }).expect(400);

    const cp = await newCheckpoint();
    const [row] = await ds.query(`SELECT id FROM checkpoints WHERE id = $1`, [cp.id]);
    await api.post('/api/checkpoints/resolve-qr', { payload: `PTR1.${row.id}.AAAAAAAAAAAAAAAAAAAAAA` }).expect(400);
  });

  it('refuses a duplicate code within the site', async () => {
    await newCheckpoint({ code: 'DUP-1' });
    const res = await api.post(`/api/sites/${siteId}/checkpoints`, { code: 'dup-1', name: 'X' }).expect(409);
    expect(res.body.error.code).toBe('CHECKPOINT_CODE_TAKEN');
  });
});
