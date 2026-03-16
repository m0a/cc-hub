import { Hono } from 'hono';
import { ShareTokenCreateSchema } from '../../../shared/types';
import {
  createShareToken,
  validateShareToken,
  listShareTokens,
  revokeShareToken,
} from '../services/share-token';
import { TmuxService } from '../services/tmux';

const tmuxService = new TmuxService();

// Detect Funnel external URL (re-checked each time since Funnel may be toggled)
async function getFunnelBaseUrl(): Promise<string | null> {
  try {
    const result = Bun.spawnSync(['tailscale', 'funnel', 'status', '--json']);
    if (result.exitCode !== 0) return null;
    const status = JSON.parse(result.stdout.toString());
    const allowFunnel = status.AllowFunnel as Record<string, boolean> | undefined;
    const web = status.Web as Record<string, { Handlers: Record<string, { Proxy?: string }> }> | undefined;
    if (!allowFunnel || !web) return null;

    // Find a funnel-enabled host:port that proxies to our backend
    const backendPort = process.env.CCHUB_PORT || '5923';
    for (const hostPort of Object.keys(allowFunnel)) {
      if (!allowFunnel[hostPort]) continue;
      const webEntry = web[hostPort];
      if (!webEntry?.Handlers) continue;
      for (const handler of Object.values(webEntry.Handlers)) {
        if (handler.Proxy && handler.Proxy.includes(`:${backendPort}`)) {
          return `https://${hostPort}`;
        }
      }
    }
  } catch {
    // Funnel not available
  }
  return null;
}

// Authenticated routes: /api/sessions/:id/share*
export const shareManage = new Hono();

// POST /api/sessions/:id/share - Create share token
shareManage.post('/:id/share', async (c) => {
  const sessionId = c.req.param('id');

  const exists = await tmuxService.sessionExists(sessionId);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  let expiresInHours = 24;
  try {
    const body = await c.req.json();
    const parsed = ShareTokenCreateSchema.parse(body);
    expiresInHours = parsed.expiresInHours;
  } catch {
    // Use default
  }

  try {
    const info = createShareToken(sessionId, sessionId, expiresInHours);
    const externalBaseUrl = await getFunnelBaseUrl();
    return c.json({ ...info, externalBaseUrl }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed to create token' }, 400);
  }
});

// GET /api/sessions/:id/shares - List tokens for session
shareManage.get('/:id/shares', async (c) => {
  const sessionId = c.req.param('id');
  const tokens = listShareTokens(sessionId);
  const externalBaseUrl = await getFunnelBaseUrl();
  return c.json({ tokens, externalBaseUrl });
});

// DELETE /api/sessions/:id/share/:token - Revoke token
shareManage.delete('/:id/share/:token', async (c) => {
  const sessionId = c.req.param('id');
  const token = c.req.param('token');
  const deleted = revokeShareToken(sessionId, token);
  if (!deleted) {
    return c.json({ error: 'Token not found' }, 404);
  }
  return c.json({ ok: true });
});

// Public route: /api/share/:token (no auth)
export const sharePublic = new Hono();

// GET /api/share/:token - Validate token and get session info
sharePublic.get('/:token', async (c) => {
  const token = c.req.param('token');
  const stored = validateShareToken(token);
  if (!stored) {
    return c.json({ error: 'Invalid or expired share token' }, 404);
  }

  return c.json({
    sessionId: stored.sessionId,
    sessionName: stored.sessionName,
    expiresAt: stored.expiresAt.toISOString(),
  });
});
