import type { ServerWebSocket } from 'bun';
import type { Subprocess } from 'bun';
import { TmuxService } from '../services/tmux';
import { isAuthRequired, getJwtSecret } from '../middleware/auth';
import { AuthService } from '../services/auth';
import { getDataDir } from '../utils/storage';
import { getOrCreateControlSession, type TmuxControlSession } from '../services/tmux-control';
import type { ControlClientMessage } from '../../../shared/types';

interface TerminalData {
  sessionId: string;
  visitorId: string;
  process: Subprocess | null;
  // Control mode fields
  controlMode?: boolean;
  controlSession?: TmuxControlSession;
  cleanupFns?: Array<() => void>;
  initialContentSent?: boolean;
}

const tmuxService = new TmuxService();

// Map to track active terminal connections
const activeConnections = new Map<string, Set<ServerWebSocket<TerminalData>>>();

// Map to track PTY process per session (only one per session)
const sessionProcesses = new Map<string, Subprocess>();

// Grace period timers for PTY cleanup (keep PTY alive after last client disconnects)
const ptyGraceTimers = new Map<string, Timer>();
const PTY_GRACE_PERIOD_MS = 30_000; // 30 seconds

export const terminalWebSocket = {
  async open(ws: ServerWebSocket<TerminalData>) {
    const { sessionId, controlMode } = ws.data;

    if (controlMode) {
      await handleControlOpen(ws);
      return;
    }

    console.log(`Terminal WebSocket opened for session: ${sessionId}`);

    // Cancel any pending PTY cleanup grace timer (client reconnected in time)
    const graceTimer = ptyGraceTimers.get(sessionId);
    if (graceTimer) {
      clearTimeout(graceTimer);
      ptyGraceTimers.delete(sessionId);
    }

    // Add to active connections
    if (!activeConnections.has(sessionId)) {
      activeConnections.set(sessionId, new Set());
    }
    activeConnections.get(sessionId)?.add(ws);

    // Check if tmux session exists - don't auto-create to prevent phantom sessions
    const exists = await tmuxService.sessionExists(sessionId);
    if (!exists) {
      ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      ws.close();
      return;
    }

    // Check if PTY process already exists for this session
    let proc = sessionProcesses.get(sessionId);

    // Track if this is a reconnection (PTY already exists)
    const isReconnection = proc && !proc.killed;

    if (!proc || proc.killed) {
      // Spawn PTY process attached to tmux session
      try {
        proc = Bun.spawn(['tmux', 'attach', '-t', sessionId], {
          stdin: 'pipe',
          env: {
            ...process.env,
            TERM: 'xterm-256color',
          },
          terminal: {
            cols: 80,
            rows: 24,
            data(_terminal, data) {
              // Send terminal output to all connected clients
              const connections = activeConnections.get(sessionId);
              if (connections) {
                const dataArray = new Uint8Array(data);
                for (const client of connections) {
                  try {
                    client.send(dataArray);
                  } catch {
                    // Client may have disconnected
                  }
                }
              }
            },
          },
        });

        sessionProcesses.set(sessionId, proc);
        console.log(`PTY process started for session: ${sessionId}`);
      } catch (error) {
        console.error('Failed to spawn PTY:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to start terminal' }));
        ws.close();
        return;
      }
    } else {
      console.log(`Reusing existing PTY process for session: ${sessionId}`);
    }

    // For reconnections, send scrollback buffer to restore terminal state
    if (isReconnection) {
      try {
        const scrollback = await tmuxService.captureScrollback(sessionId, 500);
        if (scrollback) {
          // Send scrollback content to this client only
          const scrollbackData = new TextEncoder().encode(scrollback);
          ws.send(scrollbackData);
          console.log(`Sent scrollback buffer (${scrollback.length} chars) to reconnecting client`);
        }
      } catch (error) {
        console.error('Failed to send scrollback:', error);
      }
    }

    ws.data.process = proc;
  },

  async message(ws: ServerWebSocket<TerminalData>, message: string | Buffer) {
    if (ws.data.controlMode) {
      await handleControlMessage(ws, message);
      return;
    }

    const { process, sessionId } = ws.data;

    // Handle ping/pong before terminal check (ping doesn't need PTY)
    if (typeof message === 'string' && message.startsWith('{')) {
      try {
        const data = JSON.parse(message);
        if (data.type === 'ping' && typeof data.timestamp === 'number') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
          return;
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    if (!process?.terminal) {
      return;
    }

    // Handle binary data (terminal input)
    if (message instanceof Buffer || message instanceof Uint8Array) {
      process.terminal.write(message);
      return;
    }

    // Handle JSON messages (resize, refresh commands)
    if (message.startsWith('{')) {
      try {
        const data = JSON.parse(message);
        if (data.type === 'resize' && typeof data.cols === 'number' && typeof data.rows === 'number') {
          process.terminal.resize(data.cols, data.rows);
          return;
        }
        if (data.type === 'refresh') {
          // Force tmux to completely redraw by refresh-client
          try {
            const proc = Bun.spawn(['tmux', 'refresh-client', '-S', '-t', sessionId], {
              stdout: 'ignore',
              stderr: 'ignore',
            });
            await proc.exited;
          } catch (error) {
            console.error(`[${sessionId}] Failed to refresh:`, error);
          }
          return;
        }
      } catch {
        // Not valid JSON, continue to treat as input
      }
    }

    // String input - send directly to terminal
    process.terminal.write(message);
  },

  close(ws: ServerWebSocket<TerminalData>) {
    if (ws.data.controlMode) {
      handleControlClose(ws);
      return;
    }

    const { sessionId } = ws.data;
    console.log(`Terminal WebSocket closed for session: ${sessionId}`);

    // Remove from active connections
    const connections = activeConnections.get(sessionId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        activeConnections.delete(sessionId);

        // Start grace period before killing PTY (allows fast reconnection)
        const proc = sessionProcesses.get(sessionId);
        if (proc && !proc.killed) {
          console.log(`PTY grace period started for session: ${sessionId} (${PTY_GRACE_PERIOD_MS / 1000}s)`);
          const timer = setTimeout(() => {
            ptyGraceTimers.delete(sessionId);
            // Only kill if still no clients connected
            if (!activeConnections.has(sessionId) || activeConnections.get(sessionId)?.size === 0) {
              const currentProc = sessionProcesses.get(sessionId);
              if (currentProc && !currentProc.killed) {
                currentProc.kill();
                sessionProcesses.delete(sessionId);
                console.log(`PTY process killed after grace period for session: ${sessionId}`);
              }
            }
          }, PTY_GRACE_PERIOD_MS);
          ptyGraceTimers.set(sessionId, timer);
        }
      }
    }
  },
};

// Upgrade HTTP request to WebSocket
export async function handleTerminalUpgrade(
  req: Request,
  server: { upgrade: (req: Request, options: { data: TerminalData }) => boolean }
): Promise<Response | null> {
  const url = new URL(req.url);

  // Match both /ws/terminal/:id and /ws/control/:id
  const terminalMatch = url.pathname.match(/^\/ws\/terminal\/(.+)$/);
  const controlMatch = url.pathname.match(/^\/ws\/control\/(.+)$/);
  const pathMatch = terminalMatch || controlMatch;
  const isControlMode = !!controlMatch;

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
      process: null,
      controlMode: isControlMode,
    },
  });

  if (upgraded) {
    return undefined as unknown as Response;
  }

  return new Response('WebSocket upgrade failed', { status: 500 });
}

// =========================================================================
// Control Mode WebSocket Handlers
// =========================================================================

// Track active control mode connections per session
const activeControlConnections = new Map<string, Set<ServerWebSocket<TerminalData>>>();

async function handleControlOpen(ws: ServerWebSocket<TerminalData>): Promise<void> {
  const { sessionId } = ws.data;
  console.log(`Control WebSocket opened for session: ${sessionId}`);

  // Check if tmux session exists
  const exists = await tmuxService.sessionExists(sessionId);
  if (!exists) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
    ws.close();
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

    // Initial pane content is deferred until the first resize message
    // from the client, so that capture-pane runs at the correct terminal size.
    // See handleControlMessage 'resize' handler.
  } catch (error) {
    console.error(`[control] Failed to create control session:`, error);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to start control session' }));
    ws.close();
  }
}

async function handleControlMessage(ws: ServerWebSocket<TerminalData>, message: string | Buffer): Promise<void> {
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
          // First resize: apply size immediately (no debounce) then send
          // initial content at the correct terminal dimensions.
          try {
            await controlSession.setClientSizeImmediate(msg.cols, msg.rows);
            const panes = await controlSession.listPanes();
            for (const pane of panes) {
              try {
                const content = await controlSession.capturePane(pane.paneId);
                if (content) {
                  ws.send(JSON.stringify({
                    type: 'initial-content',
                    paneId: pane.paneId,
                    data: Buffer.from(content).toString('base64'),
                  }));
                }
              } catch {
                // Pane may not be available
              }
            }
          } catch (err) {
            console.error('[control] Failed to send initial content after resize:', err);
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
}

function handleControlClose(ws: ServerWebSocket<TerminalData>): void {
  const { sessionId, controlSession, cleanupFns } = ws.data;
  console.log(`Control WebSocket closed for session: ${sessionId}`);

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
}

export type { TerminalData };
