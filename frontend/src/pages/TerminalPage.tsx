import { useState, useCallback, useRef } from 'react';
import { TerminalComponent } from '../components/Terminal';

interface TerminalPageProps {
  sessionId: string;
  onBackToList: () => void;
}

export function TerminalPage({ sessionId, onBackToList }: TerminalPageProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendRef = useRef<((data: string) => void) | null>(null);

  const handleConnect = useCallback(() => {
    setIsConnected(true);
    setError(null);
  }, []);

  const handleDisconnect = useCallback(() => {
    setIsConnected(false);
    sendRef.current = null;
  }, []);

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

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToList}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors"
          >
            &larr; 戻る
          </button>
          <h1 className="text-lg font-bold text-white">CC Hub</h1>
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
            onClick={() => window.location.reload()}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors"
          >
            Reload
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/50 px-4 py-2 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Terminal */}
      <main className="flex-1 relative overflow-hidden">
        <TerminalComponent
          sessionId={sessionId}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onError={handleError}
          onReady={handleReady}
        />
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 px-4 py-1 text-xs text-gray-500 shrink-0">
        Session: {sessionId}
      </footer>
    </div>
  );
}
