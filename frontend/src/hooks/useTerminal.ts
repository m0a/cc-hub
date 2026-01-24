import { useState, useCallback, useRef, useEffect } from 'react';

interface UseTerminalOptions {
  sessionId: string;
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

const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3000`;

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { sessionId } = options;
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Use refs for callbacks to avoid re-creating connect function
  const onDataRef = useRef(options.onData);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);

  // Keep refs updated
  useEffect(() => {
    onDataRef.current = options.onData;
    onConnectRef.current = options.onConnect;
    onDisconnectRef.current = options.onDisconnect;
    onErrorRef.current = options.onError;
  }, [options.onData, options.onConnect, options.onDisconnect, options.onError]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsUrl = `${WS_BASE}/ws/terminal/${encodeURIComponent(sessionId)}`;
    console.log('Connecting to terminal WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('Terminal WebSocket connected');
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
      console.log('Terminal WebSocket closed:', event.code, event.reason);
      setIsConnected(false);
      wsRef.current = null;
      onDisconnectRef.current?.();

      // Auto-reconnect after 3 seconds if not intentionally closed
      if (event.code !== 1000) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log('Attempting to reconnect...');
          connect();
        }, 3000);
      }
    };

    ws.onerror = (error) => {
      console.error('Terminal WebSocket error:', error);
      onErrorRef.current?.('WebSocket connection error');
    };

    wsRef.current = ws;
  }, [sessionId]); // Only depend on sessionId

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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connect,
    disconnect,
    send,
    resize,
  };
}
