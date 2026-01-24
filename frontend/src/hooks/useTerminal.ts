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
  const { sessionId, onData, onConnect, onDisconnect, onError } = options;
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = `${WS_BASE}/ws/terminal/${encodeURIComponent(sessionId)}`;
    console.log('Connecting to terminal WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('Terminal WebSocket connected');
      setIsConnected(true);
      onConnect?.();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        onData?.(new Uint8Array(event.data));
      } else if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'error') {
            onError?.(message.message);
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
      onDisconnect?.();

      // Auto-reconnect after 2 seconds if not intentionally closed
      if (event.code !== 1000) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log('Attempting to reconnect...');
          connect();
        }, 2000);
      }
    };

    ws.onerror = (error) => {
      console.error('Terminal WebSocket error:', error);
      onError?.('WebSocket connection error');
    };

    wsRef.current = ws;
  }, [sessionId, onData, onConnect, onDisconnect, onError]);

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
