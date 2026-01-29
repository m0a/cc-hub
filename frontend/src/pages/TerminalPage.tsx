import { useState, useCallback, useRef, useEffect } from 'react';
import { TerminalComponent } from '../components/Terminal';
import type { SessionState } from '../../../shared/types';

interface TerminalPageProps {
  sessionId: string;
  onStateChange?: (state: SessionState) => void;
}

export function TerminalPage({ sessionId, onStateChange }: TerminalPageProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sendRef = useRef<((data: string) => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleConnect = useCallback(() => {
    setIsConnected(true);
    setError(null);
    // Set state to idle when connected
    onStateChange?.('idle');
  }, [onStateChange]);

  const handleDisconnect = useCallback(() => {
    setIsConnected(false);
    sendRef.current = null;
    // Set state to disconnected
    onStateChange?.('disconnected');
  }, [onStateChange]);

  const handleError = useCallback((err: string) => {
    setError(err);
  }, []);

  const handleReady = useCallback((send: (data: string) => void) => {
    sendRef.current = send;
  }, []);

  const handleClear = useCallback(() => {
    if (sendRef.current) {
      sendRef.current('clear\r');
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-gray-900 min-h-0">
      {/* Header */}
      <header className={`bg-gray-800 border-b border-gray-700 px-4 py-2 flex justify-between items-center shrink-0 ${isFullscreen ? 'hidden' : ''}`}>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{sessionId}</span>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              isConnected
                ? 'bg-green-500/20 text-green-400'
                : 'bg-yellow-500/20 text-yellow-400'
            }`}
          >
            {isConnected ? 'Connected' : 'Connecting...'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            disabled={!isConnected}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm text-white transition-colors"
          >
            Clear
          </button>
          <button
            onClick={toggleFullscreen}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? '⛶' : '⛶'}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors"
          >
            Reload
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/50 px-4 py-2 text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Terminal */}
      <main className="flex-1 relative overflow-hidden min-h-0">
        <TerminalComponent
          sessionId={sessionId}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onError={handleError}
          onReady={handleReady}
        />

        {/* Fullscreen exit button (shown only in fullscreen mode) */}
        {isFullscreen && (
          <button
            onClick={toggleFullscreen}
            className="absolute top-2 right-2 px-3 py-1 bg-gray-800/80 hover:bg-gray-700 rounded text-sm text-white transition-colors z-20"
            title="Exit Fullscreen (ESC)"
          >
            Exit Fullscreen
          </button>
        )}
      </main>
    </div>
  );
}
