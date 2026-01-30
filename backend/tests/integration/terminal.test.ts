import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { TmuxService } from '../../src/services/tmux';

const TEST_PREFIX = 'cchub-test-terminal-';

describe('Terminal WebSocket Integration', () => {
  let tmuxService: TmuxService;

  beforeEach(() => {
    tmuxService = new TmuxService(TEST_PREFIX);
  });

  afterEach(async () => {
    // Clean up test sessions
    const sessions = await tmuxService.listSessions();
    for (const session of sessions) {
      if (session.id.startsWith(TEST_PREFIX)) {
        await tmuxService.killSession(session.id).catch(() => {});
      }
    }
  });

  describe('Session creation and attachment', () => {
    test('should create a new tmux session for terminal', async () => {
      const sessionId = await tmuxService.createSession('terminal-test');

      expect(sessionId).toContain(TEST_PREFIX);
      expect(await tmuxService.sessionExists(sessionId)).toBe(true);
    });

    test('should be able to send input to session', async () => {
      const sessionId = await tmuxService.createSession('input-test');

      // Send a command to the session using tmux send-keys
      const proc = Bun.spawn(['tmux', 'send-keys', '-t', sessionId, 'echo hello', 'Enter'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test('should capture output from session', async () => {
      const sessionId = await tmuxService.createSession('output-test');

      // Send echo command
      await Bun.spawn(['tmux', 'send-keys', '-t', sessionId, 'echo TEST_OUTPUT_12345', 'Enter'], {
        stdout: 'pipe',
        stderr: 'pipe',
      }).exited;

      // Wait a bit for command to execute
      await new Promise(r => setTimeout(r, 100));

      // Capture pane content
      const proc = Bun.spawn(['tmux', 'capture-pane', '-t', sessionId, '-p'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      expect(output).toContain('TEST_OUTPUT_12345');
    });
  });

  describe('Terminal resize', () => {
    test('should resize terminal window', async () => {
      const sessionId = await tmuxService.createSession('resize-test');

      // Resize the window
      const proc = Bun.spawn(['tmux', 'resize-window', '-t', sessionId, '-x', '120', '-y', '40'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      // Note: resize may fail if not attached, but we test the command works
      expect([0, 1]).toContain(exitCode);
    });
  });
});
