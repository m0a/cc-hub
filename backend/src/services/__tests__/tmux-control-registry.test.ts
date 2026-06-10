import { describe, test, expect } from 'bun:test';
import { TmuxControlSession, controlSessions, getOrCreateControlSession } from '../tmux-control';

/**
 * Regression test for #331: getOrCreateControlSession used to register the
 * session in the global registry BEFORE awaiting start(). When start() threw
 * (spawn failure, attach target gone, resource exhaustion), the broken entry
 * stayed registered with isDestroyed=false, so every subsequent call returned
 * the same dead instance and the tmux session became permanently unreachable.
 */
describe('getOrCreateControlSession', () => {
  test('rolls back the registry entry when start() throws', async () => {
    const sessionId = 'registry-rollback-test';
    const originalStart = TmuxControlSession.prototype.start;
    TmuxControlSession.prototype.start = async () => {
      throw new Error('spawn failed');
    };
    try {
      await expect(getOrCreateControlSession(sessionId)).rejects.toThrow('spawn failed');
      // The failed session must not linger as a live-looking registry entry
      expect(controlSessions.has(sessionId)).toBe(false);
    } finally {
      TmuxControlSession.prototype.start = originalStart;
      controlSessions.get(sessionId)?.destroy();
    }
  });
});
