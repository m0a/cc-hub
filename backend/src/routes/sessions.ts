import { Hono } from 'hono';
import { CreateSessionSchema } from '../../../shared/types';
import { TmuxService } from '../services/tmux';
import { ClaudeCodeService } from '../services/claude-code';

const tmuxService = new TmuxService();
const claudeCodeService = new ClaudeCodeService();

export const sessions = new Hono();

// GET /sessions - List all tmux sessions
sessions.get('/', async (c) => {
  const tmuxSessions = await tmuxService.listSessions();

  // Get Claude Code session info for sessions running claude
  const claudePaths = tmuxSessions
    .filter(s => s.currentCommand === 'claude' && s.currentPath)
    .map(s => s.currentPath!);

  const ccSessions = await claudeCodeService.getSessionsForPaths(claudePaths);

  const sessions = tmuxSessions.map((s) => {
    const ccSession = s.currentPath ? ccSessions.get(s.currentPath) : undefined;

    return {
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      lastAccessedAt: s.createdAt,
      state: s.attached ? 'working' as const : 'idle' as const,
      currentCommand: s.currentCommand,
      currentPath: s.currentPath,
      paneTitle: s.paneTitle,
      waitingForInput: s.waitingForInput,
      // Use Claude Code summary instead of terminal preview
      ccSummary: ccSession?.summary,
      ccFirstPrompt: ccSession?.firstPrompt,
    };
  });

  return c.json({ sessions });
});

// POST /sessions - Create a new tmux session
sessions.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateSessionSchema.safeParse(body);

  // Generate session name
  const tmuxSessions = await tmuxService.listSessions();
  const name = parsed.success && parsed.data.name
    ? parsed.data.name
    : `session-${tmuxSessions.length + 1}`;

  // Check if session already exists
  const exists = await tmuxService.sessionExists(name);
  if (exists) {
    return c.json({ error: 'Session already exists' }, 400);
  }

  try {
    await tmuxService.createSession(name);

    return c.json({
      id: name,
      name: name,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      state: 'idle',
    }, 201);
  } catch (error) {
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// GET /sessions/:id - Get a specific session
sessions.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tmuxSessions = await tmuxService.listSessions();
  const session = tmuxSessions.find(s => s.id === id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    lastAccessedAt: session.createdAt,
    state: session.attached ? 'working' : 'idle',
    currentCommand: session.currentCommand,
    currentPath: session.currentPath,
  });
});

// DELETE /sessions/:id - Delete (kill) a tmux session
sessions.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    await tmuxService.killSession(id);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});
