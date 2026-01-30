import { useState, useCallback } from 'react';
import { TerminalComponent } from '../components/Terminal';
import type { SessionState } from '../../../shared/types';

interface TerminalPageProps {
  sessionId: string;
  onStateChange?: (state: SessionState) => void;
}

export function TerminalPage({ sessionId, onStateChange }: TerminalPageProps) {
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(() => {
    setError(null);
    onStateChange?.('idle');
  }, [onStateChange]);

  const handleDisconnect = useCallback(() => {
    onStateChange?.('disconnected');
  }, [onStateChange]);

  const handleError = useCallback((err: string) => {
    setError(err);
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-gray-900 min-h-0">
      {/* Error banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/50 px-4 py-2 text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Terminal - full screen */}
      <main className="flex-1 relative overflow-hidden min-h-0">
        <TerminalComponent
          sessionId={sessionId}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onError={handleError}
        />
      </main>
    </div>
  );
}
