import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { TmuxService } from '../../src/services/tmux';

describe('TmuxService', () => {
  let tmuxService: TmuxService;
  const testPrefix = 'cchub-test-';

  beforeEach(() => {
    tmuxService = new TmuxService(testPrefix);
  });

  afterEach(async () => {
    // Clean up test sessions
    const sessions = await tmuxService.listSessions();
    for (const session of sessions) {
      if (session.id.startsWith(testPrefix)) {
        await tmuxService.killSession(session.id).catch(() => {});
      }
    }
  });

  describe('listSessions', () => {
    test('should return empty array when no sessions exist', async () => {
      const sessions = await tmuxService.listSessions();
      const testSessions = sessions.filter((s) => s.id.startsWith(testPrefix));
      expect(testSessions).toEqual([]);
    });

    test('should return created sessions', async () => {
      const sessionId = await tmuxService.createSession('test-session');
      const sessions = await tmuxService.listSessions();
      const found = sessions.find((s) => s.id === sessionId);

      expect(found).toBeDefined();
      expect(found?.name).toBe('test-session');
    });
  });

  describe('createSession', () => {
    test('should create a new tmux session', async () => {
      const sessionId = await tmuxService.createSession('my-session');

      expect(sessionId).toContain(testPrefix);
      expect(sessionId).toContain('my-session');
    });

    test('should create session with auto-generated name if not provided', async () => {
      const sessionId = await tmuxService.createSession();

      expect(sessionId).toContain(testPrefix);
    });
  });

  describe('killSession', () => {
    test('should kill an existing session', async () => {
      const sessionId = await tmuxService.createSession('to-kill');
      await tmuxService.killSession(sessionId);

      const sessions = await tmuxService.listSessions();
      const found = sessions.find((s) => s.id === sessionId);
      expect(found).toBeUndefined();
    });

    test('should throw error for non-existent session', async () => {
      await expect(
        tmuxService.killSession('non-existent-session-12345')
      ).rejects.toThrow();
    });
  });

  describe('sessionExists', () => {
    test('should return true for existing session', async () => {
      const sessionId = await tmuxService.createSession('exists');
      const exists = await tmuxService.sessionExists(sessionId);

      expect(exists).toBe(true);
    });

    test('should return false for non-existent session', async () => {
      const exists = await tmuxService.sessionExists('no-such-session-xyz');

      expect(exists).toBe(false);
    });
  });
});
