import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { LoginSchema, RegisterSchema } from 'shared';
import { AuthService } from '../../src/services/auth';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DATA_DIR = join(import.meta.dir, '.test-data');
const JWT_SECRET = 'test-secret';

function createTestApp() {
  const app = new Hono();
  const authService = new AuthService(TEST_DATA_DIR, JWT_SECRET);

  app.post('/api/auth/register', zValidator('json', RegisterSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    try {
      const result = await authService.register(username, password);
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof Error && error.message === 'Username already exists') {
        return c.json({ error: 'Username already exists' }, 409);
      }
      return c.json({ error: 'Registration failed' }, 500);
    }
  });

  app.post('/api/auth/login', zValidator('json', LoginSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    try {
      const result = await authService.login(username, password);
      return c.json(result);
    } catch {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
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

  describe('POST /api/auth/register', () => {
    test('should register a new user', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'password123' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.user.username).toBe('testuser');
    });

    test('should reject duplicate username', async () => {
      await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'password123' }),
      });

      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'different123' }),
      });

      expect(res.status).toBe(409);
    });

    test('should reject short password', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'short' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'password123' }),
      });
    });

    test('should login with correct credentials', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'password123' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.user.username).toBe('testuser');
    });

    test('should reject incorrect password', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'wrongpassword' }),
      });

      expect(res.status).toBe(401);
    });

    test('should reject non-existent user', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'password123' }),
      });

      expect(res.status).toBe(401);
    });
  });
});
