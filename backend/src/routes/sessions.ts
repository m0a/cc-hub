import { Hono } from 'hono';
import { z } from 'zod';
import { CreateSessionSchema, type IndicatorState } from '../../../shared/types';
import { TmuxService } from '../services/tmux';
import { ClaudeCodeService } from '../services/claude-code';
import { SessionHistoryService } from '../services/session-history';
import { PromptHistoryService } from '../services/prompt-history';

const tmuxService = new TmuxService();
const claudeCodeService = new ClaudeCodeService();
const sessionHistoryService = new SessionHistoryService();
const promptHistoryService = new PromptHistoryService();

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

  // Get Claude Code session IDs from PTY for each tmux session running claude
  const sessionIdByTmuxId = new Map<string, string>();
  await Promise.all(
    tmuxSessions
      .filter(s => s.currentCommand === 'claude' && s.paneTty)
      .map(async (s) => {
        const sessionId = await claudeCodeService.getSessionIdFromTty(s.paneTty!);
        if (sessionId) {
          sessionIdByTmuxId.set(s.id, sessionId);
        }
      })
  );

  // Get Claude Code session info for sessions running claude
  const claudePaths = tmuxSessions
    .filter(s => s.currentCommand === 'claude' && s.currentPath)
    .map(s => s.currentPath!);

  // Also get sessions by path for fallback (when session ID not found from PTY)
  const ccSessionsByPath = await claudeCodeService.getSessionsForPaths(claudePaths);

  const sessions = await Promise.all(tmuxSessions.map(async (s) => {
    let ccSession: Awaited<ReturnType<typeof claudeCodeService.getSessionForPath>> | undefined;

    if (s.currentCommand === 'claude' && s.currentPath) {
      // Get the command-line session ID (from -r flag)
      const ptySessionId = sessionIdByTmuxId.get(s.id);

      if (ptySessionId) {
        // PTY session ID is the most reliable - use it first
        ccSession = await claudeCodeService.getSessionById(ptySessionId, s.currentPath);
      }

      if (!ccSession && s.paneTty) {
        // Try to find session by process start time (for sessions without -r flag)
        ccSession = await claudeCodeService.getSessionByTtyStartTime(s.paneTty, s.currentPath);
      }

      // Only use path-based fallback if we have a PTY session ID (resumed with -r flag)
      // For new sessions without -r, don't show unrelated session info
      if (!ccSession && ptySessionId) {
        // Last fallback to path-based lookup (only for resumed sessions)
        const pathSession = ccSessionsByPath.get(s.currentPath);
        if (pathSession) {
          ccSession = pathSession;
        }
      }
    }

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

    // Calculate session duration from modified time
    let durationMinutes: number | undefined;
    if (ccSession?.modified) {
      const modified = new Date(ccSession.modified);
      const now = new Date();
      durationMinutes = Math.round((now.getTime() - modified.getTime()) / 60000);
    }

    // Only include Claude Code info when claude is actually running
    const includeClaudeInfo = s.currentCommand === 'claude';

    return {
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      lastAccessedAt: s.createdAt,
      state: s.attached ? 'working' as const : 'idle' as const,
      currentCommand: s.currentCommand,
      currentPath: s.currentPath,
      paneTitle: s.paneTitle,
      waitingForInput: includeClaudeInfo ? waitingForInput : undefined,
      waitingToolName: includeClaudeInfo ? ccSession?.waitingToolName : undefined,
      ccSummary: includeClaudeInfo ? ccSession?.summary : undefined,
      ccFirstPrompt: includeClaudeInfo ? ccSession?.firstPrompt : undefined,
      indicatorState: includeClaudeInfo ? indicatorState : undefined,
      ccSessionId: includeClaudeInfo ? ccSession?.sessionId : undefined,
      messageCount: includeClaudeInfo ? ccSession?.messageCount : undefined,
      gitBranch: includeClaudeInfo ? ccSession?.gitBranch : undefined,
      durationMinutes: includeClaudeInfo ? durationMinutes : undefined,
      firstMessageId: includeClaudeInfo ? ccSession?.firstMessageId : undefined,
    };
  }));

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

    // If workingDir is specified, change to that directory and start claude
    if (parsed.success && parsed.data.workingDir) {
      await tmuxService.sendKeys(name, `cd ${parsed.data.workingDir} && claude`);
    }

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

// GET /sessions/history/projects - Get list of projects (fast, no file content reading)
sessions.get('/history/projects', async (c) => {
  const projects = await sessionHistoryService.getProjects();
  return c.json({ projects });
});

// GET /sessions/history/projects/:dirName - Get sessions for a specific project
sessions.get('/history/projects/:dirName', async (c) => {
  const dirName = c.req.param('dirName');
  const sessions = await sessionHistoryService.getProjectSessions(dirName);
  return c.json({ sessions });
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
  const projectDirName = c.req.query('projectDirName');
  const messages = await sessionHistoryService.getConversation(sessionId, projectDirName);
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

// GET /sessions/prompts/search - Search prompt history (C1)
sessions.get('/prompts/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '20', 10);

  if (!query.trim()) {
    // Return recent prompts if no query
    const prompts = await promptHistoryService.getRecentPrompts(limit);
    return c.json({ prompts });
  }

  const prompts = await promptHistoryService.searchPrompts(query, limit);
  return c.json({ prompts });
});

// POST /sessions/history/resume - Resume a session from history (creates new tmux session)
// NOTE: Must be defined BEFORE /:id routes
const ResumeHistorySchema = z.object({
  sessionId: z.string(),
  projectPath: z.string(),
});

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

// GET /sessions/clipboard - Get tmux paste buffer (global)
// NOTE: Must be defined BEFORE /:id routes
sessions.get('/clipboard', async (c) => {
  const buffer = await tmuxService.getBuffer();
  if (buffer === null) {
    return c.json({ error: 'No buffer content' }, 404);
  }
  return c.json({ content: buffer });
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

