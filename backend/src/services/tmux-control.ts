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

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { decodeOctalOutput, decodeOctalOutputRaw, encodeHexInput } from './tmux-octal-decoder';
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
  private proc: ChildProcess | null = null;
  private sessionId: string;
  // Raw byte buffer for stdout processing.
  // We intentionally avoid StringDecoder because tmux may split multi-byte
  // UTF-8 sequences across %output lines.  Processing raw bytes preserves
  // the original byte stream, letting the browser's TextDecoder (with
  // stream: true) handle UTF-8 reassembly correctly.
  private rawBuffer: Buffer = Buffer.alloc(0);

  // Command response correlation (FIFO queue - tmux uses its own sequence numbers)
  private pendingQueue: PendingCommand[] = [];
  private currentBeginNum: number | null = null;
  private currentOutput: string[] = [];

  // Ready state: resolves after the initial %begin/%end block from tmux attach
  private resolveReady: (() => void) | null = null;
  private readyPromise: Promise<void> | null = null;

  // Listeners
  private outputListeners = new Map<string, Set<OutputListener>>(); // paneId -> listeners
  private globalOutputListeners = new Set<(paneId: string, data: Buffer) => void>();
  private layoutListeners = new Set<LayoutListener>();
  private exitListeners = new Set<ExitListener>();
  private newSessionListeners = new Set<(sessionId: string, sessionName: string) => void>();

  // Client tracking
  private clientCount = 0;
  private graceTimer: Timer | null = null;
  private destroyed = false;

  // Mobile pane separation
  private clientDeviceTypes = new Map<string, 'mobile' | 'tablet' | 'desktop'>();
  private knownPaneIds = new Set<string>();

  // Resize debounce
  private resizeTimer: Timer | null = null;
  private lastClientSize: { cols: number; rows: number } | null = null;

  // Current layout
  private currentLayout: TmuxLayoutNode | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Start the tmux -CC process.
   * Uses `script` to provide a PTY (tmux requires tcgetattr) while
   * communicating via pipes to avoid PTY echo corrupting the protocol stream.
   */
  async start(): Promise<void> {
    if (this.proc) return;

    console.log(`[tmux-control] Starting session: ${this.sessionId}`);

    // Create ready promise - resolved when initial %begin/%end block completes
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    try {
      // Use `script` to create a PTY for tmux while our I/O stays on pipes.
      // `stty -echo` prevents the PTY from echoing commands back into stdout.
      this.proc = spawn(
        'script',
        ['-qfc', `stty -echo && exec tmux -CC attach -t ${this.sessionId}`, '/dev/null'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, TERM: 'xterm-256color' },
        },
      );
      console.log(`[tmux-control] Process spawned for: ${this.sessionId} (pid=${this.proc.pid})`);

      // Read stdout as raw bytes (no StringDecoder) to preserve byte-level
      // fidelity for %output data that may contain split UTF-8 sequences.
      this.proc.stdout!.on('data', (chunk: Buffer) => {
        try {
          this.rawBuffer = Buffer.concat([this.rawBuffer, chunk]);
          this.processBuffer();
        } catch (err) {
          console.error(`[tmux-control] Error processing data for ${this.sessionId}:`, err);
        }
      });

      this.proc.stderr!.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) console.error(`[tmux-control] stderr for ${this.sessionId}: ${msg}`);
      });
    } catch (err) {
      console.error(`[tmux-control] Failed to spawn for ${this.sessionId}:`, err);
      if (this.resolveReady) {
        this.resolveReady();
        this.resolveReady = null;
      }
      throw err;
    }

    // Handle process exit
    this.proc.on('exit', (exitCode) => {
      console.log(`[tmux-control] Process exited for ${this.sessionId} with code ${exitCode}`);
      this.handleExit('process exited');
    });

    // Wait for tmux to complete initial attach notification before allowing commands
    await this.readyPromise;
    console.log(`[tmux-control] Session ready: ${this.sessionId}`);

    // Disable mouse mode for this session to prevent accidental copy-mode
    // entry from mouse escape sequences. Mouse events are handled by the
    // browser UI instead. Also exit copy-mode on any panes that may be stuck.
    try {
      await this.sendCommand(`set-option -t ${this.sessionId} mouse off`);
      const panes = await this.listPanes();
      for (const pane of panes) {
        // Exit copy-mode if active (send 'q' key)
        try {
          await this.sendCommand(`send-keys -t ${pane.paneId} -X cancel`);
        } catch {
          // Not in copy-mode, ignore
        }
      }
    } catch {
      // Non-critical
    }
  }

  // ASCII prefix bytes for fast raw-byte matching
  private static readonly OUTPUT_PREFIX = Buffer.from('%output ');
  private static readonly LF = 0x0a;
  private static readonly CR = 0x0d;

  private processBuffer(): void {
    let newlineIndex: number = this.rawBuffer.indexOf(TmuxControlSession.LF);
    while (newlineIndex !== -1) {
      let lineEnd = newlineIndex;
      // Strip \r from PTY output (PTY may add \r\n instead of \n)
      if (lineEnd > 0 && this.rawBuffer[lineEnd - 1] === TmuxControlSession.CR) {
        lineEnd--;
      }
      const rawLine = this.rawBuffer.subarray(0, lineEnd);
      this.rawBuffer = this.rawBuffer.subarray(newlineIndex + 1);
      this.processRawLine(rawLine);
      newlineIndex = this.rawBuffer.indexOf(TmuxControlSession.LF);
    }
  }

  /**
   * Process a single raw byte line from tmux stdout.
   *
   * For %output lines, we extract the data as raw bytes and decode
   * octal escapes directly - this avoids UTF-8 corruption when tmux
   * splits a multi-byte sequence across two %output lines.
   *
   * For all other lines (notifications, command responses), we decode
   * as UTF-8 string since they contain only ASCII or complete UTF-8.
   */
  private processRawLine(rawLine: Buffer): void {
    if (rawLine.length === 0) return;

    try {
      // Fast check: %output lines are the most frequent and must be
      // processed as raw bytes to avoid UTF-8 corruption.
      const prefix = TmuxControlSession.OUTPUT_PREFIX;
      if (rawLine.length > prefix.length &&
          rawLine[0] === 0x25 && // '%'
          rawLine[1] === 0x6f && // 'o'
          rawLine.subarray(0, prefix.length).equals(prefix)) {
        this.handleOutputRaw(rawLine);
        return;
      }

      // All other lines: decode as UTF-8 string.
      // These lines contain ASCII-only protocol data or complete UTF-8
      // (session names, layout strings, etc.), so decoding is safe.
      const line = rawLine.toString('utf-8');

      if (line.startsWith('%layout-change ')) {
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
        this.currentOutput.push(line);
      }
      // Other notifications (%session-changed, %window-add, etc.) are ignored for now
    } catch (err) {
      console.error(`[tmux-control] Error processing line for ${this.sessionId}:`, err);
      console.error(`[tmux-control] Line was: "${rawLine.subarray(0, 100).toString('utf-8')}"`);
    }
  }

  /**
   * Handle %output from raw bytes.
   *
   * Format: %output %N <octal-encoded-data>
   * The data portion is extracted as raw bytes and decoded without
   * UTF-8 conversion, preserving multi-byte sequences that may be
   * split across consecutive %output lines.
   */
  private handleOutputRaw(rawLine: Buffer): void {
    // Skip past "%output " (8 bytes)
    let offset = 8;

    // Expect "%" (0x25) before pane ID
    if (offset >= rawLine.length || rawLine[offset] !== 0x25) return;
    offset++;

    // Read pane number (ASCII digits 0x30-0x39)
    const paneIdStart = offset;
    while (offset < rawLine.length && rawLine[offset] >= 0x30 && rawLine[offset] <= 0x39) {
      offset++;
    }
    if (offset === paneIdStart) return; // No digits found

    const paneId = `%${rawLine.subarray(paneIdStart, offset).toString('ascii')}`;

    // Expect space (0x20) after pane ID
    if (offset >= rawLine.length || rawLine[offset] !== 0x20) return;
    offset++;

    // Extract data portion as raw bytes and decode octal escapes
    const rawData = rawLine.subarray(offset);
    const decoded = decodeOctalOutputRaw(rawData);

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

      // Track known pane IDs (for future use)
      const newPaneIds = this.collectPaneIds(layout);
      this.knownPaneIds.clear();
      for (const id of newPaneIds) {
        this.knownPaneIds.add(id);
      }

      for (const listener of this.layoutListeners) {
        listener(layout, frontendLayout);
      }
    } catch (err) {
      console.error(`[tmux-control] Failed to parse layout: ${err}`);
    }
  }

  /**
   * Collect all pane IDs from a layout tree.
   */
  private collectPaneIds(node: TmuxLayoutNode): string[] {
    if (node.type === 'leaf') {
      return node.paneId !== undefined ? [`%${node.paneId}`] : [];
    }
    return (node.children || []).flatMap(c => this.collectPaneIds(c));
  }

  // Mobile pane separation is disabled - Phase 2 uses frontend-only pane switching.
  // The break-pane approach caused infinite layout-change loops when multiple panes
  // existed, as each break-pane triggered layout changes that made the other pane
  // appear "new", creating an endless cycle.

  /**
   * Handle %begin <time> <num> <flags>
   */
  private handleBegin(line: string): void {
    const match = line.match(/^%begin (\d+) (\d+) (\d+)$/);
    if (!match) return;
    this.currentBeginNum = parseInt(match[2], 10);
    this.currentOutput = [];
  }

  /**
   * Handle %end <time> <num> <flags>
   */
  private handleEnd(line: string): void {
    const match = line.match(/^%end (\d+) (\d+) (\d+)$/);
    if (!match) return;

    // First %end after attach is the initial block - resolve ready promise
    if (this.resolveReady) {
      this.resolveReady();
      this.resolveReady = null;
      this.currentBeginNum = null;
      this.currentOutput = [];
      return;
    }

    // FIFO: resolve the first pending command.
    // Command response lines are also octal-encoded by tmux (e.g. \033 for ESC,
    // \\ for backslash). Decode each line so callers get proper ANSI escapes.
    const pending = this.pendingQueue.shift();
    if (pending) {
      const decoded = this.currentOutput.map(line =>
        decodeOctalOutput(line).toString('utf-8')
      ).join('\n');
      pending.resolve(decoded);
    }
    this.currentBeginNum = null;
    this.currentOutput = [];
  }

  /**
   * Handle %error <time> <num> <flags>
   */
  private handleError(line: string): void {
    const match = line.match(/^%error (\d+) (\d+) (\d+)$/);
    if (!match) return;

    // First %error after attach is the initial block - resolve ready promise
    if (this.resolveReady) {
      this.resolveReady();
      this.resolveReady = null;
      this.currentBeginNum = null;
      this.currentOutput = [];
      return;
    }

    // FIFO: reject the first pending command
    const pending = this.pendingQueue.shift();
    if (pending) {
      pending.reject(new Error(this.currentOutput.join('\n') || 'tmux command error'));
    }
    this.currentBeginNum = null;
    this.currentOutput = [];
  }

  private handleExit(reason: string): void {
    // Resolve ready promise if still pending (prevent deadlock)
    if (this.resolveReady) {
      this.resolveReady();
      this.resolveReady = null;
    }
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

    return new Promise<string>((resolve, reject) => {
      const pending: PendingCommand = { resolve, reject, output: [] };
      this.pendingQueue.push(pending);

      // Write command via stdin pipe
      this.proc!.stdin!.write(`${command}\n`);

      // Timeout after 10 seconds
      setTimeout(() => {
        const idx = this.pendingQueue.indexOf(pending);
        if (idx !== -1) {
          this.pendingQueue.splice(idx, 1);
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
   * Adjust pane size relatively (L=narrower, R=wider, U=shorter, D=taller).
   */
  async adjustPaneSize(paneId: string, direction: 'L' | 'R' | 'U' | 'D', amount: number): Promise<void> {
    await this.sendCommand(`resize-pane -t ${paneId} -${direction} ${amount}`);
  }

  /**
   * Equalize all pane sizes in the current window.
   */
  async equalizePanes(direction: 'horizontal' | 'vertical'): Promise<void> {
    const layout = direction === 'horizontal' ? 'even-horizontal' : 'even-vertical';
    await this.sendCommand(`select-layout ${layout}`);
  }

  /**
   * Select (focus) a pane.
   */
  async selectPane(paneId: string): Promise<void> {
    await this.sendCommand(`select-pane -t ${paneId}`);
  }

  /**
   * Toggle zoom on a pane.
   * - If the target pane is already zoomed: unzoom (restore multi-pane layout)
   * - If a different pane is zoomed: switch zoom to target
   * - If not zoomed: zoom the target pane
   */
  async zoomPane(paneId: string): Promise<void> {
    const zoomFlag = await this.sendCommand('display-message -p "#{window_zoomed_flag}"');
    const isZoomed = zoomFlag.trim() === '1';
    if (isZoomed) {
      // Check if the requested pane is already the zoomed one
      const activePaneId = await this.sendCommand('display-message -p "#{pane_id}"');
      if (activePaneId.trim() === paneId) {
        // Same pane: toggle off (unzoom)
        await this.sendCommand('resize-pane -Z');
        return;
      }
      // Different pane: unzoom, then zoom target
      await this.sendCommand('resize-pane -Z');
    }
    await this.sendCommand(`select-pane -t ${paneId}`);
    await this.sendCommand('resize-pane -Z');
  }

  /**
   * Scroll a pane's history buffer via tmux copy-mode.
   * lines > 0 = scroll up, lines < 0 = scroll down.
   */
  async scrollPane(paneId: string, lines: number): Promise<void> {
    if (lines === 0) return;
    const absLines = Math.abs(lines);
    if (lines > 0) {
      // Scroll up: enter copy-mode (no-op if already in it) then scroll up
      await this.sendCommand(`copy-mode -t ${paneId}`);
      await this.sendCommand(`send-keys -t ${paneId} -N ${absLines} -X scroll-up`);
    } else {
      // Scroll down: must be in copy-mode, silently ignore if not
      try {
        await this.sendCommand(`send-keys -t ${paneId} -N ${absLines} -X scroll-down`);
      } catch {
        // "not in a mode" - pane is at bottom / not in copy-mode, ignore
      }
    }
  }

  /**
   * Set the client size (debounced).
   * Skips if dimensions haven't changed to avoid unnecessary tmux redraws.
   */
  setClientSize(cols: number, rows: number): void {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(async () => {
      // Skip if dimensions haven't changed
      if (this.lastClientSize
        && this.lastClientSize.cols === cols
        && this.lastClientSize.rows === rows) {
        return;
      }
      this.lastClientSize = { cols, rows };
      try {
        await this.sendCommand(`refresh-client -C ${cols}x${rows}`);
        // Flush pending output so programs redraw at the new size
        await this.sendCommand('refresh-client');
      } catch {
        // Ignore resize errors
      }
    }, RESIZE_DEBOUNCE_MS);
  }

  /**
   * Set the client size immediately (no debounce).
   * Used for the first resize after connect so initial content is captured at correct size.
   */
  async setClientSizeImmediate(cols: number, rows: number): Promise<void> {
    // Cancel any pending debounced resize
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.lastClientSize = { cols, rows };
    await this.sendCommand(`refresh-client -C ${cols}x${rows}`);
    await this.sendCommand('refresh-client');
  }

  /**
   * Capture existing pane content (with ANSI escapes).
   * Uses -S - to include the full scrollback buffer so that
   * xterm.js has history available for scrolling.
   */
  async capturePane(paneId: string): Promise<string> {
    return this.sendCommand(`capture-pane -e -p -S - -t ${paneId}`);
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

  /**
   * Register a listener for new session creation (mobile pane separation).
   */
  onNewSession(listener: (sessionId: string, sessionName: string) => void): () => void {
    this.newSessionListeners.add(listener);
    return () => {
      this.newSessionListeners.delete(listener);
    };
  }

  // =========================================================================
  // Client management (grace period)
  // =========================================================================

  /**
   * Set the device type for a client (used for mobile pane separation).
   */
  setClientDeviceType(clientId: string, deviceType: 'mobile' | 'tablet' | 'desktop'): void {
    this.clientDeviceTypes.set(clientId, deviceType);
  }

  /**
   * Remove a client's device type tracking.
   */
  removeClientDeviceType(clientId: string): void {
    this.clientDeviceTypes.delete(clientId);
  }

  /**
   * Get a client's device type.
   */
  getClientDeviceType(clientId: string): 'mobile' | 'tablet' | 'desktop' | undefined {
    return this.clientDeviceTypes.get(clientId);
  }

  /**
   * Check if there are any desktop or tablet clients (excluding a specific client).
   */
  hasDesktopOrTabletClients(excludeClientId?: string): boolean {
    for (const [clientId, deviceType] of this.clientDeviceTypes) {
      if (clientId === excludeClientId) continue;
      if (deviceType === 'desktop' || deviceType === 'tablet') return true;
    }
    return false;
  }

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
    for (const pending of this.pendingQueue) {
      pending.reject(new Error('Control session destroyed'));
    }
    this.pendingQueue.length = 0;

    // Kill process tree (script + tmux -CC child)
    if (this.proc && !this.proc.killed) {
      try {
        // Kill process group to ensure child processes are cleaned up
        if (this.proc.pid) {
          process.kill(-this.proc.pid, 'SIGTERM');
        }
      } catch {
        // Process group kill failed, try direct kill
        try { this.proc.kill('SIGKILL'); } catch { /* already dead */ }
      }
    }
    this.proc = null;

    // Clear listeners
    this.outputListeners.clear();
    this.globalOutputListeners.clear();
    this.layoutListeners.clear();
    this.exitListeners.clear();
    this.newSessionListeners.clear();
    this.clientDeviceTypes.clear();
    this.knownPaneIds.clear();

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

// Clean up all control sessions on process exit (prevents orphaned tmux -CC processes)
function cleanupAllSessions(): void {
  for (const session of controlSessions.values()) {
    session.destroy();
  }
}
process.on('exit', cleanupAllSessions);
process.on('SIGTERM', () => { cleanupAllSessions(); process.exit(0); });
process.on('SIGINT', () => { cleanupAllSessions(); process.exit(0); });
