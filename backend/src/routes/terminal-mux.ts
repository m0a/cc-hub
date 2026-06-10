import type { ServerWebSocket } from 'bun';
import { TmuxService } from '../services/tmux';
import { getOrCreateControlSession, type TmuxControlSession } from '../services/tmux-control';
import { ConversationWatcher } from '../services/conversation-watcher';
import { captureViewport } from '../services/pane-viewport';
import type {
  ControlClientMessage,
  MuxClientMessage,
  ConversationMessage,
} from '../../../shared/types';
import { MuxClientMessageSchema } from '../../../shared/types';
import { buildSessionsList } from './sessions';
import { resolveViewportCursorPolicy, type ViewportCursorPolicy } from '../services/viewport-cursor-policy';

// Output → push debounce. Wait this long after the last %output for a pane
// before recapturing. Shorter = lower latency; longer = fewer captures.
const PUSH_DEBOUNCE_MS = 50;

// Hard rate limit per pane per subscription. Live-mode clients receive at
// most one unsolicited viewport push per this window. Each push runs
// display-message + capture-pane + ~10KB JSON, so removing the cap let a
// continuously-redrawing pane consume runaway CPU.
// 200ms = 5/sec/pane.
const PUSH_MIN_INTERVAL_MS = 200;

const DEBUG_MUX = process.env.DEBUG_MUX === '1' || process.env.DEBUG_MUX === 'true';

/** Per-session subscription state for a mux client */
interface MuxSubscription {
  controlSession: TmuxControlSession;
  cleanupFns: Array<() => void>;
  // True once the client has sent at least one `resize` message. The first
  // resize uses setClientSizeImmediate (synchronous tmux size adoption);
  // subsequent resizes use the dedup'd path.
  firstResizeReceived: boolean;
  // Last `offset` the client requested for each pane. 0 means live mode;
  // server pushes fresh viewports unsolicited on %output. >0 means the
  // client is viewing historical scrollback; the server is silent until
  // the client asks for a new offset.
  liveOffset: Map<string, number>;
  // Per-pane debounce timers for unsolicited viewport pushes.
  pushTimers: Map<string, Timer>;
  // Wall-clock of the last unsolicited push, for PUSH_MIN_INTERVAL_MS.
  lastPushAt: Map<string, number>;
  // Pane IDs the subscription has ever touched (request-viewport, push).
  // Used by resize to re-push known panes after tmux reflows.
  knownPanes: Set<string>;
  cursorPolicy: ViewportCursorPolicy;
}

export interface MuxData {
  mux: true;
  visitorId: string;
  /** Stable per-device identifier sent by the client (localStorage UUID).
   *  Used to count unique devices, falling back to visitorId if absent. */
  deviceId?: string;
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
  // Count unique devices, not raw WebSocket connections.
  // A client without a deviceId (very old client / direct WS test) falls back
  // to its per-connection visitorId so it still counts as one.
  const devices = new Set<string>();
  for (const ws of activeMuxConnections) {
    devices.add(ws.data.deviceId ?? ws.data.visitorId);
  }
  return devices.size;
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

  let raw: unknown;
  try {
    raw = JSON.parse(message);
  } catch {
    return;
  }

  // Validate the frame before any field reaches a tmux control-mode command.
  // Invalid/unknown frames (incl. paneId or cols/rows injection attempts) are
  // dropped here. #231.
  const parsed = MuxClientMessageSchema.safeParse(raw);
  if (!parsed.success) return;
  const msg = parsed.data as MuxClientMessage;

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

  // Keepalive. Handle before the sessionId/subscription gate below: the client
  // pings with sessionId="" whenever no terminal is selected (dashboard, file
  // viewer, history). If those pings were dropped, the client never gets a
  // pong, force-closes after the timeout, and reconnect-storms. #236
  if (msg.type === 'ping') {
    ws.data.lastPingAt = Date.now();
    ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
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
  // Already subscribed — reset state so the next resize re-emits initial viewports.
  const existing = ws.data.subscriptions.get(sessionId);
  if (existing) {
    existing.firstResizeReceived = false;
    existing.liveOffset.clear();
    for (const t of existing.pushTimers.values()) clearTimeout(t);
    existing.pushTimers.clear();
    existing.lastPushAt.clear();
    ws.send(JSON.stringify({ type: 'subscribed', sessionId }));
    void emitInitialViewports(ws, sessionId, existing).catch((err) => {
      console.warn(`[mux] re-subscribe viewport emit failed for ${sessionId}:`, err);
    });
    return;
  }

  const exists = await tmuxService.sessionExists(sessionId);
  if (!exists) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session not found', sessionId }));
    return;
  }

  let controlSession: TmuxControlSession | null = null;
  let clientAdded = false;
  const cleanupFns: Array<() => void> = [];
  try {
    controlSession = await getOrCreateControlSession(sessionId);
    controlSession.addClient();
    clientAdded = true;

    const sessions = await tmuxService.listSessions();
    const session = sessions.find(s => s.id === sessionId);
    const sub: MuxSubscription = {
      controlSession,
      cleanupFns,
      firstResizeReceived: false,
      liveOffset: new Map(),
      pushTimers: new Map(),
      lastPushAt: new Map(),
      knownPanes: new Set(),
      cursorPolicy: resolveViewportCursorPolicy(session?.agent ?? session?.currentCommand),
    };

    // %output → schedule a push for any pane this subscription is viewing
    // in live mode. Panes the client has scrolled away from (offset>0) are
    // silent until the client asks for new content. Initial viewports are
    // emitted at subscribe time (below) so we don't need to gate this on
    // `sub.initialized`.
    cleanupFns.push(
      controlSession.onOutput((paneId, _data) => {
        if ((sub.liveOffset.get(paneId) ?? 0) !== 0) return;
        schedulePush(ws, sessionId, sub, paneId);
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

    ws.send(JSON.stringify({ type: 'subscribed', sessionId }));

    // Eagerly emit an initial viewport for every pane so the client has
    // content to render even before its first `resize` arrives. Mobile
    // browsers in particular can mount the Terminal component, register
    // its viewport callback, and start expecting content before they
    // measure / send a resize — leaving a blank canvas if we wait.
    // sub.initialized stays false until a real resize comes in; the
    // resize handler is responsible for actually setting tmux's pane
    // size and re-pushing viewports if dimensions change.
    void emitInitialViewports(ws, sessionId, sub).catch((err) => {
      console.warn(`[mux] initial viewport emit failed for ${sessionId}:`, err);
    });
  } catch (error) {
    console.error(`[mux] Failed to subscribe to ${sessionId}:`, error);
    // Roll back whatever was set up before the failure. Without this the
    // client count stays over-counted, the grace period never starts, and
    // the tmux -CC subprocess lives forever (#332).
    for (const fn of cleanupFns) {
      try { fn(); } catch { /* ignore */ }
    }
    if (ws.data.subscriptions.get(sessionId)?.controlSession === controlSession) {
      ws.data.subscriptions.delete(sessionId);
    }
    if (clientAdded && controlSession) {
      controlSession.removeClient();
    }
    try {
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to subscribe', sessionId }));
    } catch { /* disconnected */ }
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
  for (const t of sub.pushTimers.values()) clearTimeout(t);
  sub.pushTimers.clear();
  sub.lastPushAt.clear();
  sub.controlSession.removeClientDeviceType(ws.data.visitorId);
  sub.controlSession.removeClient();
}

// =============================================================================
// Viewport push (unsolicited, for live-mode panes)
// =============================================================================

function schedulePush(
  ws: ServerWebSocket<MuxData>,
  sessionId: string,
  sub: MuxSubscription,
  paneId: string,
) {
  if (sub.pushTimers.has(paneId)) return;
  const lastAt = sub.lastPushAt.get(paneId) ?? 0;
  const sinceLast = Date.now() - lastAt;
  const delay = Math.max(PUSH_DEBOUNCE_MS, PUSH_MIN_INTERVAL_MS - sinceLast);
  const timer = setTimeout(() => {
    sub.pushTimers.delete(paneId);
    void pushViewport(ws, sessionId, sub, paneId, 0);
  }, delay);
  sub.pushTimers.set(paneId, timer);
}

async function pushViewport(
  ws: ServerWebSocket<MuxData>,
  sessionId: string,
  sub: MuxSubscription,
  paneId: string,
  offset: number,
) {
  if (sub.controlSession.isDestroyed) return;
  let viewport: Awaited<ReturnType<typeof captureViewport>> = null;
  try {
    viewport = await captureViewport(sub.controlSession, paneId, offset, sub.cursorPolicy);
  } catch (err) {
    console.warn(`[mux] captureViewport failed for ${paneId}:`, err);
    return;
  }
  if (!viewport) return;

  sub.knownPanes.add(paneId);
  if (DEBUG_MUX) {
    console.log(`[mux] viewport pane=${paneId} offset=${viewport.offset}/${viewport.historySize} rows=${viewport.rows}`);
  }
  try {
    ws.send(JSON.stringify({ type: 'viewport', sessionId, viewport }));
  } catch { return; }
  sub.lastPushAt.set(paneId, Date.now());
}

async function emitInitialViewports(
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
    sub.liveOffset.set(pane.paneId, 0);
    await pushViewport(ws, sessionId, sub, pane.paneId, 0);
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
        console.log(`[mux] input pane=${msg.paneId} bytes=${data.length}`);
        await controlSession.sendInput(msg.paneId, data);
        // Pre-arm a push: input usually generates output but a silent program
        // (waiting for full line, etc.) wouldn't, and we still want to refresh
        // cursor position promptly.
        if ((sub.liveOffset.get(msg.paneId) ?? 0) === 0) {
          schedulePush(ws, sessionId, sub, msg.paneId);
        }
        break;
      }
      case 'resize': {
        try {
          if (!sub.firstResizeReceived) {
            // First resize: force tmux to adopt the new pane size synchronously
            // (refresh-client -C + resize-window). Subsequent resizes go through
            // the dedup'd path.
            await controlSession.setClientSizeImmediate(msg.cols, msg.rows);
            sub.firstResizeReceived = true;
            // Brief settle window so tmux reflows before we capture, then push
            // viewports at the new size (the ones we emitted at subscribe time
            // were at whatever size tmux had previously).
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            controlSession.setClientSize(msg.cols, msg.rows);
          }
          for (const paneId of sub.knownPanes) {
            if ((sub.liveOffset.get(paneId) ?? 0) === 0) {
              schedulePush(ws, sessionId, sub, paneId);
            }
          }
        } catch (err) {
          console.error(`[mux] resize failed for ${sessionId}:`, err);
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
          // Zoom changes pane size; emit a fresh viewport in live mode.
          if ((sub.liveOffset.get(msg.paneId) ?? 0) === 0) {
            await pushViewport(ws, sessionId, sub, msg.paneId, 0);
          }
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
      case 'request-viewport': {
        sub.liveOffset.set(msg.paneId, Math.max(0, msg.offset | 0));
        await pushViewport(ws, sessionId, sub, msg.paneId, msg.offset);
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
