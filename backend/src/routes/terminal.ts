import type { ServerWebSocket } from 'bun';
import { TmuxService } from '../services/tmux';
import { getOrCreateControlSession, type TmuxControlSession } from '../services/tmux-control';
import { validateShareToken } from '../services/share-token';

interface ViewerData {
  sessionId: string;
  visitorId: string;
  readOnly: true;
  controlSession?: TmuxControlSession;
  cleanupFns?: Array<() => void>;
  initialContentSent?: boolean;
  readyForOutput?: boolean;
}

const tmuxService = new TmuxService();

/**
 * WebSocket handler for read-only share view (/ws/view/:token).
 * This is the only remaining per-session WS — all interactive
 * terminal I/O now uses the multiplexed /ws/mux endpoint.
 */
export const viewerWebSocket = {
  async open(ws: ServerWebSocket<ViewerData>) {
    const { sessionId } = ws.data;
    console.log(`[viewer] WebSocket opened for session: ${sessionId}`);

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

      const cleanupFns: Array<() => void> = [];

      // Output listener (suppressed until initial-content sent)
      cleanupFns.push(
        controlSession.onOutput((paneId, data) => {
          if (!ws.data.readyForOutput) return;
          try {
            const paneIdBuf = Buffer.from(`${paneId}\0`);
            const frame = Buffer.allocUnsafe(1 + paneIdBuf.length + data.length);
            frame[0] = 0x01;
            paneIdBuf.copy(frame, 1);
            data.copy(frame, 1 + paneIdBuf.length);
            ws.send(frame);
          } catch { /* disconnected */ }
        })
      );

      // Layout listener
      cleanupFns.push(
        controlSession.onLayoutChange((layout) => {
          try {
            ws.send(JSON.stringify({ type: 'layout', layout }));
          } catch { /* disconnected */ }
        })
      );

      // Exit listener
      cleanupFns.push(
        controlSession.onExit((reason) => {
          try {
            ws.send(JSON.stringify({ type: 'error', message: `Session exited: ${reason}` }));
            ws.close();
          } catch { /* already closed */ }
        })
      );

      // Pane dead listener
      cleanupFns.push(
        controlSession.onPaneDead((paneId) => {
          try {
            ws.send(JSON.stringify({ type: 'pane-dead', paneId }));
          } catch { /* disconnected */ }
        })
      );

      ws.data.cleanupFns = cleanupFns;

      // Send initial layout
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
        console.error(`[viewer] Failed to send initial layout:`, err);
      }

      ws.send(JSON.stringify({ type: 'ready' }));
    } catch (error) {
      console.error(`[viewer] Failed to create control session:`, error);
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to start control session' }));
      ws.close(4500, 'Control session failed');
    }
  },

  async message(ws: ServerWebSocket<ViewerData>, message: string | Buffer) {
    const { controlSession } = ws.data;
    if (!controlSession) return;
    if (typeof message !== 'string') return;

    let msg: { type: string; timestamp?: number; paneId?: string; cols?: number; rows?: number };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    // Read-only: only allow resize (for initial content), ping, request-content
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
      return;
    }

    if (msg.type === 'request-content' && msg.paneId) {
      try {
        const content = await controlSession.capturePaneWithScrollback(msg.paneId);
        if (content) {
          const termContent = content.split('\n').join('\r\n');
          ws.send(JSON.stringify({
            type: 'initial-content',
            paneId: msg.paneId,
            data: Buffer.from(termContent).toString('base64'),
          }));
        }
      } catch { /* pane may not be available */ }
      return;
    }

    if (msg.type === 'resize' && !ws.data.initialContentSent) {
      ws.data.initialContentSent = true;
      try {
        const panes = await controlSession.listPanes();
        for (const pane of panes) {
          try {
            const content = await controlSession.capturePaneWithScrollback(pane.paneId);
            if (content) {
              const termContent = content.split('\n').join('\r\n');
              ws.send(JSON.stringify({
                type: 'initial-content',
                paneId: pane.paneId,
                data: Buffer.from(termContent).toString('base64'),
              }));
            }
          } catch { /* pane may not be available */ }
        }
      } catch (err) {
        console.error('[viewer] Failed to send initial content:', err);
      }
      ws.data.readyForOutput = true;
    }
    // Ignore all other messages (input, split, close-pane, etc.)
  },

  close(ws: ServerWebSocket<ViewerData>, code: number, reason: string) {
    const { sessionId, controlSession, cleanupFns } = ws.data;
    console.log(`[viewer] WebSocket closed for session: ${sessionId} (code=${code}, reason=${reason})`);

    if (cleanupFns) {
      for (const fn of cleanupFns) fn();
    }
    if (controlSession) {
      controlSession.removeClient();
    }
  },
};

// Upgrade HTTP request to WebSocket (only /ws/view/:token)
export async function handleViewerUpgrade(
  req: Request,
  server: { upgrade: (req: Request, options: { data: ViewerData }) => boolean }
): Promise<Response | null> {
  const url = new URL(req.url);

  const viewMatch = url.pathname.match(/^\/ws\/view\/(.+)$/);
  if (!viewMatch) return null;

  const shareToken = decodeURIComponent(viewMatch[1]);
  const stored = validateShareToken(shareToken);
  if (!stored) {
    return new Response('Invalid or expired share token', { status: 403 });
  }

  const upgraded = server.upgrade(req, {
    data: {
      sessionId: stored.sessionId,
      visitorId: crypto.randomUUID(),
      readOnly: true as const,
    },
  });

  if (upgraded) {
    return undefined as unknown as Response;
  }
  return new Response('WebSocket upgrade failed', { status: 500 });
}
