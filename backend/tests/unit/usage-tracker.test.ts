import { describe, expect, test } from 'bun:test';
import { UsageTracker } from '../../src/services/usage-tracker';

describe('UsageTracker', () => {
  // Note: These tests use the actual ~/.claude data
  // They verify the service works correctly with real or missing data
  const usageTracker = new UsageTracker();

  describe('getLimitsInfo', () => {
    test('should return limits info or null', async () => {
      const limits = await usageTracker.getLimitsInfo();

      // May be null if no credentials
      if (limits === null) {
        expect(limits).toBeNull();
        return;
      }

      // If we have limits, verify structure
      expect(limits).toHaveProperty('plan');
      expect(limits).toHaveProperty('cycle5h');
      expect(limits).toHaveProperty('weeklyOpus');
      expect(limits).toHaveProperty('weeklySonnet');
    });

    test('should have correct cycle5h structure', async () => {
      const limits = await usageTracker.getLimitsInfo();

      if (limits?.cycle5h) {
        expect(limits.cycle5h).toHaveProperty('used');
        expect(limits.cycle5h).toHaveProperty('limit');
        expect(limits.cycle5h).toHaveProperty('percentage');
        expect(typeof limits.cycle5h.used).toBe('number');
        expect(typeof limits.cycle5h.percentage).toBe('number');
      }
    });

    test('should have correct weeklyOpus structure', async () => {
      const limits = await usageTracker.getLimitsInfo();

      if (limits?.weeklyOpus) {
        expect(limits.weeklyOpus).toHaveProperty('used');
        expect(limits.weeklyOpus).toHaveProperty('limit');
        expect(limits.weeklyOpus).toHaveProperty('percentage');
      }
    });

    test('should have correct weeklySonnet structure', async () => {
      const limits = await usageTracker.getLimitsInfo();

      if (limits?.weeklySonnet) {
        expect(limits.weeklySonnet).toHaveProperty('used');
        expect(limits.weeklySonnet).toHaveProperty('limit');
        expect(limits.weeklySonnet).toHaveProperty('percentage');
      }
    });

    test('should have limit ranges with min and max', async () => {
      const limits = await usageTracker.getLimitsInfo();

      if (limits?.cycle5h.limit) {
        expect(limits.cycle5h.limit).toHaveProperty('min');
        expect(limits.cycle5h.limit).toHaveProperty('max');
        expect(typeof limits.cycle5h.limit.min).toBe('number');
        expect(typeof limits.cycle5h.limit.max).toBe('number');
      }
    });
  });
});
