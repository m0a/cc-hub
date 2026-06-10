import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DailyActivity, ModelUsage } from '../../../shared/types';

interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  modelUsage: {
    [model: string]: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
    };
  };
  hourCounts?: Record<string, number>;
}

export class StatsService {
  private claudeDir: string;

  constructor() {
    this.claudeDir = join(homedir(), '.claude');
  }

  private async readStatsCache(): Promise<StatsCache | null> {
    try {
      const content = await readFile(join(this.claudeDir, 'stats-cache.json'), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async getDailyActivity(days: number = 14): Promise<DailyActivity[]> {
    const stats = await this.readStatsCache();
    if (!stats?.dailyActivity) {
      return [];
    }

    // Get last N days of activity
    const activities = stats.dailyActivity.slice(-days);

    return activities.map(a => ({
      date: a.date,
      messageCount: a.messageCount,
      sessionCount: a.sessionCount,
      tokensIn: 0, // Not available in stats-cache
      tokensOut: 0,
    }));
  }

  async getModelUsage(): Promise<ModelUsage[]> {
    const stats = await this.readStatsCache();
    if (!stats?.modelUsage) {
      return [];
    }

    return Object.entries(stats.modelUsage).map(([model, usage]) => ({
      model: this.getModelDisplayName(model),
      totalTokensIn: usage.inputTokens,
      totalTokensOut: usage.outputTokens,
      totalCacheRead: usage.cacheReadInputTokens,
      totalCacheWrite: usage.cacheCreationInputTokens,
    }));
  }

  private getModelDisplayName(modelId: string): string {
    // Extract family and version from model ID for any family
    // (e.g., "claude-opus-4-5-20251101" -> "Opus 4.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5",
    //  "claude-fable-5" -> "Fable 5")
    const match = modelId.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?:-|$))?/);
    if (match) {
      const [, family, major, minor] = match;
      const name = family.charAt(0).toUpperCase() + family.slice(1);
      return minor !== undefined ? `${name} ${major}.${minor}` : `${name} ${major}`;
    }
    return modelId;
  }

  // Phase 3: Get hourly activity for heatmap
  async getHourlyActivity(): Promise<Record<number, number>> {
    const stats = await this.readStatsCache();
    if (!stats?.hourCounts) {
      return {};
    }

    // Convert string keys to numbers and ensure all 24 hours are present
    const result: Record<number, number> = {};
    for (let i = 0; i < 24; i++) {
      result[i] = stats.hourCounts[String(i)] || 0;
    }

    return result;
  }
}
