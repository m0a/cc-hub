/**
 * HerdrControlSession — herdr-backed drop-in for TmuxControlSession.
 *
 * One instance per CC Hub session (= one herdr workspace). Exposes the same
 * public surface `routes/terminal-mux.ts` consumes from TmuxControlSession,
 * so the WS mux layer and the frontend stay unchanged.
 *
 * Differences from the tmux backend:
 *  - Output push signal: one `herdr terminal session observe` subprocess per
 *    pane (NDJSON terminal.frame records) instead of `%output` lines. Frame
 *    payloads are not forwarded; like `%output`, they only trigger a
 *    server-side viewport recapture.
 *  - Layout: CC Hub owns the split tree (see herdr-layout.ts) because the
 *    herdr workspace grid cannot be resized headlessly. Pane PTYs are sized
 *    individually via short-lived control clients.
 *  - Scrollback: herdr's pane.read is capped at 1000 lines, so viewports
 *    clamp history to (1000 - rows) rows above the live edge (#see
 *    poc/herdr/FINDINGS.md).
 */

import type { Subprocess } from 'bun';
import type { PaneCursor, PaneModes, PaneViewport, TmuxLayoutNode } from '../../../shared/types';
import {
  getPane,
  herdrRpc,
  herdrSubscribe,
  listPanes,
  listWorkspaces,
  readPane,
  resizePanePty,
  toHerdrPaneId,
  toTmuxPaneId,
} from './herdr-client';
import { translateInput } from './herdr-input';
import { PaneLayoutTree } from './herdr-layout';
import { toFrontendLayout } from './tmux-layout-parser';

const GRACE_PERIOD_MS = 30_000;
const RESIZE_DEBOUNCE_MS = 50;
// herdr pane.read hard cap (server-side, not configurable in 0.7.x)
const HERDR_READ_CAP = 1000;

const PANE_ID_RE = /^%\d+$/;

function assertPaneId(paneId: string): void {
  if (typeof paneId !== 'string' || !PANE_ID_RE.test(paneId)) {
    throw new Error(`Invalid pane id: ${JSON.stringify(paneId)}`);
  }
}

type LayoutListener = (
  layout: TmuxLayoutNode,
  frontendLayout: ReturnType<typeof toFrontendLayout>,
) => void;
type ExitListener = (reason: string) => void;
type PaneDeadListener = (paneId: string) => void;

export class HerdrControlSession {
  private sessionId: string;
  private workspaceId: string | null = null;
  private tree = new PaneLayoutTree();

  // Client size as reported by the browser (drives pane PTY sizes)
  private clientSize: { cols: number; rows: number } = { cols: 80, rows: 24 };
  private resizeTimer: Timer | null = null;
  private lastClientSize: { cols: number; rows: number } | null = null;
  // Sizes we last applied per pane, echoed into viewports
  private paneSizes = new Map<string, { cols: number; rows: number }>();

  // observe subprocess per herdr pane id
  private observers = new Map<string, Subprocess>();
  private unsubscribeEvents: (() => void) | null = null;

  private globalOutputListeners = new Set<(paneId: string, data: Buffer) => void>();
  private layoutListeners = new Set<LayoutListener>();
  private exitListeners = new Set<ExitListener>();
  private paneDeadListeners = new Set<PaneDeadListener>();
  private newSessionListeners = new Set<(sessionId: string, sessionName: string) => void>();

  private clientCount = 0;
  private graceTimer: Timer | null = null;
  private destroyed = false;
  private clientDeviceTypes = new Map<string, 'mobile' | 'tablet' | 'desktop'>();

  // Serializes pane.send_input calls. Each herdr RPC opens its own socket
  // connection, so concurrent inputs (one WS message per keystroke) can
  // arrive at the PTY out of order without this chain.
  private inputTail: Promise<unknown> = Promise.resolve();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async start(): Promise<void> {
    const workspaces = await listWorkspaces();
    const ws = workspaces.find(
      (w) => w.label === this.sessionId || w.workspace_id === this.sessionId,
    );
    if (!ws) {
      throw new Error(`herdr workspace not found for session: ${this.sessionId}`);
    }
    this.workspaceId = ws.workspace_id;

    const panes = await listPanes(ws.workspace_id);
    const tmuxIds = panes
      .map((p) => toTmuxPaneId(p.pane_id))
      .filter((id): id is string => id !== null);
    this.tree.setInitialPanes(tmuxIds);

    for (const pane of panes) {
      this.startObserver(pane.pane_id);
    }

    // Structural events → reconcile pane set. Payload shapes are treated as
    // opaque; any of these events triggers a pane.list diff.
    this.unsubscribeEvents = herdrSubscribe(
      [{ type: 'pane.created' }, { type: 'pane.closed' }, { type: 'pane.exited' }],
      () => void this.reconcilePanes(),
      () => {
        if (!this.destroyed) this.handleExit('herdr event stream closed');
      },
    );

    console.log(
      `[herdr-control] Session ready: ${this.sessionId} (workspace=${ws.workspace_id}, panes=${tmuxIds.length})`,
    );
  }

  /** Map a tmux-style `%N` pane id to this session's herdr pane id. */
  toHerdr(paneId: string): string {
    if (!this.workspaceId) throw new Error('Control session not active');
    return toHerdrPaneId(this.workspaceId, paneId);
  }

  getPaneSize(paneId: string): { cols: number; rows: number } | undefined {
    return this.paneSizes.get(paneId);
  }

  // ==========================================================================
  // Observe subprocess management (output push signal)
  // ==========================================================================

  private startObserver(herdrPaneId: string): void {
    if (this.destroyed || this.observers.has(herdrPaneId)) return;
    const tmuxId = toTmuxPaneId(herdrPaneId);
    if (!tmuxId) return;

    let proc: Subprocess;
    try {
      proc = Bun.spawn(['herdr', 'terminal', 'session', 'observe', herdrPaneId], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
      });
    } catch (err) {
      console.error(`[herdr-control] observe spawn failed for ${herdrPaneId}:`, err);
      return;
    }
    this.observers.set(herdrPaneId, proc);

    // Any stdout activity = new frames = pane output. We don't parse the
    // NDJSON; its arrival is the signal.
    void (async () => {
      try {
        const stdout = proc.stdout;
        if (!stdout || typeof stdout === 'number') return;
        const reader = stdout.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
          for (const listener of this.globalOutputListeners) {
            listener(tmuxId, Buffer.alloc(0));
          }
        }
      } catch {
        // stream closed
      } finally {
        this.observers.delete(herdrPaneId);
      }
    })();
  }

  private stopObserver(herdrPaneId: string): void {
    const proc = this.observers.get(herdrPaneId);
    if (proc) {
      this.observers.delete(herdrPaneId);
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
  }

  private async reconcilePanes(): Promise<void> {
    if (this.destroyed || !this.workspaceId) return;
    let panes: Awaited<ReturnType<typeof listPanes>>;
    try {
      panes = await listPanes(this.workspaceId);
    } catch {
      return;
    }
    const live = new Set<string>();
    let changed = false;

    for (const pane of panes) {
      const tmuxId = toTmuxPaneId(pane.pane_id);
      if (!tmuxId) continue;
      live.add(tmuxId);
      if (!this.tree.has(tmuxId)) {
        this.tree.addUnknown(tmuxId);
        this.startObserver(pane.pane_id);
        changed = true;
      }
    }

    for (const tmuxId of this.tree.paneIds()) {
      if (!live.has(tmuxId)) {
        this.tree.remove(tmuxId);
        this.stopObserver(this.toHerdr(tmuxId));
        this.paneSizes.delete(tmuxId);
        for (const listener of this.paneDeadListeners) listener(tmuxId);
        changed = true;
      }
    }

    if (this.tree.paneIds().length === 0) {
      this.handleExit('all panes closed');
      return;
    }
    if (changed) {
      await this.applyLayout();
    }
  }

  // ==========================================================================
  // Layout (CC Hub-owned split tree)
  // ==========================================================================

  /** Resize every pane PTY to its computed rect and notify layout listeners. */
  private async applyLayout(): Promise<void> {
    if (this.destroyed) return;
    const { cols, rows } = this.clientSize;
    const rects = this.tree.computeRects(cols, rows);
    await Promise.all(
      [...rects.entries()].map(async ([paneId, rect]) => {
        const prev = this.paneSizes.get(paneId);
        if (prev && prev.cols === rect.width && prev.rows === rect.height) return;
        this.paneSizes.set(paneId, { cols: rect.width, rows: rect.height });
        try {
          await resizePanePty(this.toHerdr(paneId), rect.width, rect.height);
        } catch (err) {
          console.warn(`[herdr-control] pty resize failed for ${paneId}:`, err);
        }
      }),
    );
    this.emitLayout();
  }

  private emitLayout(): void {
    const layout = this.tree.toTmuxLayout(this.clientSize.cols, this.clientSize.rows);
    if (!layout) return;
    const frontendLayout = toFrontendLayout(layout);
    for (const listener of this.layoutListeners) {
      listener(layout, frontendLayout);
    }
  }

  getCurrentLayout(): TmuxLayoutNode | null {
    return this.tree.toTmuxLayout(this.clientSize.cols, this.clientSize.rows);
  }

  get layout(): TmuxLayoutNode | null {
    return this.getCurrentLayout();
  }

  private handleExit(reason: string): void {
    for (const listener of this.exitListeners) {
      listener(reason);
    }
    this.destroy();
  }

  // ==========================================================================
  // Public API - Commands (mirrors TmuxControlSession)
  // ==========================================================================

  /** tmux raw commands have no herdr equivalent; callers must branch. */
  async sendCommand(command: string): Promise<string> {
    throw new Error(`sendCommand is not supported in herdr mode: ${command}`);
  }

  async sendInput(paneId: string, data: Buffer): Promise<void> {
    assertPaneId(paneId);
    if (data.length === 0) return;
    const herdrId = this.toHerdr(paneId);
    // herdr's send_input treats `text` as literal (it strips newlines to
    // prevent Enter injection), so control bytes must go as named keys.
    const ops = translateInput(data);
    if (ops.length === 0) return;
    const send = async () => {
      for (const op of ops) {
        try {
          await herdrRpc('pane.send_input', {
            pane_id: herdrId,
            text: 'text' in op ? op.text : '',
            keys: 'keys' in op ? op.keys : [],
          });
        } catch {
          // non-fatal (pane may have closed), matches tmux behavior
        }
      }
    };
    const next = this.inputTail.then(send, send);
    this.inputTail = next;
    await next;
  }

  async splitPane(paneId: string, direction: 'h' | 'v'): Promise<void> {
    assertPaneId(paneId);
    const res = await herdrRpc<{ pane?: { pane_id?: string } }>('pane.split', {
      target_pane_id: this.toHerdr(paneId),
      direction: direction === 'h' ? 'right' : 'down',
      focus: true,
    });
    const newHerdrId = res.pane?.pane_id;
    const newTmuxId = newHerdrId ? toTmuxPaneId(newHerdrId) : null;
    if (newHerdrId && newTmuxId) {
      this.tree.split(paneId, direction, newTmuxId);
      this.startObserver(newHerdrId);
      await this.applyLayout();
    } else {
      // Shape mismatch — fall back to reconcile
      await this.reconcilePanes();
    }
  }

  async closePane(paneId: string): Promise<void> {
    assertPaneId(paneId);
    if (this.tree.paneIds().length <= 1) {
      throw new Error('Cannot close the last pane');
    }
    await herdrRpc('pane.close', { pane_id: this.toHerdr(paneId) });
    this.tree.remove(paneId);
    this.stopObserver(this.toHerdr(paneId));
    this.paneSizes.delete(paneId);
    await this.applyLayout();
  }

  async respawnPane(paneId: string): Promise<void> {
    assertPaneId(paneId);
    throw new Error('respawn-pane is not supported in herdr mode');
  }

  async resizePane(paneId: string, cols: number, rows: number): Promise<void> {
    assertPaneId(paneId);
    this.paneSizes.set(paneId, { cols, rows });
    await resizePanePty(this.toHerdr(paneId), cols, rows);
  }

  async adjustPaneSize(paneId: string, direction: 'L' | 'R' | 'U' | 'D', amount: number): Promise<void> {
    assertPaneId(paneId);
    this.tree.adjust(paneId, direction, amount, this.clientSize.cols, this.clientSize.rows);
    await this.applyLayout();
  }

  async equalizePanes(direction: 'horizontal' | 'vertical'): Promise<void> {
    this.tree.equalize(direction);
    await this.applyLayout();
  }

  async selectPane(paneId: string): Promise<void> {
    assertPaneId(paneId);
    try {
      await herdrRpc('pane.focus', { pane_id: this.toHerdr(paneId) });
    } catch {
      // focus is best-effort
    }
  }

  async zoomPane(paneId: string): Promise<void> {
    assertPaneId(paneId);
    this.tree.toggleZoom(paneId);
    await this.applyLayout();
  }

  setClientSize(cols: number, rows: number): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      const last = this.lastClientSize;
      if (last && last.cols === cols && Math.abs(last.rows - rows) <= 1) return;
      this.lastClientSize = { cols, rows };
      this.clientSize = { cols, rows };
      void this.applyLayout();
    }, RESIZE_DEBOUNCE_MS);
  }

  async setClientSizeImmediate(cols: number, rows: number): Promise<void> {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.lastClientSize = { cols, rows };
    this.clientSize = { cols, rows };
    await this.applyLayout();
  }

  async capturePane(paneId: string): Promise<string> {
    assertPaneId(paneId);
    return (await readPane(this.toHerdr(paneId), 'visible')) ?? '';
  }

  async capturePaneWithScrollback(paneId: string): Promise<string> {
    assertPaneId(paneId);
    return (await readPane(this.toHerdr(paneId), 'recent', HERDR_READ_CAP)) ?? '';
  }

  async listPanes(): Promise<Array<{ paneId: string; width: number; height: number; isActive: boolean }>> {
    const rects = this.tree.computeRects(this.clientSize.cols, this.clientSize.rows);
    return this.tree.paneIds().map((paneId, i) => {
      const rect = rects.get(paneId);
      return {
        paneId,
        width: rect?.width ?? this.clientSize.cols,
        height: rect?.height ?? this.clientSize.rows,
        isActive: i === 0,
      };
    });
  }

  async breakPaneToNewSession(_paneId: string, _newSessionName: string): Promise<void> {
    throw new Error('break-pane is not supported in herdr mode');
  }

  // ==========================================================================
  // Public API - Listeners (mirrors TmuxControlSession)
  // ==========================================================================

  onOutput(listener: (paneId: string, data: Buffer) => void): () => void {
    this.globalOutputListeners.add(listener);
    return () => {
      this.globalOutputListeners.delete(listener);
    };
  }

  onLayoutChange(listener: LayoutListener): () => void {
    this.layoutListeners.add(listener);
    return () => {
      this.layoutListeners.delete(listener);
    };
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  onPaneDead(listener: PaneDeadListener): () => void {
    this.paneDeadListeners.add(listener);
    return () => {
      this.paneDeadListeners.delete(listener);
    };
  }

  onNewSession(listener: (sessionId: string, sessionName: string) => void): () => void {
    this.newSessionListeners.add(listener);
    return () => {
      this.newSessionListeners.delete(listener);
    };
  }

  // ==========================================================================
  // Client management (grace period) — same semantics as tmux backend
  // ==========================================================================

  setClientDeviceType(clientId: string, deviceType: 'mobile' | 'tablet' | 'desktop'): void {
    this.clientDeviceTypes.set(clientId, deviceType);
  }

  removeClientDeviceType(clientId: string): void {
    this.clientDeviceTypes.delete(clientId);
  }

  getClientDeviceType(clientId: string): 'mobile' | 'tablet' | 'desktop' | undefined {
    return this.clientDeviceTypes.get(clientId);
  }

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
      this.graceTimer = setTimeout(() => {
        if (this.clientCount <= 0) {
          console.log(`[herdr-control] Grace period expired for session: ${this.sessionId}`);
          this.destroy();
        }
      }, GRACE_PERIOD_MS);
    }
  }

  get isDestroyed(): boolean {
    return this.destroyed;
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
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    for (const herdrPaneId of [...this.observers.keys()]) {
      this.stopObserver(herdrPaneId);
    }

    this.globalOutputListeners.clear();
    this.layoutListeners.clear();
    this.exitListeners.clear();
    this.paneDeadListeners.clear();
    this.newSessionListeners.clear();
    this.clientDeviceTypes.clear();
    this.paneSizes.clear();

    herdrControlSessions.delete(this.sessionId);
    console.log(`[herdr-control] Session destroyed: ${this.sessionId}`);
  }
}

export const herdrControlSessions = new Map<string, HerdrControlSession>();

export async function getOrCreateHerdrControlSession(sessionId: string): Promise<HerdrControlSession> {
  let session = herdrControlSessions.get(sessionId);
  if (session && !session.isDestroyed) {
    return session;
  }
  session = new HerdrControlSession(sessionId);
  herdrControlSessions.set(sessionId, session);
  try {
    await session.start();
  } catch (error) {
    session.destroy();
    throw error;
  }
  return session;
}

// =============================================================================
// Viewport capture (herdr flavor of services/pane-viewport.ts)
// =============================================================================

/**
 * Compose a PaneViewport from herdr reads.
 *
 *   offset = 0 → pane.read(visible): the actual current surface, correct for
 *                both normal and alt-screen apps. Trailing blank rows are
 *                trimmed by herdr; we pad back to `rows` (top-aligned).
 *   offset > 0 → pane.read(recent) window slice, clamped to herdr's
 *                1000-line read cap.
 *
 * Known interim limitations vs the tmux backend (see poc/herdr/FINDINGS.md):
 * cursor position is not exposed by herdr's read API (reported hidden), and
 * altScreen is always reported false.
 */
export async function captureViewportHerdr(
  cs: HerdrControlSession,
  paneId: string,
  offset: number,
): Promise<PaneViewport | null> {
  assertPaneId(paneId);
  const size = cs.getPaneSize(paneId);
  let herdrId: string;
  try {
    herdrId = cs.toHerdr(paneId);
  } catch {
    return null;
  }

  const pane = await getPane(herdrId);
  if (!pane) return null;

  const rows = size?.rows ?? pane.scroll.viewport_rows;
  const cols = size?.cols ?? 80;
  if (rows <= 0 || cols <= 0) return null;

  // History the UI is allowed to scroll into: herdr's own metric, clamped to
  // what pane.read can actually reach (1000-line cap minus the window).
  const historySize = Math.max(
    0,
    Math.min(pane.scroll.max_offset_from_bottom, HERDR_READ_CAP - rows),
  );
  const clampedOffset = Math.max(0, Math.min(offset, historySize));

  let lines: string[];
  if (clampedOffset === 0) {
    const text = await readPane(herdrId, 'visible');
    if (text === null) return null;
    lines = text.split('\n').slice(0, rows);
  } else {
    const want = Math.min(clampedOffset + rows, HERDR_READ_CAP);
    const text = await readPane(herdrId, 'recent', want);
    if (text === null) return null;
    const all = text.split('\n');
    const end = Math.max(0, all.length - clampedOffset);
    const start = Math.max(0, end - rows);
    lines = all.slice(start, end);
  }

  while (lines.length < rows) {
    lines.push('');
  }

  const cursor: PaneCursor = { x: 0, y: 0, visible: false };
  const modes: PaneModes = { altScreen: false };
  const atTail = clampedOffset === 0;

  return {
    paneId,
    cols,
    rows,
    lines,
    cursor,
    modes,
    historySize,
    offset: clampedOffset,
    atTail,
  };
}
