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

const getWsBase = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

const getAuthToken = (): string | null => {
  return localStorage.getItem('cc-hub-token');
};

export function useMultiplexedTerminal(options: UseMultiplexedTerminalOptions): UseMultiplexedTerminalReturn {
  const { sessionId, token } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [deadPanes, setDeadPanes] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const deadPanesRef = useRef<Set<string>>(deadPanes);
  const subscribedSessionRef = useRef<string | null>(null);
  const sessionIdRef = useRef(sessionId);

  // Callback refs
  const onPaneOutputRef = useRef(options.onPaneOutput);
  const onLayoutChangeRef = useRef(options.onLayoutChange);
  const onInitialContentRef = useRef(options.onInitialContent);
  const onNewSessionRef = useRef(options.onNewSession);
  const onPaneDeadRef = useRef(options.onPaneDead);
  const onHookEventRef = useRef(options.onHookEvent);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);
  const tokenRef = useRef(token);

  // Keep refs updated
  onPaneOutputRef.current = options.onPaneOutput;
  onLayoutChangeRef.current = options.onLayoutChange;
  onInitialContentRef.current = options.onInitialContent;
  onNewSessionRef.current = options.onNewSession;
  onPaneDeadRef.current = options.onPaneDead;
  onHookEventRef.current = options.onHookEvent;
  deadPanesRef.current = deadPanes;
  onConnectRef.current = options.onConnect;
  onDisconnectRef.current = options.onDisconnect;
  onErrorRef.current = options.onError;
  tokenRef.current = token;
  sessionIdRef.current = sessionId;

  const sendRaw = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // Send a message scoped to the current session
  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    sendRaw({ ...msg, sessionId: sessionIdRef.current });
  }, [sendRaw]);

  const subscribeToSession = useCallback((sid: string) => {
    const prev = subscribedSessionRef.current;
    if (prev === sid) return;

    // Unsubscribe from previous
    if (prev) {
      sendRaw({ type: 'unsubscribe', sessionId: prev });
    }

    // Subscribe to new
    subscribedSessionRef.current = sid;
    setDeadPanes(new Set());
    setIsConnected(false); // Wait for 'subscribed' confirmation
    sendRaw({ type: 'subscribe', sessionId: sid });
  }, [sendRaw]);

  const connect = useCallback(() => {
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    let wsUrl = `${getWsBase()}/ws/mux`;
    const authToken = tokenRef.current || getAuthToken();
    if (authToken) {
      wsUrl += `?token=${encodeURIComponent(authToken)}`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[MUX] WebSocket opened');

      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now(), sessionId: sessionIdRef.current }));
        }
      }, 10_000);
    };

    let wsMsgCount = 0;
    let wsOutputCount = 0;

    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      wsMsgCount++;

      // Binary mux frame: [0x02][sessionId\0][paneId\0][raw data]
      if (event.data instanceof ArrayBuffer) {
        const view = new Uint8Array(event.data);
        if (view.length < 5 || view[0] !== MUX_BINARY_TYPE) return;

        // Parse sessionId
        let idx = 1;
        while (idx < view.length && view[idx] !== 0) idx++;
        if (idx >= view.length) return;
        const frameSessionId = new TextDecoder().decode(view.subarray(1, idx));
        idx++; // skip null

        // Only process if for current session
        if (frameSessionId !== sessionIdRef.current) return;

        // Parse paneId
        const paneStart = idx;
        while (idx < view.length && view[idx] !== 0) idx++;
        if (idx >= view.length) return;
        const paneId = new TextDecoder().decode(view.subarray(paneStart, idx));
        const data = view.subarray(idx + 1);

        wsOutputCount++;
        onPaneOutputRef.current?.(paneId, data);
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
          // Server ready, subscribe to initial session
          subscribeToSession(sessionIdRef.current);
          break;
        }
        case 'subscribed': {
          if (msgSessionId === sessionIdRef.current) {
            setIsConnected(true);
            onConnectRef.current?.();
          }
          break;
        }
        case 'unsubscribed': {
          // No action needed
          break;
        }
        case 'output': {
          // JSON fallback for output
          if (msgSessionId !== sessionIdRef.current) return;
          wsOutputCount++;
          const bytes = base64ToUint8Array(msg.data as string);
          onPaneOutputRef.current?.(msg.paneId as string, bytes);
          break;
        }
        case 'layout': {
          if (msgSessionId !== sessionIdRef.current) return;
          onLayoutChangeRef.current?.(msg.layout as TmuxLayoutNode);
          break;
        }
        case 'initial-content': {
          if (msgSessionId !== sessionIdRef.current) return;
          const bytes = base64ToUint8Array(msg.data as string);
          onInitialContentRef.current?.(msg.paneId as string, bytes);
          break;
        }
        case 'pong': {
          const rtt = Date.now() - (msg.timestamp as number);
          reportWsLatency(rtt);
          break;
        }
        case 'error': {
          if (msgSessionId && msgSessionId !== sessionIdRef.current) return;
          onErrorRef.current?.(msg.message as string, msg.paneId as string | undefined);
          break;
        }
        case 'new-session': {
          onNewSessionRef.current?.(msg.sessionId as string, msg.sessionName as string);
          break;
        }
        case 'pane-dead': {
          if (msgSessionId !== sessionIdRef.current) return;
          setDeadPanes(prev => new Set(prev).add(msg.paneId as string));
          onPaneDeadRef.current?.(msg.paneId as string);
          break;
        }
        case 'hook-event': {
          onHookEventRef.current?.(
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
      if (wsRef.current !== ws) return;

      setIsConnected(false);
      wsRef.current = null;
      subscribedSessionRef.current = null;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      onDisconnectRef.current?.();

      // Auto-reconnect
      if (event.code !== 1000 && deadPanesRef.current.size === 0) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 2000);
      }
    };

    ws.onerror = () => {
      onErrorRef.current?.('WebSocket connection error');
    };
  }, [subscribeToSession]);

  // When sessionId changes, switch subscription (no reconnect!)
  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && subscribedSessionRef.current !== null) {
      subscribeToSession(sessionId);
    }
  }, [sessionId, subscribeToSession]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
      subscribedSessionRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const sendInput = useCallback((paneId: string, data: string) => {
    const bytes = new TextEncoder().encode(data);
    const base64 = uint8ArrayToBase64(bytes);
    sendMessage({ type: 'input', paneId, data: base64 });
  }, [sendMessage]);

  const resize = useCallback((cols: number, rows: number) => {
    sendMessage({ type: 'resize', cols, rows });
  }, [sendMessage]);

  const splitPane = useCallback((paneId: string, direction: 'h' | 'v') => {
    sendMessage({ type: 'split', paneId, direction });
  }, [sendMessage]);

  const closePane = useCallback((paneId: string) => {
    sendMessage({ type: 'close-pane', paneId });
  }, [sendMessage]);

  const resizePane = useCallback((paneId: string, cols: number, rows: number) => {
    sendMessage({ type: 'resize-pane', paneId, cols, rows });
  }, [sendMessage]);

  const selectPane = useCallback((paneId: string) => {
    sendMessage({ type: 'select-pane', paneId });
  }, [sendMessage]);

  const scrollPane = useCallback((paneId: string, lines: number) => {
    sendMessage({ type: 'scroll', paneId, lines });
  }, [sendMessage]);

  const adjustPane = useCallback((paneId: string, direction: 'L' | 'R' | 'U' | 'D', amount: number) => {
    sendMessage({ type: 'adjust-pane', paneId, direction, amount });
  }, [sendMessage]);

  const equalizePanes = useCallback((direction: 'horizontal' | 'vertical') => {
    sendMessage({ type: 'equalize-panes', direction });
  }, [sendMessage]);

  const sendClientInfo = useCallback((deviceType: 'mobile' | 'tablet' | 'desktop') => {
    sendMessage({ type: 'client-info', deviceType });
  }, [sendMessage]);

  const requestContent = useCallback((paneId: string) => {
    sendMessage({ type: 'request-content', paneId });
  }, [sendMessage]);

  const zoomPane = useCallback((paneId: string) => {
    sendMessage({ type: 'zoom-pane', paneId });
  }, [sendMessage]);

  const respawnPane = useCallback((paneId: string) => {
    setDeadPanes(prev => {
      const next = new Set(prev);
      next.delete(paneId);
      return next;
    });
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendMessage({ type: 'respawn-pane', paneId });
    } else {
      const apiBase = import.meta.env.VITE_API_URL || '';
      fetch(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/panes/respawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paneId }),
      }).then(() => {
        setTimeout(() => connect(), 500);
      }).catch(() => {
        setTimeout(() => connect(), 500);
      });
    }
  }, [sendMessage, sessionId, connect]);

  // Reconnect on visibility change
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, []);

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
