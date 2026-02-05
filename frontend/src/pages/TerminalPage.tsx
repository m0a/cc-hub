import { useState, useCallback, type ReactNode } from 'react';
import { TerminalComponent } from '../components/Terminal';
import type { SessionState, SessionTheme } from '../../../shared/types';

interface TerminalPageProps {
  sessionId: string;
  token?: string | null;
  onStateChange?: (state: SessionState) => void;
  overlayContent?: ReactNode;
  onOverlayTap?: () => void;
  showOverlay?: boolean;
  theme?: SessionTheme;
}

export function TerminalPage({
  sessionId,
  token,
  onStateChange,
  overlayContent,
  onOverlayTap,
  showOverlay,
  theme,
}: TerminalPageProps) {
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
          token={token}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onError={handleError}
          overlayContent={overlayContent}
          onOverlayTap={onOverlayTap}
          showOverlay={showOverlay}
          theme={theme}
        />
      </main>
    </div>
  );
}
