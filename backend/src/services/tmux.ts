import * as fs from 'node:fs';
import * as path from 'node:path';

interface TmuxPaneInfo {
  paneId: string;          // "%0", "%1"
  command: string;
  path: string;
  title: string;
  tty: string;
  isActive: boolean;
  isDead: boolean;
  pid?: number;            // pane_pid (shell PID)
}

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
  panes?: TmuxPaneInfo[];
}

const CCHUB_TMUX_CONFIG = `# CC Hub tmux configuration
# Auto-generated - do not edit manually

# Enable mouse support
set -g mouse on

# Increase scrollback buffer
set -g history-limit 10000

# Enable clipboard (OSC 52)
set -g set-clipboard on

# Keep panes alive after process exits (dead pane mode)
set -g remain-on-exit on
`;

/** Parsed process info from a single `ps` call, shared across consumers */
export interface ParsedProcessInfo {
  /** TTYs that have a Claude Code process running */
  claudeTtys: Set<string>;
  /** TTY → agent info (name/color) for team agent processes */
  agentInfo: Map<string, { agentName: string; agentColor?: string }>;
  /** TTY → all process args lines (for session ID extraction etc.) */
  ttyArgs: Map<string, string[]>;
}

export class TmuxService {
  private configPath: string;
  private configEnsured = false;

  // Cache for listSessions to avoid redundant subprocess spawns from concurrent polling
  private listSessionsCache: { data: TmuxSessionInfo[]; timestamp: number } | null = null;
  private static readonly LIST_SESSIONS_CACHE_TTL = 2000; // 2 seconds

  // Cache for consolidated process info (single ps call serves all 3 consumers)
  private processInfoCache: { data: ParsedProcessInfo; timestamp: number } | null = null;
  private static readonly PROCESS_INFO_CACHE_TTL = 3000; // 3 seconds

  // Cache for capturePane per session
  private capturePaneCache = new Map<string, { data: string | null; timestamp: number }>();
  private static readonly CAPTURE_PANE_CACHE_TTL = 3000; // 3 seconds

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

    // Always write config to ensure latest settings are applied
    fs.writeFileSync(this.configPath, CCHUB_TMUX_CONFIG);

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
   * Consolidated process info: runs `ps -eo tty,args` ONCE
   * and parses the result for Claude detection, agent info, and args extraction.
   * Results are cached with a 3-second TTL.
   */
  async batchProcessInfo(ttyNames: string[]): Promise<ParsedProcessInfo> {
    // Return cached result if still fresh
    if (this.processInfoCache && Date.now() - this.processInfoCache.timestamp < TmuxService.PROCESS_INFO_CACHE_TTL) {
      return this.processInfoCache.data;
    }

    const result: ParsedProcessInfo = {
      claudeTtys: new Set(),
      agentInfo: new Map(),
      ttyArgs: new Map(),
    };

    if (ttyNames.length === 0) {
      this.processInfoCache = { data: result, timestamp: Date.now() };
      return result;
    }

    try {
      // Single ps call: TTY and args (stat/wchan no longer needed — indicator uses hook/jsonl).
      // `--no-headers` is GNU ps only; on macOS BSD ps it makes the command fail. Skip the
      // header line in user-space instead so this works on both platforms.
      const proc = Bun.spawn(['ps', '-A', '-o', 'tty,args'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        this.processInfoCache = { data: result, timestamp: Date.now() };
        return result;
      }

      const ttySet = new Set(ttyNames);

      const lines = output.split('\n');
      // Drop the header line if present (e.g. "TT       COMMAND" / "TTY      ARGS").
      const startIdx = lines[0]?.match(/^\s*(TTY|TT)\b/i) ? 1 : 0;
      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;

        const [tty] = parts;
        if (!ttySet.has(tty)) continue;

        const args = parts.slice(1).join(' ');

        // Collect all args per TTY for external consumers
        if (!result.ttyArgs.has(tty)) result.ttyArgs.set(tty, []);
        result.ttyArgs.get(tty)!.push(args);

        // Consumer 1: Claude detection (batchCheckClaudeOnTtys)
        if (this.isClaudeProcess(args)) {
          result.claudeTtys.add(tty);
        }

        // Consumer 2: Agent info (batchGetAgentInfo)
        if (args.includes('--agent-name')) {
          const nameMatch = args.match(/--agent-name\s+(\S+)/);
          const colorMatch = args.match(/--agent-color\s+(\S+)/);
          if (nameMatch) {
            result.agentInfo.set(tty, {
              agentName: nameMatch[1],
              agentColor: colorMatch?.[1],
            });
          }
        }
      }
    } catch {
      // Fall back silently
    }

    this.processInfoCache = { data: result, timestamp: Date.now() };
    return result;
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

      // Get pane info for each session (command, path, title, tty, pane_id, active).
      // Use a multi-char ASCII sentinel as separator. Originally `\x1f` (US control char) was used,
      // but on macOS + Bun.spawn the 0x1f byte in argv gets corrupted to 0x5f ('_') by the time
      // tmux's format parser sees it, so all panes failed to parse. ASCII-only sentinel avoids it.
      const SEP = '||~~||';
      const fmtString = `#{session_name}${SEP}#{pane_id}${SEP}#{pane_current_command}${SEP}#{pane_title}${SEP}#{pane_tty}${SEP}#{pane_active}${SEP}#{pane_dead}${SEP}#{pane_pid}${SEP}#{pane_current_path}`;
      const panesProc = Bun.spawn(['tmux', 'list-panes', '-a', '-F', fmtString], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const panesText = await new Response(panesProc.stdout).text();
      const panesExitCode = await panesProc.exited;

      // Store all panes per session
      const allPanes = new Map<string, TmuxPaneInfo[]>();
      if (panesExitCode === 0) {
        panesText
          .trim()
          .split('\n')
          .filter((line) => line.length > 0)
          .forEach((line) => {
            const parts = line.split(SEP);
            if (parts.length >= 9) {
              const [sessionName, paneId, command, title, tty, active, dead, pidStr, ...pathParts] = parts;
              // Path might contain SEP (extremely unlikely), so join the rest
              const panePath = pathParts.join(SEP);
              const isActive = active === '1';
              const isDead = dead === '1';
              const pidNum = pidStr ? Number.parseInt(pidStr, 10) : Number.NaN;

              // Collect all panes (pane_id already includes % prefix)
              if (!allPanes.has(sessionName)) {
                allPanes.set(sessionName, []);
              }
              allPanes.get(sessionName)!.push({
                paneId,
                command,
                path: panePath,
                title,
                tty,
                isActive,
                isDead,
                pid: Number.isFinite(pidNum) ? pidNum : undefined,
              });
            }
          });
      }

      // Batch check: which TTYs have claude running (single ps call for all pane TTYs)
      // Must run before pane selection so we can pick the right representative pane.
      const allTtys = new Set<string>();
      for (const [, panes] of allPanes) {
        for (const p of panes) {
          if (p.tty) allTtys.add(p.tty.replace('/dev/', ''));
        }
      }
      const claudeOnTtySet = await this.batchCheckClaudeOnTtys([...allTtys]);

      // Derive session-level pane info from all panes (backward compatibility).
      // Priority: pane with claude running (via ps) > first non-dead pane > first pane.
      const paneInfo = new Map<string, { command: string; path: string; title: string; tty: string }>();
      for (const [sessionName, panes] of allPanes) {
        const claudePane = panes.find(p => {
          const ttyName = p.tty?.replace('/dev/', '');
          return ttyName && claudeOnTtySet.has(ttyName);
        });
        const alivePane = panes.find(p => !p.isDead);
        const bestPane = claudePane || alivePane || panes[0];
        if (bestPane) {
          paneInfo.set(sessionName, {
            command: bestPane.command,
            path: bestPane.path,
            title: bestPane.title,
            tty: bestPane.tty,
          });
        }
      }

      // Get preview + waiting status (single capture-pane call per session)
      const previews = new Map<string, string>();
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
        const sessionPanes = allPanes.get(session.id);
        return {
          ...session,
          currentCommand,
          currentPath: info?.path,
          paneTitle: info?.title,
          paneTty: info?.tty,
          preview: previews.get(session.id),
          panes: sessionPanes,
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
   * Check if process args indicate a Claude Code process.
   * Matches 'claude ...' (main binary) or paths containing '/claude/versions/' (team agents).
   */
  private isClaudeProcess(args: string): boolean {
    return args.startsWith('claude ') || args === 'claude' || args.includes('/claude/versions/');
  }

  /**
   * Batch check which TTYs have Claude Code process running.
   * Delegates to consolidated batchProcessInfo() (single ps call).
   */
  async batchCheckClaudeOnTtys(ttyNames: string[]): Promise<Set<string>> {
    if (ttyNames.length === 0) return new Set();
    const info = await this.batchProcessInfo(ttyNames);
    return info.claudeTtys;
  }

  /**
   * Batch get team agent info from process args for TTYs.
   * Delegates to consolidated batchProcessInfo() (single ps call).
   */
  async batchGetAgentInfo(ttyNames: string[]): Promise<Map<string, { agentName: string; agentColor?: string }>> {
    if (ttyNames.length === 0) return new Map();
    const info = await this.batchProcessInfo(ttyNames);
    return info.agentInfo;
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
    // Check cache
    const cacheKey = `${sessionId}:${lines}`;
    const cached = this.capturePaneCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < TmuxService.CAPTURE_PANE_CACHE_TTL) {
      return cached.data;
    }

    try {
      const proc = Bun.spawn(['tmux', 'capture-pane', '-t', sessionId, '-p', '-S', `-${lines}`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        this.capturePaneCache.set(cacheKey, { data: null, timestamp: Date.now() });
        return null;
      }

      const text = await new Response(proc.stdout).text();
      this.capturePaneCache.set(cacheKey, { data: text, timestamp: Date.now() });
      return text;
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
   * Create a new tmux session
   */
  /** Invalidate the listSessions and processInfo caches */
  invalidateCache(): void {
    this.listSessionsCache = null;
    this.processInfoCache = null;
    this.capturePaneCache.clear();
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
