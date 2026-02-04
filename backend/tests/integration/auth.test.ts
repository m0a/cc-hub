import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { LoginSchema } from 'shared';
import { AuthService } from '../../src/services/auth';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DATA_DIR = join(import.meta.dir, '.test-data');
const JWT_SECRET = 'test-secret';
const SERVER_PASSWORD = 'testpass123';

function createTestApp() {
  const app = new Hono();
  const authService = new AuthService(TEST_DATA_DIR, JWT_SECRET);

  // Check if auth is required
  app.get('/api/auth/required', (c) => {
    return c.json({ required: !!SERVER_PASSWORD });
  });

  // Login with server password
  app.post('/api/auth/login', zValidator('json', LoginSchema), async (c) => {
    const { password } = c.req.valid('json');

    if (password !== SERVER_PASSWORD) {
      return c.json({ error: 'Invalid password' }, 401);
    }

    const token = await authService.generateTokenForUser('user');
    return c.json({ token });
  });

  return app;
}

describe('Auth Routes Integration', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    await mkdir(TEST_DATA_DIR, { recursive: true });
    app = createTestApp();
  });

  afterEach(async () => {
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('GET /api/auth/required', () => {
    test('should return required: true when password is set', async () => {
      const res = await app.request('/api/auth/required');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.required).toBe(true);
    });
  });

  describe('POST /api/auth/login', () => {
    test('should login with correct password', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: SERVER_PASSWORD }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
    });

    test('should reject incorrect password', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrongpassword' }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid password');
    });

    test('should reject empty password', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      });

      expect(res.status).toBe(400);
    });
  });
});
