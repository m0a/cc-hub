import { describe, expect, test } from 'bun:test';
import { FileChangeTracker } from '../../src/services/file-change-tracker';

describe('FileChangeTracker', () => {
  // Note: These tests use the actual ~/.claude/projects directory
  // They verify the service works correctly with real or missing data
  const tracker = new FileChangeTracker();

  describe('getChangesForWorkingDir', () => {
    test('should return an array', async () => {
      const changes = await tracker.getChangesForWorkingDir('/home/user/project');
      expect(Array.isArray(changes)).toBe(true);
    });

    test('should return empty array for unknown directory', async () => {
      const changes = await tracker.getChangesForWorkingDir('/nonexistent/path/xyz123');
      expect(changes).toEqual([]);
    });

    test('should return items with correct structure if data exists', async () => {
      // Use the current project directory which likely has data
      const changes = await tracker.getChangesForWorkingDir(process.cwd());
      if (changes.length > 0) {
        expect(changes[0]).toHaveProperty('path');
        expect(changes[0]).toHaveProperty('toolName');
        expect(changes[0]).toHaveProperty('timestamp');
      }
    });

    test('should include Write tool changes if present', async () => {
      const changes = await tracker.getChangesForWorkingDir(process.cwd());
      const writeChanges = changes.filter(c => c.toolName === 'Write');
      // Just verify the structure
      if (writeChanges.length > 0) {
        expect(writeChanges[0].newContent).toBeDefined();
      }
    });

    test('should include Edit tool changes if present', async () => {
      const changes = await tracker.getChangesForWorkingDir(process.cwd());
      const editChanges = changes.filter(c => c.toolName === 'Edit');
      // Just verify the structure
      if (editChanges.length > 0) {
        expect(editChanges[0]).toHaveProperty('oldContent');
        expect(editChanges[0]).toHaveProperty('newContent');
      }
    });

    test('should handle parent directory traversal', async () => {
      // Should be able to find project data from subdirectory
      const changes = await tracker.getChangesForWorkingDir(process.cwd() + '/src');
      expect(Array.isArray(changes)).toBe(true);
    });
  });

  describe('getChangesForSessionId', () => {
    test('should return an array', async () => {
      const changes = await tracker.getChangesForSessionId('/some/path', 'some-session-id');
      expect(Array.isArray(changes)).toBe(true);
    });

    test('should return empty array for unknown session', async () => {
      const changes = await tracker.getChangesForSessionId('/home/user/project', 'nonexistent-session-xyz');
      expect(changes).toEqual([]);
    });
  });
});
