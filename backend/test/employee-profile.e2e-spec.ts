import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayLocal } from '../src/common/date';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n%%EOF');

describe('Employee profile (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof createTenantWithAdmin>>;
  let api: ReturnType<typeof client>;
  const today = todayLocal();
  beforeAll(async () => {
    ({ app } = await createTestApp());
    admin = await createTenantWithAdmin(app, 'emp2');
    api = client(app, admin.token);
  });
  afterAll(async () => app.close());

  const newEmployee = async (code: string) =>
    (await api.post('/api/employees', { code, full_name: `Bảo vệ ${code}` }).expect(201)).body.data;
  const upload = async (token: string) =>
    (await request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', PDF, 'cc.pdf').expect(201)).body.data;

  it('keeps the HR profile and shows certificates with days left', async () => {
    const e = await newEmployee('HR-1');
    await api
      .patch(`/api/employees/${e.id}`, {
        date_of_birth: '1980-05-01', national_id: '001080012345', address: 'Hà Nội', hire_date: '2024-01-15',
        emergency_contact: 'Vợ — 0912345678',
      })
      .expect(200);
    const file = await upload(admin.token);
    await api
      .post(`/api/employees/${e.id}/documents`, {
        kind: 'security_certificate', number: 'NV-123', issued_on: addDays(today, -300), expires_on: addDays(today, 20), file_id: file.id,
      })
      .expect(201);

    const profile = (await api.get(`/api/employees/${e.id}/profile`).expect(200)).body.data;
    expect(profile).toMatchObject({ national_id: '001080012345', hire_date: '2024-01-15' });
    expect(profile.documents).toHaveLength(1);
    expect(profile.documents[0]).toMatchObject({ kind: 'security_certificate', days_left: 20, file: { id: file.id } });
  });

  it("hides personal details from people who only see the employee's team", async () => {
    const team = (await api.post('/api/org/teams', { name: 'Đội HS' }).expect(201)).body.data;
    const lead = await newEmployee('HS-L');
    const e = await newEmployee('HS-1');
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: lead.id }).expect(201);
    await api.post(`/api/org/teams/${team.id}/members`, { employee_id: e.id }).expect(201);
    await api.put(`/api/org/teams/${team.id}/leader`, { employee_id: lead.id }).expect(200);
    await api.patch(`/api/employees/${e.id}`, { national_id: '001090099999', address: 'Bí mật' }).expect(200);
    const leader = await createUserWithRoles(app, admin.tenant.id, ['team_leader'], [], { user_type: 'guard', employee_id: lead.id });

    const seen = (await client(app, leader.token).get(`/api/employees/${e.id}/profile`).expect(200)).body.data;
    expect(seen.full_name).toBe('Bảo vệ HS-1');
    expect(seen.national_id).toBeNull();
    expect(seen.address).toBeNull();
  });

  it('refuses to attach a file that already belongs to another document', async () => {
    const a = await newEmployee('FD-1');
    const b = await newEmployee('FD-2');
    const file = await upload(admin.token);
    await api.post(`/api/employees/${a.id}/documents`, { kind: 'health_check', file_id: file.id }).expect(201);
    const res = await api.post(`/api/employees/${b.id}/documents`, { kind: 'health_check', file_id: file.id }).expect(409);
    expect(res.body.error.code).toBe('FILE_IN_USE');
  });

  it('lets the document file be downloaded by those who see the employee', async () => {
    const e = await newEmployee('DL-1');
    const file = await upload(admin.token);
    await api.post(`/api/employees/${e.id}/documents`, { kind: 'national_id', file_id: file.id }).expect(201);
    const hr = await createUserWithRoles(app, admin.tenant.id, ['hr']);
    await client(app, hr.token).get(`/api/files/${file.id}`).expect(200);
  });

  it("shows a guard their own papers, scan included, and nobody else's", async () => {
    const own = await newEmployee('ME-1');
    const other = await newEmployee('ME-2');
    const file = await upload(admin.token);
    const otherFile = await upload(admin.token);
    await api.post(`/api/employees/${own.id}/documents`, { kind: 'labor_contract', number: 'HĐ-07', file_id: file.id }).expect(201);
    await api.post(`/api/employees/${other.id}/documents`, { kind: 'labor_contract', number: 'HĐ-08', file_id: otherFile.id }).expect(201);
    const guard = await createUserWithRoles(app, admin.tenant.id, [], [], { user_type: 'guard', employee_id: own.id });
    const g = client(app, guard.token);

    const mine = (await g.get('/api/me/documents').expect(200)).body.data;
    expect(mine).toEqual([expect.objectContaining({ kind: 'labor_contract', number: 'HĐ-07', file: expect.objectContaining({ id: file.id }) })]);
    await g.get(`/api/files/${file.id}`).expect(200);
    await g.get(`/api/files/${otherFile.id}`).expect(404);
  });

  it('gives an account with no employee an empty list of papers', async () => {
    const hr = await createUserWithRoles(app, admin.tenant.id, ['hr']);
    expect((await client(app, hr.token).get('/api/me/documents').expect(200)).body.data).toEqual([]);
  });

  it('removes a document', async () => {
    const e = await newEmployee('RM-1');
    const doc = (await api.post(`/api/employees/${e.id}/documents`, { kind: 'other', note: 'x' }).expect(201)).body.data;
    await api.delete(`/api/employees/${e.id}/documents/${doc.id}`).expect(200);
    const profile = (await api.get(`/api/employees/${e.id}/profile`).expect(200)).body.data;
    expect(profile.documents).toEqual([]);
  });

  it('rejects an expiry date before the issue date', async () => {
    const e = await newEmployee('BAD-1');
    await api.post(`/api/employees/${e.id}/documents`, { kind: 'other', issued_on: today, expires_on: addDays(today, -1) }).expect(400);
  });
});
