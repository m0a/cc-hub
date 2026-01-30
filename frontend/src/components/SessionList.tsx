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
            削除する
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
  formatDate,
}: {
  session: SessionResponse;
  onSelect: (session: SessionResponse) => void;
  onDelete: (session: SessionResponse) => void;
  getStateColor: (state: SessionResponse['state']) => string;
  formatDate: (dateStr: string) => string;
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

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      className="p-3 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${getStateColor(session.state)}`} />
        <span className="font-medium">{session.name}</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <div className="text-xs text-gray-500">
          最終アクセス: {formatDate(session.lastAccessedAt)}
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
    externalSessions,
    isLoading,
    error,
    fetchSessions,
    fetchExternalSessions,
    createSession,
    deleteSession,
  } = useSessions();

  const [newSessionName, setNewSessionName] = useState('');
  const [sessionToDelete, setSessionToDelete] = useState<SessionResponse | null>(null);
  const [showExternal, setShowExternal] = useState(false);

  useEffect(() => {
    fetchSessions();
    fetchExternalSessions();
  }, [fetchSessions, fetchExternalSessions]);

  const handleCreateSession = async () => {
    const session = await createSession(newSessionName || undefined);
    if (session) {
      setNewSessionName('');
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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-4 mb-4">
          {onBack && (
            <button
              onClick={onBack}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors"
            >
              &larr; 戻る
            </button>
          )}
          <h1 className="text-xl font-bold">CC Hub - Sessions</h1>
        </div>

        {/* Create new session */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="セッション名（任意）"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateSession()}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCreateSession}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition-colors"
          >
            新規
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-900/50 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* CC Hub Sessions */}
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
                onDelete={(s) => setSessionToDelete(s)}
                getStateColor={getStateColor}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}

        {/* External tmux sessions */}
        {externalSessions.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setShowExternal(!showExternal)}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 mb-2"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showExternal ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              既存のtmuxセッション ({externalSessions.length})
            </button>
            {showExternal && (
              <div className="space-y-2 pl-2 border-l-2 border-gray-700">
                {externalSessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => onSelectSession({ ...session, id: `ext:${session.id}` })}
                    className="p-3 bg-gray-800/50 hover:bg-gray-700 active:bg-gray-600 rounded cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${getStateColor(session.state)}`} />
                      <span className="font-medium">{session.name}</span>
                      <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">tmux</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      作成: {formatDate(session.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
    </div>
  );
}
