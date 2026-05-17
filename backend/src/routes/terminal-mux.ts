import { appendFile } from 'node:fs/promises';
import type { ServerWebSocket } from 'bun';
import { TmuxService } from '../services/tmux';
import { getOrCreateControlSession, type TmuxControlSession } from '../services/tmux-control';
import { ConversationWatcher } from '../services/conversation-watcher';
import { captureSnapshot, diffSnapshots, stripAnsi } from '../services/pane-snapshot';
import type {
  ControlClientMessage,
  MuxClientMessage,
  ConversationMessage,
  PaneSnapshot,
} from '../../../shared/types';
import { buildSessionsList } from './sessions';

// Channel C: client→server self-verification feedback (dev-only).
// When enabled, clients send their xterm.js buffer snapshot via `debug-dump`
// messages; the server compares them against `tmux capture-pane -p` output
// and logs any drift to /tmp/cchub-drift.log for later analysis.
const SELF_VERIFY = !!process.env.CCHUB_SELF_VERIFY;
const DRIFT_LOG_PATH = '/tmp/cchub-drift.log';
const DRIFT_MAX_MISMATCH_SAMPLES = 3;

// State-sync debounce. Wait this long after the last %output for a pane
// before recapturing canonical state. Shorter = lower latency but more
// capture-pane overhead.
const SNAPSHOT_DEBOUNCE_MS = 50;

/** Per-session subscription state for a mux client */
interface MuxSubscription {
  controlSession: TmuxControlSession;
  cleanupFns: Array<() => void>;
  initialized: boolean;          // first resize received & initial snapshots emitted
  // Last snapshot the server emitted to this client, per pane. Used as the
  // base for the next diff. Cleared on `request-snapshot` so the next emit
  // sends a full snapshot.
  serverSnapshots: Map<string, PaneSnapshot>;
  // tmux history-size at the time of the last snapshot, per pane. Used to
  // compute scrollbackDelta on the next capture.
  lastHistorySize: Map<string, number>;
  // Cached scrollback rows used to pad short snapshots (Claude TUI
  // workaround). Reusable while historySize is unchanged.
  lastPadFill: Map<string, import('../services/pane-snapshot').PadFillCache>;
  // Per-pane snapshot debounce timers.
  snapshotTimers: Map<string, Timer>;
  // Pane IDs we've ever sent a snapshot for, so we can recapture them on
  // resize / zoom even if tmux hasn't pushed a %output since.
  knownPanes: Set<string>;
  outputSuppressedCount: number;
  sendFailCount: number;
}

export interface MuxData {
  mux: true;
  visitorId: string;
  subscriptions: Map<string, MuxSubscription>;
  conversationWatchers: Map<string, ConversationWatcher>;
  lastPingAt: number;
}

const tmuxService = new TmuxService();

// Track mux connections for broadcast
const activeMuxConnections = new Set<ServerWebSocket<MuxData>>();

// Zombie detection: if no client ping for 60s, assume connection is dead.
const PING_TIMEOUT_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const ws of activeMuxConnections) {
    if (now - ws.data.lastPingAt > PING_TIMEOUT_MS) {
      console.log(`[mux] Zombie connection detected: ${ws.data.visitorId} (last ping ${Math.round((now - ws.data.lastPingAt) / 1000)}s ago)`);
      try { ws.close(1008, 'ping timeout'); } catch { /* ignore */ }
      activeMuxConnections.delete(ws);
    }
  }
}, 30_000);

// =============================================================================
// Sessions push
// =============================================================================

const SESSIONS_PUSH_INTERVAL = 5000;
let sessionsPushTimer: ReturnType<typeof setInterval> | null = null;
let lastSessionsJson = '';

function startSessionsPush() {
  if (sessionsPushTimer) return;
  sessionsPushTimer = setInterval(async () => {
    if (activeMuxConnections.size === 0) {
      stopSessionsPush();
      return;
    }
    try {
      const sessions = await buildSessionsList();
      const stableJson = JSON.stringify(sessions, (key, value) =>
        key === 'durationMinutes' ? undefined : value
      );
      if (stableJson === lastSessionsJson) return;
      lastSessionsJson = stableJson;
      const payload = JSON.stringify({ type: 'sessions-updated', sessions });
      for (const ws of activeMuxConnections) {
        try { ws.send(payload); } catch { /* disconnected */ }
      }
    } catch (err) {
      console.warn('[mux] sessions push error:', err);
    }
  }, SESSIONS_PUSH_INTERVAL);
}

function stopSessionsPush() {
  if (sessionsPushTimer) {
    clearInterval(sessionsPushTimer);
    sessionsPushTimer = null;
  }
  lastSessionsJson = '';
}

export function pushSessionsNow() {
  lastSessionsJson = '';
  buildSessionsList().then(sessions => {
    const payload = JSON.stringify({ type: 'sessions-updated', sessions });
    for (const ws of activeMuxConnections) {
      try { ws.send(payload); } catch { /* disconnected */ }
    }
  }).catch(() => {});
}

export function getConnectedClientCount(): number {
  return activeMuxConnections.size;
}

export function broadcastToMuxClients(msg: Record<string, unknown>) {
  const payload = JSON.stringify(msg);
  for (const ws of activeMuxConnections) {
    try { ws.send(payload); } catch { /* disconnected */ }
  }
}

export async function muxOpen(ws: ServerWebSocket<MuxData>) {
  console.log(`[mux] WebSocket opened: ${ws.data.visitorId}`);
  activeMuxConnections.add(ws);
  startSessionsPush();

  try {
    const sessions = await buildSessionsList();
    ws.send(JSON.stringify({ type: 'sessions-updated', sessions }));
  } catch { /* best effort */ }

  ws.send(JSON.stringify({ type: 'ready' }));
}

export async function muxMessage(ws: ServerWebSocket<MuxData>, message: string | Buffer) {
  if (typeof message !== 'string') return;

  let msg: MuxClientMessage;
  try {
    msg = JSON.parse(message);
  } catch {
    return;
  }

  if (msg.type === 'subscribe') {
    await handleSubscribe(ws, msg.sessionId);
    return;
  }

  if (msg.type === 'unsubscribe') {
    handleUnsubscribe(ws, msg.sessionId);
    return;
  }

  if (msg.type === 'subscribe-conversation') {
    await handleSubscribeConversation(ws, msg.sessionId);
    return;
  }

  if (msg.type === 'unsubscribe-conversation') {
    handleUnsubscribeConversation(ws, msg.sessionId);
    return;
  }

  if (msg.type === 'debug-dump') {
    if (SELF_VERIFY) {
      const sub = ws.data.subscriptions.get(msg.sessionId);
      if (sub) await handleDebugDump(ws, sub, msg);
    }
    return;
  }

  const sessionId = (msg as { sessionId?: string }).sessionId;
  if (!sessionId) return;

  const sub = ws.data.subscriptions.get(sessionId);
  if (!sub) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not subscribed to session', sessionId }));
    return;
  }

  const { sessionId: _sid, ...controlMsg } = msg as ControlClientMessage & { sessionId: string };
  await handleControlMessage(ws, sub, sessionId, controlMsg as ControlClientMessage);
}

export function muxClose(ws: ServerWebSocket<MuxData>, code: number, reason: string) {
  console.log(`[mux] WebSocket closed: ${ws.data.visitorId} (code=${code}, reason=${reason})`);
  activeMuxConnections.delete(ws);
  if (activeMuxConnections.size === 0) stopSessionsPush();

  for (const [sessionId, sub] of ws.data.subscriptions) {
    cleanupSubscription(ws, sessionId, sub);
  }
  ws.data.subscriptions.clear();

  for (const watcher of ws.data.conversationWatchers.values()) {
    try { watcher.stop(); } catch { /* ignore */ }
  }
  ws.data.conversationWatchers.clear();
}

async function handleSubscribe(ws: ServerWebSocket<MuxData>, sessionId: string) {
  console.log(`[mux] subscribe: ${sessionId} (current subs: ${ws.data.subscriptions.size})`);
  // Already subscribed — reset so the next resize re-emits initial snapshots.
  if (ws.data.subscriptions.has(sessionId)) {
    const existing = ws.data.subscriptions.get(sessionId)!;
    existing.initialized = false;
    existing.serverSnapshots.clear();
    existing.lastHistorySize.clear();
    existing.lastPadFill.clear();
    for (const t of existing.snapshotTimers.values()) clearTimeout(t);
    existing.snapshotTimers.clear();
    existing.outputSuppressedCount = 0;
    ws.send(JSON.stringify({ type: 'subscribed', sessionId, selfVerifyEnabled: SELF_VERIFY }));
    return;
  }

  const exists = await tmuxService.sessionExists(sessionId);
  if (!exists) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session not found', sessionId }));
    return;
  }

  try {
    const controlSession = await getOrCreateControlSession(sessionId);
    controlSession.addClient();

    const cleanupFns: Array<() => void> = [];
    const sub: MuxSubscription = {
      controlSession,
      cleanupFns,
      initialized: false,
      serverSnapshots: new Map(),
      lastHistorySize: new Map(),
      lastPadFill: new Map(),
      snapshotTimers: new Map(),
      knownPanes: new Set(),
      outputSuppressedCount: 0,
      sendFailCount: 0,
    };

    // Output → snapshot debounce trigger. We do not forward the raw bytes;
    // they are only a signal that tmux has rendered something new.
    cleanupFns.push(
      controlSession.onOutput((paneId, _data) => {
        if (!sub.initialized) {
          sub.outputSuppressedCount++;
          return;
        }
        scheduleSnapshot(ws, sessionId, sub, paneId);
      })
    );

    // Layout listener
    cleanupFns.push(
      controlSession.onLayoutChange((layout) => {
        try {
          ws.send(JSON.stringify({ type: 'layout', layout, sessionId }));
        } catch { /* disconnected */ }
      })
    );

    cleanupFns.push(
      controlSession.onExit((reason) => {
        try {
          ws.send(JSON.stringify({ type: 'error', message: `Session exited: ${reason}`, sessionId }));
        } catch { /* disconnected */ }
        handleUnsubscribe(ws, sessionId);
      })
    );

    cleanupFns.push(
      controlSession.onPaneDead((paneId) => {
        try {
          ws.send(JSON.stringify({ type: 'pane-dead', paneId, sessionId }));
        } catch { /* disconnected */ }
      })
    );

    cleanupFns.push(
      controlSession.onNewSession((newSessionId, sessionName) => {
        try {
          ws.send(JSON.stringify({ type: 'new-session', sessionId: newSessionId, sessionName }));
        } catch { /* disconnected */ }
      })
    );

    ws.data.subscriptions.set(sessionId, sub);

    try {
      const layoutOutput = await controlSession.sendCommand(
        `list-windows -F "#{window_layout}"`
      );
      const layoutString = layoutOutput.trim().split('\n')[0];
      if (layoutString) {
        const { parseTmuxLayout } = await import('../services/tmux-layout-parser');
        const layout = parseTmuxLayout(layoutString);
        ws.send(JSON.stringify({ type: 'layout', layout, sessionId }));
      }
    } catch (err) {
      console.error(`[mux] Failed to send initial layout for ${sessionId}:`, err);
    }

    ws.send(JSON.stringify({ type: 'subscribed', sessionId, selfVerifyEnabled: SELF_VERIFY }));
  } catch (error) {
    console.error(`[mux] Failed to subscribe to ${sessionId}:`, error);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to subscribe', sessionId }));
  }
}

function handleUnsubscribe(ws: ServerWebSocket<MuxData>, sessionId: string) {
  console.log(`[mux] unsubscribe: ${sessionId} (current subs: ${ws.data.subscriptions.size})`);
  const sub = ws.data.subscriptions.get(sessionId);
  if (sub) {
    cleanupSubscription(ws, sessionId, sub);
    ws.data.subscriptions.delete(sessionId);
  }
  ws.send(JSON.stringify({ type: 'unsubscribed', sessionId }));
}

function cleanupSubscription(ws: ServerWebSocket<MuxData>, _sessionId: string, sub: MuxSubscription) {
  for (const fn of sub.cleanupFns) fn();
  for (const t of sub.snapshotTimers.values()) clearTimeout(t);
  sub.snapshotTimers.clear();
  sub.controlSession.removeClientDeviceType(ws.data.visitorId);
  sub.controlSession.removeClient();
}

// =============================================================================
// State sync: snapshot scheduling and emission
// =============================================================================

function scheduleSnapshot(
  ws: ServerWebSocket<MuxData>,
  sessionId: string,
  sub: MuxSubscription,
  paneId: string,
) {
  const existing = sub.snapshotTimers.get(paneId);
  if (existing) return;
  const timer = setTimeout(() => {
    sub.snapshotTimers.delete(paneId);
    void emitSnapshot(ws, sessionId, sub, paneId);
  }, SNAPSHOT_DEBOUNCE_MS);
  sub.snapshotTimers.set(paneId, timer);
}

async function emitSnapshot(
  ws: ServerWebSocket<MuxData>,
  sessionId: string,
  sub: MuxSubscription,
  paneId: string,
) {
  if (sub.controlSession.isDestroyed) return;
  let result: Awaited<ReturnType<typeof captureSnapshot>>;
  try {
    result = await captureSnapshot(
      sub.controlSession,
      paneId,
      sub.lastHistorySize.get(paneId),
      sub.lastPadFill.get(paneId),
    );
  } catch (err) {
    console.warn(`[mux] captureSnapshot failed for ${paneId}:`, err);
    return;
  }
  if (!result) return;
  const { snapshot, historySize, padFill } = result;

  sub.knownPanes.add(paneId);
  sub.lastHistorySize.set(paneId, historySize);
  if (padFill) sub.lastPadFill.set(paneId, padFill);
  else sub.lastPadFill.delete(paneId);

  const prev = sub.serverSnapshots.get(paneId);
  if (!prev) {
    try {
      ws.send(JSON.stringify({ type: 'state-snapshot', sessionId, snapshot }));
    } catch { return; }
    sub.serverSnapshots.set(paneId, snapshot);
    return;
  }

  const ops = diffSnapshots(prev, snapshot);
  const hasScrollback = (snapshot.scrollbackDelta?.length ?? 0) > 0;

  if (ops.length === 0 && !hasScrollback) {
    sub.serverSnapshots.set(paneId, snapshot);
    return;
  }

  // Send full snapshots for every visible change. Diff application is fragile
  // when terminal apps redraw partial normal-screen regions while xterm.js has
  // local scrollback/baseY state; users then see stale content until reload.
  // A full snapshot is the same recovery path as reload, but applied live.
  console.log(`[mux] state-snapshot pane=${paneId} seq=${snapshot.seq} scrollbackDelta=${snapshot.scrollbackDelta?.length ?? 0} rows=${snapshot.rows}`);
  try {
    ws.send(JSON.stringify({ type: 'state-snapshot', sessionId, snapshot }));
  } catch { return; }
  sub.serverSnapshots.set(paneId, snapshot);
}

async function emitInitialSnapshots(
  ws: ServerWebSocket<MuxData>,
  sessionId: string,
  sub: MuxSubscription,
) {
  let panes: Awaited<ReturnType<TmuxControlSession['listPanes']>> = [];
  try {
    panes = await sub.controlSession.listPanes();
  } catch (err) {
    console.warn(`[mux] listPanes failed for ${sessionId}:`, err);
    return;
  }
  for (const pane of panes) {
    // Drop any previous snapshot so emitSnapshot sends a fresh full snapshot;
    // clear the history baseline too so scrollbackDelta starts empty.
    sub.serverSnapshots.delete(pane.paneId);
    sub.lastHistorySize.delete(pane.paneId);
    sub.lastPadFill.delete(pane.paneId);
    await emitSnapshot(ws, sessionId, sub, pane.paneId);
  }
}

async function handleSubscribeConversation(ws: ServerWebSocket<MuxData>, sessionId: string) {
  console.log(`[mux] subscribe-conversation: ${sessionId}`);

  const existing = ws.data.conversationWatchers.get(sessionId);
  if (existing) {
    try { existing.stop(); } catch { /* ignore */ }
    ws.data.conversationWatchers.delete(sessionId);
  }

  let workingDir: string | undefined;
  try {
    const sessions = await tmuxService.listSessions();
    const session = sessions.find(s => s.id === sessionId);
    workingDir = session?.currentPath;
  } catch (err) {
    console.warn(`[mux] subscribe-conversation: failed to list sessions: ${err}`);
  }

  if (!workingDir) {
    try {
      ws.send(JSON.stringify({ type: 'conversation-subscribed', sessionId, ccSessionId: null }));
      ws.send(JSON.stringify({ type: 'initial-conversation', sessionId, messages: [] }));
    } catch { /* disconnected */ }
    return;
  }

  const watcher = new ConversationWatcher();
  let initialMessages: ConversationMessage[] = [];
  try {
    initialMessages = await watcher.start(workingDir);
  } catch (err) {
    console.warn(`[mux] subscribe-conversation start failed for ${sessionId}:`, err);
  }

  watcher.onUpdate((newMessages) => {
    try {
      ws.send(JSON.stringify({ type: 'conversation-update', sessionId, messages: newMessages }));
    } catch { /* disconnected */ }
  });

  ws.data.conversationWatchers.set(sessionId, watcher);

  try {
    ws.send(JSON.stringify({
      type: 'conversation-subscribed',
      sessionId,
      ccSessionId: watcher.getCcSessionId(),
    }));
    ws.send(JSON.stringify({
      type: 'initial-conversation',
      sessionId,
      messages: initialMessages,
    }));
  } catch { /* disconnected */ }
}

function handleUnsubscribeConversation(ws: ServerWebSocket<MuxData>, sessionId: string) {
  console.log(`[mux] unsubscribe-conversation: ${sessionId}`);
  const watcher = ws.data.conversationWatchers.get(sessionId);
  if (watcher) {
    try { watcher.stop(); } catch { /* ignore */ }
    ws.data.conversationWatchers.delete(sessionId);
  }
  try {
    ws.send(JSON.stringify({ type: 'conversation-unsubscribed', sessionId }));
  } catch { /* disconnected */ }
}

// =============================================================================
// Channel C: self-verification drift detection (dev-only)
// =============================================================================

// Server snapshot lines from `capture-pane -e` embed SGR color codes
// plus OSC 8 hyperlinks, but xterm's translateToString returns plain
// text — so compare ANSI-stripped, trailing-whitespace-trimmed forms.
function normalize(s: string): string {
  return stripAnsi(s).trimEnd();
}

interface DriftSample {
  row: number;
  canonical: string;
  client: string;
}

function diffLines(canonical: string[], client: string[]): { count: number; samples: DriftSample[] } {
  const len = Math.max(canonical.length, client.length);
  const samples: DriftSample[] = [];
  let count = 0;
  for (let i = 0; i < len; i++) {
    const c = normalize(canonical[i] ?? '');
    const x = normalize(client[i] ?? '');
    if (c !== x) {
      count++;
      if (samples.length < DRIFT_MAX_MISMATCH_SAMPLES) {
        samples.push({ row: i, canonical: c, client: x });
      }
    }
  }
  return { count, samples };
}

async function handleDebugDump(
  ws: ServerWebSocket<MuxData>,
  sub: MuxSubscription,
  msg: Extract<MuxClientMessage, { type: 'debug-dump' }>,
) {
  try {
    const sentSnap = sub.serverSnapshots.get(msg.paneId);
    // Skip when we have no snapshot to compare against (early dumps
    // before initial sync) or when the client's last-applied seq lags
    // behind what we've since emitted (the snapshot has moved on; a
    // mismatch here is a race, not a render bug).
    if (!sentSnap || (msg.appliedSeq && msg.appliedSeq !== sentSnap.seq)) {
      return;
    }
    const canonicalLines = sentSnap.lines;
    const { count, samples } = diffLines(canonicalLines, msg.lines);

    const record = {
      ts: msg.ts,
      sentSeq: sentSnap.seq,
      appliedSeq: msg.appliedSeq,
      visitorId: ws.data.visitorId,
      sessionId: msg.sessionId,
      paneId: msg.paneId,
      trigger: msg.trigger,
      clientRows: msg.lines.length,
      canonicalRows: canonicalLines.length,
      mismatchCount: count,
      cursor: msg.cursor,
      suppressedOutputCount: sub.outputSuppressedCount,
      sendFailCount: sub.sendFailCount,
      samples,
    };

    if (count > 0) {
      console.warn(
        `[drift] sess=${msg.sessionId} pane=${msg.paneId} trigger=${msg.trigger} ` +
        `mismatch=${count}/${Math.max(canonicalLines.length, msg.lines.length)} ` +
        `suppressed=${sub.outputSuppressedCount}`,
      );
    }

    await appendFile(DRIFT_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    console.warn(`[drift] handleDebugDump error for ${msg.paneId}:`, err);
  }
}

// =============================================================================
// Control message dispatch
// =============================================================================

async function handleControlMessage(
  ws: ServerWebSocket<MuxData>,
  sub: MuxSubscription,
  sessionId: string,
  msg: ControlClientMessage,
) {
  const { controlSession } = sub;

  try {
    switch (msg.type) {
      case 'input': {
        const data = Buffer.from(msg.data, 'base64');
        console.log(`[mux] input pane=${msg.paneId} bytes=${data.length} initialized=${sub.initialized}`);
        await controlSession.sendInput(msg.paneId, data);
        // Pre-arm a snapshot: sending input usually produces output, but if
        // the program is silent (e.g. waiting for full line) we still want to
        // reflect any cursor advance. Re-arming the debounce window guards
        // against losing the trailing snapshot if onOutput already fired.
        if (sub.initialized) scheduleSnapshot(ws, sessionId, sub, msg.paneId);
        break;
      }
      case 'scroll': {
        console.log(`[mux] scroll pane=${msg.paneId} lines=${msg.lines}`);
        await controlSession.scrollPane(msg.paneId, msg.lines);
        if (sub.initialized) scheduleSnapshot(ws, sessionId, sub, msg.paneId);
        break;
      }
      case 'resize': {
        if (!sub.initialized) {
          try {
            // First resize: set tmux size, then emit initial snapshots for
            // every pane so the client has authoritative state to start from.
            await controlSession.setClientSizeImmediate(msg.cols, msg.rows);
            // Brief settle window so tmux reflows before we capture.
            await new Promise(resolve => setTimeout(resolve, 100));
            sub.initialized = true;
            await emitInitialSnapshots(ws, sessionId, sub);
          } catch (err) {
            console.error(`[mux] Failed to initialize after resize for ${sessionId}:`, err);
          }
        } else {
          controlSession.setClientSize(msg.cols, msg.rows);
          // After a resize the next %output will trigger a new snapshot; we
          // additionally pre-arm one in case nothing redraws (e.g. shell at
          // an idle prompt that just relaid out to a new width).
          for (const paneId of sub.knownPanes) {
            scheduleSnapshot(ws, sessionId, sub, paneId);
          }
        }
        break;
      }
      case 'split': {
        await controlSession.splitPane(msg.paneId, msg.direction);
        break;
      }
      case 'close-pane': {
        try {
          await controlSession.closePane(msg.paneId);
        } catch (e) {
          ws.send(JSON.stringify({
            type: 'error',
            message: e instanceof Error ? e.message : 'Failed to close pane',
            paneId: msg.paneId,
            sessionId,
          }));
        }
        break;
      }
      case 'resize-pane': {
        await controlSession.resizePane(msg.paneId, msg.cols, msg.rows);
        break;
      }
      case 'select-pane': {
        await controlSession.selectPane(msg.paneId);
        break;
      }
      case 'adjust-pane': {
        await controlSession.adjustPaneSize(msg.paneId, msg.direction, msg.amount);
        break;
      }
      case 'equalize-panes': {
        await controlSession.equalizePanes(msg.direction);
        break;
      }
      case 'zoom-pane': {
        try {
          await controlSession.zoomPane(msg.paneId);
          await new Promise(resolve => setTimeout(resolve, 100));
          // Zoom changes pane size; emit a fresh snapshot for the zoomed pane.
          sub.serverSnapshots.delete(msg.paneId);
          await emitSnapshot(ws, sessionId, sub, msg.paneId);
        } catch (err) {
          console.warn(`[mux] zoom-pane failed for ${msg.paneId}:`, err);
        }
        break;
      }
      case 'respawn-pane': {
        try {
          await controlSession.respawnPane(msg.paneId);
        } catch (e) {
          ws.send(JSON.stringify({
            type: 'error',
            message: e instanceof Error ? e.message : 'Failed to respawn pane',
            paneId: msg.paneId,
            sessionId,
          }));
        }
        break;
      }
      case 'state-ack': {
        // Currently informational only; we use serverSnapshots as the
        // implicit ack baseline. Kept on the protocol for future use
        // (e.g. retransmit when the client falls behind).
        break;
      }
      case 'request-snapshot': {
        sub.serverSnapshots.delete(msg.paneId);
        await emitSnapshot(ws, sessionId, sub, msg.paneId);
        break;
      }
      case 'ping': {
        ws.data.lastPingAt = Date.now();
        ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        break;
      }
      case 'client-info': {
        controlSession.setClientDeviceType(ws.data.visitorId, msg.deviceType);
        break;
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    ws.send(JSON.stringify({ type: 'error', message: errMsg, sessionId }));
  }
}
