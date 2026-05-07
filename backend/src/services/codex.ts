import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

export interface CodexTokenUsage {
  contextTokens?: number;
  contextMaxTokens?: number;
  contextPercent?: number;
  totalInputTokens?: number;
  totalCacheReadTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

export interface CodexThread {
  sessionId: string;
  title?: string;
  firstPrompt?: string;
  tokensUsed?: number;
  tokenUsage?: CodexTokenUsage;
  gitBranch?: string;
  cwd: string;
  createdAt?: string;
  updatedAt?: string;
}

interface CodexThreadRow {
  id: string;
  title: string | null;
  first_user_message: string | null;
  tokens_used: number | null;
  rollout_path: string | null;
  git_branch: string | null;
  cwd: string;
  created_at: number | null;
  updated_at: number | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
}

function epochToIso(seconds?: number | null, millis?: number | null): string | undefined {
  const timestamp = typeof millis === 'number' && millis > 0
    ? millis
    : typeof seconds === 'number' && seconds > 0
      ? seconds * 1000
      : undefined;
  return timestamp ? new Date(timestamp).toISOString() : undefined;
}

interface CodexTokenCountEvent {
  type?: string;
  payload?: {
    type?: string;
    info?: {
      total_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
      last_token_usage?: {
        input_tokens?: number;
        total_tokens?: number;
      };
      model_context_window?: number;
    };
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function tokenUsageFromLine(line: string): CodexTokenUsage | undefined {
  let event: CodexTokenCountEvent;
  try {
    event = JSON.parse(line) as CodexTokenCountEvent;
  } catch {
    return undefined;
  }

  if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') return undefined;

  const info = event.payload.info;
  const contextTokens = numberOrUndefined(info?.last_token_usage?.input_tokens);
  const contextMaxTokens = numberOrUndefined(info?.model_context_window);
  const total = info?.total_token_usage;
  const contextPercent = contextTokens !== undefined && contextMaxTokens && contextMaxTokens > 0
    ? Math.min(100, Math.round((contextTokens / contextMaxTokens) * 1000) / 10)
    : undefined;

  return {
    contextTokens,
    contextMaxTokens,
    contextPercent,
    totalInputTokens: numberOrUndefined(total?.input_tokens),
    totalCacheReadTokens: numberOrUndefined(total?.cached_input_tokens),
    totalOutputTokens: numberOrUndefined(total?.output_tokens),
    totalTokens: numberOrUndefined(total?.total_tokens),
  };
}

function findLatestTokenUsageInText(text: string): CodexTokenUsage | undefined {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line || !line.includes('"token_count"')) continue;
    const usage = tokenUsageFromLine(line);
    if (usage) return usage;
  }
  return undefined;
}

function readLatestTokenUsage(rolloutPath?: string | null): CodexTokenUsage | undefined {
  if (!rolloutPath || !existsSync(rolloutPath)) return undefined;

  try {
    const stat = statSync(rolloutPath);
    const maxTailBytes = 4 * 1024 * 1024;
    if (stat.size <= maxTailBytes) {
      return findLatestTokenUsageInText(readFileSync(rolloutPath, 'utf8'));
    }

    const fd = openSync(rolloutPath, 'r');
    try {
      const bytesToRead = Math.min(stat.size, maxTailBytes);
      const buffer = Buffer.alloc(bytesToRead);
      readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
      return findLatestTokenUsageInText(buffer.toString('utf8'));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function rowToThread(row: CodexThreadRow): CodexThread {
  return {
    sessionId: row.id,
    title: row.title || undefined,
    firstPrompt: row.first_user_message || undefined,
    tokensUsed: typeof row.tokens_used === 'number' ? row.tokens_used : undefined,
    tokenUsage: readLatestTokenUsage(row.rollout_path),
    gitBranch: row.git_branch || undefined,
    cwd: row.cwd,
    createdAt: epochToIso(row.created_at, row.created_at_ms),
    updatedAt: epochToIso(row.updated_at, row.updated_at_ms),
  };
}

export class CodexService {
  private dbPath: string;
  private cache: { timestamp: number; data: Map<string, CodexThread> } | null = null;
  private static readonly CACHE_TTL = 5000;

  constructor(dbPath = join(homedir(), '.codex', 'state_5.sqlite')) {
    this.dbPath = dbPath;
  }

  async getThreadsForPaths(paths: string[]): Promise<Map<string, CodexThread>> {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (uniquePaths.length === 0) return new Map();

    if (this.cache && Date.now() - this.cache.timestamp < CodexService.CACHE_TTL) {
      return new Map(uniquePaths.flatMap(path => {
        const thread = this.cache?.data.get(path);
        return thread ? [[path, thread] as const] : [];
      }));
    }

    const allThreads = this.loadLatestThreadsByCwd();
    this.cache = { timestamp: Date.now(), data: allThreads };

    return new Map(uniquePaths.flatMap(path => {
      const thread = allThreads.get(path);
      return thread ? [[path, thread] as const] : [];
    }));
  }

  async getThreadForPath(path: string): Promise<CodexThread | undefined> {
    return (await this.getThreadsForPaths([path])).get(path);
  }

  private loadLatestThreadsByCwd(): Map<string, CodexThread> {
    const result = new Map<string, CodexThread>();
    if (!existsSync(this.dbPath)) return result;

    let db: Database | undefined;
    try {
      db = new Database(this.dbPath, { readonly: true });
      const rows = db.query<CodexThreadRow, []>(`
        SELECT
          id,
          title,
          first_user_message,
          tokens_used,
          rollout_path,
          git_branch,
          cwd,
          created_at,
          updated_at,
          created_at_ms,
          updated_at_ms
        FROM threads
        WHERE archived = 0
        ORDER BY COALESCE(updated_at_ms, updated_at * 1000, 0) DESC
      `).all();

      for (const row of rows) {
        if (!result.has(row.cwd)) {
          result.set(row.cwd, rowToThread(row));
        }
      }
    } catch {
      return new Map();
    } finally {
      db?.close();
    }

    return result;
  }
}
