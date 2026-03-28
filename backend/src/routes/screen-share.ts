import type { ServerWebSocket } from 'bun';

interface ScreenShareData {
  screenShare: true;
  visitorId: string;
}

interface ScreenViewerData {
  screenViewer: true;
  visitorId: string;
}

let hostWs: ServerWebSocket<ScreenShareData> | null = null;
const viewers = new Set<ServerWebSocket<ScreenViewerData>>();

// Buffer last screen-state for new viewers
let lastScreenState: string | null = null;

export function screenShareOpen(ws: ServerWebSocket<ScreenShareData>) {
  console.log(`[screen-share] Host connected: ${ws.data.visitorId}`);
  hostWs = ws;
  lastScreenState = null;
}

export function screenShareMessage(ws: ServerWebSocket<ScreenShareData>, message: string | Buffer) {
  // Relay everything from host to all viewers (JSON or binary)
  if (typeof message === 'string') {
    // Cache screen-state for new viewers
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'screen-state') {
        lastScreenState = message;
        console.log(`[screen-share] State: ${message}`);
      }
    } catch { /* not JSON, relay anyway */ }
  }

  for (const viewer of viewers) {
    try {
      viewer.send(message);
    } catch { /* disconnected */ }
  }
}

export function screenShareClose(_ws: ServerWebSocket<ScreenShareData>, _code?: number, _reason?: string) {
  console.log('[screen-share] Host disconnected');
  hostWs = null;
  const msg = JSON.stringify({ type: 'host-disconnected' });
  for (const viewer of viewers) {
    try { viewer.send(msg); } catch { /* */ }
  }
}

export function screenViewerOpen(ws: ServerWebSocket<ScreenViewerData>) {
  console.log(`[screen-share] Viewer connected: ${ws.data.visitorId}`);
  viewers.add(ws);

  if (!hostWs) {
    ws.send(JSON.stringify({ type: 'host-disconnected' }));
  } else if (lastScreenState) {
    // Send cached state so viewer knows what to show
    ws.send(lastScreenState);
  }
}

export function screenViewerMessage(_ws: ServerWebSocket<ScreenViewerData>, _message: string | Buffer) {
  // Viewers are read-only
}

export function screenViewerClose(ws: ServerWebSocket<ScreenViewerData>, _code?: number, _reason?: string) {
  console.log(`[screen-share] Viewer disconnected: ${ws.data.visitorId}`);
  viewers.delete(ws);
}

export function hasActiveViewers(): boolean {
  return viewers.size > 0;
}

export function isHostConnected(): boolean {
  return hostWs !== null;
}
