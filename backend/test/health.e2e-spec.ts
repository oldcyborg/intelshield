import request from 'supertest';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp, server } from './helpers';

describe('App shell (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(async () => app.close());

  it('wraps success in { data }', async () => {
    const res = await request(server(app)).get('/api/health').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('answers unknown routes with the error envelope', async () => {
    const res = await request(server(app)).get('/api/khong-co').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu' } });
  });
});
