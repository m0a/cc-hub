import { Hono } from 'hono';
import { StatsService } from '../services/stats-service';
import { AnthropicUsageService } from '../services/anthropic-usage';
import { UsageHistoryService } from '../services/usage-history';
import { SystemMetricsService } from '../services/system-metrics';
import { getConnectedClientCount } from './terminal-mux';
import { VERSION } from '../cli';
import type { DashboardResponse } from '../../../shared/types';

const statsService = new StatsService();
const anthropicUsageService = new AnthropicUsageService();
const usageHistoryService = new UsageHistoryService();
const systemMetricsService = new SystemMetricsService();

async function getDiskUsage(): Promise<{ total: number; used: number; available: number; mountpoint: string } | null> {
  try {
    const result = Bun.spawnSync(['df', '-B1', '--output=size,used,avail,target', '/']);
    const lines = result.stdout.toString().trim().split('\n');
    if (lines.length < 2) return null;
    const parts = lines[1].trim().split(/\s+/);
    if (parts.length < 4) return null;
    return {
      total: parseInt(parts[0], 10),
      used: parseInt(parts[1], 10),
      available: parseInt(parts[2], 10),
      mountpoint: parts[3],
    };
  } catch {
    return null;
  }
}

export const dashboard = new Hono();

// GET /dashboard - Get dashboard data
dashboard.get('/', async (c) => {
  const [usageLimits, dailyActivity, modelUsage, hourlyActivity, usageHistory, systemMetrics, diskUsage] = await Promise.all([
    anthropicUsageService.getUsageLimits(),
    statsService.getDailyActivity(14),
    statsService.getModelUsage(),
    statsService.getHourlyActivity(),
    usageHistoryService.getHistory(),
    Promise.resolve(systemMetricsService.getMetrics()),
    getDiskUsage(),
  ]);

  // Record snapshot for history
  if (usageLimits) {
    usageHistoryService.recordSnapshot(
      { utilization: usageLimits.fiveHour.utilization, resetsAt: usageLimits.fiveHour.resetsAt },
      { utilization: usageLimits.sevenDay.utilization, resetsAt: usageLimits.sevenDay.resetsAt },
    );
  }

  const response: DashboardResponse = {
    limits: null, // Deprecated
    usageLimits,
    usageLimitsStatus: anthropicUsageService.getStatus(),
    usageHistory: usageHistory,
    dailyActivity,
    modelUsage,
    costEstimates: [],
    hourlyActivity,
    version: VERSION,
    systemMetrics,
    diskUsage: diskUsage || undefined,
    connectedClients: getConnectedClientCount(),
  };

  return c.json(response);
});
