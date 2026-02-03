import { describe, expect, test } from 'bun:test';
import { StatsService } from '../../src/services/stats-service';

describe('StatsService', () => {
  // Note: These tests use the actual ~/.claude/stats-cache.json
  // They verify the service works correctly with real or missing data
  const statsService = new StatsService();

  describe('getDailyActivity', () => {
    test('should return an array', async () => {
      const activity = await statsService.getDailyActivity();
      expect(Array.isArray(activity)).toBe(true);
    });

    test('should respect limit parameter', async () => {
      const activity = await statsService.getDailyActivity(5);
      expect(activity.length).toBeLessThanOrEqual(5);
    });

    test('should return items with correct structure', async () => {
      const activity = await statsService.getDailyActivity();
      if (activity.length > 0) {
        expect(activity[0]).toHaveProperty('date');
        expect(activity[0]).toHaveProperty('messageCount');
        expect(activity[0]).toHaveProperty('sessionCount');
      }
    });
  });

  describe('getModelUsage', () => {
    test('should return an array', async () => {
      const usage = await statsService.getModelUsage();
      expect(Array.isArray(usage)).toBe(true);
    });

    test('should return items with correct structure', async () => {
      const usage = await statsService.getModelUsage();
      if (usage.length > 0) {
        expect(usage[0]).toHaveProperty('model');
        expect(usage[0]).toHaveProperty('totalTokensIn');
        expect(usage[0]).toHaveProperty('totalTokensOut');
      }
    });
  });

  describe('getCostEstimates', () => {
    test('should return an array', async () => {
      const costs = await statsService.getCostEstimates();
      expect(Array.isArray(costs)).toBe(true);
    });

    test('should return items with correct structure', async () => {
      const costs = await statsService.getCostEstimates();
      if (costs.length > 0) {
        expect(costs[0]).toHaveProperty('model');
        expect(costs[0]).toHaveProperty('totalCost');
        expect(costs[0]).toHaveProperty('inputCost');
        expect(costs[0]).toHaveProperty('outputCost');
      }
    });
  });

  describe('getHourlyActivity', () => {
    test('should return an object', async () => {
      const hourly = await statsService.getHourlyActivity();
      expect(typeof hourly).toBe('object');
    });

    test('should return empty object or 24 hours', async () => {
      const hourly = await statsService.getHourlyActivity();
      const keys = Object.keys(hourly);
      // Either empty (no data) or exactly 24 hours
      expect(keys.length === 0 || keys.length === 24).toBe(true);
    });

    test('should have numeric values if data exists', async () => {
      const hourly = await statsService.getHourlyActivity();
      if (Object.keys(hourly).length > 0) {
        for (let i = 0; i < 24; i++) {
          expect(typeof hourly[i]).toBe('number');
        }
      }
    });
  });
});
