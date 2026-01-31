import { Hono } from 'hono';
import { z } from 'zod';
import { CreateSessionSchema, type IndicatorState } from '../../../shared/types';
import { TmuxService } from '../services/tmux';
import { ClaudeCodeService } from '../services/claude-code';
import { SessionHistoryService } from '../services/session-history';

const tmuxService = new TmuxService();
const claudeCodeService = new ClaudeCodeService();
const sessionHistoryService = new SessionHistoryService();

export const sessions = new Hono();

// Helper to determine indicator state
function getIndicatorState(
  isClaudeRunning: boolean,
  waitingForInput: boolean,
  waitingToolName?: string
): IndicatorState {
  if (!isClaudeRunning) {
    return 'completed'; // Not running Claude = shell prompt
  }

  if (waitingForInput) {
    return 'waiting_input';
  }

  // If Claude is running but not waiting, it's processing
  return 'processing';
}

const ResumeSessionSchema = z.object({
  ccSessionId: z.string().optional(),
});

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

    // Combine jsonl-based and terminal-based waiting detection
    // Either source detecting waiting = waiting for input
    const isClaudeRunning = s.currentCommand === 'claude';
    const waitingForInput = isClaudeRunning
      ? (ccSession?.waitingForInput || s.waitingForInput)
      : s.waitingForInput;

    // Calculate indicator state
    const indicatorState = getIndicatorState(
      isClaudeRunning,
      waitingForInput || false,
      ccSession?.waitingToolName
    );

    return {
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      lastAccessedAt: s.createdAt,
      state: s.attached ? 'working' as const : 'idle' as const,
      currentCommand: s.currentCommand,
      currentPath: s.currentPath,
      paneTitle: s.paneTitle,
      waitingForInput,
      waitingToolName: ccSession?.waitingToolName,
      // Use Claude Code summary instead of terminal preview
      ccSummary: ccSession?.summary,
      ccFirstPrompt: ccSession?.firstPrompt,
      // New fields for dashboard
      indicatorState,
      ccSessionId: ccSession?.sessionId,
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

// GET /sessions/history - Get past Claude Code session history
// NOTE: This must be defined BEFORE /:id to prevent "history" being interpreted as an id
sessions.get('/history', async (c) => {
  const includeMetadata = c.req.query('metadata') === 'true';
  const history = await sessionHistoryService.getRecentSessions(30, includeMetadata);
  return c.json({ sessions: history });
});

// GET /sessions/history/:sessionId/conversation - Get conversation history for a session
sessions.get('/history/:sessionId/conversation', async (c) => {
  const sessionId = c.req.param('sessionId');
  const messages = await sessionHistoryService.getConversation(sessionId);
  return c.json({ messages });
});

// POST /sessions/history/metadata - Lazy load metadata for specific sessions
const MetadataRequestSchema = z.object({
  sessionIds: z.array(z.string()),
});

sessions.post('/history/metadata', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = MetadataRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request: sessionIds array required' }, 400);
  }

  const { sessionIds } = parsed.data;
  const metadata = await sessionHistoryService.getSessionsMetadata(sessionIds);
  return c.json({ metadata });
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

// GET /sessions/:id/copy-mode - Check if session is in copy mode
sessions.get('/:id/copy-mode', async (c) => {
  const id = c.req.param('id');

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const inCopyMode = await tmuxService.isInCopyMode(id);
  return c.json({ inCopyMode });
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

// POST /sessions/:id/resume - Resume a Claude Code session
sessions.post('/:id/resume', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResumeSessionSchema.safeParse(body);

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    // Build the claude resume command
    const ccSessionId = parsed.success ? parsed.data.ccSessionId : undefined;
    const command = ccSessionId ? `claude -r ${ccSessionId}` : 'claude -r';

    // Send the command to the tmux session
    const success = await tmuxService.sendKeys(id, command);
    if (!success) {
      return c.json({ error: 'Failed to send command' }, 500);
    }

    return c.json({ success: true, command });
  } catch (error) {
    return c.json({ error: 'Failed to resume session' }, 500);
  }
});

const ResumeHistorySchema = z.object({
  sessionId: z.string(),
  projectPath: z.string(),
});

// POST /sessions/history/resume - Resume a session from history (creates new tmux session)
sessions.post('/history/resume', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResumeHistorySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request: sessionId and projectPath required' }, 400);
  }

  const { sessionId, projectPath } = parsed.data;

  try {
    // Generate a unique tmux session name based on project
    const projectName = projectPath.split('/').pop() || 'session';
    const tmuxSessions = await tmuxService.listSessions();
    let tmuxSessionName = projectName;
    let counter = 1;
    while (tmuxSessions.some(s => s.name === tmuxSessionName)) {
      tmuxSessionName = `${projectName}-${counter++}`;
    }

    // Create new tmux session
    await tmuxService.createSession(tmuxSessionName);

    // Change to project directory and run claude -r
    const command = `cd ${projectPath} && claude -r ${sessionId}`;
    const success = await tmuxService.sendKeys(tmuxSessionName, command);

    if (!success) {
      // Clean up the session if command failed
      await tmuxService.killSession(tmuxSessionName);
      return c.json({ error: 'Failed to start Claude session' }, 500);
    }

    return c.json({
      success: true,
      tmuxSessionId: tmuxSessionName,
      ccSessionId: sessionId,
    });
  } catch (error) {
    return c.json({ error: 'Failed to resume session from history' }, 500);
  }
});
