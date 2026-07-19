import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentThread, AgentThreadService, AgentTokenUsage } from './agent-providers';

/** One Kimi Code session as recorded under `~/.kimi-code/sessions`. */
export interface KimiSessionInfo {
  sessionId: string;
  cwd: string;
  /** Absolute session directory (holds state.json + agents/). */
  dir: string;
  title?: string;
  firstPrompt?: string;
  createdAt?: string;
  updatedAt: string;
}

interface KimiStateJson {
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  workDir?: string;
}

/** Minimal shape of a wire.jsonl `turn.prompt` record. */
interface KimiTurnPromptRecord {
  input?: unknown;
  origin?: { kind?: unknown };
}

/** Path of the main agent's wire log inside a session directory. */
export function kimiWirePath(sessionDir: string): string {
  return join(sessionDir, 'agents', 'main', 'wire.jsonl');
}

/** Joined text of a `turn.prompt` record's text parts (user-origin only). */
export function turnPromptText(record: KimiTurnPromptRecord): string {
  if (record.origin?.kind !== 'user') return '';
  if (!Array.isArray(record.input)) return '';
  return record.input
    .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Kimi Code stores each session under
 * `~/.kimi-code/sessions/wd_<name>_<hash>/session_<uuid>/` with a `state.json`
 * (title / workDir / timestamps) and the main agent's wire log in
 * `agents/main/wire.jsonl`, whose `turn.prompt` records carry the user prompts
 * and whose `usage.record` records carry per-turn token usage. Sub-agent wires
 * (`agents/agent-N/`) are ignored.
 */
export class KimiSessionStore {
  private sessionsDir: string;
  private cache: { timestamp: number; sessions: KimiSessionInfo[] } | null = null;
  private static readonly CACHE_TTL = 5000;

  constructor(sessionsDir = join(homedir(), '.kimi-code', 'sessions')) {
    this.sessionsDir = sessionsDir;
  }

  async listSessions(): Promise<KimiSessionInfo[]> {
    if (this.cache && Date.now() - this.cache.timestamp < KimiSessionStore.CACHE_TTL) {
      return this.cache.sessions;
    }
    const sessions = await this.scan();
    this.cache = { timestamp: Date.now(), sessions };
    return sessions;
  }

  async findSession(sessionId: string): Promise<KimiSessionInfo | undefined> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.sessionId === sessionId);
  }

  private async scan(): Promise<KimiSessionInfo[]> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.sessionsDir);
    } catch {
      return [];
    }

    const results: KimiSessionInfo[] = [];
    await Promise.all(projectDirs.map(async (wdDir) => {
      if (!wdDir.startsWith('wd_')) return; // stray files next to the project dirs
      const projectDir = join(this.sessionsDir, wdDir);

      let entries: string[];
      try {
        entries = await readdir(projectDir);
      } catch {
        return;
      }

      await Promise.all(entries.map(async (name) => {
        const sessionDir = join(projectDir, name);
        const state = await this.readState(join(sessionDir, 'state.json'));
        if (!state?.updatedAt || !state.workDir) return;
        results.push({
          sessionId: name,
          cwd: state.workDir,
          dir: sessionDir,
          title: state.title,
          firstPrompt: readFirstKimiPrompt(sessionDir),
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        });
      }));
    }));
    return results;
  }

  private async readState(path: string): Promise<KimiStateJson | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as KimiStateJson;
    } catch {
      return null;
    }
  }
}

/** First real user prompt: the first `turn.prompt` record in the main wire. */
function readFirstKimiPrompt(sessionDir: string): string | undefined {
  const wirePath = kimiWirePath(sessionDir);
  if (!existsSync(wirePath)) return undefined;
  let text: string;
  try {
    const stat = statSync(wirePath);
    // Bounded head read: the first prompt sits near the top, but config.update
    // records with the full system prompt can push it back tens of KB.
    const maxHeadBytes = 1024 * 1024;
    const size = Math.min(stat.size, maxHeadBytes);
    const fd = openSync(wirePath, 'r');
    try {
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, 0);
      text = buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }

  for (const line of text.split('\n')) {
    if (!line.includes('"turn.prompt"')) continue;
    try {
      const prompt = turnPromptText(JSON.parse(line) as KimiTurnPromptRecord);
      if (prompt) return prompt;
    } catch {
      // partial last line of the head slice, or a malformed record
    }
  }
  return undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Tail-read the main wire.jsonl and return the usage block of the last
 * `usage.record` record. Bounded read (like the Grok reader) so multi-MB
 * streams don't get re-parsed on every sessions push.
 */
export function readLatestKimiTokenUsage(sessionDir: string): AgentTokenUsage | undefined {
  const wirePath = kimiWirePath(sessionDir);
  if (!existsSync(wirePath)) return undefined;
  let text: string;
  try {
    const stat = statSync(wirePath);
    const maxTailBytes = 1024 * 1024;
    if (stat.size <= maxTailBytes) {
      const fd = openSync(wirePath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size);
        readSync(fd, buffer, 0, stat.size, 0);
        text = buffer.toString('utf8');
      } finally {
        closeSync(fd);
      }
    } else {
      const fd = openSync(wirePath, 'r');
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
    if (!line?.includes('"usage.record"')) continue;
    try {
      const record = JSON.parse(line) as {
        type?: string;
        model?: unknown;
        usage?: {
          inputOther?: unknown;
          inputCacheRead?: unknown;
          inputCacheCreation?: unknown;
          output?: unknown;
        };
      };
      if (record.type !== 'usage.record' || !record.usage) continue;
      const usage = record.usage;
      const cacheRead = numberOrUndefined(usage.inputCacheRead);
      const inputParts = [usage.inputOther, usage.inputCacheRead, usage.inputCacheCreation]
        .map(numberOrUndefined)
        .filter((n): n is number => n !== undefined);
      const totalInputTokens = inputParts.length > 0 ? inputParts.reduce((a, b) => a + b, 0) : undefined;
      const output = numberOrUndefined(usage.output);
      return {
        model: typeof record.model === 'string' ? record.model : undefined,
        totalInputTokens,
        totalCacheReadTokens: cacheRead,
        totalOutputTokens: output,
        totalTokens: totalInputTokens !== undefined || output !== undefined
          ? (totalInputTokens ?? 0) + (output ?? 0)
          : undefined,
      };
    } catch {
      // partial first line of the tail slice, or a malformed record
    }
  }
  return undefined;
}

/** Exact Kimi Code sessions by native session id, for the active-sessions list. */
export class KimiService implements AgentThreadService {
  private store: KimiSessionStore;

  constructor(store = new KimiSessionStore()) {
    this.store = store;
  }

  async getThreadsByIds(sessionIds: string[]): Promise<Map<string, AgentThread>> {
    const uniqueIds = new Set(sessionIds.filter(Boolean));
    if (uniqueIds.size === 0) return new Map();

    const sessions = await this.store.listSessions();
    const result = new Map<string, AgentThread>();
    for (const s of sessions) {
      if (!uniqueIds.has(s.sessionId)) continue;
      result.set(s.sessionId, {
        sessionId: s.sessionId,
        title: s.title,
        firstPrompt: s.firstPrompt,
        tokenUsage: readLatestKimiTokenUsage(s.dir),
        cwd: s.cwd,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }
    return result;
  }
}
