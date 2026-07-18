import { Hono } from 'hono';
import { StatsService } from '../services/stats-service';
import { AnthropicUsageService } from '../services/anthropic-usage';
import { CodexUsageService } from '../services/codex-usage';
import { GrokUsageService } from '../services/grok-usage';
import { UsageHistoryService } from '../services/usage-history';
import { SystemMetricsService } from '../services/system-metrics';
import { HerdrUpdateService } from '../services/herdr-update';
import { getConnectedClientCount } from './terminal-mux';
import { VERSION } from '../cli';
import type { DashboardResponse } from '../../../shared/types';

const statsService = new StatsService();
const anthropicUsageService = new AnthropicUsageService();
const codexUsageService = new CodexUsageService();
const grokUsageService = new GrokUsageService();
const usageHistoryService = new UsageHistoryService();
const systemMetricsService = new SystemMetricsService();
// Shared with the /api/herdr apply route so an apply invalidates this cache.
export const herdrUpdateService = new HerdrUpdateService();

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

export async function buildDashboard(): Promise<DashboardResponse> {
  // The herdr skew check rides on this poll instead of its own timer (#393);
  // it is cached, so the extra spawn is far rarer than the request rate.
  const [usageLimits, codexUsageLimits, grokUsage, dailyActivity, modelUsage, hourlyActivity, usageHistory, systemMetrics, diskUsage, herdrUpdate] = await Promise.all([
    anthropicUsageService.getUsageLimits(),
    codexUsageService.getUsageLimits(),
    grokUsageService.getUsageSummary(),
    statsService.getDailyActivity(14),
    statsService.getModelUsage(),
    statsService.getHourlyActivity(),
    usageHistoryService.getHistory(),
    Promise.resolve(systemMetricsService.getMetrics()),
    getDiskUsage(),
    herdrUpdateService.getStatus(),
  ]);

  // Record snapshot for history
  if (usageLimits) {
    usageHistoryService.recordSnapshot(
      { utilization: usageLimits.fiveHour.utilization, resetsAt: usageLimits.fiveHour.resetsAt },
      { utilization: usageLimits.sevenDay.utilization, resetsAt: usageLimits.sevenDay.resetsAt },
      usageLimits.scopedLimits,
    );
  }

  return {
    limits: null, // Deprecated
    usageLimits,
    usageLimitsStatus: anthropicUsageService.getStatus(),
    codexUsageLimits,
    grokUsage,
    usageHistory,
    dailyActivity,
    modelUsage,
    hourlyActivity,
    version: VERSION,
    systemMetrics,
    diskUsage: diskUsage || undefined,
    connectedClients: getConnectedClientCount(),
    herdrUpdate,
  };
}

export const dashboard = new Hono();

// GET /dashboard - Get dashboard data
dashboard.get('/', async (c) => {
  const response = await buildDashboard();
  return c.json(response);
});
