import { useState, useCallback, useRef, useEffect } from 'react';
import { reportWsLatency } from '../services/latency-store';
import type { TmuxLayoutNode } from '../../../shared/types';
import { MUX_BINARY_TYPE } from '../../../shared/types';

interface UseMultiplexedTerminalOptions {
  sessionId: string;
  token?: string | null;
  onPaneOutput?: (paneId: string, data: Uint8Array) => void;
  onLayoutChange?: (layout: TmuxLayoutNode) => void;
  onInitialContent?: (paneId: string, data: Uint8Array) => void;
  onNewSession?: (sessionId: string, sessionName: string) => void;
  onPaneDead?: (paneId: string) => void;
  onHookEvent?: (event: string, cwd?: string, sessionId?: string, data?: Record<string, unknown>, message?: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string, paneId?: string) => void;
}

interface UseMultiplexedTerminalReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  sendInput: (paneId: string, data: string) => void;
  resize: (cols: number, rows: number) => void;
  splitPane: (paneId: string, direction: 'h' | 'v') => void;
  closePane: (paneId: string) => void;
  resizePane: (paneId: string, cols: number, rows: number) => void;
  selectPane: (paneId: string) => void;
  scrollPane: (paneId: string, lines: number) => void;
  adjustPane: (paneId: string, direction: 'L' | 'R' | 'U' | 'D', amount: number) => void;
  equalizePanes: (direction: 'horizontal' | 'vertical') => void;
  sendClientInfo: (deviceType: 'mobile' | 'tablet' | 'desktop') => void;
  requestContent: (paneId: string) => void;
  zoomPane: (paneId: string) => void;
  respawnPane: (paneId: string) => void;
  deadPanes: Set<string>;
}

// =============================================================================
// Module-level singleton WebSocket — survives React component remounts
// =============================================================================

const getWsBase = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

const getAuthToken = (): string | null => {
  return localStorage.getItem('cc-hub-token');
};

let sharedWs: WebSocket | null = null;
let sharedPingInterval: number | null = null;
let sharedReconnectTimeout: number | null = null;
let subscribedSession: string | null = null;
let wsReady = false; // true after server sends 'ready'

// Screen share: forward raw WS messages to an external callback
let rawMessageForwarder: ((data: string | ArrayBuffer) => void) | null = null;

/** Register a forwarder for raw WS messages (used by screen share) */
export function setMuxForwarder(fn: ((data: string | ArrayBuffer) => void) | null) {
  rawMessageForwarder = fn;
}

// Current hook instance's callbacks (only one active at a time)
type MuxCallbacks = {
  onPaneOutput?: (paneId: string, data: Uint8Array) => void;
  onLayoutChange?: (layout: TmuxLayoutNode) => void;
  onInitialContent?: (paneId: string, data: Uint8Array) => void;
  onNewSession?: (sessionId: string, sessionName: string) => void;
  onPaneDead?: (paneId: string) => void;
  onHookEvent?: (event: string, cwd?: string, sessionId?: string, data?: Record<string, unknown>, message?: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string, paneId?: string) => void;
  setIsConnected?: (v: boolean) => void;
  setDeadPanes?: (fn: (prev: Set<string>) => Set<string>) => void;
  sessionId: string;
  deadPanes: Set<string>;
};

let activeCallbacks: MuxCallbacks | null = null;

function sendRaw(msg: Record<string, unknown>) {
  if (sharedWs?.readyState === WebSocket.OPEN) {
    sharedWs.send(JSON.stringify(msg));
  }
}

function sendSessionMessage(msg: Record<string, unknown>) {
  if (activeCallbacks) {
    sendRaw({ ...msg, sessionId: activeCallbacks.sessionId });
  }
}

function subscribeToSession(sessionId: string) {
  if (subscribedSession === sessionId) return;

  // Unsubscribe from previous
  if (subscribedSession) {
    sendRaw({ type: 'unsubscribe', sessionId: subscribedSession });
  }

  subscribedSession = sessionId;
  activeCallbacks?.setIsConnected?.(false);
  activeCallbacks?.setDeadPanes?.(() => new Set());
  sendRaw({ type: 'subscribe', sessionId });
}

function ensureConnection(token?: string | null) {
  if (sharedWs && (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (sharedReconnectTimeout) {
    clearTimeout(sharedReconnectTimeout);
    sharedReconnectTimeout = null;
  }

  let wsUrl = `${getWsBase()}/ws/mux`;
  const authToken = token || getAuthToken();
  if (authToken) {
    wsUrl += `?token=${encodeURIComponent(authToken)}`;
  }

  const ws = new WebSocket(wsUrl);
  sharedWs = ws;
  wsReady = false;

  ws.onopen = () => {
    console.log('[MUX] WebSocket opened');

    if (sharedPingInterval) clearInterval(sharedPingInterval);
    sharedPingInterval = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const sid = activeCallbacks?.sessionId || '';
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now(), sessionId: sid }));
      }
    }, 10_000);
  };

  let wsMsgCount = 0;
  let wsOutputCount = 0;

  ws.binaryType = 'arraybuffer';
  ws.onmessage = (event) => {
    wsMsgCount++;

    // Forward raw message to screen share if active
    if (rawMessageForwarder) {
      rawMessageForwarder(event.data);
    }

    const cb = activeCallbacks;
    const currentSession = cb?.sessionId;

    // Binary mux frame: [0x02][sessionId\0][paneId\0][raw data]
    if (event.data instanceof ArrayBuffer) {
      const view = new Uint8Array(event.data);
      if (view.length < 5 || view[0] !== MUX_BINARY_TYPE) return;

      let idx = 1;
      while (idx < view.length && view[idx] !== 0) idx++;
      if (idx >= view.length) return;
      const frameSessionId = new TextDecoder().decode(view.subarray(1, idx));
      idx++;

      if (frameSessionId !== currentSession) return;

      const paneStart = idx;
      while (idx < view.length && view[idx] !== 0) idx++;
      if (idx >= view.length) return;
      const paneId = new TextDecoder().decode(view.subarray(paneStart, idx));
      const data = view.subarray(idx + 1);

      wsOutputCount++;
      cb?.onPaneOutput?.(paneId, data);
      return;
    }

    if (typeof event.data !== 'string') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    const msgSessionId = msg.sessionId as string | undefined;

    switch (msg.type) {
      case 'ready': {
        wsReady = true;
        // Subscribe to current session
        if (currentSession) {
          subscribeToSession(currentSession);
        }
        break;
      }
      case 'subscribed': {
        if (msgSessionId === currentSession) {
          cb?.setIsConnected?.(true);
          cb?.onConnect?.();
        }
        break;
      }
      case 'unsubscribed':
        break;
      case 'sessions-updated': {
        // Dispatch to useSessions via CustomEvent
        window.dispatchEvent(new CustomEvent('cchub-sessions-push', {
          detail: msg.sessions,
        }));
        break;
      }
      case 'output': {
        if (msgSessionId !== currentSession) return;
        wsOutputCount++;
        const bytes = base64ToUint8Array(msg.data as string);
        cb?.onPaneOutput?.(msg.paneId as string, bytes);
        break;
      }
      case 'layout': {
        if (msgSessionId !== currentSession) return;
        cb?.onLayoutChange?.(msg.layout as TmuxLayoutNode);
        break;
      }
      case 'initial-content': {
        if (msgSessionId !== currentSession) return;
        const bytes = base64ToUint8Array(msg.data as string);
        cb?.onInitialContent?.(msg.paneId as string, bytes);
        break;
      }
      case 'pong': {
        const rtt = Date.now() - (msg.timestamp as number);
        reportWsLatency(rtt);
        break;
      }
      case 'error': {
        if (msgSessionId && msgSessionId !== currentSession) return;
        cb?.onError?.(msg.message as string, msg.paneId as string | undefined);
        break;
      }
      case 'new-session': {
        cb?.onNewSession?.(msg.sessionId as string, msg.sessionName as string);
        break;
      }
      case 'pane-dead': {
        if (msgSessionId !== currentSession) return;
        cb?.setDeadPanes?.((prev: Set<string>) => new Set(prev).add(msg.paneId as string));
        cb?.onPaneDead?.(msg.paneId as string);
        break;
      }
      case 'hook-event': {
        cb?.onHookEvent?.(
          msg.event as string,
          msg.cwd as string | undefined,
          msg.sessionId as string | undefined,
          msg.data as Record<string, unknown> | undefined,
          msg.message as string | undefined,
        );
        break;
      }
    }
  };

  ws.onclose = (event) => {
    console.log(`[MUX] WebSocket closed: code=${event.code} reason=${event.reason} msgs=${wsMsgCount} outputs=${wsOutputCount}`);
    if (sharedWs !== ws) return;

    sharedWs = null;
    wsReady = false;
    subscribedSession = null;
    if (sharedPingInterval) {
      clearInterval(sharedPingInterval);
      sharedPingInterval = null;
    }
    activeCallbacks?.setIsConnected?.(false);
    activeCallbacks?.onDisconnect?.();

    // Auto-reconnect (unless cleanly closed)
    if (event.code !== 1000) {
      sharedReconnectTimeout = window.setTimeout(() => {
        ensureConnection();
      }, 2000);
    }
  };

  ws.onerror = () => {
    activeCallbacks?.onError?.('WebSocket connection error');
  };
}

// Visibility-based reconnect (shared, registered once)
let visibilityListenerRegistered = false;
function registerVisibilityListener() {
  if (visibilityListenerRegistered) return;
  visibilityListenerRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!sharedWs || sharedWs.readyState === WebSocket.CLOSED || sharedWs.readyState === WebSocket.CLOSING) {
      if (sharedReconnectTimeout) {
        clearTimeout(sharedReconnectTimeout);
        sharedReconnectTimeout = null;
      }
      ensureConnection();
    }
  });
}

// =============================================================================
// React Hook — thin wrapper around the singleton
// =============================================================================

export function useMultiplexedTerminal(options: UseMultiplexedTerminalOptions): UseMultiplexedTerminalReturn {
  const { sessionId, token } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [deadPanes, setDeadPanes] = useState<Set<string>>(new Set());

  // Callback refs to avoid stale closures
  const onPaneOutputRef = useRef(options.onPaneOutput);
  const onLayoutChangeRef = useRef(options.onLayoutChange);
  const onInitialContentRef = useRef(options.onInitialContent);
  const onNewSessionRef = useRef(options.onNewSession);
  const onPaneDeadRef = useRef(options.onPaneDead);
  const onHookEventRef = useRef(options.onHookEvent);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);

  onPaneOutputRef.current = options.onPaneOutput;
  onLayoutChangeRef.current = options.onLayoutChange;
  onInitialContentRef.current = options.onInitialContent;
  onNewSessionRef.current = options.onNewSession;
  onPaneDeadRef.current = options.onPaneDead;
  onHookEventRef.current = options.onHookEvent;
  onConnectRef.current = options.onConnect;
  onDisconnectRef.current = options.onDisconnect;
  onErrorRef.current = options.onError;

  // Register this hook instance as the active callback target
  useEffect(() => {
    activeCallbacks = {
      onPaneOutput: (p, d) => onPaneOutputRef.current?.(p, d),
      onLayoutChange: (l) => onLayoutChangeRef.current?.(l),
      onInitialContent: (p, d) => onInitialContentRef.current?.(p, d),
      onNewSession: (s, n) => onNewSessionRef.current?.(s, n),
      onPaneDead: (p) => onPaneDeadRef.current?.(p),
      onHookEvent: (e, c, s, d, m) => onHookEventRef.current?.(e, c, s, d, m),
      onConnect: () => onConnectRef.current?.(),
      onDisconnect: () => onDisconnectRef.current?.(),
      onError: (e, p) => onErrorRef.current?.(e, p),
      setIsConnected,
      setDeadPanes,
      sessionId,
      deadPanes,
    };
  }); // Run every render to keep sessionId/deadPanes current

  // On sessionId change: switch subscription without reconnecting WS
  useEffect(() => {
    if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
      subscribeToSession(sessionId);
    }
  }, [sessionId]);

  const connect = useCallback(() => {
    registerVisibilityListener();
    ensureConnection(token);
    // If WS is already open and ready, subscribe immediately
    if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
      subscribeToSession(sessionId);
    }
  }, [sessionId, token]);

  const disconnect = useCallback(() => {
    // Don't close the shared WS — just unsubscribe
    if (subscribedSession) {
      sendRaw({ type: 'unsubscribe', sessionId: subscribedSession });
      subscribedSession = null;
    }
    setIsConnected(false);
  }, []);

  const sendInput = useCallback((paneId: string, data: string) => {
    const bytes = new TextEncoder().encode(data);
    const base64 = uint8ArrayToBase64(bytes);
    sendSessionMessage({ type: 'input', paneId, data: base64 });
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    sendSessionMessage({ type: 'resize', cols, rows });
  }, []);

  const splitPane = useCallback((paneId: string, direction: 'h' | 'v') => {
    sendSessionMessage({ type: 'split', paneId, direction });
  }, []);

  const closePane = useCallback((paneId: string) => {
    sendSessionMessage({ type: 'close-pane', paneId });
  }, []);

  const resizePane = useCallback((paneId: string, cols: number, rows: number) => {
    sendSessionMessage({ type: 'resize-pane', paneId, cols, rows });
  }, []);

  const selectPane = useCallback((paneId: string) => {
    sendSessionMessage({ type: 'select-pane', paneId });
  }, []);

  const scrollPane = useCallback((paneId: string, lines: number) => {
    sendSessionMessage({ type: 'scroll', paneId, lines });
  }, []);

  const adjustPane = useCallback((paneId: string, direction: 'L' | 'R' | 'U' | 'D', amount: number) => {
    sendSessionMessage({ type: 'adjust-pane', paneId, direction, amount });
  }, []);

  const equalizePanes = useCallback((direction: 'horizontal' | 'vertical') => {
    sendSessionMessage({ type: 'equalize-panes', direction });
  }, []);

  const sendClientInfo = useCallback((deviceType: 'mobile' | 'tablet' | 'desktop') => {
    sendSessionMessage({ type: 'client-info', deviceType });
  }, []);

  const requestContent = useCallback((paneId: string) => {
    sendSessionMessage({ type: 'request-content', paneId });
  }, []);

  const zoomPane = useCallback((paneId: string) => {
    sendSessionMessage({ type: 'zoom-pane', paneId });
  }, []);

  const respawnPane = useCallback((paneId: string) => {
    setDeadPanes(prev => {
      const next = new Set(prev);
      next.delete(paneId);
      return next;
    });
    if (sharedWs?.readyState === WebSocket.OPEN) {
      sendSessionMessage({ type: 'respawn-pane', paneId });
    } else {
      const apiBase = import.meta.env.VITE_API_URL || '';
      fetch(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/panes/respawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paneId }),
      }).then(() => {
        setTimeout(() => ensureConnection(), 500);
      }).catch(() => {
        setTimeout(() => ensureConnection(), 500);
      });
    }
  }, [sessionId]);

  return {
    isConnected,
    connect,
    disconnect,
    sendInput,
    resize,
    splitPane,
    closePane,
    resizePane,
    selectPane,
    scrollPane,
    adjustPane,
    equalizePanes,
    sendClientInfo,
    requestContent,
    zoomPane,
    respawnPane,
    deadPanes,
  };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
