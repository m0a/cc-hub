/**
 * HerdrControlSession — herdr-backed drop-in for TmuxControlSession.
 *
 * One instance per CC Hub session (= one herdr workspace). Exposes the same
 * public surface `routes/terminal-mux.ts` consumes from TmuxControlSession,
 * so the WS mux layer and the frontend stay unchanged.
 *
 * Differences from the tmux backend:
 *  - Per-pane transport: one persistent `herdr terminal session control`
 *    subprocess per pane (see PaneController). It carries raw PTY input
 *    (base64, no sanitization — mouse SGR / bracketed paste / escape
 *    sequences pass through intact), absolute PTY resizes, and streams
 *    terminal.frame records that (a) trigger viewport recaptures and
 *    (b) are scanned for cursor position and alt-screen state.
 *  - Layout: CC Hub owns the split tree (see herdr-layout.ts) because the
 *    herdr workspace grid cannot be resized headlessly.
 *  - Scrollback: herdr's pane.read is capped at 1000 lines, so viewports
 *    clamp history to (1000 - rows) rows above the live edge (see
 *    poc/herdr/FINDINGS.md).
 */

import type { PaneCursor, PaneModes, PaneViewport, TmuxLayoutNode } from '../../../shared/types';
import {
  getPane,
  herdrRpc,
  herdrSubscribe,
  listPanes,
  listWorkspaces,
  PaneController,
  readPane,
  toHerdrPaneId,
  toTmuxPaneId,
} from './herdr-client';
import { PaneLayoutTree } from './herdr-layout';

const GRACE_PERIOD_MS = 30_000;
const RESIZE_DEBOUNCE_MS = 50;
// herdr pane.read hard cap (server-side, not configurable in 0.7.x)
const HERDR_READ_CAP = 1000;

const PANE_ID_RE = /^%\d+$/;

export function assertPaneId(paneId: string): void {
  if (typeof paneId !== 'string' || !PANE_ID_RE.test(paneId)) {
    throw new Error(`Invalid pane id: ${JSON.stringify(paneId)}`);
  }
}

type LayoutListener = (layout: TmuxLayoutNode) => void;
type ExitListener = (reason: string) => void;
type PaneDeadListener = (paneId: string) => void;

/** Live terminal state tracked from a pane's frame stream. */
export interface PaneRuntimeState {
  altScreen: boolean;
  cursorX: number; // 0-based
  cursorY: number; // 0-based
  cursorVisible: boolean;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes by design.
const CUP_RE = /\x1b\[(\d*)(?:;(\d*))?[Hf]/g;

const SHELL_NAMES = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh', 'nu', 'pwsh']);

/**
 * Best-effort initial alt-screen guess for a pane that was already running
 * when we attached. herdr 0.7.x tracks `alternate_screen` internally but
 * doesn't expose it over the socket API, and attach frames repaint cells
 * without re-emitting mode toggles. Heuristic: a non-shell foreground
 * process with zero host scrollback is almost certainly a fullscreen TUI
 * (Claude, vim, htop, less) — alt apps accumulate no host history, while a
 * normal-screen program quickly does. Later frames correct the state on any
 * real transition.
 */
async function guessInitialAltScreen(
  herdrPaneId: string,
  state: PaneRuntimeState,
): Promise<void> {
  try {
    const res = await herdrRpc<{
      process_info?: { foreground_processes?: Array<{ name?: string }> };
    }>('pane.process_info', { pane_id: herdrPaneId });
    const leader = res.process_info?.foreground_processes?.[0]?.name ?? '';
    if (!leader || SHELL_NAMES.has(leader)) return;
    const pane = await getPane(herdrPaneId);
    if ((pane?.scroll.max_offset_from_bottom ?? 0) === 0) {
      state.altScreen = true;
    }
  } catch {
    // keep the default (normal screen)
  }
}

/**
 * Update tracked state from one rendered frame.
 *
 * herdr frames are re-renders (not raw PTY passthrough) and always end with
 * explicit cursor placement (CUP) plus a show/hide-cursor toggle, so "last
 * occurrence wins" scanning is sufficient — no VT emulation needed.
 */
export function scanFrameForState(state: PaneRuntimeState, bytes: Buffer): void {
  const s = bytes.toString('latin1');

  // Alt-screen enter/leave (1049/1047/47 variants), last occurrence wins.
  let altPos = -1;
  let altVal = state.altScreen;
  for (const [pat, val] of [
    ['\x1b[?1049h', true],
    ['\x1b[?1049l', false],
    ['\x1b[?1047h', true],
    ['\x1b[?1047l', false],
    ['\x1b[?47h', true],
    ['\x1b[?47l', false],
  ] as Array<[string, boolean]>) {
    const p = s.lastIndexOf(pat);
    if (p > altPos) {
      altPos = p;
      altVal = val;
    }
  }
  state.altScreen = altVal;

  // Cursor visibility, last occurrence wins.
  const show = s.lastIndexOf('\x1b[?25h');
  const hide = s.lastIndexOf('\x1b[?25l');
  if (show >= 0 || hide >= 0) {
    state.cursorVisible = show > hide;
  }

  // Cursor position: the final CUP of the frame is where the cursor rests.
  let last: RegExpExecArray | null = null;
  CUP_RE.lastIndex = 0;
  for (let m = CUP_RE.exec(s); m !== null; m = CUP_RE.exec(s)) {
    last = m;
  }
  if (last) {
    const row = last[1] ? Number.parseInt(last[1], 10) : 1;
    const col = last[2] ? Number.parseInt(last[2], 10) : 1;
    state.cursorY = Math.max(0, row - 1);
    state.cursorX = Math.max(0, col - 1);
  }
}

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

  // persistent control client per herdr pane id (input + resize + frames)
  private controllers = new Map<string, PaneController>();
  // live cursor / alt-screen state per tmux pane id, fed by frame scanning
  private runtimeStates = new Map<string, PaneRuntimeState>();
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

  // Focused pane (tmux-style id). Initialized from herdr's focused flag,
  // updated by selectPane/splitPane and reconciled against herdr state.
  private activePaneId: string | null = null;

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

    const focused = panes.find((p) => p.focused);
    this.activePaneId = (focused ? toTmuxPaneId(focused.pane_id) : null) ?? tmuxIds[0] ?? null;

    const rects = this.tree.computeRects(this.clientSize.cols, this.clientSize.rows);
    for (const pane of panes) {
      const tmuxId = toTmuxPaneId(pane.pane_id);
      const rect = tmuxId ? rects.get(tmuxId) : undefined;
      this.startController(
        pane.pane_id,
        rect?.width ?? this.clientSize.cols,
        rect?.height ?? this.clientSize.rows,
      );
      if (tmuxId && rect) {
        this.paneSizes.set(tmuxId, { cols: rect.width, rows: rect.height });
      }
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
  // Pane controller management (input + resize + frame stream)
  // ==========================================================================

  private startController(herdrPaneId: string, cols: number, rows: number): void {
    if (this.destroyed || this.controllers.get(herdrPaneId)?.isAlive) return;
    const tmuxId = toTmuxPaneId(herdrPaneId);
    if (!tmuxId) return;

    const existing = this.runtimeStates.get(tmuxId);
    const state: PaneRuntimeState = existing ?? {
      altScreen: false,
      cursorX: 0,
      cursorY: 0,
      cursorVisible: false,
    };
    this.runtimeStates.set(tmuxId, state);
    if (!existing) {
      // Frames only carry alt-screen TRANSITIONS; a pane already inside an
      // alt-screen app when we attach would stay misclassified forever.
      void guessInitialAltScreen(herdrPaneId, state);
    }

    let controller: PaneController;
    try {
      controller = new PaneController(herdrPaneId, cols, rows, {
        onFrame: (bytes) => {
          scanFrameForState(state, bytes);
          for (const listener of this.globalOutputListeners) {
            listener(tmuxId, Buffer.alloc(0));
          }
        },
        onExit: () => {
          console.log(`[herdr-control] controller exited for ${herdrPaneId} (session=${this.sessionId})`);
          if (this.controllers.get(herdrPaneId) === controller) {
            this.controllers.delete(herdrPaneId);
          }
          if (this.destroyed) return;
          // The control client can die without the pane being gone (herdr
          // restart, takeover by another client). Reconcile decides whether
          // the pane still exists and layout-applies a fresh controller.
          setTimeout(() => void this.reconcilePanes(), 500);
        },
      });
    } catch (err) {
      console.error(`[herdr-control] control spawn failed for ${herdrPaneId}:`, err);
      return;
    }
    this.controllers.set(herdrPaneId, controller);
    console.log(`[herdr-control] controller spawned for ${herdrPaneId} (${cols}x${rows}, session=${this.sessionId})`);

    // Nudge subscribers to recapture shortly after a controller (re)spawn.
    // A capture can race the app's resize repaint (blank/transitional
    // content), and if the app then goes idle no frame would ever trigger a
    // corrective push — the stale viewport would stick until the next real
    // output. Two delayed ticks cover fast and slow repaints.
    for (const delay of [300, 1200]) {
      setTimeout(() => {
        if (this.destroyed || !this.controllers.get(herdrPaneId)?.isAlive) return;
        for (const listener of this.globalOutputListeners) {
          listener(tmuxId, Buffer.alloc(0));
        }
      }, delay);
    }
  }

  private stopController(herdrPaneId: string): void {
    const controller = this.controllers.get(herdrPaneId);
    if (controller) {
      this.controllers.delete(herdrPaneId);
      controller.kill();
    }
  }

  private controllerFor(paneId: string): PaneController | undefined {
    const controller = this.controllers.get(this.toHerdr(paneId));
    return controller?.isAlive ? controller : undefined;
  }

  /** Live cursor / alt-screen state for a pane (from its frame stream). */
  getRuntimeState(paneId: string): PaneRuntimeState | undefined {
    return this.runtimeStates.get(paneId);
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
        changed = true;
      }
      // herdr's focused flag is authoritative for panes focused outside our
      // own selectPane calls (other herdr clients, focus-follows on split).
      if (pane.focused) {
        this.activePaneId = tmuxId;
      }
      // A live pane without a running controller (fresh pane, or its control
      // client died) gets one at its current size; applyLayout below corrects
      // the size if the tree changed.
      if (!this.controllers.get(pane.pane_id)?.isAlive) {
        const size = this.paneSizes.get(tmuxId);
        this.startController(
          pane.pane_id,
          size?.cols ?? this.clientSize.cols,
          size?.rows ?? this.clientSize.rows,
        );
      }
    }

    for (const tmuxId of this.tree.paneIds()) {
      if (!live.has(tmuxId)) {
        this.tree.remove(tmuxId);
        this.stopController(this.toHerdr(tmuxId));
        this.paneSizes.delete(tmuxId);
        this.runtimeStates.delete(tmuxId);
        for (const listener of this.paneDeadListeners) listener(tmuxId);
        changed = true;
      }
    }

    if (this.activePaneId && !live.has(this.activePaneId)) {
      this.activePaneId = this.tree.paneIds()[0] ?? null;
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
    for (const [paneId, rect] of rects) {
      const prev = this.paneSizes.get(paneId);
      if (prev && prev.cols === rect.width && prev.rows === rect.height) continue;
      this.paneSizes.set(paneId, { cols: rect.width, rows: rect.height });
      this.controllerFor(paneId)?.resize(rect.width, rect.height);
    }
    this.emitLayout();
  }

  private emitLayout(): void {
    const layout = this.tree.toTmuxLayout(this.clientSize.cols, this.clientSize.rows);
    if (!layout) return;
    for (const listener of this.layoutListeners) {
      listener(layout);
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
    // Raw byte passthrough over the pane's control stream. Ordering is
    // guaranteed by the single stdin pipe; no serialization needed.
    const controller = this.controllerFor(paneId);
    if (!controller) {
      console.warn(`[herdr-control] no controller for ${paneId}; input dropped`);
      return;
    }
    controller.input(data);
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
      // pane.split was issued with focus: true — the new pane is focused.
      this.activePaneId = newTmuxId;
      const rect = this.tree
        .computeRects(this.clientSize.cols, this.clientSize.rows)
        .get(newTmuxId);
      this.startController(
        newHerdrId,
        rect?.width ?? this.clientSize.cols,
        rect?.height ?? this.clientSize.rows,
      );
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
    this.stopController(this.toHerdr(paneId));
    this.paneSizes.delete(paneId);
    this.runtimeStates.delete(paneId);
    if (this.activePaneId === paneId) {
      this.activePaneId = this.tree.paneIds()[0] ?? null;
    }
    await this.applyLayout();
  }

  async respawnPane(paneId: string): Promise<void> {
    assertPaneId(paneId);
    throw new Error('respawn-pane is not supported in herdr mode');
  }

  async resizePane(paneId: string, cols: number, rows: number): Promise<void> {
    assertPaneId(paneId);
    // Route the absolute size through the layout tree (ancestor split ratio)
    // so the resize survives later applyLayout passes; writing paneSizes/PTY
    // directly would be silently reverted by the next split/zoom/resize.
    this.tree.setPaneSize(paneId, cols, rows, this.clientSize.cols, this.clientSize.rows);
    await this.applyLayout();
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
    this.activePaneId = paneId;
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
    const ids = this.tree.paneIds();
    const active = this.activePaneId && ids.includes(this.activePaneId) ? this.activePaneId : ids[0];
    return ids.map((paneId) => {
      const rect = rects.get(paneId);
      return {
        paneId,
        width: rect?.width ?? this.clientSize.cols,
        height: rect?.height ?? this.clientSize.rows,
        isActive: paneId === active,
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
    for (const herdrPaneId of [...this.controllers.keys()]) {
      this.stopController(herdrPaneId);
    }
    this.runtimeStates.clear();

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
 * Cursor position/visibility and alt-screen state come from the pane's
 * control-stream frames (see scanFrameForState), since herdr's read API
 * exposes neither.
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

  const runtime = cs.getRuntimeState(paneId);
  const atTail = clampedOffset === 0;
  // Hide the cursor in scrolled mode so the client doesn't render a stale
  // cursor inside historical content (same rule as the tmux backend).
  const cursor: PaneCursor = {
    x: runtime?.cursorX ?? 0,
    y: runtime?.cursorY ?? 0,
    visible: atTail && (runtime?.cursorVisible ?? false),
  };
  const modes: PaneModes = { altScreen: runtime?.altScreen ?? false };

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
