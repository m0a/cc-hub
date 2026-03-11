import type { ServerWebSocket } from 'bun';
import { TmuxService } from '../services/tmux';
import { isAuthRequired, getJwtSecret } from '../middleware/auth';
import { AuthService } from '../services/auth';
import { getDataDir } from '../utils/storage';
import { getOrCreateControlSession, type TmuxControlSession } from '../services/tmux-control';
import type { ControlClientMessage } from '../../../shared/types';

interface TerminalData {
  sessionId: string;
  visitorId: string;
  controlSession?: TmuxControlSession;
  cleanupFns?: Array<() => void>;
  initialContentSent?: boolean;
  readyForOutput?: boolean; // true after initial-content has been delivered
  outputSuppressedCount?: number;
  sendFailCount?: number;
}

const tmuxService = new TmuxService();

// Track active control mode connections per session
const activeControlConnections = new Map<string, Set<ServerWebSocket<TerminalData>>>();

/** Broadcast a message to ALL connected WebSocket clients across all sessions. */
export function broadcastToAllClients(msg: Record<string, unknown>) {
  const payload = JSON.stringify(msg);
  for (const connections of activeControlConnections.values()) {
    for (const ws of connections) {
      try {
        ws.send(payload);
      } catch {
        // Client may have disconnected
      }
    }
  }
}

export const terminalWebSocket = {
  async open(ws: ServerWebSocket<TerminalData>) {
    const { sessionId } = ws.data;
    console.log(`Control WebSocket opened for session: ${sessionId}`);

    // Check if tmux session exists
    const exists = await tmuxService.sessionExists(sessionId);
    if (!exists) {
      ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      ws.close(4004, 'Session not found');
      return;
    }

    try {
      const controlSession = await getOrCreateControlSession(sessionId);
      ws.data.controlSession = controlSession;
      controlSession.addClient();

      // Track connection
      if (!activeControlConnections.has(sessionId)) {
        activeControlConnections.set(sessionId, new Set());
      }
      activeControlConnections.get(sessionId)!.add(ws);

      // Register listeners
      const cleanupFns: Array<() => void> = [];

      // Output listener: forward pane output to this client
      // Suppressed until initial-content has been delivered to prevent duplicate content
      ws.data.outputSuppressedCount = 0;
      ws.data.sendFailCount = 0;
      cleanupFns.push(
        controlSession.onOutput((paneId, data) => {
          if (!ws.data.readyForOutput) {
            ws.data.outputSuppressedCount = (ws.data.outputSuppressedCount || 0) + 1;
            if (ws.data.outputSuppressedCount % 50 === 1) {
              console.warn(`[control] Output suppressed (readyForOutput=false) for ${sessionId}: count=${ws.data.outputSuppressedCount}`);
            }
            return;
          }
          try {
            const result = ws.send(JSON.stringify({
              type: 'output',
              paneId,
              data: data.toString('base64'),
            }));
            // Bun ws.send returns number of bytes sent, or 0 if backpressure/dropped
            if (result === 0) {
              ws.data.sendFailCount = (ws.data.sendFailCount || 0) + 1;
              if (ws.data.sendFailCount % 20 === 1) {
                console.warn(`[control] ws.send backpressure for ${sessionId}: dropped=${ws.data.sendFailCount} buffered=${ws.getBufferedAmount()}`);
              }
            }
          } catch (err) {
            console.warn(`[control] ws.send error for ${sessionId}:`, err);
          }
        })
      );

      // Layout listener: forward layout changes to this client
      cleanupFns.push(
        controlSession.onLayoutChange((layout, _frontendLayout) => {
          try {
            ws.send(JSON.stringify({ type: 'layout', layout }));
          } catch {
            // Client may have disconnected
          }
        })
      );

      // Exit listener: notify client and clean up
      cleanupFns.push(
        controlSession.onExit((reason) => {
          try {
            ws.send(JSON.stringify({ type: 'error', message: `Session exited: ${reason}` }));
            ws.close();
          } catch {
            // Already closed
          }
        })
      );

      // Pane dead listener: notify client when a pane's process exits
      cleanupFns.push(
        controlSession.onPaneDead((paneId) => {
          try {
            ws.send(JSON.stringify({ type: 'pane-dead', paneId }));
          } catch {
            // Client may have disconnected
          }
        })
      );

      // New session listener: notify client when a pane is separated (mobile)
      cleanupFns.push(
        controlSession.onNewSession((newSessionId, sessionName) => {
          try {
            ws.send(JSON.stringify({
              type: 'new-session',
              sessionId: newSessionId,
              sessionName,
            }));
          } catch {
            // Client may have disconnected
          }
        })
      );

      ws.data.cleanupFns = cleanupFns;

      // Send initial layout (tmux doesn't send %layout-change on connect)
      try {
        const layoutOutput = await controlSession.sendCommand(
          `list-windows -F "#{window_layout}"`
        );
        const layoutString = layoutOutput.trim().split('\n')[0];
        if (layoutString) {
          const { parseTmuxLayout } = await import('../services/tmux-layout-parser');
          const layout = parseTmuxLayout(layoutString);
          ws.send(JSON.stringify({ type: 'layout', layout }));
        }
      } catch (err) {
        console.error(`[control] Failed to send initial layout:`, err);
      }

      // Signal that backend is ready for commands.
      // The client should wait for this before sending resize to avoid
      // messages being dropped during async open handler.
      ws.send(JSON.stringify({ type: 'ready' }));
    } catch (error) {
      console.error(`[control] Failed to create control session:`, error);
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to start control session' }));
      ws.close(4500, 'Control session failed');
    }
  },

  async message(ws: ServerWebSocket<TerminalData>, message: string | Buffer) {
    const { controlSession } = ws.data;
    if (!controlSession) return;

    // Control mode only handles JSON messages
    if (typeof message !== 'string') return;

    let msg: ControlClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }


    try {
      switch (msg.type) {
        case 'input': {
          const data = Buffer.from(msg.data, 'base64');
          await controlSession.sendInput(msg.paneId, data);
          break;
        }
        case 'resize': {
          if (!ws.data.initialContentSent) {
            ws.data.initialContentSent = true;
            // First resize: apply size, then capture current pane content.
            // %output is suppressed (readyForOutput=false) until initial-content is sent,
            // preventing duplicate content from tmux reflow during resize.
            //
            // IMPORTANT: Always capture visible area only (no -S - scrollback).
            // tmux reflows scrollback on ANY size change, which corrupts TUI content
            // (absolute cursor positioning). Even if size hasn't changed, scrollback
            // may have been corrupted by a previous client's resize.
            // Scrollback will build up naturally from new %output messages.
            try {
              await controlSession.setClientSizeImmediate(msg.cols, msg.rows);

              // Wait for applications to redraw after SIGWINCH from resize.
              // Without this delay, capture-pane grabs content before the app
              // has redrawn at the new size, showing corrupted/reflowed content.
              await new Promise(resolve => setTimeout(resolve, 200));

              const panes = await controlSession.listPanes();
              for (const pane of panes) {
                try {
                  // Capture visible area only (avoids corrupted scrollback from reflow)
                  const content = await controlSession.sendCommand(`capture-pane -e -p -t ${pane.paneId}`);
                  if (content) {
                    // Convert \n to \r\n for xterm.js line rendering
                    const termContent = content.split('\n').join('\r\n');
                    ws.send(JSON.stringify({
                      type: 'initial-content',
                      paneId: pane.paneId,
                      data: Buffer.from(termContent).toString('base64'),
                    }));
                  }
                } catch {
                  // Pane may not be available
                }
              }
            } catch (err) {
              console.error('[control] Failed to initialize after resize:', err);
            }
            // Now enable %output forwarding
            ws.data.readyForOutput = true;
          } else {
            // Last-write-wins: any client's resize is applied immediately
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
          // Re-capture pane content and send as initial-content
          try {
            const content = await controlSession.capturePane(msg.paneId);
            if (content) {
              const termContent = content.split('\n').join('\r\n');
              ws.send(JSON.stringify({
                type: 'initial-content',
                paneId: msg.paneId,
                data: Buffer.from(termContent).toString('base64'),
              }));
            }
          } catch {
            // Pane may not be available
          }
          break;
        }
        case 'zoom-pane': {
          // Suppress %output during zoom to prevent double content.
          // Zoom causes tmux to reflow and send %output for the entire screen,
          // which duplicates the initial-content we send afterwards.
          ws.data.readyForOutput = false;
          try {
            await controlSession.zoomPane(msg.paneId);
            // Wait for app to redraw after zoom resize
            await new Promise(resolve => setTimeout(resolve, 200));
            // Capture zoomed pane content and send as initial-content
            try {
              const content = await controlSession.capturePane(msg.paneId);
              if (content) {
                const termContent = content.split('\n').join('\r\n');
                ws.send(JSON.stringify({
                  type: 'initial-content',
                  paneId: msg.paneId,
                  data: Buffer.from(termContent).toString('base64'),
                }));
              }
            } catch {
              // Pane may not be available
            }
          } finally {
            ws.data.readyForOutput = true;
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
            }));
          }
          break;
        }
        case 'ping': {
          // Log health info for debugging terminal freeze
          const buffered = ws.getBufferedAmount();
          const suppressed = ws.data.outputSuppressedCount || 0;
          const dropped = ws.data.sendFailCount || 0;
          if (dropped > 0 || suppressed > 0 || buffered > 0) {
            console.log(`[control] health ${ws.data.sessionId}: ready=${ws.data.readyForOutput} suppressed=${suppressed} dropped=${dropped} buffered=${buffered}`);
          }
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
          break;
        }
        case 'client-info': {
          // Store device type for mobile pane separation logic
          controlSession.setClientDeviceType(ws.data.visitorId, msg.deviceType);
          break;
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      ws.send(JSON.stringify({ type: 'error', message: errMsg }));
    }
  },

  close(ws: ServerWebSocket<TerminalData>, code: number, reason: string) {
    const { sessionId, controlSession, cleanupFns } = ws.data;
    console.log(`Control WebSocket closed for session: ${sessionId} (code=${code}, reason=${reason})`);

    // Unregister listeners
    if (cleanupFns) {
      for (const fn of cleanupFns) {
        fn();
      }
    }

    // Remove from tracking
    const connections = activeControlConnections.get(sessionId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        activeControlConnections.delete(sessionId);
      }
    }

    // Notify control session that client disconnected
    if (controlSession) {
      controlSession.removeClientDeviceType(ws.data.visitorId);
      controlSession.removeClient();
    }
  },
};

// Upgrade HTTP request to WebSocket
export async function handleTerminalUpgrade(
  req: Request,
  server: { upgrade: (req: Request, options: { data: TerminalData }) => boolean }
): Promise<Response | null> {
  const url = new URL(req.url);

  // Match /ws/control/:id (primary) and /ws/terminal/:id (legacy compatibility)
  const controlMatch = url.pathname.match(/^\/ws\/control\/(.+)$/);
  const terminalMatch = url.pathname.match(/^\/ws\/terminal\/(.+)$/);
  const pathMatch = controlMatch || terminalMatch;

  if (!pathMatch) {
    return null;
  }

  // Check authentication if required
  if (isAuthRequired()) {
    const token = url.searchParams.get('token');
    if (!token) {
      return new Response('Authentication required', { status: 401 });
    }

    try {
      const authService = new AuthService(getDataDir(), getJwtSecret());
      await authService.verifyToken(token);
    } catch {
      return new Response('Invalid or expired token', { status: 401 });
    }
  }

  const sessionId = decodeURIComponent(pathMatch[1]);

  const upgraded = server.upgrade(req, {
    data: {
      sessionId,
      visitorId: crypto.randomUUID(),
    },
  });

  if (upgraded) {
    return undefined as unknown as Response;
  }

  return new Response('WebSocket upgrade failed', { status: 500 });
}
