import { useRef, useEffect, useState, useCallback } from 'react';

const getWsBase = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

const getAuthToken = (): string | null => {
  return localStorage.getItem('cc-hub-token');
};

export interface ScreenShareState {
  activeSessionId: string | null;
  activeSessionName: string | null;
  currentView: 'terminal' | 'sessions' | 'files' | 'conversation' | 'dashboard';
  deviceType: 'mobile' | 'tablet' | 'desktop';
  inputText?: string;
}

export function useScreenShare(active: boolean, state?: ScreenShareState) {
  const wsRef = useRef<WebSocket | null>(null);
  const [wsReady, setWsReady] = useState(false);

  // Connect/disconnect WS
  useEffect(() => {
    if (!active) {
      if (wsRef.current) { wsRef.current.close(1000); wsRef.current = null; }
      setWsReady(false);
      return;
    }

    let wsUrl = `${getWsBase()}/ws/screen-share`;
    const authToken = getAuthToken();
    if (authToken) {
      wsUrl += `?token=${encodeURIComponent(authToken)}`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[ScreenShare] WS connected');
      setWsReady(true);
    };

    ws.onclose = () => {
      console.log('[ScreenShare] WS disconnected');
      setWsReady(false);
    };

    return () => {
      if (wsRef.current) { wsRef.current.close(1000); wsRef.current = null; }
      setWsReady(false);
    };
  }, [active]);

  // Send state changes when WS is ready or state changes
  useEffect(() => {
    const ws = wsRef.current;
    if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN || !state) return;
    ws.send(JSON.stringify({ type: 'screen-state', ...state }));
  }, [wsReady, state?.activeSessionId, state?.currentView, state?.activeSessionName, state?.inputText]);

  const forwardToViewer = useCallback((msg: string | ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }, []);

  return { forwardToViewer };
}
