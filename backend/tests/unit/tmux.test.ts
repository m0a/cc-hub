import { describe, expect, test, beforeAll, afterAll, afterEach } from 'bun:test';
import { TmuxService } from '../../src/services/tmux';

describe('TmuxService', () => {
  let tmuxService: TmuxService;
  const testPrefix = `cchub-test-${Date.now()}-`;
  const createdSessions: string[] = [];

  // Helper to generate unique session names
  const uniqueName = (base: string) => `${testPrefix}${base}`;

  beforeAll(() => {
    tmuxService = new TmuxService();
  });

  afterEach(async () => {
    // Clean up sessions created during each test
    for (const sessionId of createdSessions) {
      await tmuxService.killSession(sessionId).catch(() => {});
    }
    createdSessions.length = 0;
  });

  afterAll(async () => {
    // Final cleanup - kill any remaining test sessions
    const sessions = await tmuxService.listSessions();
    for (const session of sessions) {
      if (session.id.startsWith('cchub-test-')) {
        await tmuxService.killSession(session.id).catch(() => {});
      }
    }
  });

  describe('listSessions', () => {
    test('should return empty array or existing sessions', async () => {
      const sessions = await tmuxService.listSessions();
      // Just verify it returns an array
      expect(Array.isArray(sessions)).toBe(true);
    });

    test('should return created sessions', async () => {
      const name = uniqueName('list-test');
      const sessionId = await tmuxService.createSession(name);
      createdSessions.push(sessionId);

      const sessions = await tmuxService.listSessions();
      const found = sessions.find((s) => s.id === sessionId);

      expect(found).toBeDefined();
      expect(found?.name).toBe(name);
    });
  });

  describe('createSession', () => {
    test('should create a new tmux session', async () => {
      const name = uniqueName('create-test');
      const sessionId = await tmuxService.createSession(name);
      createdSessions.push(sessionId);

      expect(sessionId).toBe(name);
    });

    test('should throw error for duplicate session name', async () => {
      const name = uniqueName('duplicate-test');
      const sessionId = await tmuxService.createSession(name);
      createdSessions.push(sessionId);

      await expect(tmuxService.createSession(name)).rejects.toThrow(/duplicate session/);
    });
  });

  describe('killSession', () => {
    test('should kill an existing session', async () => {
      const name = uniqueName('kill-test');
      const sessionId = await tmuxService.createSession(name);
      // Don't add to createdSessions since we're killing it

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
      const name = uniqueName('exists-test');
      const sessionId = await tmuxService.createSession(name);
      createdSessions.push(sessionId);

      const exists = await tmuxService.sessionExists(sessionId);
      expect(exists).toBe(true);
    });

    test('should return false for non-existent session', async () => {
      const exists = await tmuxService.sessionExists('no-such-session-xyz');
      expect(exists).toBe(false);
    });
  });
});
