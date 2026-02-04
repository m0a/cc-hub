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

// Check if password auth is enabled
export function isAuthRequired(): boolean {
  return !!process.env.CCHUB_PASSWORD;
}

// Get the server password
export function getServerPassword(): string | undefined {
  return process.env.CCHUB_PASSWORD;
}

// Middleware that requires auth only if CCHUB_PASSWORD is set
export const conditionalAuthMiddleware = createMiddleware(async (c: Context, next: Next) => {
  // If no password is configured, allow all requests
  if (!isAuthRequired()) {
    await next();
    return;
  }

  // Password is set, require authentication
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
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

// Always require auth (for logout, me endpoints)
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
