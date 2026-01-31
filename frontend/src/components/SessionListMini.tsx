import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionResponse, IndicatorState, ConversationMessage } from '../../../shared/types';
import { useSessions } from '../hooks/useSessions';
import { useSessionHistory } from '../hooks/useSessionHistory';
import { SessionHistory } from './SessionHistory';
import { ConversationViewer } from './ConversationViewer';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface SessionListMiniProps {
  onSelectSession: (session: SessionResponse) => void;
  activeSessionId: string | null;
  onCreateSession?: () => void;
}

// Get indicator color and icon for session state
function getIndicatorStyle(state?: IndicatorState): { color: string; icon: string } {
  switch (state) {
    case 'processing':
      return { color: 'bg-green-500 animate-pulse', icon: '' };
    case 'waiting_input':
      return { color: 'bg-yellow-500 animate-pulse', icon: '' };
    case 'idle':
      return { color: 'bg-blue-500', icon: '' };
    case 'completed':
    default:
      return { color: 'bg-gray-500', icon: '' };
  }
}

// Compact session item for tablet view
function SessionMiniItem({
  session,
  isActive,
  onClick,
  onResume,
  onShowConversation,
}: {
  session: SessionResponse;
  isActive: boolean;
  onClick: () => void;
  onResume?: (sessionId: string, ccSessionId?: string) => void;
  onShowConversation?: (ccSessionId: string, title: string, subtitle: string) => void;
}) {
  // Get extra session info
  const extSession = session as SessionResponse & {
    currentCommand?: string;
    currentPath?: string;
    paneTitle?: string;
    ccSummary?: string;
    ccFirstPrompt?: string;
    waitingForInput?: boolean;
    waitingToolName?: string;
    indicatorState?: IndicatorState;
    ccSessionId?: string;
  };

  const isClaudeRunning = extSession.currentCommand === 'claude';
  const indicatorState = extSession.indicatorState || (isClaudeRunning ? 'processing' : 'completed');
  const isWaiting = extSession.waitingForInput;
  const waitingLabel = extSession.waitingToolName === 'AskUserQuestion' ? '質問'
    : extSession.waitingToolName === 'EnterPlanMode' ? '計画'
    : extSession.waitingToolName === 'ExitPlanMode' ? '計画'
    : extSession.waitingToolName ? '許可'
    : '入力';

  // Use pane title if cc is running and title exists, otherwise use session name
  const displayTitle = isClaudeRunning && extSession.paneTitle
    ? extSession.paneTitle.replace(/^[✳★●◆]\s*/, '')  // Remove status icons
    : session.name;

  const { color: indicatorColor } = getIndicatorStyle(indicatorState);

  // Show resume button only when Claude is not running and we have a ccSessionId
  const showResumeButton = !isClaudeRunning && extSession.ccSessionId;

  // Show conversation button when we have a ccSessionId
  const showConversationButton = !!extSession.ccSessionId;

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResume?.(session.id, extSession.ccSessionId);
  };

  const handleShowConversation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (extSession.ccSessionId) {
      const title = extSession.ccSummary || extSession.ccFirstPrompt || session.name;
      const subtitle = extSession.currentPath?.replace(/^\/home\/[^/]+\//, '~/') || '';
      onShowConversation?.(extSession.ccSessionId, title, subtitle);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`px-2 py-1.5 cursor-pointer transition-colors border-b border-gray-700/50 ${
        isActive ? 'bg-blue-900/50' : 'hover:bg-gray-700/50 active:bg-gray-600/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${indicatorColor}`} />
        <span className="text-sm text-white truncate flex-1">{displayTitle}</span>
        {isWaiting && (
          <span className="text-[10px] text-yellow-400 bg-yellow-900/50 px-1 rounded shrink-0">{waitingLabel}</span>
        )}
        {isClaudeRunning && !isWaiting && (
          <span className="text-[10px] text-green-400 bg-green-900/50 px-1 rounded shrink-0">cc</span>
        )}
        {showConversationButton && (
          <button
            onClick={handleShowConversation}
            className="text-[10px] text-gray-400 bg-gray-700/50 px-1 rounded shrink-0 hover:bg-gray-600/50"
            title="View conversation history"
          >
            履歴
          </button>
        )}
        {showResumeButton && (
          <button
            onClick={handleResume}
            className="text-[10px] text-blue-400 bg-blue-900/50 px-1 rounded shrink-0 hover:bg-blue-800/50"
            title="Resume Claude session"
          >
            再開
          </button>
        )}
      </div>
      {(extSession.ccSummary || extSession.ccFirstPrompt) && (
        <div className="text-[10px] text-blue-400 mt-0.5 truncate pl-3.5">
          {extSession.ccSummary || extSession.ccFirstPrompt}
        </div>
      )}
    </div>
  );
}

type TabType = 'sessions' | 'history';

export function SessionListMini({ onSelectSession, activeSessionId, onCreateSession }: SessionListMiniProps) {
  const { sessions, fetchSessions } = useSessions();
  const { fetchConversation } = useSessionHistory();
  const containerRef = useRef<HTMLDivElement>(null);
  const [resumingSession, setResumingSession] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('sessions');

  // Conversation viewer state
  const [viewingConversation, setViewingConversation] = useState<{
    sessionId: string;
    title: string;
    subtitle: string;
  } | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);

  useEffect(() => {
    fetchSessions();

    // Poll every 5 seconds for updates
    const interval = setInterval(() => {
      fetchSessions();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Scroll active session into view
  useEffect(() => {
    if (activeSessionId && containerRef.current) {
      const activeElement = containerRef.current.querySelector(`[data-session-id="${activeSessionId}"]`);
      activeElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeSessionId, sessions]);

  // Resume a Claude session
  const handleResume = useCallback(async (sessionId: string, ccSessionId?: string) => {
    setResumingSession(sessionId);
    try {
      const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ccSessionId }),
      });
      if (response.ok) {
        // Find and select the session
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          onSelectSession(session);
        }
        // Refresh sessions after a short delay
        setTimeout(fetchSessions, 1000);
      }
    } catch (err) {
      console.error('Failed to resume session:', err);
    } finally {
      setResumingSession(null);
    }
  }, [sessions, onSelectSession, fetchSessions]);

  // Handle session resumed from history
  const handleHistorySessionResumed = useCallback((tmuxSessionId: string) => {
    // Refresh sessions and select the new one
    fetchSessions();
    setTimeout(() => {
      const newSession = sessions.find(s => s.id === tmuxSessionId);
      if (newSession) {
        onSelectSession(newSession);
      }
    }, 500);
    setActiveTab('sessions');
  }, [sessions, onSelectSession, fetchSessions]);

  // Show conversation for an active session
  const handleShowConversation = useCallback(async (ccSessionId: string, title: string, subtitle: string) => {
    setViewingConversation({ sessionId: ccSessionId, title, subtitle });
    setLoadingConversation(true);
    setConversation([]);
    try {
      const messages = await fetchConversation(ccSessionId);
      setConversation(messages);
    } finally {
      setLoadingConversation(false);
    }
  }, [fetchConversation]);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-700 shrink-0">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('sessions')}
            className={`text-xs font-medium px-1 ${
              activeTab === 'sessions' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            セッション
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`text-xs font-medium px-1 ${
              activeTab === 'history' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            履歴
          </button>
        </div>
        {activeTab === 'sessions' && onCreateSession && (
          <button
            onClick={onCreateSession}
            className="text-xs text-blue-400 hover:text-blue-300 px-1"
          >
            + 新規
          </button>
        )}
      </div>

      {/* Content area */}
      {activeTab === 'sessions' ? (
        <div ref={containerRef} className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-4">
              セッションなし
            </div>
          ) : (
            sessions.map((session) => (
              <div key={session.id} data-session-id={session.id}>
                <SessionMiniItem
                  session={session}
                  isActive={session.id === activeSessionId}
                  onClick={() => onSelectSession(session)}
                  onResume={handleResume}
                  onShowConversation={handleShowConversation}
                />
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <SessionHistory onSessionResumed={handleHistorySessionResumed} />
        </div>
      )}

      {/* Conversation viewer modal */}
      {viewingConversation && (
        <ConversationViewer
          title={viewingConversation.title}
          subtitle={viewingConversation.subtitle}
          messages={conversation}
          isLoading={loadingConversation}
          onClose={() => setViewingConversation(null)}
        />
      )}
    </div>
  );
}
