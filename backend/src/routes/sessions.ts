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

// GET /sessions - List all sessions (including external tmux sessions)
sessions.get('/', async (c) => {
  const [sessionList, externalSessions] = await Promise.all([
    listSessions(),
    tmuxService.listExternalSessions(),
  ]);

  // Merge and sort by lastAccessedAt (newest first)
  const allSessions = [
    ...sessionList,
    ...externalSessions.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      lastAccessedAt: s.createdAt,
      state: s.attached ? 'working' as const : 'idle' as const,
      isExternal: true,
    })),
  ].sort((a, b) =>
    new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
  );

  return c.json({ sessions: allSessions });
});

// POST /sessions - Create a new session
sessions.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateSessionSchema.safeParse(body);

  const name = parsed.success ? parsed.data.name : undefined;
  const session = await createSession(name);

  return c.json(session, 201);
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
