import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { PaneContainer, type PaneNode, type ControlModeContext } from './PaneContainer';
import { FileViewer } from './files/FileViewer';
import { FloatingKeyboard } from './FloatingKeyboard';
import { authFetch } from '../services/api';
import { useSessions } from '../hooks/useSessions';
import { useControlTerminal } from '../hooks/useControlTerminal';
import type { TerminalRef, ControlModeConfig } from './Terminal';
import type { SessionState, SessionTheme, TmuxLayoutNode } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';
const DESKTOP_STATE_KEY = 'cchub-desktop-state';

interface OpenSession {
  id: string;
  name: string;
  state: SessionState;
  currentPath?: string;
  ccSessionId?: string;
  theme?: SessionTheme;
}

interface DesktopState {
  root: PaneNode;
  activePane: string;
}

interface DesktopLayoutProps {
  sessions: OpenSession[];
  activeSessionId: string | null;
  onSessionStateChange: (id: string, state: SessionState) => void;
  onReload: () => void;
  isTablet?: boolean;
  showSessionListOnboarding?: boolean;
  onCompleteSessionListOnboarding?: () => void;
  keyboardControlRef?: React.RefObject<{ open: () => void; close: () => void } | null>;
}

// Generate unique ID
let paneIdCounter = 0;
function generatePaneId(): string {
  return `pane-${Date.now()}-${++paneIdCounter}`;
}

// Create initial single pane
function createInitialState(sessionId: string | null): DesktopState {
  const paneId = generatePaneId();
  return {
    root: { type: 'terminal', sessionId, id: paneId },
    activePane: paneId,
  };
}

// Find pane by ID in the tree
function findPaneById(node: PaneNode, id: string): PaneNode | null {
  if (node.id === id) return node;
  if (node.type === 'split') {
    for (const child of node.children) {
      const found = findPaneById(child, id);
      if (found) return found;
    }
  }
  return null;
}

// Compute total tmux window size by summing pane sizes from the layout tree.
// tmux needs: horizontal splits → sum cols + borders, vertical → sum rows + borders.
// When useProposed=true, uses proposeDimensions() (what fits the container) instead of
// actual xterm size. This is needed in control mode where xterm size is set by tmux,
// not by FitAddon.
function computeTotalSizeFromTree(
  root: PaneNode,
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>,
  useProposed = false,
): { cols: number; rows: number } | null {
  if (root.type === 'terminal') {
    const ref = terminalRefs.current?.get(root.id);
    const size = useProposed
      ? (ref?.getProposedSize?.() ?? ref?.getSize?.())
      : ref?.getSize?.();
    return size ?? null;
  }

  if (root.type === 'split') {
    const childSizes = root.children.map(c =>
      computeTotalSizeFromTree(c, terminalRefs, useProposed)
    );
    if (childSizes.some(s => s === null)) return null;
    const sizes = childSizes as { cols: number; rows: number }[];

    if (root.direction === 'horizontal') {
      // Panes side by side: total cols = sum + borders
      return {
        cols: sizes.reduce((sum, s) => sum + s.cols, 0) + (sizes.length - 1),
        rows: Math.max(...sizes.map(s => s.rows)),
      };
    }
    // Panes stacked: total rows = sum + borders
    return {
      cols: Math.max(...sizes.map(s => s.cols)),
      rows: sizes.reduce((sum, s) => sum + s.rows, 0) + (sizes.length - 1),
    };
  }

  return null;
}

// Get all pane IDs in order (leaf nodes only)
function getAllPaneIds(node: PaneNode): string[] {
  if (node.type === 'split') {
    return node.children.flatMap(getAllPaneIds);
  }
  // terminal, sessions, dashboard, empty are all leaf nodes
  return [node.id];
}

// Update split ratio in tree
function updateRatio(root: PaneNode, nodeId: string, ratio: number[]): PaneNode {
  if (root.id === nodeId && root.type === 'split') {
    return { ...root, ratio };
  }
  if (root.type === 'split') {
    return { ...root, children: root.children.map(c => updateRatio(c, nodeId, ratio)) };
  }
  return root;
}

// Update session ID in tree
function updateSessionId(root: PaneNode, paneId: string, sessionId: string): PaneNode {
  if (root.id === paneId && root.type === 'terminal') {
    return { ...root, sessionId };
  }
  if (root.type === 'split') {
    return { ...root, children: root.children.map(c => updateSessionId(c, paneId, sessionId)) };
  }
  return root;
}

// Update ALL terminal panes' session ID (used for control mode session switching)
function updateAllSessionIds(root: PaneNode, sessionId: string): PaneNode {
  if (root.type === 'terminal') {
    return { ...root, sessionId };
  }
  if (root.type === 'split') {
    return { ...root, children: root.children.map(c => updateAllSessionIds(c, sessionId)) };
  }
  return root;
}

// Convert TmuxLayoutNode to PaneNode with session IDs
function tmuxLayoutToPaneNode(node: TmuxLayoutNode, sessionId: string): PaneNode {
  if (node.type === 'leaf') {
    return {
      type: 'terminal',
      sessionId,
      id: `%${node.paneId ?? 0}`,
    };
  }

  const children = (node.children || []).map(c => tmuxLayoutToPaneNode(c, sessionId));
  const isHorizontal = node.type === 'horizontal';
  const totalSize = (node.children || []).reduce(
    (sum, c) => sum + (isHorizontal ? c.width : c.height), 0
  );
  const ratio = (node.children || []).map(c => {
    const size = isHorizontal ? c.width : c.height;
    return totalSize > 0 ? (size / totalSize) * 100 : 100 / (node.children || []).length;
  });

  return {
    type: 'split',
    direction: isHorizontal ? 'horizontal' : 'vertical',
    children,
    ratio,
    id: `split-${node.x}-${node.y}`,
  };
}

// Extract per-pane {cols, rows} from a TmuxLayoutNode tree.
// tmux layout width/height = pane cols/rows.
function extractPaneSizes(node: TmuxLayoutNode): Map<string, { cols: number; rows: number }> {
  const sizes = new Map<string, { cols: number; rows: number }>();
  function walk(n: TmuxLayoutNode) {
    if (n.type === 'leaf' && n.paneId !== undefined) {
      sizes.set(`%${n.paneId}`, { cols: n.width, rows: n.height });
    }
    if (n.children) {
      n.children.forEach(walk);
    }
  }
  walk(node);
  return sizes;
}

const KEYBOARD_VISIBLE_KEY = 'cchub-floating-keyboard-visible';

export function DesktopLayout({
  sessions: propSessions,
  activeSessionId,
  onSessionStateChange,
  onReload,
  isTablet = false,
  showSessionListOnboarding = false,
  onCompleteSessionListOnboarding,
  keyboardControlRef,
}: DesktopLayoutProps) {
  const terminalRefs = useRef<Map<string, TerminalRef | null>>(new Map());
  const sessionListToggleRefs = useRef<Map<string, () => void>>(new Map());
  const activePaneRef = useRef<string>('');
  const paneContainerRef = useRef<HTMLDivElement>(null);

  // Get latest session info (including theme) from API
  const { sessions: apiSessions, fetchSessions } = useSessions();

  // Fetch sessions on mount and periodically
  useEffect(() => {
    fetchSessions();
    const interval = setInterval(() => fetchSessions(true), 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Merge prop sessions with API sessions to get latest theme info
  // propSessionsにないセッションもapiSessionsから追加する（分割ペイン用）
  const sessions = apiSessions.length > 0
    ? apiSessions.map(apiSession => {
        const propSession = propSessions.find(p => p.id === apiSession.id);
        return propSession
          ? { ...propSession, theme: apiSession.theme }
          : {
              id: apiSession.id,
              name: apiSession.name,
              state: apiSession.state,
              currentPath: (apiSession as any).currentPath,
              ccSessionId: (apiSession as any).ccSessionId,
              currentCommand: (apiSession as any).currentCommand,
              theme: apiSession.theme,
            };
      })
    : propSessions;
  const [showFileViewer, setShowFileViewer] = useState(false);

  // Floating keyboard state (for tablet mode)
  const [showKeyboard, setShowKeyboard] = useState(() => {
    if (!isTablet) return false;
    try {
      return localStorage.getItem(KEYBOARD_VISIBLE_KEY) === 'true';
    } catch {}
    return true; // Default to visible on tablet
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
  const [showUrlMenu, setShowUrlMenu] = useState(false);
  const [urlPage, setUrlPage] = useState(0);
  const URL_PAGE_SIZE = 5;

  // Keyboard elevation for onboarding (raises z-index above overlay)
  const [keyboardElevated, setKeyboardElevated] = useState(false);

  // Register keyboard control for onboarding
  useEffect(() => {
    if (keyboardControlRef && isTablet) {
      keyboardControlRef.current = {
        open: () => { setShowKeyboard(true); setKeyboardElevated(true); },
        close: () => { setShowKeyboard(false); setKeyboardElevated(false); },
      };
    }
    return () => {
      if (keyboardControlRef) {
        keyboardControlRef.current = null;
      }
    };
  }, [keyboardControlRef, isTablet]);

  // Refresh all terminal panes (force tmux redraw without page reload)
  const handleGlobalReload = useCallback(() => {
    window.location.reload();
  }, []);

  // Keep onReload reference for compatibility
  void onReload;

  // Save keyboard visibility state
  useEffect(() => {
    if (isTablet) {
      localStorage.setItem(KEYBOARD_VISIBLE_KEY, String(showKeyboard));
    }
  }, [showKeyboard, isTablet]);

  // Migrate old pane types to terminal
  const migratePaneNode = (node: PaneNode): PaneNode => {
    // Handle legacy types (empty, sessions, dashboard) - convert to terminal
    const nodeType = (node as { type: string }).type;
    if (nodeType === 'empty' || nodeType === 'sessions' || nodeType === 'dashboard') {
      return { type: 'terminal', sessionId: null, id: node.id };
    }
    if (node.type === 'split') {
      return { ...node, children: node.children.map(migratePaneNode) };
    }
    return node;
  };

  // Load/save desktop state
  const [desktopState, setDesktopState] = useState<DesktopState>(() => {
    try {
      const saved = localStorage.getItem(DESKTOP_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DesktopState;
        // Validate structure and migrate old types
        if (parsed.root && parsed.activePane) {
          return { ...parsed, root: migratePaneNode(parsed.root) };
        }
      }
    } catch {
      // Ignore
    }
    return createInitialState(activeSessionId);
  });

  // Save state on change
  useEffect(() => {
    localStorage.setItem(DESKTOP_STATE_KEY, JSON.stringify(desktopState));
  }, [desktopState]);

  // Keep activePaneRef in sync
  useEffect(() => {
    activePaneRef.current = desktopState.activePane;
  }, [desktopState.activePane]);

  // Update initial session if state was fresh
  useEffect(() => {
    if (activeSessionId && desktopState.root.type === 'terminal' && !desktopState.root.sessionId) {
      setDesktopState(prev => ({
        ...prev,
        root: updateSessionId(prev.root, prev.activePane, activeSessionId),
      }));
    }
  }, [activeSessionId, desktopState.root]);

  // =========================================================================
  // Control Mode
  // =========================================================================

  // Find the session ID that should be connected via control mode
  // For now, use the first terminal pane's session as the control target
  const getControlSessionId = (): string | null => {
    const allPanes = getAllPaneIds(desktopState.root);
    for (const pid of allPanes) {
      const pane = findPaneById(desktopState.root, pid);
      if (pane?.type === 'terminal' && pane.sessionId) {
        return pane.sessionId;
      }
    }
    return null;
  };

  const controlSessionId = getControlSessionId();
  const [controlLayout, setControlLayout] = useState<TmuxLayoutNode | null>(null);

  // Per-pane output callbacks (paneId -> Set<callbacks>)
  const paneCallbacksRef = useRef<Map<string, Set<(data: Uint8Array) => void>>>(new Map());

  // Buffer for initial content that arrives before Terminal components mount
  const initialContentBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());

  const desktopStateRef = useRef(desktopState);
  desktopStateRef.current = desktopState;

  // Timer for applying exact tmux pane sizes after layout-change
  const layoutSizeTimerRef = useRef<number | null>(null);

  // Flag: true while a layout change is being processed (React re-render pending).
  // While true, sendControlResize is suppressed to avoid sending stale proposed sizes.
  const layoutPendingRef = useRef(false);

  const controlTerminal = useControlTerminal({
    sessionId: controlSessionId || '',
    onPaneOutput: (paneId, data) => {
      const callbacks = paneCallbacksRef.current.get(paneId);
      if (callbacks) {
        for (const cb of callbacks) {
          cb(data);
        }
      }
    },
    onLayoutChange: (layout) => {
      setControlLayout(layout);
      // Suppress sendControlResize while React re-renders with new CSS ratios.
      // Without this, ResizeObserver fires with OLD container sizes → stale
      // proposed dimensions → wrong total sent to tmux → size oscillation.
      layoutPendingRef.current = true;

      // Force each xterm.js to match tmux's exact pane sizes.
      // In control mode, FitAddon.fit() is NOT called (proposeDimensions() is used
      // instead), so xterm size is ONLY set here from tmux's layout-change.
      //
      // We must wait for React to re-render with updated CSS ratios AND for the
      // browser to paint (layout reflow). Use requestAnimationFrame to ensure
      // the DOM update has completed before applying sizes.
      if (layoutSizeTimerRef.current) {
        clearTimeout(layoutSizeTimerRef.current);
      }
      layoutSizeTimerRef.current = window.setTimeout(() => {
        requestAnimationFrame(() => {
          const sizes = extractPaneSizes(layout);
          for (const [paneId, size] of sizes) {
            const ref = terminalRefs.current?.get(paneId);
            ref?.setExactSize(size.cols, size.rows);
          }
          // Re-enable sendControlResize now that DOM is up to date,
          // then immediately send a resize with the correct proposed sizes.
          layoutPendingRef.current = false;
          sendControlResize();
        });
        // Safety timeout: ensure layoutPending is cleared even if rAF doesn't fire
        // (e.g. tab in background, browser throttling)
        setTimeout(() => {
          if (layoutPendingRef.current) {
            layoutPendingRef.current = false;
            sendControlResize();
          }
        }, 500);
      }, 50);
    },
    onInitialContent: (paneId, data) => {
      const callbacks = paneCallbacksRef.current.get(paneId);
      if (callbacks && callbacks.size > 0) {
        for (const cb of callbacks) {
          cb(data);
        }
      } else {
        // Buffer for replay when Terminal component mounts and registers callback
        if (!initialContentBufferRef.current.has(paneId)) {
          initialContentBufferRef.current.set(paneId, []);
        }
        initialContentBufferRef.current.get(paneId)!.push(data);
      }
    },
    onConnect: () => {
      // Terminal components may not have mounted yet (especially after session switch).
      // Retry sendControlResize with increasing delays to catch when refs are ready.
      const delays = [100, 300, 600, 1000];
      for (const delay of delays) {
        setTimeout(() => sendControlResize(), delay);
      }
    },
    onDisconnect: () => {},
    onError: (err) => {
      console.error('[control-mode] Error:', err);
    },
  });

  // Ref for accessing control terminal in callbacks without deps
  const controlTerminalRef = useRef(controlTerminal);
  controlTerminalRef.current = controlTerminal;

  // Connect/disconnect control mode
  useEffect(() => {
    if (controlSessionId) {
      controlTerminal.connect();
    }
    return () => {
      controlTerminal.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlSessionId]);

  // Control mode resize: compute TOTAL window size from layout tree.
  // tmux refresh-client -C needs cols×rows for the entire window,
  // which is the sum of individual pane sizes + borders.
  const controlResizeTimerRef = useRef<number | null>(null);
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const sendControlResize = useCallback(() => {
    if (controlResizeTimerRef.current) {
      clearTimeout(controlResizeTimerRef.current);
    }
    controlResizeTimerRef.current = window.setTimeout(() => {
      if (!controlTerminalRef.current.isConnected) return;

      // Skip while layout change is being processed by React.
      // Container CSS sizes haven't been updated yet, so proposeDimensions()
      // would return stale values and cause size oscillation.
      if (layoutPendingRef.current) return;

      const root = desktopStateRef.current.root;
      // Use proposed dimensions (what fits each container) instead of actual
      // xterm size, since in control mode xterm size is set by tmux layout-change,
      // not by FitAddon.fit().
      const totalSize = computeTotalSizeFromTree(root, terminalRefs, true);
      if (totalSize && totalSize.cols > 0 && totalSize.rows > 0) {
        const last = lastSentSizeRef.current;
        if (last && last.cols === totalSize.cols && last.rows === totalSize.rows) return;
        lastSentSizeRef.current = { cols: totalSize.cols, rows: totalSize.rows };
        controlTerminalRef.current.resize(totalSize.cols, totalSize.rows);
      }
    }, 100);
  }, []);

  // Compute control pane tree synchronously (not via useEffect) to avoid paneId mismatch
  const controlPaneTree = useMemo(() => {
    if (!controlLayout || !controlSessionId) return null;
    return tmuxLayoutToPaneNode(controlLayout, controlSessionId);
  }, [controlLayout, controlSessionId]);

  // Update desktopState when control pane tree changes
  useEffect(() => {
    if (!controlPaneTree) return;
    const allPanes = getAllPaneIds(controlPaneTree);
    setDesktopState(prev => ({
      root: controlPaneTree,
      activePane: allPanes.includes(prev.activePane) ? prev.activePane : (allPanes[0] || prev.activePane),
    }));
  }, [controlPaneTree]);

  // Build control mode context for PaneContainer.
  // Always defined - Terminal components always use control mode.
  const controlModeContext: ControlModeContext = {
    getControlConfig: (paneId: string): ControlModeConfig | undefined => {
      return {
        paneId,
        sendInput: (data: string) => {
          if (controlTerminalRef.current.isConnected) {
            controlTerminalRef.current.sendInput(paneId, data);
          }
        },
        registerOnData: (callback: (data: Uint8Array) => void) => {
          if (!paneCallbacksRef.current.has(paneId)) {
            paneCallbacksRef.current.set(paneId, new Set());
          }
          paneCallbacksRef.current.get(paneId)!.add(callback);

          // Replay buffered initial content that arrived before this component mounted
          const buffered = initialContentBufferRef.current.get(paneId);
          if (buffered) {
            for (const data of buffered) {
              callback(data);
            }
            initialContentBufferRef.current.delete(paneId);
          }

          return () => {
            paneCallbacksRef.current.get(paneId)?.delete(callback);
          };
        },
        isConnected: controlTerminal.isConnected,
        onResize: () => {
          // Individual pane resize triggers total container size calculation.
          // tmux refresh-client -C needs the TOTAL window size, not per-pane.
          sendControlResize();
        },
      };
    },
    splitPane: (paneId: string, direction: 'h' | 'v') => {
      controlTerminalRef.current.splitPane(paneId, direction);
    },
    closePane: (paneId: string) => {
      controlTerminalRef.current.closePane(paneId);
    },
  };

  const handleSplit = useCallback((direction: 'horizontal' | 'vertical') => {
    const activeId = activePaneRef.current;
    controlTerminalRef.current.splitPane(activeId, direction === 'horizontal' ? 'h' : 'v');
    // Wait for tmux layout update via %layout-change
  }, []);

  const handleClosePane = useCallback((paneId?: string) => {
    const targetId = paneId || activePaneRef.current;
    controlTerminalRef.current.closePane(targetId);
    // Wait for tmux layout update via %layout-change
  }, []);

  // Handle paste (text or image)
  const handlePaste = useCallback(async () => {
    const pasteText = async (text: string) => {
      if (text) {
        const ref = terminalRefs.current?.get(activePaneRef.current);
        ref?.sendInput(text);
      }
    };

    try {
      // Try to read clipboard items (for images)
      const items = await navigator.clipboard.read();
      let handled = false;
      for (const item of items) {
        // Check for image
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const formData = new FormData();
          formData.append('image', blob, 'clipboard-image.png');

          const response = await authFetch(`${API_BASE}/api/upload/image`, {
            method: 'POST',
            body: formData,
          });

          const result = await response.json();
          if (response.ok && result.path) {
            const ref = terminalRefs.current?.get(activePaneRef.current);
            ref?.sendInput(result.path);
          } else {
            console.error('Upload failed:', result.error);
          }
          return;
        }

        // Check for text
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          await pasteText(text);
          handled = true;
          break;
        }
      }
      // If no items were handled, try readText as fallback
      if (!handled) {
        const text = await navigator.clipboard.readText();
        await pasteText(text);
      }
    } catch {
      // Fallback to readText for browsers that don't support clipboard.read()
      try {
        const text = await navigator.clipboard.readText();
        await pasteText(text);
      } catch (err) {
        console.error('Clipboard read failed:', err);
      }
    }
  }, []);

  const handleFocusNavigation = useCallback((key: string) => {
    const allPanes = getAllPaneIds(desktopState.root);
    const currentIndex = allPanes.indexOf(desktopState.activePane);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + allPanes.length) % allPanes.length;
    } else {
      nextIndex = (currentIndex + 1) % allPanes.length;
    }

    setDesktopState(prev => ({ ...prev, activePane: allPanes[nextIndex] }));
    // Focus the terminal
    const ref = terminalRefs.current.get(allPanes[nextIndex]);
    ref?.focus();
  }, [desktopState.root, desktopState.activePane]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (!modifier) return;

      // Ctrl/Cmd + D: Vertical split (right)
      if (!e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleSplit('horizontal');
        return;
      }

      // Ctrl/Cmd + Shift + D: Horizontal split (bottom)
      if (e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleSplit('vertical');
        return;
      }

      // Ctrl/Cmd + W: Close pane
      if (!e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        handleClosePane();
        return;
      }

      // Ctrl/Cmd + C: Copy from tmux buffer or terminal selection
      if (!e.shiftKey && e.key.toLowerCase() === 'c') {
        const ref = terminalRefs.current?.get(activePaneRef.current);
        const selection = ref?.getSelection();

        // First try xterm selection
        if (selection) {
          e.preventDefault();
          navigator.clipboard.writeText(selection).catch(err => {
            console.error('Clipboard write failed:', err);
          });
          return;
        }

        // Then try tmux buffer
        e.preventDefault();
        authFetch(`${API_BASE}/api/sessions/clipboard`)
          .then(res => res.json())
          .then(data => {
            if (data.content) {
              navigator.clipboard.writeText(data.content).catch(err => {
                console.error('Clipboard write failed:', err);
              });
            }
          })
          .catch(() => {
            // No buffer content, ignore
          });
        return;
      }

      // Ctrl/Cmd + V: Paste to terminal (text or image)
      if (!e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
        return;
      }

      // Ctrl/Cmd + B: Toggle session list in active pane
      if (!e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const toggleFn = sessionListToggleRefs.current.get(activePaneRef.current);
        toggleFn?.();
        return;
      }

      // Ctrl/Cmd + Arrow: Focus navigation
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleFocusNavigation(e.key);
        return;
      }

      // Ctrl/Cmd + 1-9: Session switch
      const num = parseInt(e.key, 10);
      if (!e.shiftKey && num >= 1 && num <= 9) {
        e.preventDefault();
        const session = sessions[num - 1];
        if (session) {
          setDesktopState(prev => ({
            ...prev,
            root: updateSessionId(prev.root, prev.activePane, session.id),
          }));
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessions, handleClosePane, handleFocusNavigation, handlePaste, handleSplit]);

  // Floating keyboard handlers (for tablet mode)
  const handleKeyboardSend = useCallback((char: string) => {
    const ref = terminalRefs.current?.get(activePaneRef.current);
    ref?.sendInput(char);
  }, []);

  const handleFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await authFetch(`${API_BASE}/api/upload/image`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok && result.path) {
        const ref = terminalRefs.current?.get(activePaneRef.current);
        ref?.sendInput(result.path);
      } else {
        console.error('Upload failed:', result.error);
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleUrlExtract = useCallback(() => {
    if (showUrlMenu) {
      setShowUrlMenu(false);
      return;
    }
    const ref = terminalRefs.current?.get(activePaneRef.current);
    const urls = ref?.extractUrls() || [];
    setDetectedUrls(urls);
    setUrlPage(0);
    setShowUrlMenu(true);
  }, [showUrlMenu]);

  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setShowUrlMenu(false);
    }).catch(console.error);
  }, []);

  const handleOpenUrl = useCallback((url: string) => {
    window.open(url, '_blank');
    setShowUrlMenu(false);
  }, []);

  const handleFocusPane = useCallback((paneId: string) => {
    setDesktopState(prev => ({ ...prev, activePane: paneId }));
    controlTerminalRef.current.selectPane(paneId);
  }, []);

  const handleSelectSessionForPane = useCallback((paneId: string, sessionId?: string) => {
    if (!sessionId) return;

    // All panes belong to one tmux session.
    // Update ALL panes' sessionId so getControlSessionId() returns the new session,
    // triggering control WebSocket reconnection to the new session.
    setDesktopState(prev => ({
      ...prev,
      root: updateAllSessionIds(prev.root, sessionId),
      activePane: paneId,
    }));
    // Clear stale layout so the new session's layout takes effect
    setControlLayout(null);
    // Clear buffered content from old session
    initialContentBufferRef.current.clear();
    lastSentSizeRef.current = null;
  }, []);

  const handleSplitRatioChange = useCallback((nodeId: string, ratio: number[]) => {
    setDesktopState(prev => ({
      ...prev,
      root: updateRatio(prev.root, nodeId, ratio),
    }));
  }, []);

  // Get active session for file viewer
  const activePane = findPaneById(desktopState.root, desktopState.activePane);
  const activeSession = activePane?.type === 'terminal' && activePane.sessionId
    ? sessions.find(s => s.id === activePane.sessionId)
    : null;

  return (
    <div className="h-screen flex bg-gray-900">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header - desktop: minimal control mode bar */}
        {!isTablet && controlSessionId && (
          <div className="flex items-center justify-between px-3 py-1 bg-black/50 border-b border-gray-700 shrink-0">
            <span className="text-white/70 text-sm truncate max-w-[300px]">
              {activeSession?.name || 'CC Hub'}
            </span>
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-1" data-onboarding="split-pane">
                <button
                  onClick={() => handleSplit('horizontal')}
                  className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
                  title="縦分割 (Ctrl+D)"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="12" y1="3" x2="12" y2="21" />
                  </svg>
                </button>
                <button
                  onClick={() => handleSplit('vertical')}
                  className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
                  title="横分割 (Ctrl+Shift+D)"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header - tablet: full toolbar with keyboard toggle */}
        {isTablet && (
          <div className="flex items-center justify-between px-3 py-1 bg-black/50 border-b border-gray-700 shrink-0">
            {/* Left: Session name */}
            <span className="text-white/70 text-sm truncate max-w-[300px]">
              {activeSession?.name || 'CC Hub - Desktop'}
            </span>

            {/* Right: Action buttons */}
            <div className="flex items-center gap-1">
              {/* Split buttons */}
              <div className="flex items-center gap-1" data-onboarding="split-pane">
                <button
                  onClick={() => handleSplit('horizontal')}
                  className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
                  title="縦分割 (Ctrl+D)"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="12" y1="3" x2="12" y2="21" />
                  </svg>
                </button>
                <button
                  onClick={() => handleSplit('vertical')}
                  className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
                  title="横分割 (Ctrl+Shift+D)"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                  </svg>
                </button>
              </div>

              {/* Reload all panes */}
              <button
                onClick={handleGlobalReload}
                className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
                title="全ペインをリロード"
                data-onboarding="reload"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              {/* Keyboard toggle */}
              <button
                onClick={() => setShowKeyboard(prev => !prev)}
                className={`p-1 rounded transition-colors ${
                  showKeyboard
                    ? 'text-green-400 bg-green-500/20 hover:bg-green-500/30'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                title={showKeyboard ? 'キーボードを隠す' : 'キーボードを表示'}
                data-onboarding="keyboard"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <line x1="6" y1="10" x2="6" y2="10" strokeLinecap="round" />
                  <line x1="10" y1="10" x2="10" y2="10" strokeLinecap="round" />
                  <line x1="14" y1="10" x2="14" y2="10" strokeLinecap="round" />
                  <line x1="18" y1="10" x2="18" y2="10" strokeLinecap="round" />
                  <line x1="6" y1="14" x2="18" y2="14" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Pane container */}
        <div className="flex-1 min-h-0" data-onboarding="terminal" ref={paneContainerRef}>
          <PaneContainer
            node={desktopState.root}
            activePane={desktopState.activePane}
            onFocusPane={handleFocusPane}
            onSelectSession={handleSelectSessionForPane}
            onSessionStateChange={onSessionStateChange}
            onSplitRatioChange={handleSplitRatioChange}
            onClosePane={handleClosePane}
            onSplit={handleSplit}
            sessions={sessions}
            terminalRefs={terminalRefs}
            sessionListToggleRefs={sessionListToggleRefs}
            isTablet={isTablet}
            showSessionListOnboarding={showSessionListOnboarding}
            onCompleteSessionListOnboarding={onCompleteSessionListOnboarding}
            controlModeContext={controlModeContext}
          />
        </div>
      </div>


      {/* File Viewer Modal */}
      {showFileViewer && activeSession?.currentPath && (
        <FileViewer
          sessionWorkingDir={activeSession.currentPath}
          onClose={() => setShowFileViewer(false)}
        />
      )}

      {/* Floating Keyboard (tablet only) */}
      {isTablet && (
        <>
          {/* Hidden file input for image upload */}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileSelect}
          />

          <FloatingKeyboard
            visible={showKeyboard}
            onClose={() => setShowKeyboard(false)}
            onSend={handleKeyboardSend}
            onFilePicker={handleFilePicker}
            onUrlExtract={handleUrlExtract}
            isUploading={isUploading}
            elevated={keyboardElevated}
          />
        </>
      )}

      {/* URL menu (tablet only) */}
      {isTablet && showUrlMenu && (() => {
        const totalPages = Math.ceil(detectedUrls.length / URL_PAGE_SIZE);
        const startIdx = urlPage * URL_PAGE_SIZE;
        const pageUrls = detectedUrls.slice(startIdx, startIdx + URL_PAGE_SIZE);

        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-lg w-full max-w-md max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <span className="text-white font-medium">
                  URL一覧 {detectedUrls.length > 0 && `(${startIdx + 1}-${Math.min(startIdx + URL_PAGE_SIZE, detectedUrls.length)}/${detectedUrls.length})`}
                </span>
                <button
                  onClick={() => setShowUrlMenu(false)}
                  className="p-1 text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {detectedUrls.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">URLが見つかりません</p>
                ) : (
                  pageUrls.map((url, index) => (
                    <div key={startIdx + index} className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded">
                      <span className="flex-1 text-white text-sm truncate">{url}</span>
                      <button
                        onClick={() => handleCopyUrl(url)}
                        className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded"
                      >
                        コピー
                      </button>
                      <button
                        onClick={() => handleOpenUrl(url)}
                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
                      >
                        開く
                      </button>
                    </div>
                  ))
                )}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 px-4 py-3 border-t border-gray-700">
                  <button
                    onClick={() => setUrlPage(p => Math.max(0, p - 1))}
                    disabled={urlPage === 0}
                    className={`px-3 py-1 rounded ${urlPage === 0 ? 'bg-gray-700 text-gray-500' : 'bg-gray-600 text-white hover:bg-gray-500'}`}
                  >
                    前へ
                  </button>
                  <span className="text-gray-400 text-sm">{urlPage + 1} / {totalPages}</span>
                  <button
                    onClick={() => setUrlPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={urlPage >= totalPages - 1}
                    className={`px-3 py-1 rounded ${urlPage >= totalPages - 1 ? 'bg-gray-700 text-gray-500' : 'bg-gray-600 text-white hover:bg-gray-500'}`}
                  >
                    次へ
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
}
