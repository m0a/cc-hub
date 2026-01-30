import { useEffect, useState, useRef } from 'react';
import type { SessionResponse } from '../../../shared/types';
import { useSessions } from '../hooks/useSessions';

interface SessionListProps {
  onSelectSession: (session: SessionResponse) => void;
  onBack?: () => void;
}

// Confirm dialog for delete
function ConfirmDialog({
  session,
  onConfirm,
  onCancel,
}: {
  session: SessionResponse;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="text-lg font-bold text-white mb-2">セッションを削除</h3>
        <p className="text-gray-300 mb-4">
          <span className="font-medium text-white">{session.name}</span> を削除しますか？
        </p>
        <p className="text-sm text-red-400 mb-6">
          この操作は取り消せません。
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-medium transition-colors"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}

// Create session modal
function CreateSessionModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    onConfirm(name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="text-lg font-bold text-white mb-4">新規セッション</h3>
        <input
          ref={inputRef}
          type="text"
          placeholder="セッション名（空欄で自動生成）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition-colors"
          >
            作成
          </button>
        </div>
      </div>
    </div>
  );
}

// Session item with long press to delete
function SessionItem({
  session,
  onSelect,
  onDelete,
  getStateColor,
}: {
  session: SessionResponse;
  onSelect: (session: SessionResponse) => void;
  onDelete: (session: SessionResponse) => void;
  getStateColor: (state: SessionResponse['state']) => string;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const handleTouchStart = () => {
    longPressFiredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onDelete(session);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressFiredRef.current = false;
  };

  const handleClick = () => {
    if (!longPressFiredRef.current) {
      onSelect(session);
    }
    longPressFiredRef.current = false;
  };

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
  const waitingLabel = extSession.waitingToolName === 'AskUserQuestion' ? '質問待ち'
    : extSession.waitingToolName === 'EnterPlanMode' ? '計画承認待ち'
    : extSession.waitingToolName === 'ExitPlanMode' ? '計画承認待ち'
    : extSession.waitingToolName ? '許可待ち'
    : '入力待ち';
  const shortPath = extSession.currentPath?.replace(/^\/home\/[^/]+\//, '~/') || '';

  // Use pane title if cc is running and title exists, otherwise use session name
  const displayTitle = isClaudeRunning && extSession.paneTitle
    ? extSession.paneTitle.replace(/^[✳★●◆]\s*/, '')  // Remove status icons
    : session.name;

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      className="p-3 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isWaiting ? 'bg-red-500 animate-pulse' : getStateColor(session.state)}`} />
        <span className="font-medium truncate flex-1">{displayTitle}</span>
        {isWaiting && (
          <span className="text-xs text-red-400 bg-red-900/50 px-1.5 py-0.5 rounded shrink-0">{waitingLabel}</span>
        )}
        {isClaudeRunning && !isWaiting && (
          <span className="text-xs text-purple-400 bg-purple-900/50 px-1.5 py-0.5 rounded shrink-0">cc</span>
        )}
      </div>
      {shortPath && (
        <div className="text-xs text-gray-400 mt-1 truncate">
          {shortPath}
        </div>
      )}
      {(extSession.ccSummary || extSession.ccFirstPrompt) && (
        <div className="text-xs text-blue-400 mt-1 truncate">
          {extSession.ccSummary || extSession.ccFirstPrompt}
        </div>
      )}
      <div className="flex items-center justify-between mt-1">
        <div className="text-xs text-gray-600">
          {session.name}
        </div>
        <div className="text-xs text-gray-600">
          長押しで削除
        </div>
      </div>
    </div>
  );
}

export function SessionList({ onSelectSession, onBack }: SessionListProps) {
  const {
    sessions,
    isLoading,
    error,
    fetchSessions,
    createSession,
    deleteSession,
  } = useSessions();

  const [sessionToDelete, setSessionToDelete] = useState<SessionResponse | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchSessions();

    // Poll every 5 seconds for updates
    const interval = setInterval(() => {
      fetchSessions();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleCreateSession = async (name: string) => {
    const session = await createSession(name || undefined);
    if (session) {
      setShowCreateModal(false);
      onSelectSession(session);
    }
  };

  const handleConfirmDelete = async () => {
    if (sessionToDelete) {
      await deleteSession(sessionToDelete.id);
      setSessionToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setSessionToDelete(null);
  };

  const handleDeleteRequest = (session: SessionResponse) => {
    setSessionToDelete(session);
  };

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

  if (isLoading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-gray-400">Loading sessions...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        {onBack ? (
          <button
            onClick={onBack}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <div className="w-9" />
        )}
        <button
          onClick={() => setShowCreateModal(true)}
          className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-900/50 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-4">
        {sessions.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            セッションがありません。新規作成してください。
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onSelect={onSelectSession}
                onDelete={handleDeleteRequest}
                getStateColor={getStateColor}
              />
            ))}
          </div>
        )}
      </div>

      {/* Confirm delete dialog */}
      {sessionToDelete && (
        <ConfirmDialog
          session={sessionToDelete}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {/* Create session modal */}
      {showCreateModal && (
        <CreateSessionModal
          onConfirm={handleCreateSession}
          onCancel={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
