import { createMiddleware } from 'hono/factory';
import type { Context, Next } from 'hono';
import { AuthService, type JwtPayload } from '../services/auth';
import { getDataDir } from '../utils/storage';

// Extend Hono context with auth info
declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
  }
}

const jwtSecret = process.env.JWT_SECRET || 'development-secret-change-in-production';

export const authMiddleware = createMiddleware(async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const authService = new AuthService(getDataDir(), jwtSecret);

  try {
    const payload = await authService.verifyToken(token);
    c.set('user', payload);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
});

export function getJwtSecret(): string {
  return jwtSecret;
}
