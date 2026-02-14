import { useState, useRef, useEffect, forwardRef, type ReactNode } from 'react';
import { TerminalComponent, type TerminalRef, type ControlModeConfig } from '../components/Terminal';
import { useControlTerminal } from '../hooks/useControlTerminal';
import type { SessionState, SessionTheme, TmuxLayoutNode } from '../../../shared/types';

interface TerminalPageProps {
  sessionId: string;
  token?: string | null;
  onStateChange?: (state: SessionState) => void;
  onNewSession?: (sessionId: string, sessionName: string) => void;
  overlayContent?: ReactNode;
  onOverlayTap?: () => void;
  showOverlay?: boolean;
  theme?: SessionTheme;
}

export const TerminalPage = forwardRef<TerminalRef, TerminalPageProps>(function TerminalPage({
  sessionId,
  token,
  onStateChange,
  onNewSession,
  overlayContent,
  onOverlayTap,
  showOverlay,
  theme,
}, ref) {
  const [error, setError] = useState<string | null>(null);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);

  // Per-pane output callbacks
  const paneCallbacksRef = useRef<Map<string, Set<(data: Uint8Array) => void>>>(new Map());
  // Buffer for initial content arriving before Terminal mounts
  const initialContentBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());

  const controlTerminal = useControlTerminal({
    sessionId,
    token,
    onPaneOutput: (paneId, data) => {
      const callbacks = paneCallbacksRef.current.get(paneId);
      if (callbacks) {
        for (const cb of callbacks) {
          cb(data);
        }
      }
    },
    onLayoutChange: (layout: TmuxLayoutNode) => {
      // For mobile, we only display a single pane.
      // Extract the first leaf pane ID from the layout.
      const firstLeaf = findFirstLeaf(layout);
      if (firstLeaf && firstLeaf.paneId !== activePaneId) {
        setActivePaneId(firstLeaf.paneId);
      }
    },
    onInitialContent: (paneId, data) => {
      const callbacks = paneCallbacksRef.current.get(paneId);
      if (callbacks && callbacks.size > 0) {
        for (const cb of callbacks) {
          cb(data);
        }
      } else {
        // Buffer for replay when Terminal component mounts
        if (!initialContentBufferRef.current.has(paneId)) {
          initialContentBufferRef.current.set(paneId, []);
        }
        initialContentBufferRef.current.get(paneId)!.push(data);
      }
    },
    onNewSession: onNewSession,
    onConnect: () => {
      setError(null);
      onStateChange?.('idle');
      // Send client-info to enable mobile pane separation
      controlTerminal.sendClientInfo('mobile');
    },
    onDisconnect: () => {
      onStateChange?.('disconnected');
    },
    onError: (err) => {
      setError(err);
    },
  });

  // Connect on mount
  useEffect(() => {
    controlTerminal.connect();
    return () => {
      controlTerminal.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Build controlMode config for Terminal
  const controlMode: ControlModeConfig | undefined = activePaneId ? {
    paneId: activePaneId,
    sendInput: (data: string) => {
      controlTerminal.sendInput(activePaneId, data);
    },
    registerOnData: (callback: (data: Uint8Array) => void) => {
      if (!paneCallbacksRef.current.has(activePaneId)) {
        paneCallbacksRef.current.set(activePaneId, new Set());
      }
      paneCallbacksRef.current.get(activePaneId)!.add(callback);

      // Replay buffered initial content
      const buffered = initialContentBufferRef.current.get(activePaneId);
      if (buffered && buffered.length > 0) {
        for (const chunk of buffered) {
          callback(chunk);
        }
        initialContentBufferRef.current.delete(activePaneId);
      }

      return () => {
        paneCallbacksRef.current.get(activePaneId)?.delete(callback);
      };
    },
    isConnected: controlTerminal.isConnected,
    onResize: (cols: number, rows: number) => {
      controlTerminal.resize(cols, rows);
    },
  } : undefined;

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
          ref={ref}
          sessionId={sessionId}
          onError={(err) => setError(err)}
          overlayContent={overlayContent}
          onOverlayTap={onOverlayTap}
          showOverlay={showOverlay}
          theme={theme}
          controlMode={controlMode}
        />
      </main>
    </div>
  );
});

// Extract the first leaf pane from a tmux layout tree.
// Returns paneId in "%N" format and the pane dimensions.
function findFirstLeaf(node: TmuxLayoutNode): { paneId: string; width: number; height: number } | null {
  if (node.type === 'leaf' && node.paneId !== undefined) {
    return { paneId: `%${node.paneId}`, width: node.width, height: node.height };
  }
  if (node.children) {
    for (const child of node.children) {
      const result = findFirstLeaf(child);
      if (result) return result;
    }
  }
  return null;
}
