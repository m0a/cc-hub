interface TmuxSessionInfo {
  id: string;
  name: string;
  createdAt: string;
  attached: boolean;
  currentCommand?: string;
  currentPath?: string;
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

      // Get pane info for each session
      const panesProc = Bun.spawn(['tmux', 'list-panes', '-a', '-F', '#{session_name}:#{pane_current_command}:#{pane_current_path}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const panesText = await new Response(panesProc.stdout).text();
      const panesExitCode = await panesProc.exited;

      if (panesExitCode === 0) {
        const paneInfo = new Map<string, { command: string; path: string }>();
        panesText
          .trim()
          .split('\n')
          .filter((line) => line.length > 0)
          .forEach((line) => {
            const [sessionName, command, ...pathParts] = line.split(':');
            // Path might contain colons, so join the rest
            const path = pathParts.join(':');
            // Only store first pane info per session
            if (!paneInfo.has(sessionName)) {
              paneInfo.set(sessionName, { command, path });
            }
          });

        // Merge pane info into sessions
        return sessions.map((session) => {
          const info = paneInfo.get(session.id);
          return {
            ...session,
            currentCommand: info?.command,
            currentPath: info?.path,
          };
        });
      }

      return sessions;
    } catch {
      return [];
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
}
