import { useState, useEffect, useRef, useCallback } from 'react';
import { useViewerTerminal } from '../hooks/useViewerTerminal';
import { TerminalComponent, type TerminalRef } from '../components/Terminal';
import type { ControlModeConfig } from '../components/Terminal';
import type { TmuxLayoutNode } from '../../../shared/types';
import { Lock, Minus, Plus, Clock, Eye } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 14;
const VIEWER_FONT_KEY = 'cchub-viewer-font-size';

interface ViewerPageProps {
  token: string;
}

interface SessionInfo {
  sessionId: string;
  sessionName: string;
  expiresAt: string;
}

function extractPaneSizes(node: TmuxLayoutNode): Map<string, { cols: number; rows: number }> {
  const sizes = new Map<string, { cols: number; rows: number }>();
  function walk(n: TmuxLayoutNode) {
    if (n.type === 'leaf' && n.paneId !== undefined) {
      sizes.set(`%${n.paneId}`, { cols: n.width, rows: n.height });
    }
    if (n.children) n.children.forEach(walk);
  }
  walk(node);
  return sizes;
}

// Render layout tree with fixed pixel sizes from tmux cols/rows
function LayoutRenderer({
  node,
  paneCallbacks,
  initialContentBuffer,
  sessionId,
  isConnected,
  scrollPane,
  requestContent,
  terminalRefs,
  cellSize,
}: {
  node: TmuxLayoutNode;
  paneCallbacks: React.RefObject<Map<string, Set<(data: Uint8Array) => void>>>;
  initialContentBuffer: React.RefObject<Map<string, Uint8Array[]>>;
  sessionId: string;
  isConnected: boolean;
  scrollPane: (paneId: string, lines: number) => void;
  requestContent: (paneId: string) => void;
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
  cellSize: { width: number; height: number };
}) {
  if (node.type === 'leaf' && node.paneId !== undefined) {
    const paneId = `%${node.paneId}`;
    const pxWidth = Math.ceil(node.width * cellSize.width) + 2;
    const pxHeight = Math.ceil(node.height * cellSize.height) + 2;

    const controlConfig: ControlModeConfig = {
      paneId,
      sendInput: () => {},
      registerOnData: (callback: (data: Uint8Array) => void) => {
        if (!paneCallbacks.current.has(paneId)) {
          paneCallbacks.current.set(paneId, new Set());
        }
        paneCallbacks.current.get(paneId)!.add(callback);

        const buffered = initialContentBuffer.current.get(paneId);
        if (buffered) {
          for (const data of buffered) callback(data);
          initialContentBuffer.current.delete(paneId);
        }

        return () => {
          paneCallbacks.current.get(paneId)?.delete(callback);
        };
      },
      isConnected,
      onResize: () => {},
      onScroll: (lines: number) => scrollPane(paneId, lines),
      requestContent: () => requestContent(paneId),
    };

    return (
      <div style={{ width: pxWidth, minWidth: pxWidth, height: pxHeight, minHeight: pxHeight, flexShrink: 0 }}>
        <TerminalComponent
          ref={(ref) => {
            if (ref) terminalRefs.current.set(paneId, ref);
            else terminalRefs.current.delete(paneId);
          }}
          sessionId={sessionId}
          controlMode={controlConfig}
          hideKeyboard
        />
      </div>
    );
  }

  if (node.children && node.children.length > 0) {
    const isHorizontal = node.type === 'horizontal';

    return (
      <div
        style={{
          display: 'inline-flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          flexShrink: 0,
        }}
      >
        {node.children.map((child, i) => (
          <LayoutRenderer
            key={`${child.x}-${child.y}-${i}`}
            node={child}
            paneCallbacks={paneCallbacks}
            initialContentBuffer={initialContentBuffer}
            sessionId={sessionId}
            isConnected={isConnected}
            scrollPane={scrollPane}
            requestContent={requestContent}
            terminalRefs={terminalRefs}
            cellSize={cellSize}
          />
        ))}
      </div>
    );
  }

  return null;
}

function loadViewerFontSize(): number {
  const saved = localStorage.getItem(VIEWER_FONT_KEY);
  if (saved) {
    const n = Number.parseInt(saved, 10);
    if (n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) return n;
  }
  return DEFAULT_FONT_SIZE;
}

export function ViewerPage({ token }: ViewerPageProps) {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<TmuxLayoutNode | null>(null);
  const [fontSize, setFontSize] = useState(loadViewerFontSize);
  const [cellSize, setCellSize] = useState({ width: 0, height: 0 });
  const paneCallbacksRef = useRef<Map<string, Set<(data: Uint8Array) => void>>>(new Map());
  const initialContentBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());
  const terminalRefsRef = useRef<Map<string, TerminalRef | null>>(new Map());
  // Force re-mount terminals when font size changes (key increment)
  const [termKey, setTermKey] = useState(0);

  // Measure cell size from a hidden probe element
  useEffect(() => {
    const probe = document.createElement('span');
    probe.style.cssText = `
      position: absolute; visibility: hidden; white-space: pre;
      font-family: "JetBrains Mono", "M PLUS 1 Code", Menlo, Monaco, monospace;
      font-size: ${fontSize}px; line-height: 1;
    `;
    probe.textContent = 'W';
    document.body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    document.body.removeChild(probe);
    setCellSize({ width: rect.width, height: rect.height });
  }, [fontSize]);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize(prev => {
      const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, prev + delta));
      localStorage.setItem(VIEWER_FONT_KEY, String(next));
      // Also update TerminalComponent's per-session font size so it initializes correctly
      if (sessionInfo) {
        localStorage.setItem(`cchub-terminal-font-size-${sessionInfo.sessionId}`, String(next));
      }
      return next;
    });
    setTermKey(k => k + 1);
  }, [sessionInfo]);

  // Validate token on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Invalid token' }));
          setError(body.error || 'Invalid or expired share link');
          return;
        }
        const info = await res.json();
        // Sync viewer font size to TerminalComponent's per-session storage
        localStorage.setItem(`cchub-terminal-font-size-${info.sessionId}`, String(fontSize));
        setSessionInfo(info);
      })
      .catch(() => setError('Failed to connect to server'));
  }, [token, fontSize]);

  const handlePaneOutput = useCallback((paneId: string, data: Uint8Array) => {
    const callbacks = paneCallbacksRef.current.get(paneId);
    if (callbacks && callbacks.size > 0) {
      for (const cb of callbacks) cb(data);
    }
  }, []);

  const handleInitialContent = useCallback((paneId: string, data: Uint8Array) => {
    const callbacks = paneCallbacksRef.current.get(paneId);
    if (callbacks && callbacks.size > 0) {
      for (const cb of callbacks) cb(data);
    } else {
      if (!initialContentBufferRef.current.has(paneId)) {
        initialContentBufferRef.current.set(paneId, []);
      }
      initialContentBufferRef.current.get(paneId)!.push(data);
    }
  }, []);

  const handleLayoutChange = useCallback((newLayout: TmuxLayoutNode) => {
    setLayout(newLayout);

    setTimeout(() => {
      requestAnimationFrame(() => {
        const sizes = extractPaneSizes(newLayout);
        for (const [paneId, size] of sizes) {
          const ref = terminalRefsRef.current.get(paneId);
          ref?.setExactSize(size.cols, size.rows);
        }
      });
    }, 50);
  }, []);

  const controlTerminal = useViewerTerminal({
    sessionId: sessionInfo?.sessionId || '',
    viewToken: token || '',
    onPaneOutput: handlePaneOutput,
    onInitialContent: handleInitialContent,
    onLayoutChange: handleLayoutChange,
    onError: (msg) => console.warn('[viewer]', msg),
  });

  // Connect when session info is available
  useEffect(() => {
    if (sessionInfo) {
      controlTerminal.connect();
      return () => controlTerminal.disconnect();
    }
  }, [sessionInfo?.sessionId]);

  // Send initial resize after connect to trigger initial-content delivery
  useEffect(() => {
    if (controlTerminal.isConnected && layout) {
      controlTerminal.resize(layout.width, layout.height);
    }
  }, [controlTerminal.isConnected, !!layout]);

  // Remaining time display
  const [remainingTime, setRemainingTime] = useState('');
  useEffect(() => {
    if (!sessionInfo) return;
    const update = () => {
      const diff = new Date(sessionInfo.expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemainingTime('Expired');
        setError('Share link has expired');
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      setRemainingTime(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [sessionInfo]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-th-bg text-th-text">
        <div className="text-center">
          <div className="w-12 h-12 rounded-md bg-th-surface border border-th-border flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-th-text-muted" />
          </div>
          <h1 className="text-lg font-semibold mb-2 tracking-tight">Access Denied</h1>
          <p className="text-th-text-secondary text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!sessionInfo) {
    return (
      <div className="h-screen flex items-center justify-center bg-th-bg">
        <div className="w-5 h-5 border-2 border-th-surface-active border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-th-bg overflow-hidden">
      {/* Info bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-th-surface text-th-text-secondary text-xs border-b border-th-border shrink-0">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${controlTerminal.isConnected ? 'bg-blue-500' : 'bg-th-text-muted'}`} />
          <span className="text-th-text font-medium">{sessionInfo.sessionName}</span>
          <span className="text-th-border">|</span>
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3" />
            Read-only
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Font size controls */}
          <button
            type="button"
            onClick={() => changeFontSize(-1)}
            disabled={fontSize <= MIN_FONT_SIZE}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-th-surface-hover hover:bg-th-surface-active disabled:opacity-30 text-th-text-secondary transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-th-text-muted w-8 text-center tabular-nums">{fontSize}px</span>
          <button
            type="button"
            onClick={() => changeFontSize(1)}
            disabled={fontSize >= MAX_FONT_SIZE}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-th-surface-hover hover:bg-th-surface-active disabled:opacity-30 text-th-text-secondary transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
          <span className="text-th-border mx-1">|</span>
          <span className="text-th-text-muted flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {remainingTime}
          </span>
        </div>
      </div>

      {/* Terminal area - horizontal scroll when content exceeds viewport */}
      <div className="flex-1 min-h-0 overflow-auto">
        {layout && cellSize.width > 0 ? (
          <LayoutRenderer
            key={termKey}
            node={layout}
            paneCallbacks={paneCallbacksRef}
            initialContentBuffer={initialContentBufferRef}
            sessionId={sessionInfo.sessionId}
            isConnected={controlTerminal.isConnected}
            scrollPane={controlTerminal.scrollPane}
            requestContent={controlTerminal.requestContent}
            terminalRefs={terminalRefsRef}
            cellSize={cellSize}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-th-text-muted text-sm">
            Waiting for terminal...
          </div>
        )}
      </div>
    </div>
  );
}
