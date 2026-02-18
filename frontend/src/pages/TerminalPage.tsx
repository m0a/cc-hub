import { useState, useRef, useEffect, useCallback, forwardRef, type ReactNode } from 'react';
import { TerminalComponent, type TerminalRef, type ControlModeConfig } from '../components/Terminal';
import { useControlTerminal } from '../hooks/useControlTerminal';
import type { SessionState, SessionTheme, TmuxLayoutNode } from '../../../shared/types';

interface PaneLeafInfo {
  paneId: string;
  width: number;
  height: number;
}

interface TerminalPageProps {
  sessionId: string;
  token?: string | null;
  onStateChange?: (state: SessionState) => void;
  onNewSession?: (sessionId: string, sessionName: string) => void;
  overlayContent?: ReactNode;
  onOverlayTap?: () => void;
  showOverlay?: boolean;
  theme?: SessionTheme;
  onPanesChange?: (panes: PaneLeafInfo[]) => void;
  externalActivePaneId?: string | null;
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
  onPanesChange,
  externalActivePaneId,
}, ref) {
  const [error, setError] = useState<string | null>(null);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [allPanes, setAllPanes] = useState<PaneLeafInfo[]>([]);

  // Derive effective active pane: external takes priority
  const effectiveActivePaneId = externalActivePaneId ?? activePaneId;

  // Per-pane output callbacks
  const paneCallbacksRef = useRef<Map<string, Set<(data: Uint8Array) => void>>>(new Map());
  // Buffer for initial content arriving before Terminal mounts
  const initialContentBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());
  // Track panes that have received initial-content (from automatic first-resize capture)
  const contentDeliveredRef = useRef<Set<string>>(new Set());

  const onPanesChangeRef = useRef(onPanesChange);
  onPanesChangeRef.current = onPanesChange;

  // Track previous external pane ID for detecting actual switches
  const prevExternalPaneIdRef = useRef<string | null | undefined>(undefined);

  // Zoom state: when zoomed, layout shows only 1 pane but we preserve the full list
  const isZoomedRef = useRef(false);
  const cachedPanesRef = useRef<PaneLeafInfo[]>([]);
  // Tracks whether initial zoom has been done (for multi-pane sessions)
  const initialZoomDoneRef = useRef(false);
  // Track whether we explicitly requested content (zoom, request-content, first connect).
  // When true, initial-content clears scrollback (ESC[3J). When false (reconnect),
  // scrollback is preserved to avoid jarring scroll position jumps.
  const expectingContentRef = useRef(true);

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
      // Extract all leaf panes from the layout
      const leaves = collectLeaves(layout);
      console.log(`[TP] layout-change: ${leaves.length} panes, zoomed=${isZoomedRef.current}, cached=${cachedPanesRef.current.length}`);

      if (isZoomedRef.current && leaves.length === 1 && cachedPanesRef.current.length > 1) {
        // Zoomed: layout shows only the zoomed pane.
        // Keep the cached pane list but update the zoomed pane's dimensions.
        const zoomed = leaves[0];
        const updated = cachedPanesRef.current.map(p =>
          p.paneId === zoomed.paneId ? { ...p, width: zoomed.width, height: zoomed.height } : p
        );
        cachedPanesRef.current = updated;
        setAllPanes(updated);
        onPanesChangeRef.current?.(updated);
      } else {
        // Normal: update the full pane list
        cachedPanesRef.current = leaves;
        setAllPanes(leaves);
        onPanesChangeRef.current?.(leaves);
      }

      // If no active pane set, or active pane was removed, select the first one
      setActivePaneId(prev => {
        const currentPanes = cachedPanesRef.current;
        if (!prev || !currentPanes.some(l => l.paneId === prev)) {
          return currentPanes[0]?.paneId ?? null;
        }
        return prev;
      });
    },
    onInitialContent: (paneId, data) => {
      const isExpected = expectingContentRef.current;
      console.log(`[TP] initial-content for ${paneId}: ${data.length} bytes, expected=${isExpected}`);
      // Track that we've received initial-content for this pane
      contentDeliveredRef.current.add(paneId);

      // Choose clear sequence based on whether content was explicitly requested.
      // ESC[2J = clear screen, ESC[3J = clear scrollback, ESC[H = cursor home
      let clearSeq: Uint8Array;
      if (isExpected) {
        // Explicit action (zoom, reload, first connect): full clear including scrollback
        clearSeq = new Uint8Array([0x1b, 0x5b, 0x32, 0x4a, 0x1b, 0x5b, 0x33, 0x4a, 0x1b, 0x5b, 0x48]);
        expectingContentRef.current = false;
      } else {
        // Implicit (reconnect resize): clear screen only, preserve scrollback
        // to avoid jarring scroll position jumps during brief disconnects
        clearSeq = new Uint8Array([0x1b, 0x5b, 0x32, 0x4a, 0x1b, 0x5b, 0x48]);
      }
      const combined = new Uint8Array(clearSeq.length + data.length);
      combined.set(clearSeq);
      combined.set(data, clearSeq.length);

      const callbacks = paneCallbacksRef.current.get(paneId);
      if (callbacks && callbacks.size > 0) {
        for (const cb of callbacks) {
          cb(combined);
        }
      } else {
        // Buffer for replay when Terminal component mounts
        if (!initialContentBufferRef.current.has(paneId)) {
          initialContentBufferRef.current.set(paneId, []);
        }
        initialContentBufferRef.current.get(paneId)!.push(combined);
      }
    },
    onNewSession: onNewSession,
    onConnect: () => {
      setError(null);
      onStateChange?.('idle');
      // Reset content tracking on new connection
      contentDeliveredRef.current.clear();
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

  // Expose selectPane for external pane switching
  const selectPane = useCallback((paneId: string) => {
    setActivePaneId(paneId);
    controlTerminal.selectPane(paneId);
  }, [controlTerminal]);

  // When external active pane changes, zoom the pane and re-request content
  useEffect(() => {
    if (!externalActivePaneId || !allPanes.some(p => p.paneId === externalActivePaneId)) {
      prevExternalPaneIdRef.current = externalActivePaneId ?? null;
      return;
    }

    const isActualSwitch = prevExternalPaneIdRef.current !== undefined
      && prevExternalPaneIdRef.current !== null
      && prevExternalPaneIdRef.current !== externalActivePaneId;
    prevExternalPaneIdRef.current = externalActivePaneId;

    const isMultiPane = cachedPanesRef.current.length > 1;

    if (isMultiPane) {
      // Zoom on first activation or on pane switch
      if (!isZoomedRef.current || isActualSwitch) {
        console.log(`[TP] zoom-pane ${externalActivePaneId} (switch=${isActualSwitch}, wasZoomed=${isZoomedRef.current})`);
        isZoomedRef.current = true;
        initialZoomDoneRef.current = true;
        expectingContentRef.current = true;
        controlTerminal.zoomPane(externalActivePaneId);
      }
    } else {
      controlTerminal.selectPane(externalActivePaneId);
    }

    // Clear stale buffer on pane switch.
    // The backend zoom-pane handler captures and sends initial-content,
    // so we no longer need to request content separately.
    if (isActualSwitch) {
      initialContentBufferRef.current.delete(externalActivePaneId);
      contentDeliveredRef.current.delete(externalActivePaneId);
    }
  }, [externalActivePaneId, allPanes, controlTerminal]);

  // Auto-zoom first pane when connecting to multi-pane session without external selection.
  // When externalActivePaneId is set, that effect handles zoom instead.
  useEffect(() => {
    if (externalActivePaneId || initialZoomDoneRef.current) return;
    if (activePaneId && allPanes.length > 1) {
      console.log(`[TP] auto-zoom ${activePaneId} (${allPanes.length} panes)`);
      initialZoomDoneRef.current = true;
      isZoomedRef.current = true;
      expectingContentRef.current = true;
      controlTerminal.zoomPane(activePaneId);
    }
  }, [activePaneId, allPanes, externalActivePaneId, controlTerminal]);

  // Connect on mount
  useEffect(() => {
    prevExternalPaneIdRef.current = undefined;
    contentDeliveredRef.current.clear();
    initialContentBufferRef.current.clear();
    initialZoomDoneRef.current = false;
    isZoomedRef.current = false;
    cachedPanesRef.current = [];
    expectingContentRef.current = true; // First connection expects initial-content
    controlTerminal.connect();
    return () => {
      controlTerminal.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Build controlMode config for Terminal - use effectiveActivePaneId
  const currentPaneId = effectiveActivePaneId;
  const controlMode: ControlModeConfig | undefined = currentPaneId ? {
    paneId: currentPaneId,
    sendInput: (data: string) => {
      controlTerminal.sendInput(currentPaneId, data);
    },
    registerOnData: (callback: (data: Uint8Array) => void) => {
      if (!paneCallbacksRef.current.has(currentPaneId)) {
        paneCallbacksRef.current.set(currentPaneId, new Set());
      }
      paneCallbacksRef.current.get(currentPaneId)!.add(callback);

      // Replay buffered initial content
      const buffered = initialContentBufferRef.current.get(currentPaneId);
      if (buffered && buffered.length > 0) {
        for (const chunk of buffered) {
          callback(chunk);
        }
        initialContentBufferRef.current.delete(currentPaneId);
      }

      return () => {
        paneCallbacksRef.current.get(currentPaneId)?.delete(callback);
      };
    },
    isConnected: controlTerminal.isConnected,
    onResize: (cols: number, rows: number) => {
      controlTerminal.resize(cols, rows);
    },
    requestContent: () => {
      expectingContentRef.current = true;
      controlTerminal.requestContent(currentPaneId);
    },
  } : undefined;

  // Expose selectPane via ref (for parent components)
  useEffect(() => {
    if (ref && typeof ref === 'object' && ref.current) {
      (ref.current as TerminalRef & { selectPane?: (paneId: string) => void }).selectPane = selectPane;
    }
  }, [ref, selectPane]);

  return (
    <div className="flex-1 flex flex-col bg-th-bg min-h-0 select-none">
      {/* Error banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/50 px-4 py-2 text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Terminal - full screen */}
      <main className="flex-1 relative overflow-hidden min-h-0 select-none">
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

// Extract all leaf panes from a tmux layout tree
function collectLeaves(node: TmuxLayoutNode): PaneLeafInfo[] {
  if (node.type === 'leaf' && node.paneId !== undefined) {
    return [{ paneId: `%${node.paneId}`, width: node.width, height: node.height }];
  }
  if (node.children) {
    return node.children.flatMap(child => collectLeaves(child));
  }
  return [];
}
