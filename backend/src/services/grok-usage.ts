import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GrokUsageSummary, GrokUsageWindow } from '../../../shared/types';
import { GrokSessionStore } from './grok';

interface TurnRecord {
  /** Unix seconds. */
  timestamp: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  models: string[];
}

function emptyWindow(): GrokUsageWindow {
  return { turns: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0 };
}

function addToWindow(window: GrokUsageWindow, turn: TurnRecord): void {
  window.turns++;
  window.totalTokens += turn.totalTokens;
  window.inputTokens += turn.inputTokens;
  window.outputTokens += turn.outputTokens;
}

/**
 * Aggregates Grok Build token consumption from `turn_completed` records in
 * each session's `updates.jsonl`. xAI stores no rate-limit windows locally
 * (nothing like Codex's rate_limits events), so consumption totals are all
 * a dashboard can honestly show.
 */
export class GrokUsageService {
  private store: GrokSessionStore;
  private cache: { timestamp: number; data: GrokUsageSummary | null } | null = null;
  private static readonly CACHE_TTL = 30_000;
  private static readonly WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly WINDOW_24H_MS = 24 * 60 * 60 * 1000;

  constructor(store = new GrokSessionStore()) {
    this.store = store;
  }

  async getUsageSummary(): Promise<GrokUsageSummary | null> {
    if (this.cache && Date.now() - this.cache.timestamp < GrokUsageService.CACHE_TTL) {
      return this.cache.data;
    }
    const data = await this.build();
    this.cache = { timestamp: Date.now(), data };
    return data;
  }

  private async build(): Promise<GrokUsageSummary | null> {
    const now = Date.now();
    const cutoff7d = now - GrokUsageService.WINDOW_7D_MS;
    const sessions = (await this.store.listSessions()).filter(
      (s) => new Date(s.updatedAt).getTime() >= cutoff7d,
    );
    if (sessions.length === 0) return null;

    const turns: TurnRecord[] = [];
    await Promise.all(sessions.map(async (s) => {
      turns.push(...await this.readTurns(join(s.dir, 'updates.jsonl'), cutoff7d));
    }));
    if (turns.length === 0) return null;

    turns.sort((a, b) => a.timestamp - b.timestamp);
    const last24h = emptyWindow();
    const last7d = emptyWindow();
    const modelTotals = new Map<string, number>();
    const cutoff24h = now - GrokUsageService.WINDOW_24H_MS;
    for (const turn of turns) {
      const ms = turn.timestamp * 1000;
      addToWindow(last7d, turn);
      if (ms >= cutoff24h) addToWindow(last24h, turn);
      for (const model of turn.models) {
        modelTotals.set(model, (modelTotals.get(model) ?? 0) + turn.totalTokens);
      }
    }

    const lastTurn = turns[turns.length - 1];
    const models = Array.from(modelTotals.entries())
      .map(([model, totalTokens]) => ({ model, totalTokens }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      last24h,
      last7d,
      models,
      sessions7d: sessions.length,
      planType: lastTurn.models.some((m) => m.endsWith('-free')) ? 'Free' : undefined,
      lastTurnAt: new Date(lastTurn.timestamp * 1000).toISOString(),
    };
  }

  private async readTurns(updatesPath: string, cutoffMs: number): Promise<TurnRecord[]> {
    // Skip files that clearly predate the window before reading them.
    try {
      if ((await stat(updatesPath)).mtimeMs < cutoffMs) return [];
    } catch {
      return [];
    }
    let text: string;
    try {
      text = await readFile(updatesPath, 'utf8');
    } catch {
      return [];
    }

    const turns: TurnRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.includes('"turn_completed"')) continue;
      try {
        const record = JSON.parse(line) as {
          timestamp?: number;
          params?: {
            update?: {
              sessionUpdate?: string;
              usage?: {
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
                modelUsage?: Record<string, unknown>;
              };
            };
          };
        };
        const update = record.params?.update;
        if (update?.sessionUpdate !== 'turn_completed' || !update.usage) continue;
        const timestamp = typeof record.timestamp === 'number' ? record.timestamp : 0;
        if (timestamp * 1000 < cutoffMs) continue;
        turns.push({
          timestamp,
          totalTokens: update.usage.totalTokens ?? 0,
          inputTokens: update.usage.inputTokens ?? 0,
          outputTokens: update.usage.outputTokens ?? 0,
          models: Object.keys(update.usage.modelUsage ?? {}),
        });
      } catch {
        // malformed line
      }
    }
    return turns;
  }
}
