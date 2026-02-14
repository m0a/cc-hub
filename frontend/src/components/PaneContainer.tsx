import { useRef, useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TerminalComponent, type TerminalRef } from './Terminal';
import { ConversationViewer } from './ConversationViewer';
import { FileViewer } from './files/FileViewer';
import { SessionList } from './SessionList';
import { Onboarding } from './Onboarding';
import { authFetch } from '../services/api';
import type { SessionState, ConversationMessage, SessionTheme } from '../../../shared/types';
import type { ControlModeConfig } from './Terminal';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SESSION_LIST_WIDTH_KEY = 'cchub-session-list-width';
const DEFAULT_SESSION_LIST_WIDTH = 256; // 256px = w-64
const MIN_SESSION_LIST_WIDTH = 150;
const MAX_SESSION_LIST_WIDTH = 500;
const SESSION_LIST_SCALE_KEY = 'cchub-session-list-scale';
const DEFAULT_SESSION_LIST_SCALE = 1;
const MIN_SESSION_LIST_SCALE = 0.5;
const MAX_SESSION_LIST_SCALE = 2;

// ペインノード型定義
export type PaneNode =
  | { type: 'terminal'; sessionId: string | null; id: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: PaneNode[]; ratio: number[]; id: string };

// Extended session type with ccSessionId
interface ExtendedSession {
  id: string;
  name: string;
  state: SessionState;
  currentPath?: string;
  ccSessionId?: string;
  currentCommand?: string;
  theme?: SessionTheme;
}

// Control mode context passed through the pane tree
export interface ControlModeContext {
  getControlConfig: (paneId: string) => ControlModeConfig | undefined;
  splitPane: (paneId: string, direction: 'h' | 'v') => void;
  closePane: (paneId: string) => void;
}

interface PaneContainerProps {
  node: PaneNode;
  activePane: string;
  onFocusPane: (paneId: string) => void;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onSessionStateChange: (sessionId: string, state: SessionState) => void;
  onSplitRatioChange: (nodeId: string, ratio: number[]) => void;
  onClosePane: (paneId: string) => void;
  onSplit?: (direction: 'horizontal' | 'vertical') => void;
  sessions: ExtendedSession[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
  sessionListToggleRefs?: React.RefObject<Map<string, () => void>>;
  isTablet?: boolean;
  globalReloadKey?: number;
  showSessionListOnboarding?: boolean;
  onCompleteSessionListOnboarding?: () => void;
  controlModeContext: ControlModeContext;
}

export function PaneContainer({
  node,
  activePane,
  onFocusPane,
  onSelectSession,
  onSessionStateChange,
  onSplitRatioChange,
  onClosePane,
  onSplit,
  sessions,
  terminalRefs,
  sessionListToggleRefs,
  isTablet = false,
  globalReloadKey = 0,
  showSessionListOnboarding = false,
  onCompleteSessionListOnboarding,
  controlModeContext,
}: PaneContainerProps) {
  if (node.type === 'terminal') {
    return (
      <TerminalPane
        paneId={node.id}
        sessionId={node.sessionId}
        isActive={activePane === node.id}
        onFocus={() => onFocusPane(node.id)}
        onSelectSession={(sessionId) => onSelectSession(node.id, sessionId)}
        onSessionStateChange={onSessionStateChange}
        onClose={() => onClosePane(node.id)}
        onSplit={onSplit}
        sessions={sessions}
        terminalRefs={terminalRefs}
        sessionListToggleRefs={sessionListToggleRefs}
        globalReloadKey={globalReloadKey}
        isTablet={isTablet}
        showSessionListOnboarding={showSessionListOnboarding}
        onCompleteSessionListOnboarding={onCompleteSessionListOnboarding}
        controlModeContext={controlModeContext}
      />
    );
  }

  if (node.type === 'split') {
    return (
      <SplitContainer
        node={node}
        activePane={activePane}
        onFocusPane={onFocusPane}
        onSelectSession={onSelectSession}
        onSessionStateChange={onSessionStateChange}
        onSplitRatioChange={onSplitRatioChange}
        onClosePane={onClosePane}
        onSplit={onSplit}
        sessions={sessions}
        terminalRefs={terminalRefs}
        sessionListToggleRefs={sessionListToggleRefs}
        isTablet={isTablet}
        globalReloadKey={globalReloadKey}
        showSessionListOnboarding={showSessionListOnboarding}
        onCompleteSessionListOnboarding={onCompleteSessionListOnboarding}
        controlModeContext={controlModeContext}
      />
    );
  }

  // Fallback for unknown/legacy pane types (empty, sessions, dashboard)
  // Treat them as terminal panes with no session selected
  const legacyNode = node as { id: string };
  return (
    <TerminalPane
      paneId={legacyNode.id}
      sessionId={null}
      isActive={activePane === legacyNode.id}
      onFocus={() => onFocusPane(legacyNode.id)}
      onSelectSession={(sessionId) => onSelectSession(legacyNode.id, sessionId)}
      onSessionStateChange={onSessionStateChange}
      onClose={() => onClosePane(legacyNode.id)}
      onSplit={onSplit}
      sessions={sessions}
      terminalRefs={terminalRefs}
      sessionListToggleRefs={sessionListToggleRefs}
      globalReloadKey={globalReloadKey}
      isTablet={isTablet}
      showSessionListOnboarding={showSessionListOnboarding}
      onCompleteSessionListOnboarding={onCompleteSessionListOnboarding}
      controlModeContext={controlModeContext}
    />
  );
}

interface TerminalPaneProps {
  paneId: string;
  sessionId: string | null;
  isActive: boolean;
  onFocus: () => void;
  onSelectSession: (sessionId?: string) => void;
  onSessionStateChange: (sessionId: string, state: SessionState) => void;
  onClose: () => void;
  onSplit?: (direction: 'horizontal' | 'vertical') => void;
  sessions: ExtendedSession[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
  sessionListToggleRefs?: React.RefObject<Map<string, () => void>>;
  globalReloadKey?: number;
  isTablet?: boolean;
  showSessionListOnboarding?: boolean;
  onCompleteSessionListOnboarding?: () => void;
  controlModeContext: ControlModeContext;
}

function TerminalPane({
  paneId,
  sessionId,
  isActive,
  onFocus,
  onSelectSession,
  onSessionStateChange,
  onClose,
  onSplit: _onSplit,
  sessions,
  terminalRefs,
  sessionListToggleRefs,
  globalReloadKey = 0,
  isTablet = false,
  showSessionListOnboarding = false,
  onCompleteSessionListOnboarding,
  controlModeContext,
}: TerminalPaneProps) {
  const { t } = useTranslation();
  const terminalRef = useRef<TerminalRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showConversation, setShowConversation] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [currentCcSessionId, setCurrentCcSessionId] = useState<string | null>(null);
  const [isClaudeRunning, setIsClaudeRunning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);

  // Session list sidebar width (resizable by drag)
  const [sessionListWidth, setSessionListWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_LIST_WIDTH_KEY);
      return saved ? parseInt(saved, 10) : DEFAULT_SESSION_LIST_WIDTH;
    } catch {
      return DEFAULT_SESSION_LIST_WIDTH;
    }
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  // Session list scale (pinch zoom)
  const [sessionListScale, setSessionListScale] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_LIST_SCALE_KEY);
      return saved ? parseFloat(saved) : DEFAULT_SESSION_LIST_SCALE;
    } catch {
      return DEFAULT_SESSION_LIST_SCALE;
    }
  });

  // Save session list width and scale to localStorage
  useEffect(() => {
    localStorage.setItem(SESSION_LIST_WIDTH_KEY, String(sessionListWidth));
  }, [sessionListWidth]);

  useEffect(() => {
    localStorage.setItem(SESSION_LIST_SCALE_KEY, String(sessionListScale));
  }, [sessionListScale]);

  // Handle sidebar resize drag
  useEffect(() => {
    if (!isDraggingSidebar) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      // Calculate width from right edge
      const newWidth = rect.right - clientX;
      setSessionListWidth(Math.max(MIN_SESSION_LIST_WIDTH, Math.min(MAX_SESSION_LIST_WIDTH, newWidth)));
    };

    const handleEnd = () => {
      setIsDraggingSidebar(false);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDraggingSidebar]);

  const handleSidebarDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
  }, []);

  // Pinch gesture for content scale (zoom)
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);

  const getTouchDistance = (touches: React.TouchList | TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleSidebarTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchStartRef.current = {
        distance: getTouchDistance(e.touches),
        scale: sessionListScale,
      };
    }
  }, [sessionListScale]);

  const handleSidebarTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartRef.current) {
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches);
      const ratio = currentDistance / pinchStartRef.current.distance;
      const newScale = pinchStartRef.current.scale * ratio;
      setSessionListScale(Math.max(MIN_SESSION_LIST_SCALE, Math.min(MAX_SESSION_LIST_SCALE, newScale)));
    }
  }, []);

  const handleSidebarTouchEnd = useCallback(() => {
    pinchStartRef.current = null;
  }, []);

  // Refresh terminal display (force tmux redraw without remounting)
  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (terminalRef.current?.refreshTerminal) {
      terminalRef.current.refreshTerminal();
    } else {
      // Fallback: remount terminal
      setReloadKey(prev => prev + 1);
    }
  }, []);

  // Open file viewer
  const handleOpenFileViewer = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFileViewer(true);
  }, []);

  // Register terminal ref
  useEffect(() => {
    if (sessionId && terminalRef.current) {
      terminalRefs.current.set(paneId, terminalRef.current);
    }
    return () => {
      terminalRefs.current.delete(paneId);
    };
  }, [paneId, sessionId, terminalRefs]);

  // Register session list toggle function
  useEffect(() => {
    if (sessionListToggleRefs?.current) {
      sessionListToggleRefs.current.set(paneId, () => setShowSessionList(prev => !prev));
    }
    return () => {
      sessionListToggleRefs?.current?.delete(paneId);
    };
  }, [paneId, sessionListToggleRefs]);

  const handleConnect = useCallback(() => {
    if (sessionId) {
      onSessionStateChange(sessionId, 'idle');
    }
  }, [sessionId, onSessionStateChange]);

  const handleDisconnect = useCallback(() => {
    if (sessionId) {
      onSessionStateChange(sessionId, 'disconnected');
    }
  }, [sessionId, onSessionStateChange]);

  const session = sessionId ? sessions.find(s => s.id === sessionId) : null;

  // Fetch fresh session info from API to get current ccSessionId
  const fetchSessionInfo = useCallback(async () => {
    if (!sessionId) return null;
    try {
      const response = await authFetch(`${API_BASE}/api/sessions`);
      if (response.ok) {
        const data = await response.json();
        const freshSession = data.sessions.find((s: ExtendedSession) => s.id === sessionId);
        if (freshSession) {
          setCurrentCcSessionId(freshSession.ccSessionId || null);
          setIsClaudeRunning(freshSession.currentCommand === 'claude');
          return freshSession.ccSessionId || null;
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }, [sessionId]);

  // Fetch conversation using fresh ccSessionId
  const fetchConversation = useCallback(async (ccId?: string) => {
    const targetCcSessionId = ccId || currentCcSessionId;
    if (!targetCcSessionId) return;
    try {
      const response = await authFetch(`${API_BASE}/api/sessions/history/${targetCcSessionId}/conversation`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
      }
    } catch {
      // Ignore errors
    }
  }, [currentCcSessionId]);

  // Reset conversation state when session changes
  useEffect(() => {
    setShowConversation(false);
    setMessages([]);
    setCurrentCcSessionId(null);
  }, [sessionId]);

  // Handle toggle - fetch fresh session info first
  const handleToggleConversation = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showConversation) {
      // Opening conversation - fetch fresh data
      setIsLoadingMessages(true);
      const freshCcSessionId = await fetchSessionInfo();
      if (freshCcSessionId) {
        await fetchConversation(freshCcSessionId);
      }
      setIsLoadingMessages(false);
    }
    setShowConversation(prev => !prev);
  }, [showConversation, fetchSessionInfo, fetchConversation]);

  // Check if we have a ccSessionId (from props or fresh fetch)
  const hasCcSessionId = currentCcSessionId || session?.ccSessionId;

  return (
    <div
      ref={containerRef}
      className={`h-full flex flex-col bg-gray-900 relative select-none ${isActive ? 'ring-2 ring-blue-500' : ''}`}
      onMouseDown={onFocus}
    >
      {/* Pane header - overlay on tablet, normal on desktop */}
      <div className={`flex items-center px-2 py-1 text-xs select-none ${
        isTablet
          ? 'absolute top-0 right-0 z-50 justify-end pointer-events-auto bg-black/60 backdrop-blur-sm rounded-bl-lg'
          : 'justify-between bg-black/50 border-b border-gray-700 shrink-0'
      }`}>
        {!isTablet && (
          <span className="text-white/70 truncate flex-1">
            {showConversation ? t('conversation.history') : (session?.name || t('pane.noSession'))}
          </span>
        )}
        <div className={`flex items-center ${isTablet ? 'gap-0' : 'gap-1.5'}`}>
          {/* Conversation toggle button - show for Claude sessions */}
          {(hasCcSessionId || session?.currentCommand === 'claude') && (
            <button
              onClick={handleToggleConversation}
              className={`${isTablet ? 'p-2.5' : 'p-1'} transition-colors ${
                showConversation
                  ? 'text-blue-400 hover:text-blue-300'
                  : 'text-white/50 hover:text-white/80'
              }`}
              title={showConversation ? t('conversation.backToTerminal') : t('conversation.showHistory')}
            >
              <svg className={isTablet ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </button>
          )}
          {/* File browser button */}
          {session?.currentPath && !showConversation && (
            <button
              onClick={handleOpenFileViewer}
              className={`${isTablet ? 'p-2.5' : 'p-1'} text-white/50 hover:text-white/80 transition-colors`}
              title={t('files.title')}
              data-onboarding="file-browser"
            >
              <svg className={isTablet ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          )}
          {/* Reload button */}
          {sessionId && !showConversation && (
            <button
              onClick={handleReload}
              className={`${isTablet ? 'p-2.5' : 'p-1'} text-white/50 hover:text-white/80 transition-colors`}
              title={t('files.reload')}
            >
              <svg className={isTablet ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {/* Cache clear & reload button */}
          {!isTablet && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                await Promise.all([
                  navigator.serviceWorker?.getRegistrations().then(regs => Promise.all(regs.map(r => r.unregister()))),
                  caches?.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))),
                ].filter(Boolean));
                location.reload();
              }}
              className="p-1 text-yellow-500/70 hover:text-yellow-400 transition-colors"
              title="キャッシュクリア & リロード (Ctrl+Shift+F5)"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M21 21v-5h-5" />
              </svg>
            </button>
          )}
          {/* Split buttons - desktop only */}
          {!isTablet && (
            <div className="flex items-center" data-onboarding="split-pane">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  controlModeContext.splitPane(paneId, 'h');
                }}
                className="p-1 text-white/50 hover:text-white/80 transition-colors"
                title="縦分割 (Ctrl+D)"
                data-onboarding="split-pane"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  controlModeContext.splitPane(paneId, 'v');
                }}
                className="p-1 text-white/50 hover:text-white/80 transition-colors"
                title="横分割 (Ctrl+Shift+D)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                </svg>
              </button>
            </div>
          )}
          {/* Session list toggle button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowSessionList(!showSessionList);
            }}
            className={`${isTablet ? 'p-2.5' : 'p-1'} transition-colors ${
              showSessionList
                ? 'text-blue-400 hover:text-blue-300'
                : 'text-white/50 hover:text-white/80'
            }`}
            title={showSessionList ? t('session.hideList') : t('session.showList')}
            data-onboarding="session-list"
          >
            <svg className={isTablet ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className={`${isTablet ? 'p-2.5' : 'p-1'} text-white/50 hover:text-red-400 transition-colors`}
            title={t('common.close')}
          >
            <svg className={isTablet ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal, conversation, or session selector - with optional session list sidebar */}
      <div className="flex-1 min-h-0 flex relative">
        {/* Main content */}
        <div className={`${showSessionList ? 'flex-1' : 'w-full'} min-w-0`}>
          {showConversation && currentCcSessionId ? (
            <ConversationViewer
              title="会話履歴"
              subtitle={session?.name}
              messages={messages}
              isLoading={isLoadingMessages}
              onClose={() => setShowConversation(false)}
              inline={true}
              scrollToBottom={true}
              isActive={isClaudeRunning}
              onRefresh={() => fetchConversation(currentCcSessionId || undefined)}
            />
          ) : sessionId ? (
            <TerminalComponent
              key={`${sessionId}-${reloadKey}-${globalReloadKey}`}
              ref={terminalRef}
              sessionId={sessionId}
              hideKeyboard={true}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              theme={session?.theme}
              controlMode={controlModeContext.getControlConfig(paneId)}
            />
          ) : (
            <SessionSelector
              sessions={sessions}
              onSelect={(sess) => {
                // Directly set session ID via callback
                onSelectSession(sess.id);
              }}
            />
          )}
        </div>

        {/* Resize handle - absolute, overlaying the border between terminal and sidebar */}
        <div
          onMouseDown={handleSidebarDragStart}
          onTouchStart={handleSidebarDragStart}
          className={`absolute top-0 h-full cursor-col-resize z-10 flex items-center justify-center ${
            isDraggingSidebar ? 'bg-blue-500/20' : ''
          }`}
          style={{
            width: isTablet ? 24 : 12,
            right: sessionListWidth - 8 - (isTablet ? 12 : 6),
            touchAction: 'none',
            display: showSessionList ? undefined : 'none',
          }}
        >
          <div className={`w-0.5 h-8 rounded-full transition-colors ${isDraggingSidebar ? 'bg-blue-400' : 'bg-gray-500'}`} />
        </div>

        {/* Session list sidebar - kept mounted, hidden via CSS to preserve state and polling */}
        <div
          className="flex flex-col shrink-0 overflow-hidden bg-gray-900 -ml-2 border-l border-gray-700"
          style={{
            width: sessionListWidth,
            touchAction: 'pan-y',
            display: showSessionList ? undefined : 'none',
          }}
          onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove}
          onTouchEnd={handleSidebarTouchEnd}
        >
          <div className={`px-2 py-1 bg-black/30 border-b border-gray-700 text-xs text-white/70 flex items-center justify-between shrink-0 ${isTablet ? 'mt-10' : ''}`}>
            <span>{t('session.list')}</span>
            <span className="text-white/40">{Math.round(sessionListScale * 100)}%</span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionList
              onSelectSession={(sess) => {
                onSelectSession(sess.id);
                // Keep session list open after selection
              }}
              inline={true}
              contentScale={sessionListScale}
              isOnboarding={showSessionListOnboarding}
            />
          </div>
        </div>
      </div>

      {/* File Viewer Modal */}
      {showFileViewer && session?.currentPath && (
        <FileViewer
          sessionWorkingDir={session.currentPath}
          onClose={() => setShowFileViewer(false)}
        />
      )}

      {/* Session list onboarding (for first-time users) */}
      {showSessionListOnboarding && showSessionList && onCompleteSessionListOnboarding && (
        <Onboarding type="sessionList" onComplete={onCompleteSessionListOnboarding} />
      )}
    </div>
  );
}

interface SessionSelectorProps {
  sessions: ExtendedSession[];
  onSelect: (session: ExtendedSession) => void;
}

function SessionSelector({ sessions, onSelect }: SessionSelectorProps) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center bg-gray-900 p-4">
      <p className="text-gray-400 mb-4">{t('pane.selectSession')}</p>
      <div className="max-h-64 overflow-y-auto w-full max-w-xs space-y-2">
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session)}
            className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-white text-sm transition-colors"
          >
            <div className="font-medium truncate">{session.name}</div>
            {session.currentPath && (
              <div className="text-xs text-gray-400 truncate">
                {session.currentPath.replace(/^\/home\/[^/]+\//, '~/')}
              </div>
            )}
          </button>
        ))}
        {sessions.length === 0 && (
          <p className="text-gray-500 text-sm text-center">{t('session.noSessions')}</p>
        )}
      </div>
    </div>
  );
}

interface SplitContainerProps {
  node: Extract<PaneNode, { type: 'split' }>;
  activePane: string;
  onFocusPane: (paneId: string) => void;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onSessionStateChange: (sessionId: string, state: SessionState) => void;
  onSplitRatioChange: (nodeId: string, ratio: number[]) => void;
  onClosePane: (paneId: string) => void;
  onSplit?: (direction: 'horizontal' | 'vertical') => void;
  sessions: ExtendedSession[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
  sessionListToggleRefs?: React.RefObject<Map<string, () => void>>;
  isTablet?: boolean;
  globalReloadKey?: number;
  showSessionListOnboarding?: boolean;
  onCompleteSessionListOnboarding?: () => void;
  controlModeContext: ControlModeContext;
}

function SplitContainer({
  node,
  activePane,
  onFocusPane,
  onSelectSession,
  onSessionStateChange,
  onSplitRatioChange,
  onClosePane,
  onSplit,
  sessions,
  terminalRefs,
  sessionListToggleRefs,
  isTablet = false,
  globalReloadKey = 0,
  showSessionListOnboarding = false,
  onCompleteSessionListOnboarding,
  controlModeContext,
}: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);

  // Pointer-capture based drag: all pointer events go to the captured element
  const handlePointerDown = useCallback((index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(index);
    draggingRef.current = index;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const dragIndex = draggingRef.current;
    if (dragIndex === null) return;
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientPos = node.direction === 'horizontal' ? e.clientX : e.clientY;
    const containerSize = node.direction === 'horizontal' ? rect.width : rect.height;
    const offset = node.direction === 'horizontal' ? rect.left : rect.top;

    const newRatio = [...node.ratio];
    const beforeSum = node.ratio.slice(0, dragIndex + 1).reduce((a, b) => a + b, 0);
    const afterSum = node.ratio.slice(dragIndex + 1).reduce((a, b) => a + b, 0);
    const position = ((clientPos - offset) / containerSize) * 100;
    const minRatio = 10;
    const newBefore = Math.max(minRatio, Math.min(beforeSum + afterSum - minRatio, position));
    const diff = newBefore - beforeSum;

    if (newRatio[dragIndex] !== undefined && newRatio[dragIndex + 1] !== undefined) {
      newRatio[dragIndex] = newRatio[dragIndex] + diff;
      newRatio[dragIndex + 1] = newRatio[dragIndex + 1] - diff;
      if (newRatio[dragIndex] >= minRatio && newRatio[dragIndex + 1] >= minRatio) {
        onSplitRatioChange(node.id, newRatio);
      }
    }
  }, [node, onSplitRatioChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(null);
    draggingRef.current = null;
  }, []);

  // Touch fallback for devices that don't support pointer capture well
  const handleTouchStart = useCallback((index: number) => (e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(index);
    draggingRef.current = index;
  }, []);

  useEffect(() => {
    const dragIndex = draggingRef.current;
    if (dragIndex === null) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientPos = node.direction === 'horizontal' ? e.touches[0].clientX : e.touches[0].clientY;
      const containerSize = node.direction === 'horizontal' ? rect.width : rect.height;
      const offset = node.direction === 'horizontal' ? rect.left : rect.top;

      const newRatio = [...node.ratio];
      const beforeSum = node.ratio.slice(0, dragIndex + 1).reduce((a, b) => a + b, 0);
      const afterSum = node.ratio.slice(dragIndex + 1).reduce((a, b) => a + b, 0);
      const position = ((clientPos - offset) / containerSize) * 100;
      const minRatio = 10;
      const newBefore = Math.max(minRatio, Math.min(beforeSum + afterSum - minRatio, position));
      const diff = newBefore - beforeSum;

      if (newRatio[dragIndex] !== undefined && newRatio[dragIndex + 1] !== undefined) {
        newRatio[dragIndex] = newRatio[dragIndex] + diff;
        newRatio[dragIndex + 1] = newRatio[dragIndex + 1] - diff;
        if (newRatio[dragIndex] >= minRatio && newRatio[dragIndex + 1] >= minRatio) {
          onSplitRatioChange(node.id, newRatio);
        }
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(null);
      draggingRef.current = null;
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, node, onSplitRatioChange]);

  const isHorizontal = node.direction === 'horizontal';

  // Divider size: 4px on desktop, 8px on tablet
  const dividerSize = isTablet ? 8 : 4;

  // Build elements array with panes and dividers interleaved
  const elements: React.ReactNode[] = [];
  node.children.forEach((child, index) => {
    // Child pane
    elements.push(
      <div
        key={child.id}
        style={{
          [isHorizontal ? 'width' : 'height']: `calc(${node.ratio[index]}% - ${index < node.children.length - 1 ? dividerSize / 2 : 0}px)`,
          [isHorizontal ? 'height' : 'width']: '100%',
        }}
        className="flex-shrink-0 overflow-hidden"
      >
        <PaneContainer
          node={child}
          activePane={activePane}
          onFocusPane={onFocusPane}
          onSelectSession={onSelectSession}
          onSessionStateChange={onSessionStateChange}
          onSplitRatioChange={onSplitRatioChange}
          onClosePane={onClosePane}
          onSplit={onSplit}
          sessions={sessions}
          terminalRefs={terminalRefs}
          sessionListToggleRefs={sessionListToggleRefs}
          isTablet={isTablet}
          globalReloadKey={globalReloadKey}
          showSessionListOnboarding={showSessionListOnboarding}
          onCompleteSessionListOnboarding={onCompleteSessionListOnboarding}
          controlModeContext={controlModeContext}
        />
      </div>
    );

    // Divider (not after last child)
    if (index < node.children.length - 1) {
      elements.push(
        <div
          key={`divider-${child.id}`}
          style={{
            [isHorizontal ? 'width' : 'height']: `${dividerSize}px`,
            position: 'relative',
          }}
          className={`
            ${isHorizontal ? 'h-full cursor-col-resize' : 'w-full cursor-row-resize'}
            flex items-center justify-center bg-gray-700 hover:bg-blue-500/50 transition-colors flex-shrink-0 z-10
            ${isDragging === index ? 'bg-blue-500/70' : ''}
          `}
        >
          {/* Expanded touch/click target for easier dragging */}
          <div
            onPointerDown={handlePointerDown(index)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onTouchStart={handleTouchStart(index)}
            style={{
              position: 'absolute',
              [isHorizontal ? 'left' : 'top']: isTablet ? '-16px' : '-8px',
              [isHorizontal ? 'right' : 'bottom']: isTablet ? '-16px' : '-8px',
              [isHorizontal ? 'top' : 'left']: '0',
              [isHorizontal ? 'bottom' : 'right']: '0',
              touchAction: 'none',
              zIndex: 20,
            }}
            className={isHorizontal ? 'cursor-col-resize' : 'cursor-row-resize'}
          />
          <div className={`
            ${isHorizontal ? 'w-0.5 h-8' : 'h-0.5 w-8'}
            bg-gray-500 rounded-full pointer-events-none
          `} />
        </div>
      );
    }
  });

  return (
    <div
      ref={containerRef}
      className={`h-full w-full flex select-none ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      {elements}
    </div>
  );
}
