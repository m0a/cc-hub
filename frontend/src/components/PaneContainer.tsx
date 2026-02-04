import { useRef, useCallback, useState, useEffect } from 'react';
import { TerminalComponent, type TerminalRef } from './Terminal';
import { ConversationViewer } from './ConversationViewer';
import { FileViewer } from './files/FileViewer';
import type { SessionState, ConversationMessage } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

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
}

interface PaneContainerProps {
  node: PaneNode;
  activePane: string;
  onFocusPane: (paneId: string) => void;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onSessionStateChange: (sessionId: string, state: SessionState) => void;
  onSplitRatioChange: (nodeId: string, ratio: number[]) => void;
  onClosePane: (paneId: string) => void;
  sessions: ExtendedSession[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
  isTablet?: boolean;
  globalReloadKey?: number;
}

export function PaneContainer({
  node,
  activePane,
  onFocusPane,
  onSelectSession,
  onSessionStateChange,
  onSplitRatioChange,
  onClosePane,
  sessions,
  terminalRefs,
  isTablet = false,
  globalReloadKey = 0,
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
        sessions={sessions}
        terminalRefs={terminalRefs}
        globalReloadKey={globalReloadKey}
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
        sessions={sessions}
        terminalRefs={terminalRefs}
        isTablet={isTablet}
        globalReloadKey={globalReloadKey}
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
      sessions={sessions}
      terminalRefs={terminalRefs}
      globalReloadKey={globalReloadKey}
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
  sessions: ExtendedSession[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
  globalReloadKey?: number;
}

function TerminalPane({
  paneId,
  sessionId,
  isActive,
  onFocus,
  onSelectSession,
  onSessionStateChange,
  onClose,
  sessions,
  terminalRefs,
  globalReloadKey = 0,
}: TerminalPaneProps) {
  const terminalRef = useRef<TerminalRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showConversation, setShowConversation] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [currentCcSessionId, setCurrentCcSessionId] = useState<string | null>(null);
  const [isClaudeRunning, setIsClaudeRunning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showFileViewer, setShowFileViewer] = useState(false);

  // Reload terminal by remounting
  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadKey(prev => prev + 1);
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
      const response = await fetch(`${API_BASE}/api/sessions`);
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
      const response = await fetch(`${API_BASE}/api/sessions/history/${targetCcSessionId}/conversation`);
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
      className={`h-full flex flex-col bg-gray-900 ${isActive ? 'ring-2 ring-blue-500' : ''}`}
      onClick={onFocus}
    >
      {/* Pane header */}
      <div className="flex items-center justify-between px-2 py-1 bg-black/50 border-b border-gray-700 shrink-0 text-xs">
        <span className="text-white/70 truncate flex-1">
          {showConversation ? '会話履歴' : (session?.name || 'セッション未選択')}
        </span>
        <div className="flex items-center gap-1">
          {/* Conversation toggle button - show for Claude sessions */}
          {(hasCcSessionId || session?.currentCommand === 'claude') && (
            <button
              onClick={handleToggleConversation}
              className={`p-0.5 transition-colors ${
                showConversation
                  ? 'text-blue-400 hover:text-blue-300'
                  : 'text-white/50 hover:text-white/80'
              }`}
              title={showConversation ? 'ターミナルに戻る' : '会話履歴を表示'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </button>
          )}
          {/* File browser button */}
          {session?.currentPath && !showConversation && (
            <button
              onClick={handleOpenFileViewer}
              className="p-0.5 text-white/50 hover:text-white/80 transition-colors"
              title="ファイルブラウザ"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          )}
          {/* Reload button */}
          {sessionId && !showConversation && (
            <button
              onClick={handleReload}
              className="p-0.5 text-white/50 hover:text-white/80 transition-colors"
              title="リロード"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {/* Session change button */}
          {sessionId && !showConversation && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectSession();
              }}
              className="p-0.5 text-white/50 hover:text-white/80 transition-colors"
              title="セッション変更"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
              </svg>
            </button>
          )}
          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-0.5 text-white/50 hover:text-red-400 transition-colors"
            title="ペインを閉じる"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal, conversation, or session selector - with optional session list sidebar */}
      <div className="flex-1 min-h-0 flex">
        {/* Main content */}
        <div className="w-full min-w-0">
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

      </div>

      {/* File Viewer Modal */}
      {showFileViewer && session?.currentPath && (
        <FileViewer
          sessionWorkingDir={session.currentPath}
          onClose={() => setShowFileViewer(false)}
        />
      )}
    </div>
  );
}

interface SessionSelectorProps {
  sessions: ExtendedSession[];
  onSelect: (session: ExtendedSession) => void;
}

function SessionSelector({ sessions, onSelect }: SessionSelectorProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-gray-900 p-4">
      <p className="text-gray-400 mb-4">セッションを選択してください</p>
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
          <p className="text-gray-500 text-sm text-center">セッションがありません</p>
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
  sessions: ExtendedSession[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
  isTablet?: boolean;
  globalReloadKey?: number;
}

function SplitContainer({
  node,
  activePane,
  onFocusPane,
  onSelectSession,
  onSessionStateChange,
  onSplitRatioChange,
  onClosePane,
  sessions,
  terminalRefs,
  isTablet = false,
  globalReloadKey = 0,
}: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(index);
  }, []);

  useEffect(() => {
    if (isDragging === null) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientPos = 'touches' in e
        ? (node.direction === 'horizontal' ? e.touches[0].clientX : e.touches[0].clientY)
        : (node.direction === 'horizontal' ? e.clientX : e.clientY);

      const containerSize = node.direction === 'horizontal' ? rect.width : rect.height;
      const offset = node.direction === 'horizontal' ? rect.left : rect.top;

      // Calculate new ratios
      const newRatio = [...node.ratio];
      const beforeSum = node.ratio.slice(0, isDragging + 1).reduce((a, b) => a + b, 0);
      const afterSum = node.ratio.slice(isDragging + 1).reduce((a, b) => a + b, 0);

      const position = ((clientPos - offset) / containerSize) * 100;
      const minRatio = 10; // 10% minimum

      // Adjust ratio at drag point
      const newBefore = Math.max(minRatio, Math.min(beforeSum + afterSum - minRatio, position));
      const diff = newBefore - beforeSum;

      if (newRatio[isDragging] !== undefined && newRatio[isDragging + 1] !== undefined) {
        newRatio[isDragging] = newRatio[isDragging] + diff;
        newRatio[isDragging + 1] = newRatio[isDragging + 1] - diff;

        // Clamp values
        if (newRatio[isDragging] >= minRatio && newRatio[isDragging + 1] >= minRatio) {
          onSplitRatioChange(node.id, newRatio);
        }
      }
    };

    const handleEnd = () => {
      setIsDragging(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, node, onSplitRatioChange]);

  const isHorizontal = node.direction === 'horizontal';

  // Divider size: 4px on desktop, 8px on tablet for easier touch
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
          sessions={sessions}
          terminalRefs={terminalRefs}
          isTablet={isTablet}
          globalReloadKey={globalReloadKey}
        />
      </div>
    );

    // Divider (not after last child)
    if (index < node.children.length - 1) {
      elements.push(
        <div
          key={`divider-${child.id}`}
          onMouseDown={handleDragStart(index)}
          onTouchStart={handleDragStart(index)}
          style={{
            [isHorizontal ? 'width' : 'height']: `${dividerSize}px`,
          }}
          className={`
            ${isHorizontal ? 'h-full cursor-col-resize' : 'w-full cursor-row-resize'}
            flex items-center justify-center bg-gray-700 hover:bg-blue-500/50 transition-colors flex-shrink-0 z-10
            ${isDragging === index ? 'bg-blue-500/70' : ''}
          `}
        >
          <div className={`
            ${isHorizontal ? 'w-0.5 h-8' : 'h-0.5 w-8'}
            bg-gray-500 rounded-full
          `} />
        </div>
      );
    }
  });

  return (
    <div
      ref={containerRef}
      className={`h-full w-full flex ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      {elements}
    </div>
  );
}
