/**
 * TmuxControlSession - manages a tmux -CC (control mode) connection.
 *
 * tmux control mode sends structured notifications on stdout:
 *   %output %<paneId> <octal-encoded data>
 *   %layout-change @<windowId> <layout-string>
 *   %begin <time> <num> <flags>
 *   %end <time> <num> <flags>
 *   %error <time> <num> <flags>
 *   %exit [reason]
 *   %session-changed ...
 *   %window-add @<windowId>
 *   %pane-mode-changed %<paneId>
 *
 * Commands are sent via stdin (one per line).
 */

import type { Subprocess } from 'bun';
import { decodeOctalOutput, encodeHexInput } from './tmux-octal-decoder';
import { parseTmuxLayout, toFrontendLayout } from './tmux-layout-parser';
import type { TmuxLayoutNode } from '../../../shared/types';

// Max chunk size for send-keys -H (bytes)
const SEND_KEYS_CHUNK_SIZE = 4096;

// Debounce for refresh-client -C
const RESIZE_DEBOUNCE_MS = 100;

// Grace period before destroying session after all clients disconnect
const GRACE_PERIOD_MS = 30_000;

interface PendingCommand {
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  output: string[];
}

type OutputListener = (data: Buffer) => void;
type LayoutListener = (layout: TmuxLayoutNode, frontendLayout: ReturnType<typeof toFrontendLayout>) => void;
type ExitListener = (reason: string) => void;

export class TmuxControlSession {
  private proc: Subprocess | null = null;
  private sessionId: string;
  private buffer = '';

  // Command response correlation
  private pendingCommands = new Map<number, PendingCommand>();
  private commandCounter = 0;
  private currentBeginNum: number | null = null;

  // Listeners
  private outputListeners = new Map<string, Set<OutputListener>>(); // paneId -> listeners
  private globalOutputListeners = new Set<(paneId: string, data: Buffer) => void>();
  private layoutListeners = new Set<LayoutListener>();
  private exitListeners = new Set<ExitListener>();

  // Client tracking
  private clientCount = 0;
  private graceTimer: Timer | null = null;
  private destroyed = false;

  // Resize debounce
  private resizeTimer: Timer | null = null;

  // Current layout
  private currentLayout: TmuxLayoutNode | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Start the tmux -CC process.
   */
  async start(): Promise<void> {
    if (this.proc) return;

    this.proc = Bun.spawn(['tmux', '-CC', 'attach', '-t', this.sessionId], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    // Read stdout line by line
    this.readStdout();

    // Handle process exit
    this.proc.exited.then(() => {
      this.handleExit('process exited');
    });
  }

  private async readStdout(): Promise<void> {
    const stdout = this.proc?.stdout;
    if (!stdout || typeof stdout === 'number') return;

    const reader = (stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // Stream closed
    }
  }

  private processBuffer(): void {
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex);
      this.buffer = this.buffer.substring(newlineIndex + 1);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    // Skip empty lines
    if (!line) return;

    if (line.startsWith('%output ')) {
      this.handleOutput(line);
    } else if (line.startsWith('%layout-change ')) {
      this.handleLayoutChange(line);
    } else if (line.startsWith('%begin ')) {
      this.handleBegin(line);
    } else if (line.startsWith('%end ')) {
      this.handleEnd(line);
    } else if (line.startsWith('%error ')) {
      this.handleError(line);
    } else if (line.startsWith('%exit')) {
      const reason = line.substring(5).trim() || 'unknown';
      this.handleExit(reason);
    } else if (this.currentBeginNum !== null) {
      // Inside a command response block - accumulate output
      const pending = this.pendingCommands.get(this.currentBeginNum);
      if (pending) {
        pending.output.push(line);
      }
    }
    // Other notifications (%session-changed, %window-add, etc.) are ignored for now
  }

  /**
   * Handle %output %<paneId> <octal-encoded-data>
   */
  private handleOutput(line: string): void {
    // Format: %output %N data
    const match = line.match(/^%output %(\d+) (.*)$/);
    if (!match) return;

    const paneId = `%${match[1]}`;
    const encodedData = match[2];
    const decoded = decodeOctalOutput(encodedData);

    // Notify pane-specific listeners
    const listeners = this.outputListeners.get(paneId);
    if (listeners) {
      for (const listener of listeners) {
        listener(decoded);
      }
    }

    // Notify global listeners
    for (const listener of this.globalOutputListeners) {
      listener(paneId, decoded);
    }
  }

  /**
   * Handle %layout-change @<windowId> <layout-string>
   */
  private handleLayoutChange(line: string): void {
    // Format: %layout-change @N <layout-string>
    const match = line.match(/^%layout-change @\d+ (.+)$/);
    if (!match) return;

    const layoutString = match[1];
    try {
      const layout = parseTmuxLayout(layoutString);
      const frontendLayout = toFrontendLayout(layout);
      this.currentLayout = layout;

      for (const listener of this.layoutListeners) {
        listener(layout, frontendLayout);
      }
    } catch (err) {
      console.error(`[tmux-control] Failed to parse layout: ${err}`);
    }
  }

  /**
   * Handle %begin <time> <num> <flags>
   */
  private handleBegin(line: string): void {
    const match = line.match(/^%begin (\d+) (\d+) (\d+)$/);
    if (!match) return;
    this.currentBeginNum = parseInt(match[2], 10);
  }

  /**
   * Handle %end <time> <num> <flags>
   */
  private handleEnd(line: string): void {
    const match = line.match(/^%end (\d+) (\d+) (\d+)$/);
    if (!match) return;

    const num = parseInt(match[2], 10);
    const pending = this.pendingCommands.get(num);
    if (pending) {
      pending.resolve(pending.output.join('\n'));
      this.pendingCommands.delete(num);
    }
    this.currentBeginNum = null;
  }

  /**
   * Handle %error <time> <num> <flags>
   */
  private handleError(line: string): void {
    const match = line.match(/^%error (\d+) (\d+) (\d+)$/);
    if (!match) return;

    const num = parseInt(match[2], 10);
    const pending = this.pendingCommands.get(num);
    if (pending) {
      pending.reject(new Error(pending.output.join('\n') || 'tmux command error'));
      this.pendingCommands.delete(num);
    }
    this.currentBeginNum = null;
  }

  private handleExit(reason: string): void {
    for (const listener of this.exitListeners) {
      listener(reason);
    }
    this.destroy();
  }

  // =========================================================================
  // Public API - Commands
  // =========================================================================

  /**
   * Send a raw tmux command and wait for response.
   */
  async sendCommand(command: string): Promise<string> {
    if (!this.proc || this.destroyed) {
      throw new Error('Control session not active');
    }

    const num = ++this.commandCounter;

    return new Promise<string>((resolve, reject) => {
      this.pendingCommands.set(num, { resolve, reject, output: [] });

      // Write command to stdin
      const stdin = this.proc!.stdin;
      if (stdin && typeof stdin !== 'number') {
        (stdin as { write(data: Uint8Array): void }).write(
          new TextEncoder().encode(`${command}\n`),
        );
      }

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingCommands.has(num)) {
          this.pendingCommands.delete(num);
          reject(new Error(`Command timed out: ${command}`));
        }
      }, 10_000);
    });
  }

  /**
   * Send input to a specific pane.
   * Data is a Buffer of raw bytes to send.
   */
  async sendInput(paneId: string, data: Buffer): Promise<void> {
    // Chunk data for send-keys -H
    for (let offset = 0; offset < data.length; offset += SEND_KEYS_CHUNK_SIZE) {
      const chunk = data.subarray(offset, offset + SEND_KEYS_CHUNK_SIZE);
      const hex = encodeHexInput(chunk);
      try {
        await this.sendCommand(`send-keys -H -t ${paneId} ${hex}`);
      } catch {
        // send-keys errors are non-fatal (pane may have closed)
      }
    }
  }

  /**
   * Split a pane.
   */
  async splitPane(paneId: string, direction: 'h' | 'v'): Promise<void> {
    const flag = direction === 'h' ? '-h' : '-v';
    await this.sendCommand(`split-window ${flag} -t ${paneId}`);
  }

  /**
   * Close a pane.
   */
  async closePane(paneId: string): Promise<void> {
    await this.sendCommand(`kill-pane -t ${paneId}`);
  }

  /**
   * Resize a specific pane.
   */
  async resizePane(paneId: string, cols: number, rows: number): Promise<void> {
    await this.sendCommand(`resize-pane -t ${paneId} -x ${cols} -y ${rows}`);
  }

  /**
   * Select (focus) a pane.
   */
  async selectPane(paneId: string): Promise<void> {
    await this.sendCommand(`select-pane -t ${paneId}`);
  }

  /**
   * Set the client size (debounced).
   */
  setClientSize(cols: number, rows: number): void {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(async () => {
      try {
        await this.sendCommand(`refresh-client -C ${cols},${rows}`);
      } catch {
        // Ignore resize errors
      }
    }, RESIZE_DEBOUNCE_MS);
  }

  /**
   * Capture existing pane content (with ANSI escapes).
   */
  async capturePane(paneId: string): Promise<string> {
    return this.sendCommand(`capture-pane -e -p -t ${paneId}`);
  }

  /**
   * List current panes with their IDs.
   */
  async listPanes(): Promise<Array<{ paneId: string; width: number; height: number }>> {
    const output = await this.sendCommand(
      `list-panes -F "#{pane_id} #{pane_width} #{pane_height}"`
    );
    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [paneId, w, h] = line.trim().split(' ');
        return { paneId, width: parseInt(w, 10), height: parseInt(h, 10) };
      });
  }

  /**
   * Break a pane out to a new session (for mobile pane separation).
   */
  async breakPaneToNewSession(paneId: string, _newSessionName: string): Promise<void> {
    // break-pane detaches pane to a new window
    await this.sendCommand(`break-pane -d -t ${paneId}`);
  }

  // =========================================================================
  // Public API - Listeners
  // =========================================================================

  /**
   * Register a listener for output from a specific pane.
   */
  onPaneOutput(paneId: string, listener: OutputListener): () => void {
    if (!this.outputListeners.has(paneId)) {
      this.outputListeners.set(paneId, new Set());
    }
    this.outputListeners.get(paneId)!.add(listener);
    return () => {
      this.outputListeners.get(paneId)?.delete(listener);
    };
  }

  /**
   * Register a listener for output from all panes.
   */
  onOutput(listener: (paneId: string, data: Buffer) => void): () => void {
    this.globalOutputListeners.add(listener);
    return () => {
      this.globalOutputListeners.delete(listener);
    };
  }

  /**
   * Register a listener for layout changes.
   */
  onLayoutChange(listener: LayoutListener): () => void {
    this.layoutListeners.add(listener);
    return () => {
      this.layoutListeners.delete(listener);
    };
  }

  /**
   * Register a listener for session exit.
   */
  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  // =========================================================================
  // Client management (grace period)
  // =========================================================================

  addClient(): void {
    this.clientCount++;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  removeClient(): void {
    this.clientCount--;
    if (this.clientCount <= 0) {
      this.clientCount = 0;
      // Start grace period
      this.graceTimer = setTimeout(() => {
        if (this.clientCount <= 0) {
          console.log(`[tmux-control] Grace period expired for session: ${this.sessionId}`);
          this.destroy();
        }
      }, GRACE_PERIOD_MS);
    }
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get layout(): TmuxLayoutNode | null {
    return this.currentLayout;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }

    // Reject pending commands
    for (const [, pending] of this.pendingCommands) {
      pending.reject(new Error('Control session destroyed'));
    }
    this.pendingCommands.clear();

    // Kill process
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.proc = null;

    // Clear listeners
    this.outputListeners.clear();
    this.globalOutputListeners.clear();
    this.layoutListeners.clear();
    this.exitListeners.clear();

    // Remove from global registry
    controlSessions.delete(this.sessionId);
    console.log(`[tmux-control] Session destroyed: ${this.sessionId}`);
  }
}

// Global registry of control sessions (one per tmux session)
export const controlSessions = new Map<string, TmuxControlSession>();

/**
 * Get or create a TmuxControlSession for a given tmux session.
 */
export async function getOrCreateControlSession(sessionId: string): Promise<TmuxControlSession> {
  let session = controlSessions.get(sessionId);
  if (session && !session.isDestroyed) {
    return session;
  }

  session = new TmuxControlSession(sessionId);
  controlSessions.set(sessionId, session);
  await session.start();
  return session;
}
