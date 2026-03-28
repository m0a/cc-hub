import type { ServerWebSocket } from 'bun';
import { TmuxService } from '../services/tmux';
import { getOrCreateControlSession, type TmuxControlSession } from '../services/tmux-control';
import type { ControlClientMessage, MuxClientMessage } from '../../../shared/types';
import { MUX_BINARY_TYPE } from '../../../shared/types';
import { buildSessionsList } from './sessions';

/** Per-session subscription state for a mux client */
interface MuxSubscription {
  controlSession: TmuxControlSession;
  cleanupFns: Array<() => void>;
  initialContentSent: boolean;
  readyForOutput: boolean;
  outputSuppressedCount: number;
  sendFailCount: number;
}

export interface MuxData {
  mux: true;
  visitorId: string;
  subscriptions: Map<string, MuxSubscription>;
}

const tmuxService = new TmuxService();

// Track mux connections for broadcast
const activeMuxConnections = new Set<ServerWebSocket<MuxData>>();

// =============================================================================
// Sessions push: periodically push session list to connected mux clients
// =============================================================================

const SESSIONS_PUSH_INTERVAL = 5000; // 5 seconds
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
      // Compare without volatile fields (durationMinutes changes every minute)
      const stableJson = JSON.stringify(sessions, (key, value) =>
        key === 'durationMinutes' ? undefined : value
      );
      if (stableJson === lastSessionsJson) return;
      lastSessionsJson = stableJson;
      const payload = JSON.stringify({ type: 'sessions-updated', sessions });
      for (const ws of activeMuxConnections) {
        try {
          ws.send(payload);
        } catch { /* disconnected */ }
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

/** Force an immediate sessions push (e.g. after create/delete) */
export function pushSessionsNow() {
  lastSessionsJson = ''; // Force change detection
  // Fire async, don't await
  buildSessionsList().then(sessions => {
    const payload = JSON.stringify({ type: 'sessions-updated', sessions });
    for (const ws of activeMuxConnections) {
      try {
        ws.send(payload);
      } catch { /* disconnected */ }
    }
  }).catch(() => {});
}

/** Broadcast a message to all mux clients (used by notify) */
export function broadcastToMuxClients(msg: Record<string, unknown>) {
  const payload = JSON.stringify(msg);
  for (const ws of activeMuxConnections) {
    try {
      ws.send(payload);
    } catch {
      // Client may have disconnected
    }
  }
}

export async function muxOpen(ws: ServerWebSocket<MuxData>) {
  console.log(`[mux] WebSocket opened: ${ws.data.visitorId}`);
  activeMuxConnections.add(ws);
  startSessionsPush();

  // Send initial sessions list immediately so frontend has data before Terminal mounts
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

  // All other messages need sessionId
  const sessionId = (msg as { sessionId?: string }).sessionId;
  if (!sessionId) return;

  const sub = ws.data.subscriptions.get(sessionId);
  if (!sub) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not subscribed to session', sessionId }));
    return;
  }

  // Strip sessionId and handle as regular ControlClientMessage
  const { sessionId: _sid, ...controlMsg } = msg as ControlClientMessage & { sessionId: string };
  await handleControlMessage(ws, sub, sessionId, controlMsg as ControlClientMessage);
}

export function muxClose(ws: ServerWebSocket<MuxData>, code: number, reason: string) {
  console.log(`[mux] WebSocket closed: ${ws.data.visitorId} (code=${code}, reason=${reason})`);
  activeMuxConnections.delete(ws);
  if (activeMuxConnections.size === 0) stopSessionsPush();

  // Clean up all subscriptions
  for (const [sessionId, sub] of ws.data.subscriptions) {
    cleanupSubscription(ws, sessionId, sub);
  }
  ws.data.subscriptions.clear();
}

async function handleSubscribe(ws: ServerWebSocket<MuxData>, sessionId: string) {
  console.log(`[mux] subscribe: ${sessionId} (current subs: ${ws.data.subscriptions.size})`);
  // Already subscribed
  if (ws.data.subscriptions.has(sessionId)) {
    ws.send(JSON.stringify({ type: 'subscribed', sessionId }));
    return;
  }

  // Check session exists
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
      initialContentSent: false,
      readyForOutput: false,
      outputSuppressedCount: 0,
      sendFailCount: 0,
    };

    // Output listener - binary mux frame: [0x02][sessionId\0][paneId\0][raw data]
    cleanupFns.push(
      controlSession.onOutput((paneId, data) => {
        if (!sub.readyForOutput) {
          sub.outputSuppressedCount++;
          return;
        }
        try {
          const sessionIdBuf = Buffer.from(`${sessionId}\0`);
          const paneIdBuf = Buffer.from(`${paneId}\0`);
          const frame = Buffer.allocUnsafe(1 + sessionIdBuf.length + paneIdBuf.length + data.length);
          frame[0] = MUX_BINARY_TYPE;
          sessionIdBuf.copy(frame, 1);
          paneIdBuf.copy(frame, 1 + sessionIdBuf.length);
          data.copy(frame, 1 + sessionIdBuf.length + paneIdBuf.length);
          const result = ws.send(frame);
          if (result === 0) {
            sub.sendFailCount++;
          }
        } catch (err) {
          console.warn(`[mux] ws.send error for ${sessionId}:`, err);
        }
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

    // Exit listener
    cleanupFns.push(
      controlSession.onExit((reason) => {
        try {
          ws.send(JSON.stringify({ type: 'error', message: `Session exited: ${reason}`, sessionId }));
        } catch { /* disconnected */ }
        // Auto-unsubscribe on exit
        handleUnsubscribe(ws, sessionId);
      })
    );

    // Pane dead listener
    cleanupFns.push(
      controlSession.onPaneDead((paneId) => {
        try {
          ws.send(JSON.stringify({ type: 'pane-dead', paneId, sessionId }));
        } catch { /* disconnected */ }
      })
    );

    // New session listener
    cleanupFns.push(
      controlSession.onNewSession((newSessionId, sessionName) => {
        try {
          ws.send(JSON.stringify({ type: 'new-session', sessionId: newSessionId, sessionName }));
        } catch { /* disconnected */ }
      })
    );

    ws.data.subscriptions.set(sessionId, sub);

    // Send initial layout
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
  for (const fn of sub.cleanupFns) {
    fn();
  }
  sub.controlSession.removeClientDeviceType(ws.data.visitorId);
  sub.controlSession.removeClient();
}

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
        await controlSession.sendInput(msg.paneId, data);
        break;
      }
      case 'resize': {
        if (!sub.initialContentSent) {
          sub.initialContentSent = true;
          try {
            // Step 1: Capture scrollback before resize
            const panesBefore = await controlSession.listPanes();
            const scrollbackMap = new Map<string, string>();
            for (const pane of panesBefore) {
              try {
                const scrollback = await controlSession.sendCommand(
                  `capture-pane -e -p -t ${pane.paneId} -S - -E -1`
                );
                if (scrollback?.trim()) {
                  scrollbackMap.set(pane.paneId, scrollback);
                }
              } catch { /* pane may not be available */ }
            }

            // Step 2: Resize
            await controlSession.setClientSizeImmediate(msg.cols, msg.rows);
            await new Promise(resolve => setTimeout(resolve, 200));

            // Step 3: Capture visible area after resize
            const panes = await controlSession.listPanes();
            for (const pane of panes) {
              try {
                const visible = await controlSession.sendCommand(`capture-pane -e -p -t ${pane.paneId}`);
                if (visible) {
                  const scrollback = scrollbackMap.get(pane.paneId);
                  const fullContent = scrollback ? `${scrollback}\n${visible}` : visible;
                  const termContent = fullContent.split('\n').join('\r\n');
                  ws.send(JSON.stringify({
                    type: 'initial-content',
                    paneId: pane.paneId,
                    data: Buffer.from(termContent).toString('base64'),
                    sessionId,
                  }));
                }
              } catch { /* pane may not be available */ }
            }
          } catch (err) {
            console.error(`[mux] Failed to initialize after resize for ${sessionId}:`, err);
          }
          sub.readyForOutput = true;
        } else {
          controlSession.setClientSize(msg.cols, msg.rows);
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
      case 'scroll': {
        await controlSession.scrollPane(msg.paneId, msg.lines);
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
      case 'request-content': {
        try {
          const content = await controlSession.capturePaneWithScrollback(msg.paneId);
          if (content) {
            const termContent = content.split('\n').join('\r\n');
            ws.send(JSON.stringify({
              type: 'initial-content',
              paneId: msg.paneId,
              data: Buffer.from(termContent).toString('base64'),
              sessionId,
            }));
          }
        } catch { /* pane may not be available */ }
        break;
      }
      case 'zoom-pane': {
        sub.readyForOutput = false;
        try {
          await controlSession.zoomPane(msg.paneId);
          await new Promise(resolve => setTimeout(resolve, 200));
          try {
            const content = await controlSession.capturePane(msg.paneId);
            if (content) {
              const termContent = content.split('\n').join('\r\n');
              ws.send(JSON.stringify({
                type: 'initial-content',
                paneId: msg.paneId,
                data: Buffer.from(termContent).toString('base64'),
                sessionId,
              }));
            }
          } catch { /* pane may not be available */ }
        } finally {
          sub.readyForOutput = true;
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
      case 'ping': {
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
