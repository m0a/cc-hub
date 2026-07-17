import { Hono } from 'hono';
import { z } from 'zod';
import { homedir } from 'node:os';
import { AGENT_PROVIDERS, AGENT_PROVIDER_IDS, CreateSessionSchema, DEFAULT_AGENT_PROVIDER, PaneIdSchema, SessionIdSchema, agentResumeCommand, agentSupportsConversationMetadata, type AgentProvider, type IndicatorState, type PaneInfo, type ExtendedSessionResponse, type SessionState } from '../../../shared/types';
import { HerdrService } from '../services/herdr';
import {
  captureViewportHerdr,
  getOrCreateHerdrControlSession,
  type HerdrControlSession,
} from '../services/herdr-control';
import { ClaudeCodeService } from '../services/claude-code';
import { CodexService } from '../services/codex';
import { CodexConversationService } from '../services/codex-conversation';
import { SessionHistoryService } from '../services/session-history';
import { CodexHistoryService } from '../services/codex-history';
import { PromptHistoryService } from '../services/prompt-history';
import { getAllSessionMetadata, setSessionTheme, setSessionTitle, getLastKnownSessions, saveLastKnownSessions, removeLastKnownSession, type LastKnownSession } from '../services/session-metadata';
import { computeSessionMetrics } from '../services/session-metrics';
import { getIndicatorOverride } from './notify';
import { pushSessionsNow } from './terminal-mux';
import { detectPaneState, stripAnsi, type DetectedPaneState } from '../services/pane-state';

const herdrService = new HerdrService();
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
  cs: HerdrControlSession,
  paneId: string,
  lines: number,
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
  const vp = await captureViewportHerdr(cs, paneId, 0);
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

/**
 * Run `fn` against the session's control session with REST client
 * accounting: addClient/removeClient bracket the call so a control session
 * created solely for a one-shot REST request (cchub peek/send, peer calls)
 * starts its grace timer afterwards and gets cleaned up instead of leaking
 * its per-pane controller subprocesses forever.
 */
async function withControlSession<T>(
  sessionId: string,
  fn: (cs: HerdrControlSession) => Promise<T>,
): Promise<T> {
  const cs = await getOrCreateHerdrControlSession(sessionId);
  cs.addClient();
  try {
    return await fn(cs);
  } finally {
    cs.removeClient();
  }
}

/**
 * Deliver text to the session's active pane over the raw control stream.
 * Unlike herdr's pane.send_input RPC (which strips ESC/newlines from text),
 * raw bytes preserve multi-line payloads; `bracketed` wraps the text in
 * bracketed-paste markers so agent TUIs (Claude/Codex) treat embedded
 * newlines as literal lines and the trailing \r as submit.
 */
async function sendTextToSession(
  sessionId: string,
  text: string,
  opts?: { bracketed?: boolean },
): Promise<string> {
  return withControlSession(sessionId, async (cs) => {
    const panes = await cs.listPanes();
    const target = panes.find((p) => p.isActive) || panes[0];
    if (!target) throw new Error('No pane found');
    const payload = opts?.bracketed ? `\x1b[200~${text}\x1b[201~` : text;
    await cs.sendInput(target.paneId, Buffer.from(payload, 'utf-8'));
    // Deliver the submit \r as its own write, slightly later: agent TUIs
    // can swallow a \r that arrives in the same chunk as the bracketed-paste
    // terminator (treated as part of the paste), leaving the prompt sitting
    // unsubmitted in the input box.
    await new Promise((r) => setTimeout(r, 80));
    await cs.sendInput(target.paneId, Buffer.from('\r', 'utf-8'));
    return target.paneId;
  });
}

/**
 * herdr's agent status → CC Hub indicator.
 *
 * Verified against Claude 2.x on herdr 0.7.3: `working` while responding,
 * `blocked` while a TUI prompt waits on the user (AskUserQuestion and
 * permission prompts both), `idle` before the first turn, `done` after one.
 * Anything else — `unknown`, or a state a future herdr adds — returns null so
 * the caller falls back instead of showing a confidently wrong indicator.
 */
export function herdrStatusToIndicator(status?: string): IndicatorState | null {
  switch (status) {
    case 'working':
      return 'processing';
    case 'blocked':
      return 'waiting_input';
    case 'idle':
    case 'done':
      return 'completed';
    default:
      return null;
  }
}

export const sessions = new Hono();

/** Build the full sessions list (shared by HTTP handler and WS push) */
export async function buildSessionsList(): Promise<ExtendedSessionResponse[]> {
  const herdrSessions = await herdrService.listSessions();
  const sessionMetadata = await getAllSessionMetadata();

  const claudePaths = herdrSessions
    .filter((s): s is typeof s & { currentPath: string } => agentSupportsConversationMetadata(s.agent ?? s.currentCommand) && !!s.currentPath)
    .map(s => s.currentPath);
  const ccSessionsByPath = await claudeCodeService.getSessionsForPaths(claudePaths);
  const codexPaths = herdrSessions
    .filter((s): s is typeof s & { currentPath: string } => (s.agent ?? s.currentCommand) === 'codex' && !!s.currentPath)
    .map(s => s.currentPath);
  const codexThreadsByPath = await codexService.getThreadsForPaths(codexPaths);

  // Remote Control deep-link map: Claude Code sessionId -> bridgeSessionId.
  // Read once per build (cheap: a handful of small ~/.claude/sessions/*.json).
  const bridgeSessionIds = await claudeCodeService.getBridgeSessionIds();

  const results = await Promise.all(herdrSessions.map(async (s) => {
    let ccSession: Awaited<ReturnType<typeof claudeCodeService.getSessionForPath>> | undefined;
    const codexThread = s.currentPath ? codexThreadsByPath.get(s.currentPath) : undefined;

    if (agentSupportsConversationMetadata(s.agent ?? s.currentCommand) && s.currentPath) {
      // Prefer the native session id reported via the herdr agent
      // integration — it keeps two sessions in the SAME workingDir
      // distinguishable. Fall back to most-recent-.jsonl path matching.
      ccSession = s.agentSessionId
        ? ((await claudeCodeService.getSessionById(s.agentSessionId, s.currentPath)) ??
          ccSessionsByPath.get(s.currentPath))
        : ccSessionsByPath.get(s.currentPath);
    }

    const includeClaudeInfo = agentSupportsConversationMetadata(s.agent ?? s.currentCommand);
    const includeCodexInfo = (s.agent ?? s.currentCommand) === 'codex';
    const conversationSessionId = includeClaudeInfo
      ? ccSession?.sessionId
      : includeCodexInfo
        ? codexThread?.sessionId
        : undefined;

    // Indicator state: herdr's own agent detection is the source of truth —
    // it tracks the pane itself, so it can't go stale when a hook is missing,
    // fails to fire, or the agent is killed mid-turn. Hooks only fill in what
    // herdr can't see (an agent it hasn't detected) and carry the notification
    // text / tool name.
    const hookResult = conversationSessionId ? getIndicatorOverride(conversationSessionId) : null;
    const hookState = hookResult?.state ?? null;
    const hookToolName = hookResult?.toolName;
    const herdrState = herdrStatusToIndicator(s.agentStatus);
    const indicatorState: IndicatorState = herdrState ?? hookState ?? 'completed';
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

    // Codex keeps hooks first: herdr detects Codex panes too, but its status
    // accuracy there hasn't been verified the way it has for Claude (#390).
    const sessionIndicatorState = includeClaudeInfo
      ? indicatorState
      : includeCodexInfo
        ? (hookState ?? herdrState ?? undefined)
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
      bridgeSessionId:
        includeClaudeInfo && ccSession?.sessionId
          ? bridgeSessionIds.get(ccSession.sessionId)
          : undefined,
      agentSessionId: includeCodexInfo ? codexThread?.sessionId : undefined,
      messageCount: includeClaudeInfo ? ccSession?.messageCount : undefined,
      gitBranch: includeClaudeInfo ? ccSession?.gitBranch : includeCodexInfo ? codexThread?.gitBranch : undefined,
      durationMinutes: includeClaudeInfo ? durationMinutes : includeCodexInfo && codexThread?.updatedAt ? Math.round((Date.now() - new Date(codexThread.updatedAt).getTime()) / 60000) : undefined,
      firstMessageId: includeClaudeInfo ? ccSession?.firstMessageId : undefined,
      theme: sessionMetadata[s.id]?.theme,
      customTitle: sessionMetadata[s.id]?.title,
      metrics: sessionMetrics,
      panes: s.panes ? s.panes.map((p: { paneId: string; command: string; path: string; title: string; tty: string; isActive: boolean; isDead: boolean; pid?: number }) => {
        // Pane command comes from herdr's pane.process_info (foreground group
        // leader), so `command === agent id` identifies the agent pane.
        const sessionAgent = s.agent ?? s.currentCommand;
        const isSessionAgentOnPane = !p.isDead && p.command === sessionAgent;
        const isClaudeOnPane = isSessionAgentOnPane && includeClaudeInfo;
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
        const pane: PaneInfo = {
          paneId: p.paneId,
          currentCommand: p.command,
          currentPath: p.path,
          title: p.title || undefined,
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

  // Add lost sessions (existed before reboot but not in herdr now)
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
      bridgeSessionId: undefined,
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
  // Fall back to previously-known values when herdr did not report a field this round —
  // otherwise a transient gap (e.g. currentPath missing on first capture) erases the data
  // and lost-session resume can't find the project path.
  const prevById = new Map(lastKnown.map(s => [s.id, s]));
  const snapshot: LastKnownSession[] = [
    ...results.filter(s => s.state !== 'lost').map(s => {
      const prev = prevById.get(s.id);
      // currentPath tracks the agent's cwd while an agent runs; once the
      // agent exits, the pane cwd falls back to the shell's dir (often ~)
      // and would DEGRADE the recorded project path, breaking lost-session
      // resume. Keep the last agent-era value in that case.
      const currentPath = s.agent
        ? (s.currentPath ?? prev?.currentPath)
        : (prev?.currentPath ?? s.currentPath);
      return {
        id: s.id,
        name: s.name,
        currentPath,
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

  // No sort: `results` is already in herdr's workspace order (listSessions
  // maps over `workspace.list`), and herdr is the only source of session
  // order. Lost sessions have no workspace, so they trail the live ones.

  return results;
}


const ResumeSessionSchema = z.object({
  ccSessionId: SessionIdSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  agent: z.enum(AGENT_PROVIDER_IDS).optional(),
});

// GET /sessions - List all sessions (debug/fallback only, frontend uses WS push)
sessions.get('/', async (c) => {
  const sessionsList = await buildSessionsList();
  return c.json({ sessions: sessionsList });
});

// POST /sessions - Create a new session
sessions.post('/', async (c) => {
  notifySessionChange();
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateSessionSchema.safeParse(body);
  const agent = parsed.success ? parsed.data.agent : DEFAULT_AGENT_PROVIDER;

  // Generate session name
  const herdrSessions = await herdrService.listSessions();
  const name = parsed.success && parsed.data.name
    ? parsed.data.name
    : `session-${herdrSessions.length + 1}`;

  // Check if session already exists
  const exists = await herdrService.sessionExists(name);
  if (exists) {
    return c.json({ error: 'Session already exists' }, 400);
  }

  // Guard: reject if the same agent is already running in the same directory
  if (parsed.success && parsed.data.workingDir) {
    const conflicting = findDuplicateAgentWorkingDirSession(herdrSessions, agent, parsed.data.workingDir);
    if (conflicting) {
      return c.json({ error: 'duplicate_working_dir', existingSession: conflicting.name }, 409);
    }
  }

  try {
    await herdrService.createSession(name);

    // Start the selected agent if workingDir is specified
    if (parsed.success && parsed.data.workingDir) {
      await sendTextToSession(name, agentStartCommand(agent, parsed.data.workingDir));

      // Send initial prompt after the agent starts (interactive mode)
      if (parsed.data.initialPrompt) {
        const prompt = parsed.data.initialPrompt;
        const sessionName = name;
        // Poll until the selected agent process is running in the session
        (async () => {
          for (let i = 0; i < 30; i++) { // up to 30 seconds
            await new Promise(r => setTimeout(r, 1000));
            const sessions = await herdrService.listSessions();
            const session = sessions.find(s => s.name === sessionName);
            if (session?.currentCommand === agent) {
              // Wait a bit more for the TUI to be fully ready, then submit
              // via bracketed paste (multi-line prompts stay multi-line).
              await new Promise(r => setTimeout(r, 2000));
              await sendTextToSession(sessionName, prompt, { bracketed: true });
              return;
            }
          }
        })().catch((err) => {
          console.warn(`[sessions] initial prompt delivery failed for ${name}:`, err);
        });
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

// POST /sessions/history/resume - Resume a session from history (creates a new session)
// NOTE: Must be defined BEFORE /:id routes
const ResumeHistorySchema = z.object({
  sessionId: SessionIdSchema,
  projectPath: z.string(),
  agent: z.enum(AGENT_PROVIDER_IDS).optional(),
});

sessions.post('/history/resume', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResumeHistorySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request: sessionId and projectPath required' }, 400);
  }

  const { sessionId } = parsed.data;
  const agent: AgentProvider = parsed.data.agent ?? DEFAULT_AGENT_PROVIDER;
  // The provided projectPath can be stale (lost sessions record the pane's
  // cwd, which falls back to the shell dir once the agent exits). The cwd
  // recorded inside the conversation .jsonl is authoritative — `claude -r`
  // only finds conversations from the project directory they belong to.
  const recordedCwd =
    agent === 'claude' ? await claudeCodeService.resolveSessionCwd(sessionId) : null;
  const projectPath = recordedCwd ?? parsed.data.projectPath;

  try {
    // Generate a unique session name based on project
    const projectName = projectPath.split('/').pop() || 'session';
    const herdrSessions = await herdrService.listSessions();

    // Guard: reject if the same agent is already running in the same directory
    const conflicting = findDuplicateAgentWorkingDirSession(herdrSessions, agent, projectPath);
    if (conflicting) {
      return c.json({ error: 'duplicate_working_dir', existingSession: conflicting.name }, 409);
    }
    let sessionName = projectName;
    let counter = 1;
    while (herdrSessions.some(s => s.name === sessionName)) {
      sessionName = `${projectName}-${counter++}`;
    }

    // Create new session
    await herdrService.createSession(sessionName);

    // Change to project directory and run the agent's resume command
    const command = `cd ${shellQuote(expandHome(projectPath))} && ${agentResumeCommand(agent, sessionId)}`;
    try {
      await sendTextToSession(sessionName, command);
    } catch {
      // Clean up the session if command failed
      await herdrService.killSession(sessionName);
      return c.json({ error: 'Failed to start agent session' }, 500);
    }

    return c.json({
      success: true,
      tmuxSessionId: sessionName,
      ccSessionId: sessionId,
      agent,
    });
  } catch (_error) {
    return c.json({ error: 'Failed to resume session from history' }, 500);
  }
});

// GET /sessions/:id - Get a specific session
sessions.get('/:id', async (c) => {
  const id = c.req.param('id');
  const herdrSessions = await herdrService.listSessions();
  const session = herdrSessions.find(s => s.id === id);

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

// DELETE /sessions/:id - Delete (kill) a session
sessions.delete('/:id', async (c) => {
  notifySessionChange();
  const id = c.req.param('id');

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    // Already lost — purge from last-known so it disappears from the list.
    await removeLastKnownSession(id).catch(() => {});
    return c.json({ success: true });
  }

  try {
    await herdrService.killSession(id);
    // Keep the entry in last-known so the session shows up as "Lost" and can
    // be resumed via the Resume button without going to the history tab.
    // To purge entirely, delete the Lost session again.
    return c.json({ success: true });
  } catch (_error) {
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});

// POST /sessions/:id/resume - Resume an agent session in an existing session
sessions.post('/:id/resume', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResumeSessionSchema.safeParse(body);

  const herdrSessions = await herdrService.listSessions();
  const session = herdrSessions.find(s => s.id === id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const sessionId = parsed.success ? (parsed.data.sessionId ?? parsed.data.ccSessionId) : undefined;
    const requestedAgent = parsed.success ? parsed.data.agent : undefined;
    const agent: AgentProvider = requestedAgent ?? session.agent ?? DEFAULT_AGENT_PROVIDER;
    const command = agentResumeCommand(agent, sessionId);

    await sendTextToSession(id, command);

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

  const exists = await herdrService.sessionExists(id);
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

  const exists = await herdrService.sessionExists(id);
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

// POST /sessions/:id/move - Move a session to `index` in the display order.
// The order lives in herdr (workspace order), not in cchub — so this is a
// write straight through to herdr rather than to a cchub-side store.
sessions.post('/:id/move', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const index = (body as { index?: unknown }).index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return c.json({ error: 'Invalid index' }, 400);
  }
  try {
    const moved = await herdrService.moveSession(id, index);
    if (!moved) return c.json({ error: 'Session not found' }, 404);
    notifySessionChange();
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to move session' },
      500,
    );
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

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    await withControlSession(id, (cs) => cs.selectPane(parsed.data.paneId));
    herdrService.invalidateCache();
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

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    // rejects the last pane itself
    await withControlSession(id, (cs) => cs.closePane(parsed.data.paneId));
    herdrService.invalidateCache();
    notifySessionChange();
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to close pane';
    const status = message.includes('last pane') ? 400 : 500;
    return c.json({ error: message }, status);
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

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    await withControlSession(id, (cs) => cs.splitPane(parsed.data.paneId, parsed.data.direction));
    herdrService.invalidateCache();
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

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // herdr has no dead-pane/respawn concept; exited panes are closed.
  return c.json({ error: 'respawn-pane is not supported' }, 501);
});

// POST /sessions/:id/panes/input - Send raw input bytes to a specific pane
sessions.post('/:id/panes/input', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = PaneInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    return await withControlSession(id, async (controlSession) => {
      const panes = await controlSession.listPanes();
      const targetPane = panes.find((p) => p.paneId === parsed.data.paneId);
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
      const viewport = await captureViewportSnapshot(controlSession, parsed.data.paneId, parsed.data.lines);
      return c.json({
        success: true,
        paneId: parsed.data.paneId,
        bytes: buffer.length,
        viewport,
      });
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

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    return await withControlSession(id, async (controlSession) => {
      const panes = await controlSession.listPanes();
      if (!panes.find((p) => p.paneId === paneId)) {
        return c.json({ error: 'Pane not found' }, 404);
      }
      const viewport = await captureViewportSnapshot(controlSession, paneId, lines);
      if (!viewport) {
        return c.json({ error: 'Failed to capture viewport' }, 500);
      }
      return c.json(viewport);
    });
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

  const exists = await herdrService.sessionExists(id);
  if (!exists) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    // Bracketed paste + separately-delivered \r (see sendTextToSession)
    const paneId = await sendTextToSession(id, text, { bracketed: true });
    return c.json({ success: true, paneId });
  } catch (_error) {
    return c.json({ error: 'Failed to send prompt' }, 500);
  }
});
