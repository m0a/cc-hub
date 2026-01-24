import { useEffect, useState } from 'react';
import type { SessionResponse } from '../../../shared/types';
import { useSessions } from '../hooks/useSessions';

interface SessionListProps {
  onSelectSession: (sessionId: string) => void;
}

export function SessionList({ onSelectSession }: SessionListProps) {
  const {
    sessions,
    isLoading,
    error,
    fetchSessions,
    createSession,
    deleteSession,
  } = useSessions();

  const [newSessionName, setNewSessionName] = useState('');

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleCreateSession = async () => {
    const session = await createSession(newSessionName || undefined);
    if (session) {
      setNewSessionName('');
      onSelectSession(session.id);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('このセッションを削除しますか？')) {
      await deleteSession(id);
    }
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
        <h1 className="text-xl font-bold mb-4">CC Hub</h1>

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
        {sessions.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            セッションがありません。新規作成してください。
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className="p-3 bg-gray-800 hover:bg-gray-700 rounded cursor-pointer transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${getStateColor(session.state)}`} />
                    <span className="font-medium">{session.name}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-all"
                  >
                    削除
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  最終アクセス: {formatDate(session.lastAccessedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
