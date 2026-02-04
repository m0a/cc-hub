import { useState, useCallback, useRef, useEffect } from 'react';

interface UseTerminalOptions {
  sessionId: string;
  token?: string | null;
  onData?: (data: Uint8Array) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
}

interface UseTerminalReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  send: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
}

// Use same origin WebSocket (works with Vite proxy)
const getWsBase = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

// Get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('cc-hub-token');
};

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { sessionId, token } = options;
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Use refs for callbacks to avoid re-creating connect function
  const onDataRef = useRef(options.onData);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);
  const tokenRef = useRef(token);

  // Keep refs updated without triggering re-renders
  onDataRef.current = options.onData;
  onConnectRef.current = options.onConnect;
  onDisconnectRef.current = options.onDisconnect;
  onErrorRef.current = options.onError;
  tokenRef.current = token;

  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Build WebSocket URL with token (from prop or localStorage)
    let wsUrl = `${getWsBase()}/ws/terminal/${encodeURIComponent(sessionId)}`;
    const authToken = tokenRef.current || getAuthToken();
    if (authToken) {
      wsUrl += `?token=${encodeURIComponent(authToken)}`;
    }
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      onConnectRef.current?.();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        onDataRef.current?.(new Uint8Array(event.data));
      } else if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'error') {
            onErrorRef.current?.(message.message);
          }
        } catch {
          // Not JSON, ignore
        }
      }
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      wsRef.current = null;
      onDisconnectRef.current?.();

      // Auto-reconnect after 2 seconds if not intentionally closed
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

  const send = useCallback((data: string | Uint8Array) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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
    send,
    resize,
  };
}
