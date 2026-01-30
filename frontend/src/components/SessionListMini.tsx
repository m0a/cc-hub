import { useEffect, useRef } from 'react';
import type { SessionResponse } from '../../../shared/types';
import { useSessions } from '../hooks/useSessions';

interface SessionListMiniProps {
  onSelectSession: (session: SessionResponse) => void;
  activeSessionId: string | null;
  onCreateSession?: () => void;
}

// Compact session item for tablet view
function SessionMiniItem({
  session,
  isActive,
  onClick,
}: {
  session: SessionResponse;
  isActive: boolean;
  onClick: () => void;
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
  };

  const isClaudeRunning = extSession.currentCommand === 'claude';
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

  const getStateColor = (state: SessionResponse['state']) => {
    switch (state) {
      case 'idle':
        return 'bg-green-500';
      case 'working':
        return 'bg-yellow-500';
      case 'waiting_input':
      case 'waiting_permission':
        return 'bg-red-500';
      case 'disconnected':
        return 'bg-gray-500';
      default:
        return 'bg-gray-500';
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
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isWaiting ? 'bg-red-500 animate-pulse' : getStateColor(session.state)}`} />
        <span className="text-sm text-white truncate flex-1">{displayTitle}</span>
        {isWaiting && (
          <span className="text-[10px] text-red-400 bg-red-900/50 px-1 rounded shrink-0">{waitingLabel}</span>
        )}
        {isClaudeRunning && !isWaiting && (
          <span className="text-[10px] text-purple-400 bg-purple-900/50 px-1 rounded shrink-0">cc</span>
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

export function SessionListMini({ onSelectSession, activeSessionId, onCreateSession }: SessionListMiniProps) {
  const { sessions, fetchSessions } = useSessions();
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-700 shrink-0">
        <span className="text-xs text-gray-400 font-medium">Sessions</span>
        {onCreateSession && (
          <button
            onClick={onCreateSession}
            className="text-xs text-blue-400 hover:text-blue-300 px-1"
          >
            + 新規
          </button>
        )}
      </div>

      {/* Session list */}
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
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
