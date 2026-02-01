import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface UsageResponse {
  five_hour: {
    utilization: number;
    resets_at: string;
  };
  seven_day: {
    utilization: number;
    resets_at: string;
  };
}

export interface UsageLimits {
  fiveHour: {
    utilization: number;
    resetsAt: string;
    timeRemaining: string;
    estimatedHitTime?: string; // When limit will be hit at current rate
    status: 'safe' | 'warning' | 'danger' | 'exceeded'; // Overall status
    statusMessage: string; // Human-readable message
  };
  sevenDay: {
    utilization: number;
    resetsAt: string;
    timeRemaining: string;
    estimatedHitTime?: string;
    status: 'safe' | 'warning' | 'danger' | 'exceeded';
    statusMessage: string;
  };
}

export class AnthropicUsageService {
  private claudeDir: string;

  constructor() {
    this.claudeDir = join(homedir(), '.claude');
  }

  private async getAccessToken(): Promise<string | null> {
    try {
      const content = await readFile(join(this.claudeDir, '.credentials.json'), 'utf-8');
      const data = JSON.parse(content);
      return data?.claudeAiOauth?.accessToken || null;
    } catch {
      return null;
    }
  }

  async getUsageLimits(): Promise<UsageLimits | null> {
    const token = await this.getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.0.32',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch usage:', response.status);
        return null;
      }

      const data: UsageResponse = await response.json();

      const fiveHourEstimate = this.estimateHitTime(data.five_hour.utilization, data.five_hour.resets_at, 5);
      const sevenDayEstimate = this.estimateHitTime(data.seven_day.utilization, data.seven_day.resets_at, 7 * 24);

      return {
        fiveHour: {
          utilization: data.five_hour.utilization,
          resetsAt: data.five_hour.resets_at,
          timeRemaining: this.formatTimeRemaining(data.five_hour.resets_at),
          estimatedHitTime: fiveHourEstimate,
          ...this.calculateStatus(data.five_hour.utilization, fiveHourEstimate, this.formatTimeRemaining(data.five_hour.resets_at)),
        },
        sevenDay: {
          utilization: data.seven_day.utilization,
          resetsAt: data.seven_day.resets_at,
          timeRemaining: this.formatTimeRemaining(data.seven_day.resets_at),
          estimatedHitTime: sevenDayEstimate,
          ...this.calculateStatus(data.seven_day.utilization, sevenDayEstimate, this.formatTimeRemaining(data.seven_day.resets_at)),
        },
      };
    } catch (err) {
      console.error('Error fetching usage:', err);
      return null;
    }
  }

  /**
   * Calculate status and message based on utilization and estimated hit time
   */
  private calculateStatus(
    utilization: number,
    estimatedHitTime: string | undefined,
    timeRemaining: string
  ): { status: 'safe' | 'warning' | 'danger' | 'exceeded'; statusMessage: string } {
    if (utilization >= 100) {
      return { status: 'exceeded', statusMessage: 'リミット到達中' };
    }

    if (estimatedHitTime) {
      // Will hit limit before reset
      return {
        status: 'danger',
        statusMessage: `このペースで${estimatedHitTime}後にリミット到達`,
      };
    }

    // Won't hit limit before reset
    if (utilization >= 75) {
      return {
        status: 'warning',
        statusMessage: `余裕あり（リセットまで${timeRemaining}）`,
      };
    }

    if (utilization >= 50) {
      return {
        status: 'safe',
        statusMessage: `順調（リセットまで${timeRemaining}）`,
      };
    }

    return {
      status: 'safe',
      statusMessage: `余裕十分（リセットまで${timeRemaining}）`,
    };
  }

  private formatTimeRemaining(resetsAt: string): string {
    try {
      const resetTime = new Date(resetsAt);
      const now = new Date();
      const diffMs = resetTime.getTime() - now.getTime();

      if (diffMs <= 0) return 'soon';

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        return `${hours}h${minutes}m`;
      }
      return `${minutes}m`;
    } catch {
      return '?';
    }
  }

  /**
   * Estimate when the limit will be hit based on current usage rate
   * @param utilization Current usage percentage
   * @param resetsAt When the cycle resets
   * @param cycleTotalHours Total hours in the cycle (5 for 5h, 168 for 7d)
   */
  private estimateHitTime(utilization: number, resetsAt: string, cycleTotalHours: number): string | undefined {
    if (utilization <= 0 || utilization >= 100) {
      return undefined;
    }

    try {
      const resetTime = new Date(resetsAt);
      const now = new Date();

      // Calculate cycle start time
      const cycleStartTime = new Date(resetTime.getTime() - cycleTotalHours * 60 * 60 * 1000);

      // Time elapsed since cycle start
      const elapsedMs = now.getTime() - cycleStartTime.getTime();
      if (elapsedMs <= 0) return undefined;

      // Usage rate: utilization% per elapsed time
      const ratePerMs = utilization / elapsedMs;

      // Time needed to reach 100%
      const remainingUtilization = 100 - utilization;
      const msToHit = remainingUtilization / ratePerMs;

      // Estimated hit time
      const hitTime = new Date(now.getTime() + msToHit);

      // If hit time is after reset, limit won't be hit this cycle
      if (hitTime >= resetTime) {
        return undefined;
      }

      // Format the hit time
      const diffMs = hitTime.getTime() - now.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        return `${hours}h${minutes}m`;
      }
      return `${minutes}m`;
    } catch {
      return undefined;
    }
  }
}
