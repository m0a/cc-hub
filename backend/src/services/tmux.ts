interface TmuxSessionInfo {
  id: string;
  name: string;
  createdAt: string;
  attached: boolean;
  currentCommand?: string;
  currentPath?: string;
  paneTitle?: string;
  paneTty?: string;
  preview?: string;
  waitingForInput?: boolean;
}

export class TmuxService {
  /**
   * List all tmux sessions with pane info
   */
  async listSessions(): Promise<TmuxSessionInfo[]> {
    try {
      // Get session info
      const sessionsProc = Bun.spawn(['tmux', 'list-sessions', '-F', '#{session_name}:#{session_created}:#{session_attached}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const sessionsText = await new Response(sessionsProc.stdout).text();
      const sessionsExitCode = await sessionsProc.exited;

      if (sessionsExitCode !== 0) {
        return [];
      }

      const sessions = sessionsText
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, created, attached] = line.split(':');
          return {
            id: name,
            name: name,
            createdAt: new Date(parseInt(created) * 1000).toISOString(),
            attached: attached === '1',
          };
        });

      // Get pane info for each session (command, path, title, tty)
      // Use | as separator since path can contain :
      const panesProc = Bun.spawn(['tmux', 'list-panes', '-a', '-F', '#{session_name}|#{pane_current_command}|#{pane_title}|#{pane_tty}|#{pane_current_path}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const panesText = await new Response(panesProc.stdout).text();
      const panesExitCode = await panesProc.exited;

      const paneInfo = new Map<string, { command: string; path: string; title: string; tty: string }>();
      if (panesExitCode === 0) {
        panesText
          .trim()
          .split('\n')
          .filter((line) => line.length > 0)
          .forEach((line) => {
            const parts = line.split('|');
            if (parts.length >= 5) {
              const [sessionName, command, title, tty, ...pathParts] = parts;
              // Path might contain |, so join the rest
              const path = pathParts.join('|');
              // Only store first pane info per session
              if (!paneInfo.has(sessionName)) {
                paneInfo.set(sessionName, { command, path, title, tty });
              }
            }
          });
      }

      // Get preview and waiting status for each session
      const previews = new Map<string, string>();
      const waitingStatus = new Map<string, boolean>();
      await Promise.all(
        sessions.map(async (session) => {
          const preview = await this.capturePreview(session.id);
          if (preview) {
            previews.set(session.id, preview);
          }
          const waiting = await this.isWaitingForInput(session.id);
          waitingStatus.set(session.id, waiting);
        })
      );

      // Merge all info into sessions
      return sessions.map((session) => {
        const info = paneInfo.get(session.id);
        return {
          ...session,
          currentCommand: info?.command,
          currentPath: info?.path,
          paneTitle: info?.title,
          paneTty: info?.tty,
          preview: previews.get(session.id),
          waitingForInput: waitingStatus.get(session.id),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Capture a short preview of recent pane output
   */
  async capturePreview(sessionId: string, lines: number = 5): Promise<string | null> {
    try {
      const proc = Bun.spawn(['tmux', 'capture-pane', '-t', sessionId, '-p', '-S', `-${lines}`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return null;
      }

      const text = await new Response(proc.stdout).text();
      // Clean up: trim, remove empty lines, take last meaningful lines
      const cleanedLines = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .slice(-3)  // Take last 3 non-empty lines
        .join(' ')
        .slice(0, 100);  // Limit to 100 chars

      return cleanedLines || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a session is waiting for user input
   */
  async isWaitingForInput(sessionId: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(['tmux', 'capture-pane', '-t', sessionId, '-p', '-S', '-10'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return false;
      }

      const text = await new Response(proc.stdout).text();
      const lastLines = text.toLowerCase();

      // Check for common waiting patterns in Claude Code
      const waitingPatterns = [
        'esc to cancel',
        'tab to amend',
        'accept edits',
        'shift+tab to cycle',
        'waiting for',
        '? ',  // Selection prompt
        '> ',  // Input prompt
      ];

      return waitingPatterns.some(pattern => lastLines.includes(pattern));
    } catch {
      return false;
    }
  }

  /**
   * Create a new tmux session
   */
  async createSession(name: string): Promise<string> {
    const proc = Bun.spawn(['tmux', 'new-session', '-d', '-s', name], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      throw new Error(`Failed to create session: ${error}`);
    }

    return name;
  }

  /**
   * Kill a tmux session
   */
  async killSession(sessionId: string): Promise<void> {
    const proc = Bun.spawn(['tmux', 'kill-session', '-t', sessionId], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      throw new Error(`Failed to kill session: ${error}`);
    }
  }

  /**
   * Check if a tmux session exists
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const proc = Bun.spawn(['tmux', 'has-session', '-t', sessionId], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    return exitCode === 0;
  }

  /**
   * Check if session is in copy mode (scroll mode)
   */
  async isInCopyMode(sessionId: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(['tmux', 'display-message', '-t', sessionId, '-p', '#{pane_in_mode}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return false;
      }

      const text = await new Response(proc.stdout).text();
      return text.trim() === '1';
    } catch {
      return false;
    }
  }

  /**
   * Get tmux paste buffer content
   */
  async getBuffer(): Promise<string | null> {
    try {
      const proc = Bun.spawn(['tmux', 'show-buffer'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return null;
      }

      const text = await new Response(proc.stdout).text();
      return text;
    } catch {
      return null;
    }
  }

  /**
   * Capture the scrollback buffer from a tmux session
   */
  async captureScrollback(sessionId: string, lines: number = 1000): Promise<string | null> {
    try {
      const proc = Bun.spawn(['tmux', 'capture-pane', '-t', sessionId, '-p', '-S', `-${lines}`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return null;
      }

      const text = await new Response(proc.stdout).text();
      return text;
    } catch {
      return null;
    }
  }

  /**
   * Send keys to a tmux session
   */
  async sendKeys(sessionId: string, keys: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(['tmux', 'send-keys', '-t', sessionId, keys, 'Enter'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }
}
