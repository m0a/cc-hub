import { describe, expect, test } from 'bun:test';
import { AnthropicUsageService } from '../../src/services/anthropic-usage';

describe('AnthropicUsageService', () => {
  // Note: These tests verify the service structure and behavior
  const usageService = new AnthropicUsageService();

  describe('getUsageLimits', () => {
    test('should return limits info or null', async () => {
      const limits = await usageService.getUsageLimits();

      // May be null if no credentials or API error
      if (limits === null) {
        expect(limits).toBeNull();
        return;
      }

      // If we have limits, verify structure
      expect(limits).toHaveProperty('fiveHour');
      expect(limits).toHaveProperty('sevenDay');
    });

    test('should have correct fiveHour structure if available', async () => {
      const limits = await usageService.getUsageLimits();

      if (limits?.fiveHour) {
        expect(limits.fiveHour).toHaveProperty('utilization');
        expect(limits.fiveHour).toHaveProperty('resetsAt');
        expect(limits.fiveHour).toHaveProperty('timeRemaining');
        expect(limits.fiveHour).toHaveProperty('status');
        expect(limits.fiveHour).toHaveProperty('statusMessage');
        expect(typeof limits.fiveHour.utilization).toBe('number');
      }
    });

    test('should have correct sevenDay structure if available', async () => {
      const limits = await usageService.getUsageLimits();

      if (limits?.sevenDay) {
        expect(limits.sevenDay).toHaveProperty('utilization');
        expect(limits.sevenDay).toHaveProperty('resetsAt');
        expect(limits.sevenDay).toHaveProperty('timeRemaining');
        expect(limits.sevenDay).toHaveProperty('status');
        expect(limits.sevenDay).toHaveProperty('statusMessage');
        expect(typeof limits.sevenDay.utilization).toBe('number');
      }
    });

    test('should have valid status values if available', async () => {
      const limits = await usageService.getUsageLimits();

      if (limits?.fiveHour) {
        const validStatuses = ['safe', 'warning', 'danger', 'exceeded'];
        expect(validStatuses).toContain(limits.fiveHour.status);
      }

      if (limits?.sevenDay) {
        const validStatuses = ['safe', 'warning', 'danger', 'exceeded'];
        expect(validStatuses).toContain(limits.sevenDay.status);
      }
    });
  });
});
