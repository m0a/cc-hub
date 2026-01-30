import type { Session, SessionState } from 'shared';

interface TmuxSessionInfo {
  id: string;
  name: string;
  createdAt: string;
  attached: boolean;
}

export class TmuxService {
  private prefix: string;

  constructor(prefix: string = 'cchub-') {
    this.prefix = prefix;
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    try {
      const proc = Bun.spawn(['tmux', 'list-sessions', '-F', '#{session_name}:#{session_created}:#{session_attached}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        // No sessions exist
        return [];
      }

      return text
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, created, attached] = line.split(':');
          return {
            id: name,
            name: name.replace(this.prefix, ''),
            createdAt: new Date(parseInt(created) * 1000).toISOString(),
            attached: attached === '1',
          };
        })
        .filter((s) => s.id.startsWith(this.prefix));
    } catch {
      return [];
    }
  }

  /**
   * List all tmux sessions (including non-cchub sessions)
   */
  async listAllSessions(): Promise<TmuxSessionInfo[]> {
    try {
      const proc = Bun.spawn(['tmux', 'list-sessions', '-F', '#{session_name}:#{session_created}:#{session_attached}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        return [];
      }

      return text
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
    } catch {
      return [];
    }
  }

  /**
   * List external tmux sessions (non-cchub sessions)
   */
  async listExternalSessions(): Promise<TmuxSessionInfo[]> {
    const all = await this.listAllSessions();
    return all.filter((s) => !s.id.startsWith(this.prefix));
  }

  async createSession(name?: string): Promise<string> {
    const sessionName = name
      ? `${this.prefix}${name}`
      : `${this.prefix}${Date.now()}`;

    const proc = Bun.spawn(['tmux', 'new-session', '-d', '-s', sessionName], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      throw new Error(`Failed to create session: ${error}`);
    }

    return sessionName;
  }

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

  async sessionExists(sessionId: string): Promise<boolean> {
    const proc = Bun.spawn(['tmux', 'has-session', '-t', sessionId], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    return exitCode === 0;
  }

  /**
   * Capture the scrollback buffer from a tmux session.
   * Returns the visible pane content + scrollback history.
   * @param sessionId tmux session name
   * @param lines number of history lines to capture (default 1000)
   */
  async captureScrollback(sessionId: string, lines: number = 1000): Promise<string | null> {
    try {
      // -p: output to stdout
      // -S: start line (negative = history)
      // -E: end line (empty = current)
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

  toSessionResponse(info: TmuxSessionInfo, ownerId: string, state: SessionState = 'idle'): Session {
    return {
      id: info.id,
      name: info.name,
      createdAt: info.createdAt,
      lastAccessedAt: new Date().toISOString(),
      state,
      ownerId,
    };
  }
}
