import { useRef, useCallback, useState, useEffect } from 'react';
import { PaneContainer, type PaneNode } from './PaneContainer';
import { SessionListMini } from './SessionListMini';
import { Dashboard } from './dashboard/Dashboard';
import { FileViewer } from './files/FileViewer';
import type { TerminalRef } from './Terminal';
import type { SessionResponse, SessionState } from '../../../shared/types';

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
  if (root.type === 'terminal') return null;
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === id) {
      return { parent: root, index: i };
    }
    const found = findParent(root.children[i], id);
    if (found) return found;
  }
  return null;
}

// Get all terminal pane IDs in order
function getAllPaneIds(node: PaneNode): string[] {
  if (node.type === 'terminal') return [node.id];
  return node.children.flatMap(getAllPaneIds);
}

// Split a pane
function splitPane(
  root: PaneNode,
  paneId: string,
  direction: 'horizontal' | 'vertical',
  newSessionId: string | null
): { newRoot: PaneNode; newPaneId: string } {
  const newPaneId = generatePaneId();
  const newPane: PaneNode = { type: 'terminal', sessionId: newSessionId, id: newPaneId };

  function splitNode(node: PaneNode): PaneNode {
    if (node.id === paneId && node.type === 'terminal') {
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
  if (root.type === 'terminal') {
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

export function DesktopLayout({
  sessions,
  activeSessionId,
  onSelectSession,
  onSessionStateChange,
  onShowSessionList,
  onReload,
}: DesktopLayoutProps) {
  const terminalRefs = useRef<Map<string, TerminalRef | null>>(new Map());
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<'sessions' | 'dashboard'>('sessions');
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [pendingSessionPane, setPendingSessionPane] = useState<string | null>(null);

  // Load/save desktop state
  const [desktopState, setDesktopState] = useState<DesktopState>(() => {
    try {
      const saved = localStorage.getItem(DESKTOP_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DesktopState;
        // Validate structure
        if (parsed.root && parsed.activePane) {
          return parsed;
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
  }, [sessions, desktopState]);

  const handleSplit = useCallback((direction: 'horizontal' | 'vertical') => {
    setDesktopState(prev => {
      const { newRoot, newPaneId } = splitPane(prev.root, prev.activePane, direction, null);
      return { root: newRoot, activePane: newPaneId };
    });
  }, []);

  const handleClosePane = useCallback(() => {
    setDesktopState(prev => {
      const { newRoot, nextPane } = closePane(prev.root, prev.activePane);
      if (!newRoot) return prev; // Can't close last pane
      return { root: newRoot, activePane: nextPane || prev.activePane };
    });
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

            {/* Reload */}
            <button
              onClick={onReload}
              className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="リロード"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
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
            sessions={sessions}
            terminalRefs={terminalRefs}
          />
        </div>
      </div>

      {/* Side panel */}
      {showSidePanel && (
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
              <SessionListMini
                activeSessionId={activeSession?.id || null}
                onSelectSession={handleSessionSelect}
              />
            ) : (
              <Dashboard className="h-full" />
            )}
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      {showFileViewer && activeSession?.currentPath && (
        <FileViewer
          sessionWorkingDir={activeSession.currentPath}
          onClose={() => setShowFileViewer(false)}
        />
      )}
    </div>
  );
}
