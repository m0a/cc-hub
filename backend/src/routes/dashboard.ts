import { Hono } from 'hono';
import { StatsService } from '../services/stats-service';
import { AnthropicUsageService } from '../services/anthropic-usage';
import { UsageHistoryService } from '../services/usage-history';
import { SystemMetricsService } from '../services/system-metrics';
import { VERSION } from '../cli';
import type { DashboardResponse } from '../../../shared/types';

const statsService = new StatsService();
const anthropicUsageService = new AnthropicUsageService();
const usageHistoryService = new UsageHistoryService();
const systemMetricsService = new SystemMetricsService();

export const dashboard = new Hono();

// GET /dashboard - Get dashboard data
dashboard.get('/', async (c) => {
  const [usageLimits, dailyActivity, modelUsage, hourlyActivity, usageHistory, systemMetrics] = await Promise.all([
    anthropicUsageService.getUsageLimits(),
    statsService.getDailyActivity(14),
    statsService.getModelUsage(),
    statsService.getHourlyActivity(),
    usageHistoryService.getHistory(),
    Promise.resolve(systemMetricsService.getMetrics()),
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
    usageHistory: usageHistory,
    dailyActivity,
    modelUsage,
    costEstimates: [],
    hourlyActivity,
    version: VERSION,
    systemMetrics,
  };

  return c.json(response);
});
