import { useState, useEffect } from 'react';
import { ViewerProvider } from '../contexts/ViewerContext';
import { App } from '../App';

const getWsBase = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

export function ScreenViewerPage() {
  const [hostSessionId, setHostSessionId] = useState<string | null>(null);
  const [hostView, setHostView] = useState('terminal');
  const [hostDeviceType, setHostDeviceType] = useState<'mobile' | 'tablet' | 'desktop' | null>(null);
  const [hostOnline, setHostOnline] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(`${getWsBase()}/ws/screen-view`);

    ws.onopen = () => console.log('[ScreenViewer] Connected');

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'screen-state') {
          setHostSessionId(msg.activeSessionId);
          setHostView(msg.currentView || 'terminal');
          if (msg.deviceType) setHostDeviceType(msg.deviceType);
          setHostOnline(true);
        } else if (msg.type === 'host-disconnected') {
          setHostOnline(false);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      console.log('[ScreenViewer] Disconnected');
      setHostOnline(false);
    };

    return () => ws.close(1000);
  }, []);

  if (!hostOnline) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <p className="text-zinc-400 text-sm">Waiting for host to start sharing...</p>
      </div>
    );
  }

  return (
    <ViewerProvider value={{ isViewer: true, hostSessionId, hostView, hostDeviceType }}>
      <div style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <App />
      </div>
    </ViewerProvider>
  );
}
