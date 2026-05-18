import { useState, useRef, useEffect, useCallback, forwardRef, type ReactNode } from 'react';
import { TerminalComponent, type TerminalRef, type ControlModeConfig } from '../components/Terminal';
import { useMultiplexedTerminal, type PaneRenderEvent } from '../hooks/useMultiplexedTerminal';
import type { SessionState, SessionTheme, TmuxLayoutNode } from '../../../shared/types';
import { fireHookNotification } from '../utils/hookNotification';

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
  /** When set, replaces the xterm area while keeping the InputBar visible below.
   *  Always rendered (when truthy) so React state/subscriptions persist; visibility
   *  is toggled via `mainOverlayVisible`. */
  mainOverlay?: ReactNode;
  /** Whether the mainOverlay is currently shown. Defaults to `!!mainOverlay`. */
  mainOverlayVisible?: boolean;
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
  mainOverlay,
  mainOverlayVisible,
}, ref) {
  const [error, setError] = useState<string | null>(null);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [allPanes, setAllPanes] = useState<PaneLeafInfo[]>([]);

  // Derive effective active pane: external takes priority
  const effectiveActivePaneId = externalActivePaneId ?? activePaneId;

  // Per-pane render callbacks
  const paneCallbacksRef = useRef<Map<string, Set<(event: PaneRenderEvent) => void>>>(new Map());
  // Last snapshot per pane, replayed when a Terminal mounts late.
  const lastSnapshotRef = useRef<Map<string, PaneRenderEvent>>(new Map());

  const onPanesChangeRef = useRef(onPanesChange);
  onPanesChangeRef.current = onPanesChange;

  // Track previous external pane ID for detecting actual switches
  const prevExternalPaneIdRef = useRef<string | null | undefined>(undefined);

  // Zoom state: when zoomed, layout shows only 1 pane but we preserve the full list
  const isZoomedRef = useRef(false);
  const cachedPanesRef = useRef<PaneLeafInfo[]>([]);
  // Tracks whether initial zoom has been done (for multi-pane sessions)
  const initialZoomDoneRef = useRef(false);

  const controlTerminal = useMultiplexedTerminal({
    sessionId,
    token,
    onPaneRender: (paneId, event) => {
      if (event.type === 'snapshot') {
        lastSnapshotRef.current.set(paneId, event);
      }
      const callbacks = paneCallbacksRef.current.get(paneId);
      if (callbacks) {
        for (const cb of callbacks) {
          cb(event);
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
    onNewSession: onNewSession,
    onConnect: () => {
      setError(null);
      onStateChange?.('idle');
      controlTerminal.sendClientInfo('mobile');
      for (const pane of cachedPanesRef.current) {
        controlTerminal.requestSnapshot(pane.paneId);
      }
    },
    onHookEvent: fireHookNotification,
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
      if (!isZoomedRef.current || isActualSwitch) {
        console.log(`[TP] zoom-pane ${externalActivePaneId} (switch=${isActualSwitch}, wasZoomed=${isZoomedRef.current})`);
        isZoomedRef.current = true;
        initialZoomDoneRef.current = true;
        controlTerminal.zoomPane(externalActivePaneId);
      }
    } else {
      controlTerminal.selectPane(externalActivePaneId);
    }

    if (isActualSwitch) {
      lastSnapshotRef.current.delete(externalActivePaneId);
    }
  }, [externalActivePaneId, allPanes, controlTerminal]);

  useEffect(() => {
    if (externalActivePaneId || initialZoomDoneRef.current) return;
    if (activePaneId && allPanes.length > 1) {
      console.log(`[TP] auto-zoom ${activePaneId} (${allPanes.length} panes)`);
      initialZoomDoneRef.current = true;
      isZoomedRef.current = true;
      controlTerminal.zoomPane(activePaneId);
    }
  }, [activePaneId, allPanes, externalActivePaneId, controlTerminal]);

  useEffect(() => {
    prevExternalPaneIdRef.current = undefined;
    lastSnapshotRef.current.clear();
    initialZoomDoneRef.current = false;
    isZoomedRef.current = false;
    cachedPanesRef.current = [];
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
    registerOnRender: (callback: (event: PaneRenderEvent) => void) => {
      if (!paneCallbacksRef.current.has(currentPaneId)) {
        paneCallbacksRef.current.set(currentPaneId, new Set());
      }
      paneCallbacksRef.current.get(currentPaneId)!.add(callback);

      const last = lastSnapshotRef.current.get(currentPaneId);
      if (last) callback(last);

      if (controlTerminal.isConnected) {
        controlTerminal.requestSnapshot(currentPaneId);
      }

      return () => {
        paneCallbacksRef.current.get(currentPaneId)?.delete(callback);
      };
    },
    isConnected: controlTerminal.isConnected,
    onResize: (cols: number, rows: number) => {
      controlTerminal.resize(cols, rows);
    },
    forceResize: (cols: number, rows: number) => {
      controlTerminal.resize(cols, rows);
    },
    requestSnapshot: () => {
      controlTerminal.requestSnapshot(currentPaneId);
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

      {/* Terminal - full screen. mainOverlay (e.g. ChatView) replaces the
          xterm area while the InputBar inside TerminalComponent remains visible. */}
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
          hideTerminalArea={!!mainOverlay && (mainOverlayVisible ?? true)}
          terminalAreaOverlay={mainOverlay}
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
