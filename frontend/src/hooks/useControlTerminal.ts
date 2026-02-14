import { useState, useCallback, useRef, useEffect } from 'react';
import { reportWsLatency } from '../services/latency-store';
import type { TmuxLayoutNode, ControlServerMessage } from '../../../shared/types';

interface UseControlTerminalOptions {
  sessionId: string;
  token?: string | null;
  onPaneOutput?: (paneId: string, data: Uint8Array) => void;
  onLayoutChange?: (layout: TmuxLayoutNode) => void;
  onInitialContent?: (paneId: string, data: Uint8Array) => void;
  onNewSession?: (sessionId: string, sessionName: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string, paneId?: string) => void;
}

interface UseControlTerminalReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  sendInput: (paneId: string, data: string) => void;
  resize: (cols: number, rows: number) => void;
  splitPane: (paneId: string, direction: 'h' | 'v') => void;
  closePane: (paneId: string) => void;
  resizePane: (paneId: string, cols: number, rows: number) => void;
  selectPane: (paneId: string) => void;
  sendClientInfo: (deviceType: 'mobile' | 'tablet' | 'desktop') => void;
}

// Use same origin WebSocket
const getWsBase = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

const getAuthToken = (): string | null => {
  return localStorage.getItem('cc-hub-token');
};

export function useControlTerminal(options: UseControlTerminalOptions): UseControlTerminalReturn {
  const { sessionId, token } = options;
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);

  // Use refs for callbacks to avoid re-creating connect function
  const onPaneOutputRef = useRef(options.onPaneOutput);
  const onLayoutChangeRef = useRef(options.onLayoutChange);
  const onInitialContentRef = useRef(options.onInitialContent);
  const onNewSessionRef = useRef(options.onNewSession);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);
  const tokenRef = useRef(token);

  // Keep refs updated
  onPaneOutputRef.current = options.onPaneOutput;
  onLayoutChangeRef.current = options.onLayoutChange;
  onInitialContentRef.current = options.onInitialContent;
  onNewSessionRef.current = options.onNewSession;
  onConnectRef.current = options.onConnect;
  onDisconnectRef.current = options.onDisconnect;
  onErrorRef.current = options.onError;
  tokenRef.current = token;

  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    let wsUrl = `${getWsBase()}/ws/control/${encodeURIComponent(sessionId)}`;
    const authToken = tokenRef.current || getAuthToken();
    if (authToken) {
      wsUrl += `?token=${encodeURIComponent(authToken)}`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Don't set isConnected yet - wait for 'ready' message from server.
      // The server sends 'ready' after the async open handler completes
      // (control session created, initial layout sent).

      // Start periodic ping
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, 10_000);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;

      let msg: ControlServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'output': {
          const bytes = base64ToUint8Array(msg.data);
          onPaneOutputRef.current?.(msg.paneId, bytes);
          break;
        }
        case 'layout': {
          onLayoutChangeRef.current?.(msg.layout);
          break;
        }
        case 'initial-content': {
          const bytes = base64ToUint8Array(msg.data);
          onInitialContentRef.current?.(msg.paneId, bytes);
          break;
        }
        case 'pong': {
          const rtt = Date.now() - msg.timestamp;
          reportWsLatency(rtt);
          break;
        }
        case 'error': {
          onErrorRef.current?.(msg.message, msg.paneId);
          break;
        }
        case 'ready': {
          setIsConnected(true);
          onConnectRef.current?.();
          break;
        }
        case 'new-session': {
          onNewSessionRef.current?.(msg.sessionId, msg.sessionName);
          break;
        }
      }
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      wsRef.current = null;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      onDisconnectRef.current?.();

      // Auto-reconnect
      if (event.code !== 1000) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 2000);
      }
    };

    ws.onerror = () => {
      onErrorRef.current?.('WebSocket connection error');
    };
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const sendInput = useCallback((paneId: string, data: string) => {
    // data is raw string from xterm onData, encode to base64
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

  const sendClientInfo = useCallback((deviceType: 'mobile' | 'tablet' | 'desktop') => {
    sendMessage({ type: 'client-info', deviceType });
  }, [sendMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
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
    sendClientInfo,
  };
}

// Utility: base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Utility: Uint8Array to base64
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
