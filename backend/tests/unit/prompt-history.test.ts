import { describe, expect, test } from 'bun:test';
import { PromptHistoryService } from '../../src/services/prompt-history';

describe('PromptHistoryService', () => {
  // Note: These tests use the actual ~/.claude/history.jsonl
  // They verify the service works correctly with real or missing data
  const promptService = new PromptHistoryService();

  describe('searchPrompts', () => {
    test('should return an array', async () => {
      const results = await promptService.searchPrompts('test');
      expect(Array.isArray(results)).toBe(true);
    });

    test('should respect limit parameter', async () => {
      const results = await promptService.searchPrompts('a', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('should return items with correct structure', async () => {
      const results = await promptService.searchPrompts('a', 10);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('display');
        expect(results[0]).toHaveProperty('timestamp');
        expect(results[0]).toHaveProperty('project');
        expect(results[0]).toHaveProperty('projectName');
        expect(results[0]).toHaveProperty('sessionId');
      }
    });

    test('should be case-insensitive', async () => {
      const lowerResults = await promptService.searchPrompts('test');
      const upperResults = await promptService.searchPrompts('TEST');
      // Should find same or similar results
      expect(lowerResults.length).toBe(upperResults.length);
    });
  });

  describe('getRecentPrompts', () => {
    test('should return an array', async () => {
      const results = await promptService.getRecentPrompts();
      expect(Array.isArray(results)).toBe(true);
    });

    test('should respect limit parameter', async () => {
      const results = await promptService.getRecentPrompts(5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('should return items with correct structure', async () => {
      const results = await promptService.getRecentPrompts(10);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('display');
        expect(results[0]).toHaveProperty('timestamp');
        expect(results[0]).toHaveProperty('project');
        expect(results[0]).toHaveProperty('sessionId');
      }
    });

    test('should not return empty prompts', async () => {
      const results = await promptService.getRecentPrompts(100);
      for (const result of results) {
        expect(result.display.trim().length).toBeGreaterThan(0);
      }
    });

    test('should be sorted by timestamp descending', async () => {
      const results = await promptService.getRecentPrompts(10);
      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          const prevTime = new Date(results[i - 1].timestamp).getTime();
          const currTime = new Date(results[i].timestamp).getTime();
          expect(prevTime).toBeGreaterThanOrEqual(currTime);
        }
      }
    });
  });
});
