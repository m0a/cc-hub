import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { LoginSchema, RegisterSchema } from 'shared';
import { AuthService } from '../services/auth';
import { getDataDir } from '../utils/storage';
import { getJwtSecret, authMiddleware } from '../middleware/auth';

const auth = new Hono();

auth.post(
  '/login',
  zValidator('json', LoginSchema),
  async (c) => {
    const { username, password } = c.req.valid('json');
    const authService = new AuthService(getDataDir(), getJwtSecret());

    try {
      const result = await authService.login(username, password);
      return c.json(result);
    } catch (error) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
  }
);

auth.post(
  '/register',
  zValidator('json', RegisterSchema),
  async (c) => {
    const { username, password } = c.req.valid('json');
    const authService = new AuthService(getDataDir(), getJwtSecret());

    try {
      const result = await authService.register(username, password);
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof Error && error.message === 'Username already exists') {
        return c.json({ error: 'Username already exists' }, 409);
      }
      return c.json({ error: 'Registration failed' }, 500);
    }
  }
);

auth.post('/logout', authMiddleware, async (c) => {
  // Stateless JWT - client should discard the token
  return c.json({ success: true });
});

auth.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ user: { id: user.userId, username: user.username } });
});

export { auth };
