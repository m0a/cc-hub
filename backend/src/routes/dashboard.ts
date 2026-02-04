import { Hono } from 'hono';
import { StatsService } from '../services/stats-service';
import { AnthropicUsageService } from '../services/anthropic-usage';
import { VERSION } from '../cli';
import type { DashboardResponse } from '../../../shared/types';

const statsService = new StatsService();
const anthropicUsageService = new AnthropicUsageService();

export const dashboard = new Hono();

// GET /dashboard - Get dashboard data
dashboard.get('/', async (c) => {
  const [usageLimits, dailyActivity, modelUsage, hourlyActivity] = await Promise.all([
    anthropicUsageService.getUsageLimits(),
    statsService.getDailyActivity(14),
    statsService.getModelUsage(),
    statsService.getHourlyActivity(),
  ]);

  const response: DashboardResponse = {
    limits: null, // Deprecated
    usageLimits,
    dailyActivity,
    modelUsage,
    costEstimates: [],
    hourlyActivity,
    version: VERSION,
  };

  return c.json(response);
});
