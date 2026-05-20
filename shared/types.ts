import { z } from 'zod';

// =============================================================================
// Session State
// =============================================================================

export type SessionState =
  | 'idle'
  | 'working'
  | 'waiting_input'
  | 'waiting_permission'
  | 'disconnected'
  | 'lost';

// =============================================================================
// Entities
// =============================================================================

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
  state: SessionState;
  ownerId: string;
}


// =============================================================================
// API Response Types
// =============================================================================

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
  };
}

// Session theme colors
export type SessionTheme = 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'blue' | 'indigo' | 'purple' | 'pink';

export const AGENT_PROVIDERS = {
  claude: {
    id: 'claude',
    command: 'claude',
    resumeCommand: 'claude -r',
    labelKey: 'session.agentProvider.claude',
    processPatterns: [/(?:^|\/)claude(?:\s|$)/, /\/claude\/versions\//],
    supportsConversationMetadata: true,
  },
  codex: {
    id: 'codex',
    command: 'codex',
    resumeCommand: 'codex resume',
    labelKey: 'session.agentProvider.codex',
    processPatterns: [/(?:^|\/)codex(?:\s|$)/, /\/@openai\/codex\//],
    supportsConversationMetadata: false,
  },
} as const;

export type AgentProvider = keyof typeof AGENT_PROVIDERS;
export const AGENT_PROVIDER_IDS = Object.keys(AGENT_PROVIDERS) as [AgentProvider, ...AgentProvider[]];
export const DEFAULT_AGENT_PROVIDER: AgentProvider = 'claude';

export function isAgentProvider(value: string): value is AgentProvider {
  return value in AGENT_PROVIDERS;
}

export function detectAgentProviderFromArgs(args: string): AgentProvider | undefined {
  for (const agent of Object.values(AGENT_PROVIDERS)) {
    if (agent.processPatterns.some(pattern => pattern.test(args))) {
      return agent.id;
    }
  }
  return undefined;
}

export function agentSupportsConversationMetadata(agent: string | undefined): boolean {
  return !!agent && isAgentProvider(agent) && AGENT_PROVIDERS[agent].supportsConversationMetadata;
}

export function agentResumeCommand(agent: AgentProvider, sessionId?: string): string {
  const base = AGENT_PROVIDERS[agent].resumeCommand;
  return sessionId ? `${base} ${sessionId}` : base;
}

export interface SessionResponse {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
  state: SessionState;
  currentPath?: string;
  agent?: AgentProvider;
  theme?: SessionTheme;
  customTitle?: string;
}

export interface SessionListResponse {
  sessions: SessionResponse[];
}

export interface ErrorResponse {
  error: string;
  code?: string;
}

// =============================================================================
// Validation Schemas
// =============================================================================

// Simple password-only login (for server password auth)
export const LoginSchema = z.object({
  password: z.string().min(1),
});


// Pane ID validation (e.g., "%0", "%1")
export const PaneIdSchema = z.string().regex(/^%\d+$/, 'Invalid pane ID');

export interface PaneInfo {
  paneId: string;          // "%0", "%1"
  currentCommand?: string;
  currentPath?: string;
  title?: string;          // pane_title set by Claude Code (task description)
  agentName?: string;      // Team agent name from --agent-name process arg
  agentColor?: string;     // Team agent color from --agent-color process arg
  isActive: boolean;
  isDead?: boolean;
  indicatorState?: IndicatorState;
  pid?: number;            // tmux pane_pid (shell/subprocess PID)
}

export interface SessionMetrics {
  contextTokens?: number;              // current context window size (last assistant message sum)
  contextMaxTokens?: number;           // model-specific max (from Anthropic /v1/models)
  contextPercent?: number;             // 0-100
  totalInputTokens?: number;           // cumulative uncached input tokens
  totalCacheCreationTokens?: number;   // cumulative cache creation tokens
  totalCacheReadTokens?: number;       // cumulative cache read tokens
  totalOutputTokens?: number;          // cumulative output tokens
  totalTokens?: number;                // effective usage: input + cache_creation + output (cache_read excluded)
  memoryRssBytes?: number;             // total RSS across session's panes
}

export const CreateSessionSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  workingDir: z.string().optional(),
  initialPrompt: z.string().max(1000).optional(),
  agent: z.enum(AGENT_PROVIDER_IDS).optional().default(DEFAULT_AGENT_PROVIDER),
});

export const ResizeTerminalSchema = z.object({
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(200),
});


// Type inference from schemas
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type ResizeTerminalInput = z.infer<typeof ResizeTerminalSchema>;

// =============================================================================
// File Viewer Types
// =============================================================================

export type FileType = 'file' | 'directory' | 'symlink';

export interface FileInfo {
  name: string;
  path: string;
  type: FileType;
  size: number;
  modifiedAt: string;
  isHidden: boolean;
  extension?: string;
}

export interface FileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  mimeType: string;
  size: number;
  truncated: boolean;
}

export interface FileChange {
  path: string;
  toolName: 'Write' | 'Edit';
  timestamp: string;
  oldContent?: string;
  newContent?: string;
}

export interface FileListResponse {
  path: string;
  files: FileInfo[];
  parentPath: string | null;
}

export interface FileReadResponse {
  file: FileContent;
}

export interface FileChangesResponse {
  sessionId: string;
  changes: FileChange[];
}

// Git diff types
export type GitChangeStatus = 'M' | 'A' | 'D' | 'R' | '??' | 'U';

export interface GitFileChange {
  path: string;
  status: GitChangeStatus;
  staged: boolean;
}

export interface GitChangesResponse {
  workingDir: string;
  changes: GitFileChange[];
  branch: string;
}

export interface GitDiffResponse {
  diff: string;
  path: string;
}

// =============================================================================
// Dashboard Types
// =============================================================================

export type IndicatorState = 'processing' | 'waiting_input' | 'idle' | 'completed';

export interface LimitRange {
  min: number;
  max: number;
}

export interface CycleLimitInfo {
  used: number;
  limit: LimitRange;
  percentage: number;
  resetTime?: string;
  isStale?: boolean; // Data is older than expected cycle
}

export interface LimitsInfo {
  plan: string;
  cycle5h: CycleLimitInfo;
  weeklyOpus: CycleLimitInfo;
  weeklySonnet: CycleLimitInfo;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ModelUsage {
  model: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCacheRead: number;
  totalCacheWrite: number;
}

export interface CostEstimate {
  model: string;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

// Usage limits from Anthropic API
export interface UsageCycleInfo {
  utilization: number;
  resetsAt: string;
  timeRemaining: string;
  estimatedHitTime?: string; // When limit will be hit at current rate
  status?: 'safe' | 'warning' | 'danger' | 'exceeded'; // Overall status
  statusMessage?: string; // Human-readable prediction message
}

export interface UsageLimits {
  fiveHour: UsageCycleInfo;
  sevenDay: UsageCycleInfo;
}

// Usage limits derived from Codex rollouts (rate_limits in token_count events).
// Free plan only includes the 7-day window; paid plans may include both.
export interface CodexUsageLimits {
  fiveHour?: UsageCycleInfo;
  sevenDay?: UsageCycleInfo;
  planType?: string;
  capturedAt?: string; // timestamp of the rollout event the limits were read from
  /**
   * True when Codex's most recent rate_limits event reports `credits.has_credits === false`.
   * OpenAI returns null primary/secondary windows once exhausted, so the cycle data
   * may be from an earlier in-cycle measurement; this flag signals "currently exhausted".
   */
  rateLimitExceeded?: boolean;
}

// Usage history snapshot for line chart
export interface UsageSnapshot {
  timestamp: string; // ISO 8601
  fiveHour: { utilization: number; resetsAt: string };
  sevenDay: { utilization: number; resetsAt: string };
}

export interface UsageHistoryResponse {
  snapshots: UsageSnapshot[];
}

export interface SystemMetricsSnapshot {
  timestamp: number;
  cpuPercent: number;
  memUsedPercent: number;
  memUsedMB: number;
  memTotalMB: number;
  swapUsedMB: number;
  swapTotalMB: number;
}

export interface SystemMetrics {
  current: SystemMetricsSnapshot;
  history: SystemMetricsSnapshot[];
  loadAvg: [number, number, number]; // 1, 5, 15 min
  cpuCount: number;
}

export type UsageLimitsErrorReason =
  | 'no-credentials'
  | 'rate-limited'
  | 'unauthorized'
  | 'fetch-failed'
  | 'unknown';

export interface UsageLimitsStatus {
  errorReason?: UsageLimitsErrorReason;
  rateLimitedUntil?: string; // ISO 8601 — when backoff ends
  lastFetchAt?: string; // ISO 8601 — when the last attempt happened
  isStale?: boolean; // true when serving cached data while backing off
}

export interface DashboardResponse {
  limits: LimitsInfo | null; // Deprecated, kept for compatibility
  usageLimits: UsageLimits | null; // New: from Anthropic API
  usageLimitsStatus?: UsageLimitsStatus; // Error/state info for UI
  codexUsageLimits?: CodexUsageLimits | null; // From Codex rollouts
  usageHistory: UsageSnapshot[]; // Usage history for line chart
  dailyActivity: DailyActivity[];
  modelUsage: ModelUsage[];
  costEstimates: CostEstimate[];
  hourlyActivity?: Record<number, number>; // Phase 3: Hour (0-23) -> session count
  version?: string; // CC Hub version
  systemMetrics?: SystemMetrics; // System CPU/memory metrics
  diskUsage?: { total: number; used: number; available: number; mountpoint: string };
  connectedClients?: number;
}

export interface ExtendedSessionResponse extends SessionResponse {
  indicatorState?: IndicatorState;
  ccSessionId?: string;
  agentSessionId?: string;
  currentCommand?: string;
  paneTitle?: string;
  ccSummary?: string;
  ccFirstPrompt?: string;
  ccRecap?: string;
  ccRecapAt?: string;
  waitingToolName?: string;
  panes?: PaneInfo[];
  messageCount?: number;
  gitBranch?: string;
  durationMinutes?: number;
  firstMessageId?: string;
  metrics?: SessionMetrics;
}

// =============================================================================
// Session History Types
// =============================================================================

export interface HistorySession {
  sessionId: string;
  projectPath: string;
  projectName: string;
  firstPrompt?: string;
  summary?: string;
  modified: string;
  // Phase 2 additions
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  messageCount?: number;
  gitBranch?: string;
  // For session matching with active sessions
  firstMessageUuid?: string;
  // Which agent produced this history entry. Drives the resume command
  // (`claude -r <id>` vs `codex resume <id>`) and the badge in the UI.
  agent?: AgentProvider;
}

export interface HistorySessionsResponse {
  sessions: HistorySession[];
}

export interface ToolUseInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultImage {
  mediaType: string;
  data: string;
}

export interface ToolResultInfo {
  toolUseId: string;
  toolName?: string;
  output: string;
  images?: ToolResultImage[];
  isError?: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  thinking?: string;
  toolUse?: ToolUseInfo[];
  toolResult?: ToolResultInfo[];
}

export interface ConversationResponse {
  messages: ConversationMessage[];
}

// =============================================================================
// tmux Control Mode Types
// =============================================================================

// tmux layout tree node (parsed from layout string)
export interface TmuxLayoutNode {
  type: 'leaf' | 'horizontal' | 'vertical';
  width: number;
  height: number;
  x: number;
  y: number;
  paneId?: number; // leaf only: pane number
  children?: TmuxLayoutNode[];
}

// -----------------------------------------------------------------------------
// Server-side scrollback (viewport on demand)
//
// tmux is the authoritative store for both the visible region and the
// scrollback. The frontend keeps no buffer of its own; it asks for a
// `viewport` window (offset rows above the live edge) and the server
// answers with the lines tmux currently has for that range.
// -----------------------------------------------------------------------------

export interface PaneCursor {
  x: number;          // 0-based column
  y: number;          // 0-based row within visible area (live mode only)
  visible: boolean;
}

export interface PaneModes {
  altScreen: boolean;      // alternate screen buffer active (vim, htop, etc.)
}

export interface PaneViewport {
  paneId: string;
  cols: number;            // pane width (cells)
  rows: number;            // pane height (cells)
  lines: string[];         // exactly `rows` entries, top-to-bottom, ANSI-encoded
  cursor: PaneCursor;      // cursor.visible=false when offset>0 (scrolled away)
  modes: PaneModes;
  // tmux history_size at capture time. Total scrollback extent above the
  // live edge — the frontend uses this to size its ScrollOverlay.
  historySize: number;
  // Echo of the request's offset (0 = live edge, N = N rows scrolled up).
  offset: number;
  atTail: boolean;         // offset === 0
}

// Client → Server messages
export type ControlClientMessage =
  | { type: 'input'; paneId: string; data: string } // base64
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'split'; paneId: string; direction: 'h' | 'v' }
  | { type: 'close-pane'; paneId: string }
  | { type: 'resize-pane'; paneId: string; cols: number; rows: number }
  | { type: 'select-pane'; paneId: string }
  | { type: 'ping'; timestamp: number }
  | { type: 'client-info'; deviceType: 'mobile' | 'tablet' | 'desktop' }
  | { type: 'adjust-pane'; paneId: string; direction: 'L' | 'R' | 'U' | 'D'; amount: number }
  | { type: 'equalize-panes'; direction: 'horizontal' | 'vertical' }
  | { type: 'zoom-pane'; paneId: string }
  | { type: 'respawn-pane'; paneId: string }
  // Ask the server for a viewport `offset` rows above the live edge.
  // offset=0 means live mode; the server will also push fresh viewports
  // unsolicited when new output arrives.
  | { type: 'request-viewport'; paneId: string; offset: number };

// Server → Client messages
export type ControlServerMessage =
  | { type: 'layout'; layout: TmuxLayoutNode }
  // Viewport payload. Sent in reply to `request-viewport` and pushed
  // unsolicited to live-mode (offset=0) subscribers when tmux emits output.
  | { type: 'viewport'; viewport: PaneViewport }
  | { type: 'ready' }
  | { type: 'pong'; timestamp: number }
  | { type: 'error'; message: string; paneId?: string }
  | { type: 'new-session'; sessionId: string; sessionName: string }
  | { type: 'pane-dead'; paneId: string }
  | { type: 'hook-event'; event: string; cwd?: string; sessionId?: string; message?: string; data?: Record<string, unknown> };

// =============================================================================
// Multiplexed WebSocket Types (single WS per client)
// =============================================================================

// Client → Server messages for /ws/mux
export type MuxClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'subscribe-conversation'; sessionId: string }
  | { type: 'unsubscribe-conversation'; sessionId: string }
  | (ControlClientMessage & { sessionId: string });

// Server → Client messages for /ws/mux
export type MuxServerMessage =
  | { type: 'subscribed'; sessionId: string }
  | { type: 'unsubscribed'; sessionId: string }
  | { type: 'sessions-updated'; sessions: SessionResponse[] }
  | { type: 'conversation-subscribed'; sessionId: string; ccSessionId: string | null }
  | { type: 'conversation-unsubscribed'; sessionId: string }
  | { type: 'initial-conversation'; sessionId: string; messages: ConversationMessage[] }
  | { type: 'conversation-update'; sessionId: string; messages: ConversationMessage[] }
  | (ControlServerMessage & { sessionId: string });
