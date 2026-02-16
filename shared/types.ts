import { z } from 'zod';

// =============================================================================
// Session State
// =============================================================================

export type SessionState =
  | 'idle'
  | 'working'
  | 'waiting_input'
  | 'waiting_permission'
  | 'disconnected';

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

export interface SessionResponse {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
  state: SessionState;
  isExternal?: boolean;
  theme?: SessionTheme;
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
}

export const CreateSessionSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  workingDir: z.string().optional(),
  initialPrompt: z.string().max(1000).optional(),
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

// Usage history snapshot for line chart
export interface UsageSnapshot {
  timestamp: string; // ISO 8601
  fiveHour: { utilization: number; resetsAt: string };
  sevenDay: { utilization: number; resetsAt: string };
}

export interface UsageHistoryResponse {
  snapshots: UsageSnapshot[];
}

export interface DashboardResponse {
  limits: LimitsInfo | null; // Deprecated, kept for compatibility
  usageLimits: UsageLimits | null; // New: from Anthropic API
  usageHistory: UsageSnapshot[]; // Usage history for line chart
  dailyActivity: DailyActivity[];
  modelUsage: ModelUsage[];
  costEstimates: CostEstimate[];
  hourlyActivity?: Record<number, number>; // Phase 3: Hour (0-23) -> session count
  version?: string; // CC Hub version
}

export interface ExtendedSessionResponse extends SessionResponse {
  indicatorState?: IndicatorState;
  ccSessionId?: string;
  currentCommand?: string;
  currentPath?: string;
  paneTitle?: string;
  ccSummary?: string;
  ccFirstPrompt?: string;
  waitingForInput?: boolean;
  waitingToolName?: string;
  panes?: PaneInfo[];
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
}

export interface HistorySessionsResponse {
  sessions: HistorySession[];
}

export interface ToolUseInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultInfo {
  toolUseId: string;
  toolName?: string;
  output: string;
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
  | { type: 'scroll'; paneId: string; lines: number } // positive = up, negative = down
  | { type: 'adjust-pane'; paneId: string; direction: 'L' | 'R' | 'U' | 'D'; amount: number }
  | { type: 'equalize-panes'; direction: 'horizontal' | 'vertical' }
  | { type: 'request-content'; paneId: string }
  | { type: 'zoom-pane'; paneId: string };

// Server → Client messages
export type ControlServerMessage =
  | { type: 'output'; paneId: string; data: string } // base64
  | { type: 'layout'; layout: TmuxLayoutNode }
  | { type: 'initial-content'; paneId: string; data: string } // base64
  | { type: 'ready' }
  | { type: 'pong'; timestamp: number }
  | { type: 'error'; message: string; paneId?: string }
  | { type: 'new-session'; sessionId: string; sessionName: string };
