import { useRef, useCallback, useState, useEffect } from 'react';
import { PaneContainer, type PaneNode } from './PaneContainer';
import { SessionList } from './SessionList';
import { Dashboard } from './dashboard/Dashboard';
import { FileViewer } from './files/FileViewer';
import { FloatingKeyboard } from './FloatingKeyboard';
import type { TerminalRef } from './Terminal';
import type { SessionResponse, SessionState } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';
const DESKTOP_STATE_KEY = 'cchub-desktop-state';

interface OpenSession {
  id: string;
  name: string;
  state: SessionState;
  currentPath?: string;
  ccSessionId?: string;
}

interface DesktopState {
  root: PaneNode;
  activePane: string;
}

interface DesktopLayoutProps {
  sessions: OpenSession[];
  activeSessionId: string | null;
  onSelectSession: (session: SessionResponse) => void;
  onSessionStateChange: (id: string, state: SessionState) => void;
  onShowSessionList: () => void;
  onReload: () => void;
  isTablet?: boolean;
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

// Find parent of a pane
function findParent(root: PaneNode, id: string): { parent: Extract<PaneNode, { type: 'split' }>; index: number } | null {
  if (root.type !== 'split') return null;
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === id) {
      return { parent: root, index: i };
    }
    const found = findParent(root.children[i], id);
    if (found) return found;
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

// Split a pane (creates a new terminal pane)
function splitPane(
  root: PaneNode,
  paneId: string,
  direction: 'horizontal' | 'vertical'
): { newRoot: PaneNode; newPaneId: string } {
  const newPaneId = generatePaneId();
  const newPane: PaneNode = { type: 'terminal', sessionId: null, id: newPaneId };

  function splitNode(node: PaneNode): PaneNode {
    // Split any leaf node (terminal)
    if (node.id === paneId && node.type !== 'split') {
      // Create new split containing this pane and new pane
      return {
        type: 'split',
        direction,
        id: generatePaneId(),
        children: [node, newPane],
        ratio: [50, 50],
      };
    }
    if (node.type === 'split') {
      return {
        ...node,
        children: node.children.map(splitNode),
      };
    }
    return node;
  }

  return { newRoot: splitNode(root), newPaneId };
}

// Close a pane
function closePane(root: PaneNode, paneId: string): { newRoot: PaneNode | null; nextPane: string | null } {
  // Check if root is a leaf node (not split)
  if (root.type !== 'split') {
    // Only pane, can't close
    if (root.id === paneId) {
      return { newRoot: null, nextPane: null };
    }
    return { newRoot: root, nextPane: null };
  }

  // Find and remove the pane
  const parent = findParent(root, paneId);
  if (!parent) {
    return { newRoot: root, nextPane: null };
  }

  const { parent: parentNode, index } = parent;
  const siblings = parentNode.children.filter((_, i) => i !== index);

  if (siblings.length === 0) {
    return { newRoot: null, nextPane: null };
  }

  if (siblings.length === 1) {
    // Replace parent with single remaining child
    function replaceNode(node: PaneNode): PaneNode {
      if (node.id === parentNode.id) {
        return siblings[0];
      }
      if (node.type === 'split') {
        return { ...node, children: node.children.map(replaceNode) };
      }
      return node;
    }
    const newRoot = replaceNode(root);
    const allIds = getAllPaneIds(newRoot);
    return { newRoot, nextPane: allIds[0] || null };
  }

  // Multiple siblings remain
  const newRatio = parentNode.ratio.filter((_, i) => i !== index);
  const ratioSum = newRatio.reduce((a, b) => a + b, 0);
  const normalizedRatio = newRatio.map(r => (r / ratioSum) * 100);

  function updateNode(node: PaneNode): PaneNode {
    if (node.id === parentNode.id && node.type === 'split') {
      return { ...node, children: siblings, ratio: normalizedRatio };
    }
    if (node.type === 'split') {
      return { ...node, children: node.children.map(updateNode) };
    }
    return node;
  }

  const newRoot = updateNode(root);
  const nextIndex = Math.min(index, siblings.length - 1);
  const nextPane = getAllPaneIds(siblings[nextIndex])[0] || getAllPaneIds(newRoot)[0];
  return { newRoot, nextPane };
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

const KEYBOARD_VISIBLE_KEY = 'cchub-floating-keyboard-visible';

export function DesktopLayout({
  sessions,
  activeSessionId,
  onSelectSession,
  onSessionStateChange,
  onShowSessionList,
  onReload,
  isTablet = false,
}: DesktopLayoutProps) {
  const terminalRefs = useRef<Map<string, TerminalRef | null>>(new Map());
  const activePaneRef = useRef<string>('');
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<'sessions' | 'dashboard'>('sessions');
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [pendingSessionPane, setPendingSessionPane] = useState<string | null>(null);

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

  // Handle global reload (browser reload)
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

  // Use onShowSessionList in tablet mode for session list
  void onShowSessionList;

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
        fetch(`${API_BASE}/api/sessions/clipboard`)
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

      // Ctrl/Cmd + B: Toggle side panel
      if (!e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setShowSidePanel(prev => !prev);
        return;
      }

      // Ctrl/Cmd + Arrow: Focus navigation
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleFocusNavigation(e.key);
        return;
      }

      // Ctrl/Cmd + 1-9: Session switch
      const num = parseInt(e.key);
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
  }, [sessions]);

  const handleSplit = useCallback((direction: 'horizontal' | 'vertical') => {
    setDesktopState(prev => {
      const { newRoot, newPaneId } = splitPane(prev.root, prev.activePane, direction);
      return { root: newRoot, activePane: newPaneId };
    });
  }, []);

  const handleClosePane = useCallback((paneId?: string) => {
    setDesktopState(prev => {
      const targetPaneId = paneId || prev.activePane;
      const { newRoot, nextPane } = closePane(prev.root, targetPaneId);
      if (!newRoot) return prev; // Can't close last pane
      return { root: newRoot, activePane: nextPane || prev.activePane };
    });
  }, []);

  // Handle paste (text or image)
  const handlePaste = useCallback(async () => {
    try {
      // Try to read clipboard items (for images)
      const items = await navigator.clipboard.read();
      for (const item of items) {
        // Check for image
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const formData = new FormData();
          formData.append('image', blob, 'clipboard-image.png');

          const response = await fetch(`${API_BASE}/api/upload/image`, {
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
          if (text) {
            const ref = terminalRefs.current?.get(activePaneRef.current);
            ref?.sendInput(text);
          }
          return;
        }
      }
    } catch {
      // Fallback to readText for browsers that don't support clipboard.read()
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const ref = terminalRefs.current?.get(activePaneRef.current);
          ref?.sendInput(text);
        }
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

      const response = await fetch(`${API_BASE}/api/upload/image`, {
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
  }, []);

  const handleSelectSessionForPane = useCallback((paneId: string, sessionId?: string) => {
    if (sessionId) {
      // Direct session selection from SessionSelector in pane
      setDesktopState(prev => ({
        ...prev,
        root: updateSessionId(prev.root, paneId, sessionId),
        activePane: paneId,
      }));
    } else {
      // Open side panel for session selection
      setPendingSessionPane(paneId);
      setShowSidePanel(true);
      setSidePanelTab('sessions');
    }
  }, []);

  const handleSessionSelect = useCallback((session: SessionResponse) => {
    if (pendingSessionPane) {
      setDesktopState(prev => ({
        ...prev,
        root: updateSessionId(prev.root, pendingSessionPane, session.id),
        activePane: pendingSessionPane,
      }));
      setPendingSessionPane(null);
    } else {
      // Update active pane
      setDesktopState(prev => ({
        ...prev,
        root: updateSessionId(prev.root, prev.activePane, session.id),
      }));
    }
    onSelectSession(session);
  }, [pendingSessionPane, onSelectSession]);

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
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1 bg-black/50 border-b border-gray-700 shrink-0">
          {/* Left: Menu button */}
          <button
            onClick={() => setShowSidePanel(prev => !prev)}
            className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="サイドパネル (Ctrl+B)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Center: Session name */}
          <span className="text-white/70 text-sm truncate max-w-[300px]">
            {activeSession?.name || 'CC Hub - Desktop'}
          </span>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-1">
            {/* Split buttons */}
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

            {/* File browser */}
            <button
              onClick={() => setShowFileViewer(true)}
              className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="ファイルブラウザ"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>

            {/* Reload all panes */}
            <button
              onClick={handleGlobalReload}
              className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="全ペインをリロード"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Keyboard toggle (tablet only) */}
            {isTablet && (
              <button
                onClick={() => setShowKeyboard(prev => !prev)}
                className={`p-1 rounded transition-colors ${
                  showKeyboard
                    ? 'text-green-400 bg-green-500/20 hover:bg-green-500/30'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                title={showKeyboard ? 'キーボードを隠す' : 'キーボードを表示'}
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
            )}
          </div>
        </div>

        {/* Pane container */}
        <div className="flex-1 min-h-0">
          <PaneContainer
            node={desktopState.root}
            activePane={desktopState.activePane}
            onFocusPane={handleFocusPane}
            onSelectSession={handleSelectSessionForPane}
            onSessionStateChange={onSessionStateChange}
            onSplitRatioChange={handleSplitRatioChange}
            onClosePane={handleClosePane}
            sessions={sessions}
            terminalRefs={terminalRefs}
            isTablet={isTablet}
          />
        </div>
      </div>

      {/* Side panel - overlay on tablet, inline on desktop */}
      {showSidePanel && (
        isTablet ? (
          // Tablet: Overlay side panel
          <div className="fixed inset-0 z-40">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowSidePanel(false)}
            />
            {/* Panel */}
            <div className="absolute right-0 top-0 bottom-0 w-80 bg-gray-900 shadow-xl flex flex-col">
              {/* Tab header */}
              <div className="flex items-center border-b border-gray-700 shrink-0">
                <button
                  onClick={() => setSidePanelTab('sessions')}
                  className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                    sidePanelTab === 'sessions'
                      ? 'text-white bg-gray-800'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Sessions
                </button>
                <button
                  onClick={() => setSidePanelTab('dashboard')}
                  className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                    sidePanelTab === 'dashboard'
                      ? 'text-white bg-gray-800'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setShowSidePanel(false)}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="閉じる"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Tab content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {sidePanelTab === 'sessions' ? (
                  <SessionList
                    onSelectSession={handleSessionSelect}
                  />
                ) : (
                  <Dashboard className="h-full" />
                )}
              </div>
            </div>
          </div>
        ) : (
          // Desktop: Inline side panel
          <div className="w-80 h-full flex flex-col border-l border-gray-700 bg-gray-900 shrink-0">
            {/* Tab header */}
            <div className="flex items-center border-b border-gray-700 shrink-0">
              <button
                onClick={() => setSidePanelTab('sessions')}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  sidePanelTab === 'sessions'
                    ? 'text-white bg-gray-800'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Sessions
              </button>
              <button
                onClick={() => setSidePanelTab('dashboard')}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  sidePanelTab === 'dashboard'
                    ? 'text-white bg-gray-800'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setShowSidePanel(false)}
                className="p-2 text-gray-400 hover:text-white transition-colors"
                title="閉じる"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {sidePanelTab === 'sessions' ? (
                <SessionList
                  onSelectSession={handleSessionSelect}
                />
              ) : (
                <Dashboard className="h-full" />
              )}
            </div>
          </div>
        )
      )}

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
