import * as fs from 'node:fs';
import * as path from 'node:path';

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

  // Cache for listSessions to avoid redundant subprocess spawns from concurrent polling
  private listSessionsCache: { data: TmuxSessionInfo[]; timestamp: number } | null = null;
  private static readonly LIST_SESSIONS_CACHE_TTL = 2000; // 2 seconds

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
    // Return cached result if still fresh
    if (this.listSessionsCache && Date.now() - this.listSessionsCache.timestamp < TmuxService.LIST_SESSIONS_CACHE_TTL) {
      return this.listSessionsCache.data;
    }

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
            createdAt: new Date(parseInt(created, 10) * 1000).toISOString(),
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

      // Batch check: which TTYs have claude running (single ps call for all TTYs)
      const allTtys = new Set<string>();
      for (const [, info] of paneInfo) {
        if (info.tty) allTtys.add(info.tty.replace('/dev/', ''));
      }
      const claudeOnTtySet = await this.batchCheckClaudeOnTtys([...allTtys]);

      // Get preview + waiting status (single capture-pane call per session)
      const previews = new Map<string, string>();
      const waitingStatus = new Map<string, boolean>();
      const claudeOnTty = new Map<string, boolean>();
      await Promise.all(
        sessions.map(async (session) => {
          // Single capture-pane call for both preview and waiting detection
          const capturedText = await this.capturePane(session.id, 15);
          if (capturedText) {
            const previewLines = capturedText
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .slice(-3)
              .join(' ')
              .slice(0, 100);
            if (previewLines) {
              previews.set(session.id, previewLines);
            }
            waitingStatus.set(session.id, this.parseWaitingStatus(capturedText));
          }

          // Use batch result for claude detection
          const info = paneInfo.get(session.id);
          if (info?.tty) {
            claudeOnTty.set(session.id, claudeOnTtySet.has(info.tty.replace('/dev/', '')));
          }
        })
      );

      // Merge all info into sessions
      const result = sessions.map((session) => {
        const info = paneInfo.get(session.id);
        // Claude Code detection: Check if 'claude' process exists on the TTY
        const isClaudeRunning = claudeOnTty.get(session.id) || false;
        const currentCommand = isClaudeRunning ? 'claude' : info?.command;
        return {
          ...session,
          currentCommand,
          currentPath: info?.path,
          paneTitle: info?.title,
          paneTty: info?.tty,
          preview: previews.get(session.id),
          waitingForInput: waitingStatus.get(session.id),
        };
      });

      // Cache the result
      this.listSessionsCache = { data: result, timestamp: Date.now() };
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Batch check which TTYs have 'claude' process running (single ps call)
   * Returns a Set of tty names that have claude running
   */
  async batchCheckClaudeOnTtys(ttyNames: string[]): Promise<Set<string>> {
    const result = new Set<string>();
    if (ttyNames.length === 0) return result;

    try {
      // Single ps call: get TTY and command for all processes
      const proc = Bun.spawn(['ps', '-eo', 'tty,comm', '--no-headers'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) return result;

      // Build a set of TTYs that have claude
      const ttySet = new Set(ttyNames);
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[1] === 'claude' && ttySet.has(parts[0])) {
          result.add(parts[0]);
        }
      }
    } catch {
      // Fall back silently
    }
    return result;
  }

  /**
   * Check if 'claude' process is running on a given TTY
   * This is the most reliable way to detect Claude Code on macOS
   * where pane_current_command returns version number instead of 'claude'
   */
  async isClaudeRunningOnTty(tty: string): Promise<boolean> {
    try {
      const ttyName = tty.replace('/dev/', '');
      const result = await this.batchCheckClaudeOnTtys([ttyName]);
      return result.has(ttyName);
    } catch {
      return false;
    }
  }

  /**
   * Capture pane output (raw text) - used as a shared primitive for preview + waiting detection
   */
  async capturePane(sessionId: string, lines: number = 15): Promise<string | null> {
    try {
      const proc = Bun.spawn(['tmux', 'capture-pane', '-t', sessionId, '-p', '-S', `-${lines}`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        return null;
      }

      return await new Response(proc.stdout).text();
    } catch {
      return null;
    }
  }

  /**
   * Capture a short preview of recent pane output
   */
  async capturePreview(sessionId: string, lines: number = 5): Promise<string | null> {
    const text = await this.capturePane(sessionId, lines);
    if (!text) return null;

    const cleanedLines = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(-3)
      .join(' ')
      .slice(0, 100);

    return cleanedLines || null;
  }

  /**
   * Batch check if Claude processes are actively running on given TTYs (single ps call)
   * Returns a Map of tty name → isActivelyRunning
   */
  async batchCheckProcessRunning(ttyNames: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (ttyNames.length === 0) return result;

    // Initialize all as false
    for (const tty of ttyNames) result.set(tty, false);

    try {
      // Single ps call: get TTY, state, wchan, and command for all processes
      const proc = Bun.spawn(['ps', '-eo', 'tty,stat,wchan:20,comm', '--no-headers'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) return result;

      const ttySet = new Set(ttyNames);
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const [tty, stat, wchan, comm] = parts;
        if (comm !== 'claude' || !ttySet.has(tty)) continue;

        if (stat.startsWith('R')) {
          result.set(tty, true); // Actively running
        } else if (stat.startsWith('S') && (wchan === 'do_epo' || wchan === 'ep_poll' || wchan === 'poll_s')) {
          result.set(tty, false); // Sleeping (waiting for input)
        }
      }
    } catch {
      // Fall back silently
    }
    return result;
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
      const result = await this.batchCheckProcessRunning([pts]);
      return result.get(pts) || false;
    } catch {
      return false;
    }
  }

  /**
   * Parse waiting status from captured pane text (no subprocess spawn)
   */
  parseWaitingStatus(text: string): boolean {
    const lastLines = text.toLowerCase();
    const lines = text.trim().split('\n');
    const lastLine = lines[lines.length - 1] || '';

    // Check for active processing patterns FIRST
    const processingPatterns = [
      '✽ crunching', '✽ embellishing', '✽ thinking', '✽ working',
      '✻ thinking', '✻ crunching', '⏳ working', '✽',
    ];
    if (processingPatterns.some(pattern => lastLines.includes(pattern))) {
      return false;
    }

    // Check for completion patterns
    const completionPatterns = ['✻ worked', '✻ cooked', '✻ crunched', '✻ done'];
    if (completionPatterns.some(pattern => lastLines.includes(pattern))) {
      return true;
    }

    // Check for common waiting patterns
    const waitingPatterns = [
      'esc to cancel', 'tab to amend', 'accept edits', 'shift+tab to cycle',
      'waiting for', 'y/n', 'yes/no', 'press enter', '(y)',
    ];
    if (waitingPatterns.some(pattern => lastLines.includes(pattern))) {
      return true;
    }

    // Check prompt indicators
    const trimmedLast = lastLine.trim();
    if (trimmedLast.endsWith('> ') || trimmedLast.endsWith('>')) {
      return true;
    }
    if (trimmedLast.endsWith('?') && lastLines.includes('❯')) {
      return true;
    }

    return false;
  }

  /**
   * Check if a session is waiting for user input
   */
  async isWaitingForInput(sessionId: string): Promise<boolean> {
    try {
      const text = await this.capturePane(sessionId, 15);
      if (!text) return false;
      return this.parseWaitingStatus(text);
    } catch {
      return false;
    }
  }

  /**
   * Create a new tmux session
   */
  /** Invalidate the listSessions cache */
  invalidateCache(): void {
    this.listSessionsCache = null;
  }

  async createSession(name: string): Promise<string> {
    this.invalidateCache();
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
    this.invalidateCache();
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
