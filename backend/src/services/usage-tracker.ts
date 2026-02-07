import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { LimitsInfo, LimitRange, CycleLimitInfo } from '../../../shared/types';

interface Credentials {
  claudeAiOauth?: {
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

interface UsageData {
  current_5h_cycle?: {
    start_time: number;
    total_prompts: number;
    total_hours: number;
  };
  current_week?: {
    start_time: number;
    sonnet4_hours: number;
    opus4_hours: number;
    total_sessions: number;
  };
  last_updated?: number;
}

interface LimitsConfig {
  [plan: string]: {
    '5h_cycle'?: LimitRange;
    weekly_sonnet?: LimitRange;
    weekly_opus?: LimitRange;
  };
}

export class UsageTracker {
  private claudeDir: string;

  constructor() {
    this.claudeDir = join(homedir(), '.claude');
  }

  private async readJsonFile<T>(path: string): Promise<T | null> {
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async getLimitsInfo(): Promise<LimitsInfo | null> {
    // Read credentials for plan info
    const credentials = await this.readJsonFile<Credentials>(
      join(this.claudeDir, '.credentials.json')
    );

    if (!credentials?.claudeAiOauth) {
      return null;
    }

    // Determine plan from rateLimitTier (e.g., "default_claude_max_20x" -> "max_20x")
    const tierMatch = credentials.claudeAiOauth.rateLimitTier?.match(/max_\d+x/);
    const plan = tierMatch?.[0] || credentials.claudeAiOauth.subscriptionType || 'pro';

    // Read usage data
    const usageData = await this.readJsonFile<UsageData>(
      join(this.claudeDir, 'limit-tracker', 'data', 'usage_data.json')
    );

    // Read limits config
    const limitsConfig = await this.readJsonFile<LimitsConfig>(
      join(this.claudeDir, 'limit-tracker', 'config', 'limits.json')
    );

    const planLimits = limitsConfig?.[plan] || limitsConfig?.pro;

    if (!planLimits) {
      return null;
    }

    // Calculate 5h cycle info
    const cycle5h = this.calculateCycleInfo(
      usageData?.current_5h_cycle?.total_prompts || 0,
      planLimits['5h_cycle'] || { min: 10, max: 40 },
      usageData?.current_5h_cycle?.start_time,
      false
    );

    // Check if weekly data is stale (older than 7 days)
    const weekStartTime = usageData?.current_week?.start_time;
    const isWeeklyStale = weekStartTime
      ? (Date.now() - weekStartTime) > 7 * 24 * 60 * 60 * 1000
      : false;

    // Calculate weekly Opus info
    const weeklyOpus = this.calculateCycleInfo(
      usageData?.current_week?.opus4_hours || 0,
      planLimits.weekly_opus || { min: 24, max: 40 },
      usageData?.current_week?.start_time,
      isWeeklyStale
    );

    // Calculate weekly Sonnet info
    const weeklySonnet = this.calculateCycleInfo(
      usageData?.current_week?.sonnet4_hours || 0,
      planLimits.weekly_sonnet || { min: 240, max: 480 },
      usageData?.current_week?.start_time,
      isWeeklyStale
    );

    return {
      plan,
      cycle5h,
      weeklyOpus,
      weeklySonnet,
    };
  }

  private calculateCycleInfo(
    used: number,
    limit: LimitRange,
    startTime?: number,
    isStale?: boolean
  ): CycleLimitInfo {
    // Calculate percentage based on min limit (conservative)
    const percentage = Math.round((used / limit.min) * 100);

    // Calculate reset time for 5h cycle
    let resetTime: string | undefined;
    if (startTime) {
      // 5h cycle resets 5 hours after start
      const resetMs = startTime + 5 * 60 * 60 * 1000;
      if (resetMs > Date.now()) {
        resetTime = new Date(resetMs).toISOString();
      }
    }

    return {
      used,
      limit,
      percentage,
      resetTime,
      isStale,
    };
  }
}
