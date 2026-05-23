import { Hono } from 'hono';
import { z } from 'zod';
import { homedir } from 'node:os';
import { AGENT_PROVIDERS, AGENT_PROVIDER_IDS, CreateSessionSchema, DEFAULT_AGENT_PROVIDER, PaneIdSchema, agentResumeCommand, agentSupportsConversationMetadata, type AgentProvider, type IndicatorState, type PaneInfo, type ExtendedSessionResponse, type SessionState } from '../../../shared/types';
import { TmuxService } from '../services/tmux';
import { controlSessions, getOrCreateControlSession } from '../services/tmux-control';
import { ClaudeCodeService } from '../services/claude-code';
import { CodexService } from '../services/codex';
import { CodexConversationService } from '../services/codex-conversation';
import { SessionHistoryService } from '../services/session-history';
import { CodexHistoryService } from '../services/codex-history';
import { PromptHistoryService } from '../services/prompt-history';
import { getAllSessionMetadata, setSessionTheme, setSessionTitle, getSessionOrder, setSessionOrder, getLastKnownSessions, saveLastKnownSessions, removeLastKnownSession, type LastKnownSession } from '../services/session-metadata';
import { computeSessionMetrics } from '../services/session-metrics';
import { getIndicatorOverride } from './notify';
import { pushSessionsNow } from './terminal-mux';
import { captureViewport, detectPaneState, stripAnsi, type DetectedPaneState } from '../services/pane-viewport';
import { resolveViewportCursorPolicy } from '../services/viewport-cursor-policy';
import type { TmuxControlSession } from '../services/tmux-control';

const tmuxService = new TmuxService();
const claudeCodeService = new ClaudeCodeService();
const codexService = new CodexService();
const codexConversationService = new CodexConversationService();
// peers.ts からも参照するため export
export const sessionHistoryService = new SessionHistoryService();
export const codexHistoryService = new CodexHistoryService(undefined, codexConversationService);
const promptHistoryService = new PromptHistoryService();

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return `${homedir()}${value.slice(1)}`;
  return value;
}

export function agentStartCommand(agent: AgentProvider, workingDir: string): string {
  return `cd ${shellQuote(expandHome(workingDir))} && ${AGENT_PROVIDERS[agent].command}`;
}

export function findDuplicateAgentWorkingDirSession<T extends { agent?: string; currentCommand?: string; currentPath?: string }>(
  sessions: T[],
  agent: AgentProvider,
  workingDir: string,
): T | undefined {
  return sessions.find(s => (s.agent ?? s.currentCommand) === agent && s.currentPath === workingDir);
}

/** Notify mux clients of session changes after mutations */
function notifySessionChange(): void {
  pushSessionsNow();
}

/**
 * Capture a pane viewport for peer-dialog tooling (cchub send --wait, peek).
 * Returns the trailing `lines` rows (0 = all), with both ANSI-preserved and
 * stripped variants plus a heuristic `detectedState`.
 */
async function captureViewportSnapshot(
  cs: TmuxControlSession,
  paneId: string,
  lines: number,
  cursorPolicy: ReturnType<typeof resolveViewportCursorPolicy> = 'default',
): Promise<{
  paneId: string;
  cols: number;
  rows: number;
  totalLines: number;
  lines: string[];
  text: string;
  cursor: { x: number; y: number; visible: boolean };
  detectedState: DetectedPaneState;
} | null> {
  const vp = await captureViewport(cs, paneId, 0, cursorPolicy);
  if (!vp) return null;
  const slice = lines > 0 ? vp.lines.slice(-lines) : vp.lines;
  const stripped = slice.map(stripAnsi);
  return {
    paneId: vp.paneId,
    cols: vp.cols,
    rows: vp.rows,
    totalLines: vp.lines.length,
    lines: slice,
    text: stripped.join('\n'),
    cursor: vp.cursor,
    detectedState: detectPaneState(vp.lines),
  };
}

async function resolveSessionCursorPolicy(sessionId: string): Promise<ReturnType<typeof resolveViewportCursorPolicy>> {
  const sessions = await tmuxService.listSessions();
  const session = sessions.find(s => s.id === sessionId);
  return resolveViewportCursorPolicy(session?.agent ?? session?.currentCommand);
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
    if (agentSupportsConversationMetadata(s.agent ?? s.currentCommand) && s.paneTty) {
      const sessionId = claudeCodeService.getSessionIdFromArgs(s.paneTty, processInfo.ttyArgs);
      if (sessionId) {
        sessionIdByTmuxId.set(s.id, sessionId);
      }
    }
  }

  const claudePaths = tmuxSessions
    .filter((s): s is typeof s & { currentPath: string } => agentSupportsConversationMetadata(s.agent ?? s.currentCommand) && !!s.currentPath)
    .map(s => s.currentPath);
  const ccSessionsByPath = await claudeCodeService.getSessionsForPaths(claudePaths);
  const codexPaths = tmuxSessions
    .filter((s): s is typeof s & { currentPath: string } => (s.agent ?? s.currentCommand) === 'codex' && !!s.currentPath)
    .map(s => s.currentPath);
  const codexThreadsByPath = await codexService.getThreadsForPaths(codexPaths);

  const order = await getSessionOrder();

  const results = await Promise.all(tmuxSessions.map(async (s) => {
    let ccSession: Awaited<ReturnType<typeof claudeCodeService.getSessionForPath>> | undefined;
    const codexThread = s.currentPath ? codexThreadsByPath.get(s.currentPath) : undefined;

    if (agentSupportsConversationMetadata(s.agent ?? s.currentCommand) && s.currentPath) {
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

      // Final fallback: pick the most recent `.jsonl` for the working dir. Earlier
      // this branch required `ptySessionId` (i.e. only ran for `claude -r <uuid>`),
      // which meant a freshly-started `claude` (no `-r`) whose tty-start-time
      // detection failed (TZ skew on macOS launchd, etc.) ended up with no
      // ccSession at all — and therefore no `ccSessionId` for hook events to
      // match against, so the indicator never reacted.
      if (!ccSession) {
        const pathSession = ccSessionsByPath.get(s.currentPath);
        if (pathSession) {
          ccSession = pathSession;
        }
      }
    }

    const includeClaudeInfo = agentSupportsConversationMetadata(s.agent ?? s.currentCommand);
    const includeCodexInfo = (s.agent ?? s.currentCommand) === 'codex';
    const conversationSessionId = includeClaudeInfo
      ? ccSession?.sessionId
      : includeCodexInfo
        ? codexThread?.sessionId
        : undefined;

    // Indicator state: hook events are the source of truth.
    // Claude defaults to completed (idle/waiting for user input); Codex keeps
    // tmux/process state unless a hook event has been received.
    const hookResult = conversationSessionId ? getIndicatorOverride(conversationSessionId) : null;
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

    // ccSessionId is needed for hook-event matching even when the session was
    // resolved via parent-directory traversal (e.g. a `claude` invocation with
    // no project dir yet). But user-visible content (recap / firstPrompt /
    // summary) must NOT leak from an ancestor project — gate it on
    // ccSession.projectPath === s.currentPath.
    const isExactPathMatch = !!ccSession && !!s.currentPath && ccSession.projectPath === s.currentPath;

    const sessionIndicatorState = includeClaudeInfo
      ? indicatorState
      : includeCodexInfo
        ? (hookState ?? undefined)
        : undefined;

    const panePids: (number | undefined)[] = s.panes ? s.panes.map((p: { pid?: number }) => p.pid) : [];
    const metrics = await computeSessionMetrics({
      ccSessionId: includeClaudeInfo ? ccSession?.sessionId : undefined,
      workingDir: s.currentPath,
      pids: panePids,
    });
    const sessionMetrics = includeCodexInfo && codexThread
      ? {
          ...metrics,
          ...codexThread.tokenUsage,
          totalTokens: codexThread.tokenUsage?.totalTokens ?? codexThread.tokensUsed,
        }
      : metrics;

    return {
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      lastAccessedAt: s.createdAt,
      state: (s.attached ? 'working' : 'idle') as SessionState,
      currentCommand: s.currentCommand,
      agent: s.agent,
      currentPath: s.currentPath,
      paneTitle: s.paneTitle,
      waitingToolName: includeClaudeInfo ? effectiveWaitingToolName : includeCodexInfo ? hookToolName : undefined,
      ccSummary: includeClaudeInfo ? (isExactPathMatch ? ccSession?.summary : undefined) : includeCodexInfo ? codexThread?.title : undefined,
      ccFirstPrompt: includeClaudeInfo ? (isExactPathMatch ? ccSession?.firstPrompt : undefined) : includeCodexInfo ? codexThread?.firstPrompt : undefined,
      ccRecap: includeClaudeInfo && isExactPathMatch ? ccSession?.lastRecap?.content : undefined,
      ccRecapAt: includeClaudeInfo && isExactPathMatch ? ccSession?.lastRecap?.timestamp : undefined,
      indicatorState: sessionIndicatorState,
      ccSessionId: includeClaudeInfo ? ccSession?.sessionId : undefined,
      agentSessionId: includeCodexInfo ? codexThread?.sessionId : undefined,
      messageCount: includeClaudeInfo ? ccSession?.messageCount : undefined,
      gitBranch: includeClaudeInfo ? ccSession?.gitBranch : includeCodexInfo ? codexThread?.gitBranch : undefined,
      durationMinutes: includeClaudeInfo ? durationMinutes : includeCodexInfo && codexThread?.updatedAt ? Math.round((Date.now() - new Date(codexThread.updatedAt).getTime()) / 60000) : undefined,
      firstMessageId: includeClaudeInfo ? ccSession?.firstMessageId : undefined,
      theme: sessionMetadata[s.id]?.theme,
      customTitle: sessionMetadata[s.id]?.title,
      metrics: sessionMetrics,
      panes: s.panes ? s.panes.map((p: { paneId: string; command: string; path: string; title: string; tty: string; isActive: boolean; isDead: boolean; pid?: number }) => {
        const ttyName = p.tty?.replace('/dev/', '');
        const agentInfo = ttyName ? agentInfoByTty.get(ttyName) : undefined;
        const paneAgent = ttyName ? processInfo.agentByTty.get(ttyName) : undefined;
        const sessionAgent = s.agent ?? s.currentCommand;
        const isClaudeOnPane = !p.isDead && !!ttyName && claudeOnPaneTtys.has(ttyName);
        const isSessionAgentOnPane = !p.isDead && (
          (paneAgent !== undefined && paneAgent === sessionAgent) ||
          (paneAgent === undefined && p.command === sessionAgent)
        );
        let paneIndicator: IndicatorState | undefined;
        if (p.isDead) {
          paneIndicator = 'completed';
        } else if (isClaudeOnPane) {
          // Use session-level indicator for Claude panes (hook/jsonl based)
          paneIndicator = indicatorState === 'completed' ? 'waiting_input' : indicatorState;
        } else if (includeCodexInfo && isSessionAgentOnPane) {
          paneIndicator = hookState ?? 'idle';
        } else {
          paneIndicator = 'idle';
        }
        // Prefer the ps-based detection over tmux's pane_current_command, which
        // on macOS sometimes returns the Claude version (e.g. "2.1.123") when the
        // binary is invoked via a non-standard path. The frontend relies on this
        // string equaling "claude" to enable the conversation toggle.
        const currentCommand = paneAgent ?? p.command;
        const pane: PaneInfo = {
          paneId: p.paneId,
          currentCommand,
          currentPath: p.path,
          title: p.title || undefined,
          agentName: agentInfo?.agentName,
          agentColor: agentInfo?.agentColor,
          isActive: p.isActive,
          isDead: p.isDead || undefined,
          indicatorState: isSessionAgentOnPane
            ? (hookState === 'processing' && p.title?.startsWith('✳') ? paneIndicator : (hookState ?? paneIndicator))
            : paneIndicator,
          pid: p.pid,
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
      state: 'lost' as SessionState,
      currentCommand: undefined,
      currentPath: lost.currentPath,
      paneTitle: undefined,
      waitingToolName: undefined,
      ccSummary: undefined,
      ccFirstPrompt: undefined,
      ccRecap: undefined,
      ccRecapAt: undefined,
      indicatorState: undefined,
      ccSessionId: lost.ccSessionId,
      agentSessionId: lost.agentSessionId,
      messageCount: undefined,
      gitBranch: undefined,
      durationMinutes: undefined,
      firstMessageId: undefined,
      theme: lost.theme,
      customTitle: lost.customTitle,
      agent: lost.agent,
      metrics: undefined,
      panes: undefined,
    });
  }

  // Save snapshot: active sessions + still-lost sessions (so lost ones persist across refreshes).
  // Fall back to previously-known values when tmux didn't report a field this round —
  // otherwise a transient gap (e.g. currentPath missing on first capture) erases the data
  // and lost-session resume can't find the project path.
  const prevById = new Map(lastKnown.map(s => [s.id, s]));
  const snapshot: LastKnownSession[] = [
    ...results.filter(s => s.state !== 'lost').map(s => {
      const prev = prevById.get(s.id);
      return {
        id: s.id,
        name: s.name,
        currentPath: s.currentPath ?? prev?.currentPath,
        agent: s.agent ?? prev?.agent,
        theme: s.theme ?? prev?.theme,
        customTitle: s.customTitle ?? prev?.customTitle,
        ccSessionId: s.ccSessionId ?? prev?.ccSessionId,
        agentSessionId: s.agentSessionId ?? prev?.agentSessionId,
      };
    }),
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
  sessionId: z.string().optional(),
  agent: z.enum(AGENT_PROVIDER_IDS).optional(),
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
  const agent = parsed.success ? parsed.data.agent : DEFAULT_AGENT_PROVIDER;

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

  // Guard: reject if the same agent is already running in the same directory
  if (parsed.success && parsed.data.workingDir) {
    const conflicting = findDuplicateAgentWorkingDirSession(tmuxSessions, agent, parsed.data.workingDir);
    if (conflicting) {
      return c.json({ error: 'duplicate_working_dir', existingSession: conflicting.name }, 409);
    }
  }

  try {
    await tmuxService.createSession(name);

    // Start the selected agent if workingDir is specified
    if (parsed.success && parsed.data.workingDir) {
      await tmuxService.sendKeys(name, agentStartCommand(agent, parsed.data.workingDir));

      // Send initial prompt after the agent starts (interactive mode)
      if (parsed.data.initialPrompt) {
        const prompt = parsed.data.initialPrompt;
        const sessionName = name;
        // Poll until the selected agent process is running on the session's TTY
        (async () => {
          for (let i = 0; i < 30; i++) { // up to 30 seconds
            await new Promise(r => setTimeout(r, 1000));
            const sessions = await tmuxService.listSessions();
            const session = sessions.find(s => s.name === sessionName);
            if (session?.currentCommand === agent) {
              // Wait a bit more for the TUI to be fully ready
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
      agent,
    }, 201);
  } catch (_error) {
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// GET /sessions/history/projects - Get list of projects (fast, no file content reading)
// Merges Claude (~/.claude/projects/*) and Codex (~/.codex/sessions/**) buckets
// by encoded cwd so the same directory shows up once.
sessions.get('/history/projects', async (c) => {
  const [claudeProjects, codexProjects] = await Promise.all([
    sessionHistoryService.getProjects(),
    codexHistoryService.getProjects(),
  ]);
  const byDir = new Map<string, typeof claudeProjects[number]>();
  for (const p of claudeProjects) byDir.set(p.dirName, p);
  for (const p of codexProjects) {
    const existing = byDir.get(p.dirName);
    if (existing) {
      existing.sessionCount += p.sessionCount;
      if (!existing.latestModified || (p.latestModified && p.latestModified > existing.latestModified)) {
        existing.latestModified = p.latestModified;
      }
    } else {
      byDir.set(p.dirName, p);
    }
  }
  const projects = Array.from(byDir.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
  return c.json({ projects });
});

// GET /sessions/history/search - Search sessions across all projects
sessions.get('/history/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const [claudeMatches, codexMatches] = await Promise.all([
    sessionHistoryService.searchSessions(query, limit),
    codexHistoryService.searchSessions(query, limit),
  ]);
  const merged = [
    ...claudeMatches.map(s => ({ ...s, agent: s.agent ?? 'claude' as const })),
    ...codexMatches,
  ].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()).slice(0, limit);
  return c.json({ sessions: merged });
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
      let yielded = 0;

      try {
        // Emit Codex matches up-front (small set, scanned in one pass).
        const codexMatches = await codexHistoryService.searchSessions(query, limit);
        for (const session of codexMatches) {
          if (yielded >= limit) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(session)}\n\n`));
          yielded++;
        }
        // Then stream Claude matches incrementally.
        for await (const session of sessionHistoryService.searchSessionsStream(query, limit - yielded)) {
          if (yielded >= limit) break;
          const tagged = { ...session, agent: session.agent ?? 'claude' as const };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(tagged)}\n\n`));
          yielded++;
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
// Returns merged Claude + Codex sessions in the same project bucket.
sessions.get('/history/projects/:dirName', async (c) => {
  const dirName = c.req.param('dirName');
  const [claudeSessions, codexSessions] = await Promise.all([
    sessionHistoryService.getProjectSessions(dirName),
    codexHistoryService.getProjectSessions(dirName),
  ]);
  const merged = [
    ...claudeSessions.map(s => ({ ...s, agent: s.agent ?? 'claude' as const })),
    ...codexSessions,
  ].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return c.json({ sessions: merged });
});

// GET /sessions/history - Get past session history (recent across all projects)
// NOTE: This must be defined BEFORE /:id to prevent "history" being interpreted as an id
sessions.get('/history', async (c) => {
  const includeMetadata = c.req.query('metadata') === 'true';
  const [claudeHistory, codexHistory] = await Promise.all([
    sessionHistoryService.getRecentSessions(30, includeMetadata),
    codexHistoryService.getRecentSessions(30),
  ]);
  const merged = [
    ...claudeHistory.map(s => ({ ...s, agent: s.agent ?? 'claude' as const })),
    ...codexHistory,
  ].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()).slice(0, 30);
  return c.json({ sessions: merged });
});

// GET /sessions/history/:sessionId/conversation - Get conversation history for a session
// ?last=N returns only the last N messages (for lightweight clients like G2 glasses)
// ?agent=codex routes to the Codex rollout reader instead of Claude's jsonl
sessions.get('/history/:sessionId/conversation', async (c) => {
  const sessionId = c.req.param('sessionId');
  const projectDirName = c.req.query('projectDirName');
  const lastQuery = c.req.query('last');
  const last = lastQuery ? parseInt(lastQuery, 10) : undefined;
  const agent = c.req.query('agent');
  const messages = agent === 'codex'
    ? await codexHistoryService.getConversation(sessionId)
    : await sessionHistoryService.getConversation(sessionId, projectDirName);
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
  agent: z.enum(AGENT_PROVIDER_IDS).optional(),
});

sessions.post('/history/resume', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResumeHistorySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request: sessionId and projectPath required' }, 400);
  }

  const { sessionId, projectPath } = parsed.data;
  const agent: AgentProvider = parsed.data.agent ?? DEFAULT_AGENT_PROVIDER;

  try {
    // Generate a unique tmux session name based on project
    const projectName = projectPath.split('/').pop() || 'session';
    const tmuxSessions = await tmuxService.listSessions();

    // Guard: reject if the same agent is already running in the same directory
    const conflicting = findDuplicateAgentWorkingDirSession(tmuxSessions, agent, projectPath);
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

    // Change to project directory and run the agent's resume command
    const command = `cd ${shellQuote(expandHome(projectPath))} && ${agentResumeCommand(agent, sessionId)}`;
    const success = await tmuxService.sendKeys(tmuxSessionName, command);

    if (!success) {
      // Clean up the session if command failed
      await tmuxService.killSession(tmuxSessionName);
      return c.json({ error: 'Failed to start agent session' }, 500);
    }

    return c.json({
      success: true,
      tmuxSessionId: tmuxSessionName,
      ccSessionId: sessionId,
      agent,
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
    agent: session.agent,
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
    // Already lost — purge from last-known so it disappears from the list.
    await removeLastKnownSession(id).catch(() => {});
    return c.json({ success: true });
  }

  try {
    await tmuxService.killSession(id);
    // Keep the entry in last-known so the session shows up as "Lost" and can
    // be resumed via the Resume button without going to the history tab.
    // To purge entirely, delete the Lost session again.
    return c.json({ success: true });
  } catch (_error) {
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});

// POST /sessions/:id/resume - Resume an agent session in an existing tmux session
sessions.post('/:id/resume', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResumeSessionSchema.safeParse(body);

  const tmuxSessions = await tmuxService.listSessions();
  const session = tmuxSessions.find(s => s.id === id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const sessionId = parsed.success ? (parsed.data.sessionId ?? parsed.data.ccSessionId) : undefined;
    const requestedAgent = parsed.success ? parsed.data.agent : undefined;
    const agent: AgentProvider = requestedAgent ?? session.agent ?? DEFAULT_AGENT_PROVIDER;
    const command = agentResumeCommand(agent, sessionId);

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

const PaneInputSchema = z.object({
  paneId: PaneIdSchema,
  data: z.string(),
  encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8'),
  // peer-dialog helpers: if `wait` is true the response includes a viewport
  // snapshot captured `waitMs` after the input is delivered. `lines` is how
  // many trailing rows to return (0 = all). Defaults match the CLI defaults.
  wait: z.boolean().optional().default(false),
  waitMs: z.number().int().min(0).max(10000).optional().default(800),
  lines: z.number().int().min(0).max(500).optional().default(20),
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

// POST /sessions/:id/panes/input - Send raw input bytes to a specific pane
sessions.post('/:id/panes/input', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = PaneInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const controlSession = controlSessions.get(id) || await getOrCreateControlSession(id);
    const panes = await controlSession.listPanes();
    const targetPane = panes.find(p => p.paneId === parsed.data.paneId);
    if (!targetPane) {
      return c.json({ error: 'Pane not found' }, 404);
    }

    const buffer = parsed.data.encoding === 'base64'
      ? Buffer.from(parsed.data.data, 'base64')
      : Buffer.from(parsed.data.data, 'utf-8');
    await controlSession.sendInput(parsed.data.paneId, buffer);

    if (!parsed.data.wait) {
      return c.json({ success: true, paneId: parsed.data.paneId, bytes: buffer.length });
    }

    // Give the TUI time to render before snapshotting.
    if (parsed.data.waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, parsed.data.waitMs));
    }
    const cursorPolicy = await resolveSessionCursorPolicy(id);
    const viewport = await captureViewportSnapshot(controlSession, parsed.data.paneId, parsed.data.lines, cursorPolicy);
    return c.json({
      success: true,
      paneId: parsed.data.paneId,
      bytes: buffer.length,
      viewport,
    });
  } catch (_error) {
    return c.json({ error: 'Failed to send input' }, 500);
  }
});

// GET /sessions/:id/panes/:paneId/viewport - Snapshot a pane's current viewport
sessions.get('/:id/panes/:paneId/viewport', async (c) => {
  const id = c.req.param('id');
  const paneId = c.req.param('paneId');
  const linesParam = c.req.query('lines');
  const lines = linesParam ? Math.max(0, Math.min(500, Number.parseInt(linesParam, 10) || 0)) : 20;

  if (!paneId.startsWith('%')) {
    return c.json({ error: 'paneId must start with %' }, 400);
  }

  const exists = await tmuxService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const controlSession = controlSessions.get(id) || await getOrCreateControlSession(id);
    const panes = await controlSession.listPanes();
    if (!panes.find(p => p.paneId === paneId)) {
      return c.json({ error: 'Pane not found' }, 404);
    }
    const cursorPolicy = await resolveSessionCursorPolicy(id);
    const viewport = await captureViewportSnapshot(controlSession, paneId, lines, cursorPolicy);
    if (!viewport) {
      return c.json({ error: 'Failed to capture viewport' }, 500);
    }
    return c.json(viewport);
  } catch (_error) {
    return c.json({ error: 'Failed to capture viewport' }, 500);
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
