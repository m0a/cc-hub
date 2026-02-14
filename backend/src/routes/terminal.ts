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
}

const tmuxService = new TmuxService();

// Track active control mode connections per session
const activeControlConnections = new Map<string, Set<ServerWebSocket<TerminalData>>>();

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
      cleanupFns.push(
        controlSession.onOutput((paneId, data) => {
          try {
            ws.send(JSON.stringify({
              type: 'output',
              paneId,
              data: Buffer.from(data).toString('base64'),
            }));
          } catch {
            // Client may have disconnected
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
    if (!controlSession) {
      console.log(`[ws] message received but no controlSession yet`);
      return;
    }

    // Control mode only handles JSON messages
    if (typeof message !== 'string') return;

    let msg: ControlClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    console.log(`[ws] msg type=${msg.type}${msg.type === 'resize' ? ` ${(msg as any).cols}x${(msg as any).rows} initial=${!ws.data.initialContentSent}` : ''}`);

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
            try {
              await controlSession.setClientSizeImmediate(msg.cols, msg.rows);
              // Capture current pane content and send to client
              const panes = await controlSession.listPanes();
              for (const pane of panes) {
                try {
                  const content = await controlSession.capturePane(pane.paneId);
                  if (content) {
                    // Convert \n to \r\n for xterm.js line rendering
                    const termContent = content.split('\n').join('\r\n');
                    ws.send(JSON.stringify({
                      type: 'output',
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
          await controlSession.closePane(msg.paneId);
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
        case 'ping': {
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
