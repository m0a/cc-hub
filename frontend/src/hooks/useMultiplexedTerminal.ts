import { useState, useCallback, useRef, useEffect } from 'react';
import { reportWsLatency } from '../services/latency-store';
import type { DiffOp, PaneSnapshot, TmuxLayoutNode } from '../../../shared/types';

export type PaneRenderEvent =
  | { type: 'snapshot'; snapshot: PaneSnapshot }
  | { type: 'diff'; base: number; seq: number; ops: DiffOp[] };

interface UseMultiplexedTerminalOptions {
  sessionId: string;
  token?: string | null;
  onPaneRender?: (paneId: string, event: PaneRenderEvent) => void;
  onLayoutChange?: (layout: TmuxLayoutNode) => void;
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
  requestSnapshot: (paneId: string) => void;
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
let wsReady = false;
// Channel C: when the server (CCHUB_SELF_VERIFY=1) accepts our subscription,
// it includes selfVerifyEnabled=true so we know to start streaming debug-dump
// messages. Stays false on production builds.
let selfVerifyEnabled = false;

// Conversation subscriptions (multiple sessions can be subscribed at once)
const subscribedConversations = new Set<string>();
const pendingConversationSubs = new Set<string>();
const pendingConversationUnsubs = new Set<string>();

function flushConversationPending() {
  if (!sharedWs || sharedWs.readyState !== WebSocket.OPEN || !wsReady) return;
  for (const sid of pendingConversationUnsubs) {
    sharedWs.send(JSON.stringify({ type: 'unsubscribe-conversation', sessionId: sid }));
    subscribedConversations.delete(sid);
  }
  pendingConversationUnsubs.clear();
  for (const sid of pendingConversationSubs) {
    sharedWs.send(JSON.stringify({ type: 'subscribe-conversation', sessionId: sid }));
    subscribedConversations.add(sid);
  }
  pendingConversationSubs.clear();
}

type MuxCallbacks = {
  onPaneRender?: (paneId: string, event: PaneRenderEvent) => void;
  onLayoutChange?: (layout: TmuxLayoutNode) => void;
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

function subscribeToSession(sessionId: string, force = false) {
  if (subscribedSession === sessionId && !force) return;

  if (subscribedSession && subscribedSession !== sessionId) {
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

  // Track bytes per second for throughput display
  let wsBytesThisSec = 0;
  const bytesTimer = setInterval(() => {
    (window as any).__cchub_ws_bytes_per_sec = wsBytesThisSec;
    wsBytesThisSec = 0;
  }, 1000);

  // Plain JSON transport only — no binary frames in the state-sync protocol.
  ws.onmessage = (event) => {
    wsMsgCount++;
    if (typeof event.data === 'string') {
      wsBytesThisSec += event.data.length;
    }

    if (typeof event.data !== 'string') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    const cb = activeCallbacks;
    const currentSession = cb?.sessionId;
    const msgSessionId = msg.sessionId as string | undefined;

    switch (msg.type) {
      case 'ready': {
        wsReady = true;
        if (currentSession) {
          subscribeToSession(currentSession, true);
        }
        for (const sid of subscribedConversations) {
          pendingConversationSubs.add(sid);
        }
        flushConversationPending();
        break;
      }
      case 'subscribed': {
        if (msg.selfVerifyEnabled === true && !selfVerifyEnabled) {
          selfVerifyEnabled = true;
          console.log('[MUX] self-verify enabled by server');
        }
        if (msgSessionId === currentSession) {
          cb?.setIsConnected?.(true);
          cb?.onConnect?.();
        }
        break;
      }
      case 'unsubscribed':
        break;
      case 'sessions-updated': {
        window.dispatchEvent(new CustomEvent('cchub-sessions-push', {
          detail: msg.sessions,
        }));
        break;
      }
      case 'state-snapshot': {
        if (msgSessionId !== currentSession) return;
        const snapshot = msg.snapshot as PaneSnapshot;
        cb?.onPaneRender?.(snapshot.paneId, { type: 'snapshot', snapshot });
        break;
      }
      case 'state-diff': {
        if (msgSessionId !== currentSession) return;
        const paneId = msg.paneId as string;
        const base = msg.base as number;
        const seq = msg.seq as number;
        const ops = msg.ops as DiffOp[];
        cb?.onPaneRender?.(paneId, { type: 'diff', base, seq, ops });
        break;
      }
      case 'layout': {
        if (msgSessionId !== currentSession) return;
        cb?.onLayoutChange?.(msg.layout as TmuxLayoutNode);
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
      case 'conversation-subscribed':
      case 'conversation-unsubscribed':
      case 'initial-conversation':
      case 'conversation-update': {
        window.dispatchEvent(new CustomEvent('cchub-conversation', { detail: msg }));
        break;
      }
    }
  };

  ws.onclose = (event) => {
    console.log(`[MUX] WebSocket closed: code=${event.code} reason=${event.reason} msgs=${wsMsgCount}`);
    clearInterval(bytesTimer);
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
// Conversation stream API
// =============================================================================

export function subscribeConversation(sessionId: string, token?: string | null) {
  pendingConversationUnsubs.delete(sessionId);
  if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
    if (!subscribedConversations.has(sessionId)) {
      sharedWs.send(JSON.stringify({ type: 'subscribe-conversation', sessionId }));
      subscribedConversations.add(sessionId);
    } else {
      sharedWs.send(JSON.stringify({ type: 'subscribe-conversation', sessionId }));
    }
  } else {
    pendingConversationSubs.add(sessionId);
    ensureConnection(token);
  }
}

export function unsubscribeConversation(sessionId: string) {
  pendingConversationSubs.delete(sessionId);
  subscribedConversations.delete(sessionId);
  if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
    sharedWs.send(JSON.stringify({ type: 'unsubscribe-conversation', sessionId }));
  } else {
    pendingConversationUnsubs.add(sessionId);
  }
}

/**
 * Send terminal input to a specific pane on a session, regardless of which session
 * the active terminal hook is subscribed to. Used by ChatView's composer.
 */
export function sendTerminalInput(sessionId: string, paneId: string, data: string): boolean {
  if (sharedWs?.readyState !== WebSocket.OPEN || !wsReady) return false;
  const bytes = new TextEncoder().encode(data);
  const base64 = uint8ArrayToBase64(bytes);
  sharedWs.send(JSON.stringify({ type: 'input', sessionId, paneId, data: base64 }));
  dispatchInputEcho(sessionId, paneId, data);
  return true;
}

export function isSelfVerifyEnabled(): boolean {
  return selfVerifyEnabled;
}

/**
 * Channel C: send a client-side xterm.js snapshot for server-side drift
 * detection. No-op unless the server has self-verify enabled (so production
 * builds incur zero overhead). The caller is responsible for assembling
 * `lines` from the xterm buffer.
 */
export function sendDebugDump(
  sessionId: string,
  paneId: string,
  lines: string[],
  cursor: { x: number; y: number },
  trigger: 'resize-done' | 'reconnect-done' | 'output-idle' | 'periodic' | 'user',
): boolean {
  if (!selfVerifyEnabled) return false;
  if (sharedWs?.readyState !== WebSocket.OPEN || !wsReady) return false;
  sharedWs.send(JSON.stringify({
    type: 'debug-dump',
    sessionId,
    paneId,
    lines,
    cursor,
    trigger,
    ts: Date.now(),
  }));
  return true;
}

export function dispatchInputEcho(sessionId: string, paneId: string, data: string) {
  window.dispatchEvent(new CustomEvent('cchub-input-echo', {
    detail: { sessionId, paneId, data },
  }));
}

// =============================================================================
// React Hook
// =============================================================================

export function useMultiplexedTerminal(options: UseMultiplexedTerminalOptions): UseMultiplexedTerminalReturn {
  const { sessionId, token } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [deadPanes, setDeadPanes] = useState<Set<string>>(new Set());

  const onPaneRenderRef = useRef(options.onPaneRender);
  const onLayoutChangeRef = useRef(options.onLayoutChange);
  const onNewSessionRef = useRef(options.onNewSession);
  const onPaneDeadRef = useRef(options.onPaneDead);
  const onHookEventRef = useRef(options.onHookEvent);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);

  onPaneRenderRef.current = options.onPaneRender;
  onLayoutChangeRef.current = options.onLayoutChange;
  onNewSessionRef.current = options.onNewSession;
  onPaneDeadRef.current = options.onPaneDead;
  onHookEventRef.current = options.onHookEvent;
  onConnectRef.current = options.onConnect;
  onDisconnectRef.current = options.onDisconnect;
  onErrorRef.current = options.onError;

  useEffect(() => {
    activeCallbacks = {
      onPaneRender: (p, e) => onPaneRenderRef.current?.(p, e),
      onLayoutChange: (l) => onLayoutChangeRef.current?.(l),
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
  });

  useEffect(() => {
    if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
      subscribeToSession(sessionId);
    }
  }, [sessionId]);

  const connect = useCallback(() => {
    registerVisibilityListener();
    ensureConnection(token);
    if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
      subscribeToSession(sessionId);
    }
  }, [sessionId, token]);

  const disconnect = useCallback(() => {
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
    if (subscribedSession) dispatchInputEcho(subscribedSession, paneId, data);
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

  const requestSnapshot = useCallback((paneId: string) => {
    sendSessionMessage({ type: 'request-snapshot', paneId });
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
    requestSnapshot,
    zoomPane,
    respawnPane,
    deadPanes,
  };
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
