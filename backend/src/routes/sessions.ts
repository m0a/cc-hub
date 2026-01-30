import { Hono } from 'hono';
import { CreateSessionSchema } from '../../../shared/types';
import {
  listSessions,
  getSession,
  createSession,
  deleteSession,
} from '../services/sessions';
import { TmuxService } from '../services/tmux';

const tmuxService = new TmuxService('cchub-');

export const sessions = new Hono();

// GET /sessions - List all sessions
sessions.get('/', async (c) => {
  const sessionList = await listSessions();
  return c.json({ sessions: sessionList });
});

// POST /sessions - Create a new session
sessions.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateSessionSchema.safeParse(body);

  const name = parsed.success ? parsed.data.name : undefined;
  const session = await createSession(name);

  return c.json(session, 201);
});

// GET /sessions/external - List external tmux sessions (non-cchub)
// NOTE: Must be before /:id route
sessions.get('/external', async (c) => {
  const externalSessions = await tmuxService.listExternalSessions();
  return c.json({
    sessions: externalSessions.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      lastAccessedAt: s.createdAt,
      state: s.attached ? 'working' : 'idle',
      isExternal: true,
    })),
  });
});

// GET /sessions/:id - Get a specific session
sessions.get('/:id', async (c) => {
  const id = c.req.param('id');
  const session = await getSession(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json(session);
});

// DELETE /sessions/:id - Delete a session
sessions.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const success = await deleteSession(id);

  if (!success) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({ success: true });
});
