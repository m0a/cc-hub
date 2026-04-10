import { Hono } from 'hono';
import { z } from 'zod';
import { CreateSessionSchema, PaneIdSchema, type IndicatorState, type PaneInfo, type ExtendedSessionResponse } from '../../../shared/types';
import { TmuxService } from '../services/tmux';
import { controlSessions, getOrCreateControlSession } from '../services/tmux-control';
import { ClaudeCodeService } from '../services/claude-code';
import { SessionHistoryService } from '../services/session-history';
import { PromptHistoryService } from '../services/prompt-history';
import { getAllSessionMetadata, setSessionTheme, setSessionTitle, getSessionOrder, setSessionOrder, getLastKnownSessions, saveLastKnownSessions, removeLastKnownSession, type LastKnownSession } from '../services/session-metadata';
import { getIndicatorOverride } from './notify';
import { pushSessionsNow } from './terminal-mux';

const tmuxService = new TmuxService();
const claudeCodeService = new ClaudeCodeService();
const sessionHistoryService = new SessionHistoryService();
const promptHistoryService = new PromptHistoryService();

/** Notify mux clients of session changes after mutations */
function notifySessionChange(): void {
  pushSessionsNow();
}

export const sessions = new Hono();

/** Build the full sessions list (shared by HTTP handler and WS push) */
export async function buildSessionsList(): Promise<ExtendedSessionResponse[]> {
  const tmuxSessions = await tmuxService.listSessions();
  const sessionMetadata = await getAllSessionMetadata();

  const allPaneTtys: string[] = [];
  for (const s of tmuxSessions) {
    if (s.panes) {
      for (const p of s.panes) {
        if (p.tty) allPaneTtys.push(p.tty.replace('/dev/', ''));
      }
    }
  }

  const processInfo = await tmuxService.batchProcessInfo(allPaneTtys);
  const claudeOnPaneTtys = processInfo.claudeTtys;
  const agentInfoByTty = processInfo.agentInfo;

  const sessionIdByTmuxId = new Map<string, string>();
  for (const s of tmuxSessions) {
    if (s.currentCommand === 'claude' && s.paneTty) {
      const sessionId = claudeCodeService.getSessionIdFromArgs(s.paneTty, processInfo.ttyArgs);
      if (sessionId) {
        sessionIdByTmuxId.set(s.id, sessionId);
      }
    }
  }

  const claudePaths = tmuxSessions
    .filter((s): s is typeof s & { currentPath: string } => s.currentCommand === 'claude' && !!s.currentPath)
    .map(s => s.currentPath);
  const ccSessionsByPath = await claudeCodeService.getSessionsForPaths(claudePaths);

  const order = await getSessionOrder();

  const results = await Promise.all(tmuxSessions.map(async (s) => {
    let ccSession: Awaited<ReturnType<typeof claudeCodeService.getSessionForPath>> | undefined;

    if (s.currentCommand === 'claude' && s.currentPath) {
      const ptySessionId = sessionIdByTmuxId.get(s.id);

      if (ptySessionId) {
        ccSession = await claudeCodeService.getSessionById(ptySessionId, s.currentPath);
        if (ccSession) {
          const [newestSession] = await claudeCodeService.getRecentSessionsForPath(s.currentPath, 1);
          if (
            newestSession &&
            newestSession.sessionId !== ccSession.sessionId &&
            newestSession.modified && ccSession.modified
          ) {
            const newestMtime = new Date(newestSession.modified).getTime();
            const currentMtime = new Date(ccSession.modified).getTime();
            if (newestMtime - currentMtime > 5000) {
              ccSession = newestSession;
            }
          }
        }
      }

      if (!ccSession && s.paneTty) {
        ccSession = await claudeCodeService.getSessionByTtyStartTime(s.paneTty, s.currentPath);
      }

      if (!ccSession && ptySessionId) {
        const pathSession = ccSessionsByPath.get(s.currentPath);
        if (pathSession) {
          ccSession = pathSession;
        }
      }
    }

    const isClaudeRunning = s.currentCommand === 'claude';
    // Indicator state: hook events are the source of truth
    // Default for running Claude = completed (idle/waiting for user input)
    const hookResult = ccSession?.sessionId ? getIndicatorOverride(ccSession.sessionId) : null;
    const hookState = hookResult?.state ?? null;
    const hookToolName = hookResult?.toolName;
    // When pane title shows ✳ (Claude Code idle marker) but hook says "processing",
    // Claude is waiting for permission (not actually processing).
    const isPaneTitleIdle = s.paneTitle?.startsWith('✳');
    const indicatorState: IndicatorState = (hookState === 'processing' && isPaneTitleIdle) ? 'waiting_input' : (hookState ?? 'completed');
    // Use hook tool name for waiting state when jsonl doesn't have it yet
    const effectiveWaitingToolName = (indicatorState === 'waiting_input' && hookToolName && !ccSession?.waitingToolName)
      ? hookToolName : ccSession?.waitingToolName;

    let durationMinutes: number | undefined;
    if (ccSession?.modified) {
      const modified = new Date(ccSession.modified);
      durationMinutes = Math.round((Date.now() - modified.getTime()) / 60000);
    }

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
      waitingToolName: includeClaudeInfo ? effectiveWaitingToolName : undefined,
      ccSummary: includeClaudeInfo ? ccSession?.summary : undefined,
      ccFirstPrompt: includeClaudeInfo ? ccSession?.firstPrompt : undefined,
      indicatorState: includeClaudeInfo ? indicatorState : undefined,
      ccSessionId: includeClaudeInfo ? ccSession?.sessionId : undefined,
      messageCount: includeClaudeInfo ? ccSession?.messageCount : undefined,
      gitBranch: includeClaudeInfo ? ccSession?.gitBranch : undefined,
      durationMinutes: includeClaudeInfo ? durationMinutes : undefined,
      firstMessageId: includeClaudeInfo ? ccSession?.firstMessageId : undefined,
      theme: sessionMetadata[s.id]?.theme,
      customTitle: sessionMetadata[s.id]?.title,
      panes: s.panes ? s.panes.map((p: { paneId: string; command: string; path: string; title: string; tty: string; isActive: boolean; isDead: boolean }) => {
        const ttyName = p.tty?.replace('/dev/', '');
        const agentInfo = ttyName ? agentInfoByTty.get(ttyName) : undefined;
        let paneIndicator: IndicatorState | undefined;
        if (p.isDead) {
          paneIndicator = 'completed';
        } else {
          const isClaudeOnPane = ttyName ? claudeOnPaneTtys.has(ttyName) : false;
          if (isClaudeOnPane) {
            // Use session-level indicator for Claude panes (hook/jsonl based)
            paneIndicator = indicatorState === 'completed' ? 'waiting_input' : indicatorState;
          } else {
            paneIndicator = 'idle';
          }
        }
        const pane: PaneInfo = {
          paneId: p.paneId,
          currentCommand: p.command,
          currentPath: p.path,
          title: p.title || undefined,
          agentName: agentInfo?.agentName,
          agentColor: agentInfo?.agentColor,
          isActive: p.isActive,
          isDead: p.isDead || undefined,
          indicatorState: (hookState === 'processing' && p.title?.startsWith('✳')) ? paneIndicator : (hookState ?? paneIndicator),
        };
        return pane;
      }) : undefined,
    };
  }));

  // Add lost sessions (existed before reboot but not in tmux now)
  const activeIds = new Set(results.map(s => s.id));
  const activePaths = new Set(results.map(s => s.currentPath).filter(Boolean));
  const lastKnown = await getLastKnownSessions();
  const lostSessions: LastKnownSession[] = [];
  for (const lost of lastKnown) {
    // Skip if session ID still exists or if a new session is already running in the same directory
    if (activeIds.has(lost.id) || (lost.currentPath && activePaths.has(lost.currentPath))) continue;
    lostSessions.push(lost);
    results.push({
      id: lost.id,
      name: lost.name,
      createdAt: '',
      lastAccessedAt: '',
      state: 'lost',
      currentPath: lost.currentPath,
      theme: lost.theme,
      customTitle: lost.customTitle,
      ccSessionId: lost.ccSessionId,
    });
  }

  // Save snapshot: active sessions + still-lost sessions (so lost ones persist across refreshes)
  const snapshot: LastKnownSession[] = [
    ...results.filter(s => s.state !== 'lost').map(s => ({
      id: s.id,
      name: s.name,
      currentPath: s.currentPath,
      theme: s.theme,
      customTitle: s.customTitle,
      ccSessionId: s.ccSessionId,
    })),
    ...lostSessions,
  ];
  // Fire async, don't block response
  saveLastKnownSessions(snapshot).catch(() => {});

  // Apply custom order if set
  if (order.length > 0) {
    const orderMap = new Map(order.map((id, i) => [id, i]));
    results.sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }

  return results;
}


const ResumeSessionSchema = z.object({
  ccSessionId: z.string().optional(),
});

// GET /sessions - List all tmux sessions (debug/fallback only, frontend uses WS push)
sessions.get('/', async (c) => {
  const sessionsList = await buildSessionsList();
  return c.json({ sessions: sessionsList });
});

// POST /sessions - Create a new tmux session
sessions.post('/', async (c) => {
  notifySessionChange();
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

  // Guard: reject if a Claude session is already running in the same directory
  if (parsed.success && parsed.data.workingDir) {
    const conflicting = tmuxSessions.find(
      s => s.currentCommand === 'claude' && s.currentPath === parsed.data.workingDir
    );
    if (conflicting) {
      return c.json({ error: 'duplicate_working_dir', existingSession: conflicting.name }, 409);
    }
  }

  try {
    await tmuxService.createSession(name);

    // Start claude if workingDir is specified
    if (parsed.success && parsed.data.workingDir) {
      await tmuxService.sendKeys(name, `cd ${parsed.data.workingDir} && claude`);

      // Send initial prompt after claude starts (interactive mode)
      if (parsed.data.initialPrompt) {
        const prompt = parsed.data.initialPrompt;
        const sessionName = name;
        // Poll until claude process is running on the session's TTY
        (async () => {
          for (let i = 0; i < 30; i++) { // up to 30 seconds
            await new Promise(r => setTimeout(r, 1000));
            const sessions = await tmuxService.listSessions();
            const session = sessions.find(s => s.name === sessionName);
            if (session?.currentCommand === 'claude') {
              // Wait a bit more for claude to be fully ready
              await new Promise(r => setTimeout(r, 2000));
              await tmuxService.sendKeys(sessionName, prompt);
              // Send extra Enter to submit the prompt
              await new Promise(r => setTimeout(r, 500));
              await tmuxService.sendKeys(sessionName, '');
              return;
            }
          }
        })();
      }
    }

    return c.json({
      id: name,
      name: name,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      state: 'idle',
    }, 201);
  } catch (_error) {
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// GET /sessions/history/projects - Get list of projects (fast, no file content reading)
sessions.get('/history/projects', async (c) => {
  const projects = await sessionHistoryService.getProjects();
  return c.json({ projects });
});

// GET /sessions/history/search - Search sessions across all projects
sessions.get('/history/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const sessions = await sessionHistoryService.searchSessions(query, limit);
  return c.json({ sessions });
});

// GET /sessions/history/search/stream - Streaming search with SSE
sessions.get('/history/search/stream', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '50', 10);

  // Set up SSE headers
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        for await (const session of sessionHistoryService.searchSessionsStream(query, limit)) {
          const data = `data: ${JSON.stringify(session)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        // Send done event
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
      } catch (_error) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Search failed' })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
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
// ?last=N returns only the last N messages (for lightweight clients like G2 glasses)
sessions.get('/history/:sessionId/conversation', async (c) => {
  const sessionId = c.req.param('sessionId');
  const projectDirName = c.req.query('projectDirName');
  const last = c.req.query('last') ? parseInt(c.req.query('last')!, 10) : undefined;
  const messages = await sessionHistoryService.getConversation(sessionId, projectDirName);
  return c.json({ messages: last ? messages.slice(-last) : messages });
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

    // Guard: reject if a Claude session is already running in the same directory
    const conflicting = tmuxSessions.find(
      s => s.currentCommand === 'claude' && s.currentPath === projectPath
    );
    if (conflicting) {
      return c.json({ error: 'duplicate_working_dir', existingSession: conflicting.name }, 409);
    }
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
  } catch (_error) {
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
  notifySessionChange();
  const id = c.req.param('id');

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    // May be a lost session — remove from last-known and return success
    await removeLastKnownSession(id).catch(() => {});
    return c.json({ success: true });
  }

  try {
    await tmuxService.killSession(id);
    removeLastKnownSession(id).catch(() => {});
    return c.json({ success: true });
  } catch (_error) {
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
  } catch (_error) {
    return c.json({ error: 'Failed to resume session' }, 500);
  }
});

// PUT /sessions/:id/theme - Update session theme color
const UpdateThemeSchema = z.object({
  theme: z.enum(['red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink']).nullable(),
});

sessions.put('/:id/theme', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateThemeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid theme' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    await setSessionTheme(id, parsed.data.theme);
    return c.json({ success: true, theme: parsed.data.theme });
  } catch (_error) {
    return c.json({ error: 'Failed to update theme' }, 500);
  }
});

// PUT /sessions/:id/title - Update session custom title
const UpdateTitleSchema = z.object({
  title: z.string().max(100).nullable(),
});

sessions.put('/:id/title', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateTitleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid title' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    await setSessionTitle(id, parsed.data.title);
    return c.json({ success: true, title: parsed.data.title });
  } catch (_error) {
    return c.json({ error: 'Failed to update title' }, 500);
  }
});

// PUT /sessions/order - Save session display order
sessions.put('/order', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const order = body.order;
  if (!Array.isArray(order) || !order.every((id: unknown) => typeof id === 'string')) {
    return c.json({ error: 'Invalid order' }, 400);
  }
  try {
    await setSessionOrder(order);
    notifySessionChange();
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Failed to save order' }, 500);
  }
});

// =============================================================================
// Pane Operations
// =============================================================================

const PaneFocusSchema = z.object({
  paneId: PaneIdSchema,
});

const PaneCloseSchema = z.object({
  paneId: PaneIdSchema,
});

const PaneSplitSchema = z.object({
  paneId: PaneIdSchema,
  direction: z.enum(['h', 'v']),
});

const PaneRespawnSchema = z.object({
  paneId: PaneIdSchema,
});

// POST /sessions/:id/panes/focus - Focus a specific pane
sessions.post('/:id/panes/focus', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = PaneFocusSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid pane ID' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const proc = Bun.spawn(['tmux', 'select-pane', '-t', parsed.data.paneId], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      return c.json({ error: `Failed to focus pane: ${error}` }, 500);
    }
    tmuxService.invalidateCache();
    notifySessionChange();
    return c.json({ success: true });
  } catch (_error) {
    return c.json({ error: 'Failed to focus pane' }, 500);
  }
});

// POST /sessions/:id/panes/close - Close a specific pane
sessions.post('/:id/panes/close', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = PaneCloseSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid pane ID' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Check pane count - don't allow closing the last pane
  try {
    const countProc = Bun.spawn(['tmux', 'list-panes', '-t', id, '-F', '#{pane_id}'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const countText = await new Response(countProc.stdout).text();
    await countProc.exited;
    const paneCount = countText.trim().split('\n').filter(l => l.length > 0).length;
    if (paneCount <= 1) {
      return c.json({ error: 'Cannot close the last pane' }, 400);
    }
  } catch {
    // If we can't count panes, proceed cautiously
  }

  try {
    const proc = Bun.spawn(['tmux', 'kill-pane', '-t', parsed.data.paneId], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      return c.json({ error: `Failed to close pane: ${error}` }, 500);
    }
    tmuxService.invalidateCache();
    notifySessionChange();
    return c.json({ success: true });
  } catch (_error) {
    return c.json({ error: 'Failed to close pane' }, 500);
  }
});

// POST /sessions/:id/panes/split - Split a pane
sessions.post('/:id/panes/split', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = PaneSplitSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const proc = Bun.spawn(['tmux', 'split-window', parsed.data.direction === 'h' ? '-h' : '-v', '-t', parsed.data.paneId], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      return c.json({ error: `Failed to split pane: ${error}` }, 500);
    }
    tmuxService.invalidateCache();
    notifySessionChange();
    return c.json({ success: true });
  } catch (_error) {
    return c.json({ error: 'Failed to split pane' }, 500);
  }
});

// POST /sessions/:id/panes/respawn - Respawn a dead pane
sessions.post('/:id/panes/respawn', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = PaneRespawnSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const proc = Bun.spawn(['tmux', 'respawn-pane', '-t', parsed.data.paneId], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      return c.json({ error: `Failed to respawn pane: ${error}` }, 500);
    }
    tmuxService.invalidateCache();
    notifySessionChange();
    return c.json({ success: true });
  } catch (_error) {
    return c.json({ error: 'Failed to respawn pane' }, 500);
  }
});

// POST /sessions/:id/prompt - Send a prompt text to the session's active pane
sessions.post('/:id/prompt', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const text = body.text as string | undefined;

  if (!text) {
    return c.json({ error: 'text is required' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const controlSession = controlSessions.get(id) || await getOrCreateControlSession(id);
    const panes = await controlSession.listPanes();
    // Find the active pane, or fall back to the first pane
    const targetPane = panes.find(p => p.isActive) || panes[0];
    if (!targetPane) {
      return c.json({ error: 'No pane found' }, 404);
    }

    // Send using bracketed paste mode + Enter
    const payload = `\x1b[200~${text}\x1b[201~\r`;
    await controlSession.sendInput(targetPane.paneId, Buffer.from(payload, 'utf-8'));

    return c.json({ success: true, paneId: targetPane.paneId });
  } catch (_error) {
    return c.json({ error: 'Failed to send prompt' }, 500);
  }
});

