import * as fs from 'fs';
import * as path from 'path';

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

const CCHUB_TMUX_CONFIG = `# CC Hub tmux configuration
# Auto-generated - do not edit manually

# Enable mouse support
set -g mouse on

# Increase scrollback buffer
set -g history-limit 10000

# Enable clipboard (OSC 52)
set -g set-clipboard on
`;

export class TmuxService {
  private configPath: string;
  private configEnsured = false;

  constructor() {
    const configDir = path.join(process.env.HOME || '/tmp', '.config', 'cchub');
    this.configPath = path.join(configDir, 'tmux.conf');
  }

  /**
   * Ensure CC Hub tmux config exists
   */
  private async ensureConfig(): Promise<void> {
    if (this.configEnsured) return;

    const configDir = path.dirname(this.configPath);

    // Create config directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Create config file if it doesn't exist
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, CCHUB_TMUX_CONFIG);
      console.log(`Created tmux config: ${this.configPath}`);
    }

    this.configEnsured = true;
  }

  /**
   * Apply CC Hub tmux config to the server
   */
  private async applyConfig(): Promise<void> {
    await this.ensureConfig();

    // Source the config file to apply settings
    const proc = Bun.spawn(['tmux', 'source-file', this.configPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    await proc.exited;
    // Ignore errors (e.g., if no tmux server is running)
  }
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
   * Check if Claude process is running (not sleeping/waiting)
   * Returns true if actively processing, false if waiting for input
   */
  async isProcessRunning(sessionId: string): Promise<boolean> {
    try {
      // Get pane TTY
      const ttyProc = Bun.spawn(['tmux', 'list-panes', '-t', sessionId, '-F', '#{pane_tty}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const tty = (await new Response(ttyProc.stdout).text()).trim();
      if (!tty) return false;

      const pts = tty.replace('/dev/', '');

      // Get process state
      const psProc = Bun.spawn(['ps', '-t', pts, '-o', 'stat,wchan,comm'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const psOutput = await new Response(psProc.stdout).text();

      // Find claude process line
      for (const line of psOutput.split('\n')) {
        if (line.includes('claude')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            const stat = parts[0];
            const wchan = parts[1];

            // R = Running (processing)
            // S with do_epo/ep_poll = epoll_wait (waiting for input)
            if (stat.startsWith('R')) {
              return true;  // Actively running
            }
            if (stat.startsWith('S') && (wchan === 'do_epo' || wchan === 'ep_poll' || wchan === 'poll_s')) {
              return false;  // Sleeping in event loop (waiting for input)
            }
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a session is waiting for user input
   */
  async isWaitingForInput(sessionId: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(['tmux', 'capture-pane', '-t', sessionId, '-p', '-S', '-15'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return false;
      }

      const text = await new Response(proc.stdout).text();
      const lastLines = text.toLowerCase();
      const lines = text.trim().split('\n');
      const lastLine = lines[lines.length - 1] || '';

      // Check for active processing patterns FIRST - if found, NOT waiting
      // These are specific Claude Code spinner patterns with emoji prefix
      // Processing takes priority over completion (completion may be in scroll buffer)
      const processingPatterns = [
        '✽ crunching',
        '✽ embellishing',
        '✽ thinking',
        '✽ working',
        '✻ thinking',
        '✻ crunching',
        '⏳ working',
        '✽',  // Any spinning indicator
      ];

      if (processingPatterns.some(pattern => lastLines.includes(pattern))) {
        return false;  // Currently processing, not waiting
      }

      // Check for completion patterns - if found, definitely waiting
      // These indicate Claude finished processing and is waiting for input
      const completionPatterns = [
        '✻ worked',
        '✻ cooked',
        '✻ crunched',
        '✻ done',
      ];

      if (completionPatterns.some(pattern => lastLines.includes(pattern))) {
        return true;  // Completed, waiting for input
      }

      // Check for common waiting patterns in Claude Code
      // These patterns are specific to Claude Code UI
      const waitingPatterns = [
        'esc to cancel',
        'tab to amend',
        'accept edits',
        'shift+tab to cycle',
        'waiting for',
        'y/n',
        'yes/no',
        'press enter',
        '(y)',
      ];

      // Check if any specific pattern matches
      if (waitingPatterns.some(pattern => lastLines.includes(pattern))) {
        return true;
      }

      // Check if the last line ends with a prompt indicator
      // Only consider it waiting if it's at the very end
      const trimmedLast = lastLine.trim();
      if (trimmedLast.endsWith('> ') || trimmedLast.endsWith('>')) {
        return true;
      }

      // Check for selection prompt (? at end of line with options above)
      if (trimmedLast.endsWith('?') && lastLines.includes('❯')) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Create a new tmux session
   */
  async createSession(name: string): Promise<string> {
    // Ensure config exists before creating session
    await this.ensureConfig();

    const proc = Bun.spawn(['tmux', 'new-session', '-d', '-s', name], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      throw new Error(`Failed to create session: ${error}`);
    }

    // Apply CC Hub config to tmux server
    await this.applyConfig();

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
