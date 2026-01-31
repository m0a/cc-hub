import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DailyActivity, ModelUsage, CostEstimate } from '../../../shared/types';

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

// API reference pricing (per 1M tokens)
const PRICING: Record<string, {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}> = {
  'claude-opus-4-5-20251101': {
    input: 15.00 / 1_000_000,
    output: 75.00 / 1_000_000,
    cacheRead: 1.50 / 1_000_000,
    cacheWrite: 18.75 / 1_000_000,
  },
  'claude-sonnet-4-5-20250929': {
    input: 3.00 / 1_000_000,
    output: 15.00 / 1_000_000,
    cacheRead: 0.30 / 1_000_000,
    cacheWrite: 3.75 / 1_000_000,
  },
};

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

  async getCostEstimates(): Promise<CostEstimate[]> {
    const stats = await this.readStatsCache();
    if (!stats?.modelUsage) {
      return [];
    }

    return Object.entries(stats.modelUsage).map(([model, usage]) => {
      const pricing = PRICING[model] || PRICING['claude-sonnet-4-5-20250929'];

      const inputCost = usage.inputTokens * pricing.input;
      const outputCost = usage.outputTokens * pricing.output;
      const cacheReadCost = usage.cacheReadInputTokens * pricing.cacheRead;
      const cacheWriteCost = usage.cacheCreationInputTokens * pricing.cacheWrite;

      return {
        model: this.getModelDisplayName(model),
        inputCost: Math.round(inputCost * 100) / 100,
        outputCost: Math.round(outputCost * 100) / 100,
        cacheReadCost: Math.round(cacheReadCost * 100) / 100,
        cacheWriteCost: Math.round(cacheWriteCost * 100) / 100,
        totalCost: Math.round((inputCost + outputCost + cacheReadCost + cacheWriteCost) * 100) / 100,
      };
    });
  }

  private getModelDisplayName(modelId: string): string {
    if (modelId.includes('opus')) return 'Opus';
    if (modelId.includes('sonnet')) return 'Sonnet';
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
