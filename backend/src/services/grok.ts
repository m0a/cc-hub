import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentThread, AgentThreadService, AgentTokenUsage } from './agent-providers';

/** One Grok Build session as recorded under `~/.grok/sessions`. */
export interface GrokSessionInfo {
  sessionId: string;
  cwd: string;
  /** Absolute session directory (holds chat_history.jsonl etc.). */
  dir: string;
  title?: string;
  firstPrompt?: string;
  createdAt?: string;
  updatedAt: string;
}

interface GrokSummaryJson {
  info?: { id?: string; cwd?: string };
  session_summary?: string;
  generated_title?: string;
  created_at?: string;
  updated_at?: string;
  last_active_at?: string;
}

/**
 * Grok Build stores each session under
 * `~/.grok/sessions/<URL-encoded cwd>/<session-uuid>/` with a `summary.json`
 * (id / cwd / title / timestamps), the full conversation in
 * `chat_history.jsonl`, and a `session/update` JSON-RPC stream in
 * `updates.jsonl` whose `turn_completed` records carry token usage.
 * Each project dir also has a `prompt_history.jsonl` with the real first
 * prompt per session id.
 *
 * The scanner decodes the directory name instead of re-encoding cwds so it
 * can never disagree with Grok's own percent-encoding.
 */
export class GrokSessionStore {
  private sessionsDir: string;
  private cache: { timestamp: number; sessions: GrokSessionInfo[] } | null = null;
  private static readonly CACHE_TTL = 5000;

  constructor(sessionsDir = join(homedir(), '.grok', 'sessions')) {
    this.sessionsDir = sessionsDir;
  }

  async listSessions(): Promise<GrokSessionInfo[]> {
    if (this.cache && Date.now() - this.cache.timestamp < GrokSessionStore.CACHE_TTL) {
      return this.cache.sessions;
    }
    const sessions = await this.scan();
    this.cache = { timestamp: Date.now(), sessions };
    return sessions;
  }

  async findSession(sessionId: string): Promise<GrokSessionInfo | undefined> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.sessionId === sessionId);
  }

  private async scan(): Promise<GrokSessionInfo[]> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.sessionsDir);
    } catch {
      return [];
    }

    const results: GrokSessionInfo[] = [];
    await Promise.all(projectDirs.map(async (encoded) => {
      let cwd: string;
      try {
        cwd = decodeURIComponent(encoded);
      } catch {
        return;
      }
      if (!cwd.startsWith('/')) return; // sqlite / lock files etc.
      const projectDir = join(this.sessionsDir, encoded);

      let entries: string[];
      try {
        entries = await readdir(projectDir);
      } catch {
        return;
      }
      const firstPrompts = await this.readPromptHistory(join(projectDir, 'prompt_history.jsonl'));

      await Promise.all(entries.map(async (name) => {
        const sessionDir = join(projectDir, name);
        const summary = await this.readSummary(join(sessionDir, 'summary.json'));
        if (!summary) return;
        const sessionId = summary.info?.id ?? name;
        const updatedAt = summary.last_active_at ?? summary.updated_at ?? summary.created_at;
        if (!updatedAt) return;
        results.push({
          sessionId,
          cwd: summary.info?.cwd ?? cwd,
          dir: sessionDir,
          title: summary.generated_title ?? summary.session_summary,
          firstPrompt: firstPrompts.get(sessionId) ?? summary.session_summary,
          createdAt: summary.created_at,
          updatedAt,
        });
      }));
    }));
    return results;
  }

  private async readSummary(path: string): Promise<GrokSummaryJson | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as GrokSummaryJson;
    } catch {
      return null;
    }
  }

  /** First prompt per session id from the project-level prompt_history.jsonl. */
  private async readPromptHistory(path: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch {
      return result;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { session_id?: string; prompt?: string };
        if (entry.session_id && entry.prompt && !result.has(entry.session_id)) {
          result.set(entry.session_id, entry.prompt);
        }
      } catch {
        // skip malformed lines
      }
    }
    return result;
  }
}

interface GrokTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Tail-read updates.jsonl and return the usage block of the last
 * `turn_completed` record. Bounded read (like the Codex reader) so multi-MB
 * streams don't get re-parsed on every sessions push.
 */
export function readLatestGrokTokenUsage(sessionDir: string): AgentTokenUsage | undefined {
  const updatesPath = join(sessionDir, 'updates.jsonl');
  if (!existsSync(updatesPath)) return undefined;
  let text: string;
  try {
    const stat = statSync(updatesPath);
    const maxTailBytes = 1024 * 1024;
    if (stat.size <= maxTailBytes) {
      const fd = openSync(updatesPath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size);
        readSync(fd, buffer, 0, stat.size, 0);
        text = buffer.toString('utf8');
      } finally {
        closeSync(fd);
      }
    } else {
      const fd = openSync(updatesPath, 'r');
      try {
        const buffer = Buffer.alloc(maxTailBytes);
        readSync(fd, buffer, 0, maxTailBytes, stat.size - maxTailBytes);
        text = buffer.toString('utf8');
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    return undefined;
  }

  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes('"turn_completed"')) continue;
    try {
      const record = JSON.parse(line) as {
        params?: { update?: { sessionUpdate?: string; usage?: GrokTurnUsage } };
      };
      const update = record.params?.update;
      if (update?.sessionUpdate !== 'turn_completed' || !update.usage) continue;
      const usage = update.usage;
      return {
        totalInputTokens: numberOrUndefined(usage.inputTokens),
        totalOutputTokens: numberOrUndefined(usage.outputTokens),
        totalCacheReadTokens: numberOrUndefined(usage.cachedReadTokens),
        totalTokens: numberOrUndefined(usage.totalTokens),
      };
    } catch {
      // partial first line of the tail slice, or a malformed record
    }
  }
  return undefined;
}

/** Latest Grok session per working directory, for the active-sessions list. */
export class GrokService implements AgentThreadService {
  private store: GrokSessionStore;

  constructor(store = new GrokSessionStore()) {
    this.store = store;
  }

  async getThreadsForPaths(paths: string[]): Promise<Map<string, AgentThread>> {
    const uniquePaths = new Set(paths.filter(Boolean));
    if (uniquePaths.size === 0) return new Map();

    const sessions = await this.store.listSessions();
    const latestByCwd = new Map<string, GrokSessionInfo>();
    for (const s of sessions) {
      if (!uniquePaths.has(s.cwd)) continue;
      const existing = latestByCwd.get(s.cwd);
      if (!existing || s.updatedAt > existing.updatedAt) latestByCwd.set(s.cwd, s);
    }

    const result = new Map<string, AgentThread>();
    for (const [cwd, s] of latestByCwd) {
      const tokenUsage = readLatestGrokTokenUsage(s.dir);
      result.set(cwd, {
        sessionId: s.sessionId,
        title: s.title,
        firstPrompt: s.firstPrompt,
        tokenUsage,
        cwd,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }
    return result;
  }
}
