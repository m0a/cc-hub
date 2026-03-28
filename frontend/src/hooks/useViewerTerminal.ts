import { useState, useCallback, useRef, useEffect } from 'react';
import type { TmuxLayoutNode, ControlServerMessage } from '../../../shared/types';

interface UseViewerTerminalOptions {
  sessionId: string;
  viewToken: string;
  onPaneOutput?: (paneId: string, data: Uint8Array) => void;
  onLayoutChange?: (layout: TmuxLayoutNode) => void;
  onInitialContent?: (paneId: string, data: Uint8Array) => void;
  onError?: (error: string) => void;
}

interface UseViewerTerminalReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  resize: (cols: number, rows: number) => void;
  scrollPane: (paneId: string, lines: number) => void;
  requestContent: (paneId: string) => void;
}

const getWsBase = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

export function useViewerTerminal(options: UseViewerTerminalOptions): UseViewerTerminalReturn {
  const { sessionId, viewToken } = options;
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);

  const onPaneOutputRef = useRef(options.onPaneOutput);
  const onLayoutChangeRef = useRef(options.onLayoutChange);
  const onInitialContentRef = useRef(options.onInitialContent);
  const onErrorRef = useRef(options.onError);

  onPaneOutputRef.current = options.onPaneOutput;
  onLayoutChangeRef.current = options.onLayoutChange;
  onInitialContentRef.current = options.onInitialContent;
  onErrorRef.current = options.onError;

  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }

    const ws = new WebSocket(`${getWsBase()}/ws/view/${encodeURIComponent(viewToken)}`);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      // Binary frame: [0x01][paneId\0][raw data]
      if (event.data instanceof ArrayBuffer) {
        const view = new Uint8Array(event.data);
        if (view.length < 3 || view[0] !== 0x01) return;
        let nullIdx = 1;
        while (nullIdx < view.length && view[nullIdx] !== 0) nullIdx++;
        if (nullIdx >= view.length) return;
        const paneId = new TextDecoder().decode(view.subarray(1, nullIdx));
        onPaneOutputRef.current?.(paneId, view.subarray(nullIdx + 1));
        return;
      }

      if (typeof event.data !== 'string') return;
      let msg: ControlServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case 'ready':
          setIsConnected(true);
          break;
        case 'layout':
          onLayoutChangeRef.current?.(msg.layout);
          break;
        case 'initial-content': {
          const bytes = base64ToUint8Array(msg.data);
          onInitialContentRef.current?.(msg.paneId, bytes);
          break;
        }
        case 'output': {
          const bytes = base64ToUint8Array(msg.data);
          onPaneOutputRef.current?.(msg.paneId, bytes);
          break;
        }
        case 'error':
          onErrorRef.current?.(msg.message);
          break;
      }
    };

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      setIsConnected(false);
      wsRef.current = null;
      if (event.code !== 1000) {
        reconnectRef.current = window.setTimeout(() => connect(), 2000);
      }
    };

    ws.onerror = () => onErrorRef.current?.('WebSocket connection error');
  }, [sessionId, viewToken]);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    if (wsRef.current) { wsRef.current.close(1000); wsRef.current = null; setIsConnected(false); }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    sendMessage({ type: 'resize', cols, rows });
  }, [sendMessage]);

  const scrollPane = useCallback((paneId: string, lines: number) => {
    sendMessage({ type: 'scroll', paneId, lines });
  }, [sendMessage]);

  const requestContent = useCallback((paneId: string) => {
    sendMessage({ type: 'request-content', paneId });
  }, [sendMessage]);

  useEffect(() => {
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) { wsRef.current.close(1000); wsRef.current = null; }
    };
  }, []);

  return { isConnected, connect, disconnect, resize, scrollPane, requestContent };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
