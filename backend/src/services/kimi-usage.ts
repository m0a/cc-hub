import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { KimiUsageSummary, KimiUsageWindow } from '../../../shared/types';
import { KimiSessionStore } from './kimi';

interface UsageRecord {
  /** Unix ms. */
  timestamp: number;
  totalTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  model?: string;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function emptyWindow(): KimiUsageWindow {
  return { turns: 0, totalTokens: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
}

function addToWindow(window: KimiUsageWindow, record: UsageRecord): void {
  window.turns++;
  window.totalTokens += record.totalTokens;
  window.inputTokens += record.inputTokens;
  window.cacheReadTokens += record.cacheReadTokens;
  window.outputTokens += record.outputTokens;
}

/**
 * Aggregates Kimi Code token consumption from `usage.record` records in each
 * session's `agents/<agentId>/wire.jsonl` — sub-agent wires included, their tokens
 * are real consumption. Kimi stores no rate-limit windows or plan data
 * locally, so consumption totals are all a dashboard can honestly show.
 */
export class KimiUsageService {
  private store: KimiSessionStore;
  private cache: { timestamp: number; data: KimiUsageSummary | null } | null = null;
  private static readonly CACHE_TTL = 30_000;
  private static readonly WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly WINDOW_24H_MS = 24 * 60 * 60 * 1000;

  constructor(store = new KimiSessionStore()) {
    this.store = store;
  }

  async getUsageSummary(): Promise<KimiUsageSummary | null> {
    if (this.cache && Date.now() - this.cache.timestamp < KimiUsageService.CACHE_TTL) {
      return this.cache.data;
    }
    const data = await this.build();
    this.cache = { timestamp: Date.now(), data };
    return data;
  }

  private async build(): Promise<KimiUsageSummary | null> {
    const now = Date.now();
    const cutoff7d = now - KimiUsageService.WINDOW_7D_MS;
    const sessions = (await this.store.listSessions()).filter(
      (s) => new Date(s.updatedAt).getTime() >= cutoff7d,
    );
    if (sessions.length === 0) return null;

    const records: UsageRecord[] = [];
    let sessionsWithUsage = 0;
    await Promise.all(sessions.map(async (s) => {
      const sessionRecords = await this.readSessionRecords(s.dir, cutoff7d);
      if (sessionRecords.length > 0) sessionsWithUsage++;
      records.push(...sessionRecords);
    }));
    if (records.length === 0) return null;

    records.sort((a, b) => a.timestamp - b.timestamp);
    const last24h = emptyWindow();
    const last7d = emptyWindow();
    const modelTotals = new Map<string, number>();
    const cutoff24h = now - KimiUsageService.WINDOW_24H_MS;
    for (const record of records) {
      addToWindow(last7d, record);
      if (record.timestamp >= cutoff24h) addToWindow(last24h, record);
      if (record.model) {
        modelTotals.set(record.model, (modelTotals.get(record.model) ?? 0) + record.totalTokens);
      }
    }

    const models = Array.from(modelTotals.entries())
      .map(([model, totalTokens]) => ({ model, totalTokens }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      last24h,
      last7d,
      models,
      sessions7d: sessionsWithUsage,
      lastTurnAt: new Date(records[records.length - 1].timestamp).toISOString(),
    };
  }

  /** usage.record entries across all agent wires of one session dir. */
  private async readSessionRecords(sessionDir: string, cutoffMs: number): Promise<UsageRecord[]> {
    let agentIds: string[];
    try {
      agentIds = await readdir(join(sessionDir, 'agents'));
    } catch {
      return [];
    }
    const records: UsageRecord[] = [];
    await Promise.all(agentIds.map(async (agentId) => {
      records.push(...await this.readRecords(join(sessionDir, 'agents', agentId, 'wire.jsonl'), cutoffMs));
    }));
    return records;
  }

  private async readRecords(wirePath: string, cutoffMs: number): Promise<UsageRecord[]> {
    // Skip files that clearly predate the window before reading them.
    try {
      if ((await stat(wirePath)).mtimeMs < cutoffMs) return [];
    } catch {
      return [];
    }
    let text: string;
    try {
      text = await readFile(wirePath, 'utf8');
    } catch {
      return [];
    }

    const records: UsageRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.includes('"usage.record"')) continue;
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
          time?: unknown;
        };
        if (record.type !== 'usage.record' || !record.usage) continue;
        const timestamp = typeof record.time === 'number' ? record.time : 0;
        if (timestamp < cutoffMs) continue;
        const usage = record.usage;
        const cacheReadTokens = numberOrZero(usage.inputCacheRead);
        const inputTokens = numberOrZero(usage.inputOther) + cacheReadTokens + numberOrZero(usage.inputCacheCreation);
        const outputTokens = numberOrZero(usage.output);
        records.push({
          timestamp,
          totalTokens: inputTokens + outputTokens,
          inputTokens,
          cacheReadTokens,
          outputTokens,
          model: typeof record.model === 'string' ? record.model : undefined,
        });
      } catch {
        // malformed line
      }
    }
    return records;
  }
}
