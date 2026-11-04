import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { client, createTenantWithAdmin, createTestApp, createUserWithRoles, server } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');

describe('Files (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(async () => app.close());

  const upload = (token: string, content: Buffer, filename: string) =>
    request(server(app)).post('/api/files').set('Authorization', `Bearer ${token}`).attach('file', content, filename);

  it('stores a real PDF and hands it back only to its uploader while unattached', async () => {
    const t = await createTenantWithAdmin(app, 'file-a');
    const res = await upload(t.token, PDF, 'hop-dong.pdf').expect(201);
    expect(res.body.data).toMatchObject({ original_name: 'hop-dong.pdf', mime: 'application/pdf', size: PDF.length });

    const back = await client(app, t.token).get(`/api/files/${res.body.data.id}`).expect(200);
    expect(back.headers['content-type']).toBe('application/pdf');
    expect(back.headers['content-disposition']).toContain('attachment');
    expect(Buffer.from(back.body).equals(PDF)).toBe(true);

    const colleague = await createUserWithRoles(app, t.tenant.id, ['accountant']);
    await client(app, colleague.token).get(`/api/files/${res.body.data.id}`).expect(404);
    const other = await createTenantWithAdmin(app, 'file-b');
    await client(app, other.token).get(`/api/files/${res.body.data.id}`).expect(404);
  });

  it('judges a file by its content, not its name', async () => {
    const t = await createTenantWithAdmin(app, 'file-fake');
    const res = await upload(t.token, Buffer.from('<html><script>x</script></html>'), 'hop-dong.pdf').expect(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('refuses files over 10 MB', async () => {
    const t = await createTenantWithAdmin(app, 'file-big');
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    const res = await upload(t.token, big, 'big.pdf').expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});
