import { useState, useCallback, useEffect } from 'react';
import { TerminalPage } from './pages/TerminalPage';
import { SessionList } from './components/SessionList';
import { SessionTabs, type OpenSession } from './components/SessionTabs';
import type { SessionResponse, SessionState } from '../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

// Confirm dialog for delete
function ConfirmDeleteDialog({
  sessionName,
  onConfirm,
  onCancel,
}: {
  sessionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="text-lg font-bold text-white mb-2">セッションを削除</h3>
        <p className="text-gray-300 mb-4">
          <span className="font-medium text-white">{sessionName}</span> を削除しますか？
        </p>
        <p className="text-sm text-red-400 mb-6">
          この操作は取り消せません。
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition-colors text-white"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-medium transition-colors text-white"
          >
            削除する
          </button>
        </div>
      </div>
    </div>
  );
}

// localStorage keys for session persistence
const STORAGE_KEY_LAST_SESSION = 'cchub-last-session-id';
const STORAGE_KEY_OPEN_SESSIONS = 'cchub-open-sessions';

function saveLastSession(sessionId: string | null) {
  if (sessionId) {
    localStorage.setItem(STORAGE_KEY_LAST_SESSION, sessionId);
  } else {
    localStorage.removeItem(STORAGE_KEY_LAST_SESSION);
  }
}

function getLastSession(): string | null {
  return localStorage.getItem(STORAGE_KEY_LAST_SESSION);
}

function saveOpenSessions(sessions: OpenSession[]) {
  localStorage.setItem(STORAGE_KEY_OPEN_SESSIONS, JSON.stringify(sessions.map(s => s.id)));
}

function getSavedOpenSessionIds(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_OPEN_SESSIONS);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function App() {
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSessionList, setShowSessionList] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<OpenSession | null>(null);

  // On mount, fetch sessions and restore from localStorage
  useEffect(() => {
    const fetchAndOpenSession = async () => {
      try {
        // Fetch both regular and external sessions
        const [sessionsRes, externalRes] = await Promise.all([
          fetch(`${API_BASE}/api/sessions`),
          fetch(`${API_BASE}/api/sessions/external`),
        ]);

        const allSessions: SessionResponse[] = sessionsRes.ok
          ? (await sessionsRes.json()).sessions
          : [];

        const externalSessions: SessionResponse[] = externalRes.ok
          ? (await externalRes.json()).sessions
          : [];

        // Try to restore previously open sessions
        const savedSessionIds = getSavedOpenSessionIds();
        const lastSessionId = getLastSession();

        if (savedSessionIds.length > 0) {
          // Restore saved sessions (both regular and external)
          const sessionsToOpen: OpenSession[] = [];

          for (const id of savedSessionIds) {
            if (id.startsWith('ext:')) {
              // External session
              const extId = id.slice(4);
              const extSession = externalSessions.find(s => s.id === extId);
              if (extSession) {
                sessionsToOpen.push({
                  id: id,
                  name: extSession.name,
                  state: extSession.state,
                });
              }
            } else {
              // Regular session
              const session = allSessions.find(s => s.id === id);
              if (session) {
                sessionsToOpen.push({
                  id: session.id,
                  name: session.name,
                  state: session.state,
                });
              }
            }
          }

          if (sessionsToOpen.length > 0) {
            setOpenSessions(sessionsToOpen);

            // Set active session: prefer last active, fallback to first open
            const validIds = sessionsToOpen.map(s => s.id);
            const activeId = lastSessionId && validIds.includes(lastSessionId)
              ? lastSessionId
              : validIds[0];
            setActiveSessionId(activeId);
          } else if (allSessions.length > 0) {
            // No valid saved sessions, open most recent
            const mostRecent = allSessions[0];
            setOpenSessions([{
              id: mostRecent.id,
              name: mostRecent.name,
              state: mostRecent.state,
            }]);
            setActiveSessionId(mostRecent.id);
          } else {
            setShowSessionList(true);
          }
        } else if (allSessions.length > 0) {
          // No saved sessions, open most recent
          const mostRecent = allSessions[0];
          setOpenSessions([{
            id: mostRecent.id,
            name: mostRecent.name,
            state: mostRecent.state,
          }]);
          setActiveSessionId(mostRecent.id);
        } else {
          setShowSessionList(true);
        }
      } catch {
        setShowSessionList(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndOpenSession();
  }, []);

  // Save to localStorage when sessions change
  useEffect(() => {
    if (openSessions.length > 0) {
      saveOpenSessions(openSessions);
    }
  }, [openSessions]);

  // Save active session to localStorage
  useEffect(() => {
    saveLastSession(activeSessionId);
  }, [activeSessionId]);

  const handleSelectSession = useCallback((session: SessionResponse) => {
    // Check if already open
    const existing = openSessions.find(s => s.id === session.id);
    if (existing) {
      setActiveSessionId(session.id);
    } else {
      // Add to open sessions
      setOpenSessions(prev => [...prev, {
        id: session.id,
        name: session.name,
        state: session.state,
      }]);
      setActiveSessionId(session.id);
    }
    setShowSessionList(false);
  }, [openSessions]);

  const handleCloseSession = useCallback((id: string) => {
    setOpenSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);

      // If closing the active session, switch to another
      if (id === activeSessionId) {
        if (filtered.length > 0) {
          setActiveSessionId(filtered[filtered.length - 1].id);
        } else {
          setActiveSessionId(null);
          setShowSessionList(true);
        }
      }

      return filtered;
    });
  }, [activeSessionId]);

  // Show delete confirmation dialog
  const handleDeleteSessionRequest = useCallback((id: string) => {
    const session = openSessions.find(s => s.id === id);
    if (session) {
      setSessionToDelete(session);
    }
  }, [openSessions]);

  // Actually delete the session
  const handleConfirmDelete = useCallback(async () => {
    if (!sessionToDelete) return;

    try {
      const response = await fetch(`${API_BASE}/api/sessions/${sessionToDelete.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Close the tab first
        handleCloseSession(sessionToDelete.id);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setSessionToDelete(null);
    }
  }, [sessionToDelete, handleCloseSession]);

  const handleCancelDelete = useCallback(() => {
    setSessionToDelete(null);
  }, []);

  const handleNewSession = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const session = await response.json() as SessionResponse;
        setOpenSessions(prev => [...prev, {
          id: session.id,
          name: session.name,
          state: session.state,
        }]);
        setActiveSessionId(session.id);
        setShowSessionList(false);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, []);

  const handleSwitchTab = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleShowSessionList = useCallback(() => {
    setShowSessionList(true);
  }, []);

  const handleBackFromList = useCallback(() => {
    if (openSessions.length > 0) {
      setShowSessionList(false);
    }
  }, [openSessions.length]);

  // Update session state (called from terminal)
  const updateSessionState = useCallback((id: string, state: SessionState) => {
    setOpenSessions(prev =>
      prev.map(s => s.id === id ? { ...s, state } : s)
    );
  }, []);

  // Show loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // Show session list
  if (showSessionList) {
    return (
      <SessionList
        onSelectSession={handleSelectSession}
        onBack={openSessions.length > 0 ? handleBackFromList : undefined}
      />
    );
  }

  // Show terminal with tabs - keep all terminals mounted but hidden
  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Tabs */}
      <SessionTabs
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSwitchTab}
        onCloseSession={handleCloseSession}
        onDeleteSession={handleDeleteSessionRequest}
        onNewSession={handleNewSession}
        onShowSessionList={handleShowSessionList}
      />

      {/* Terminals - all stay mounted, only active one is visible */}
      {openSessions.map((session) => (
        <div
          key={session.id}
          className={session.id === activeSessionId ? 'flex-1 flex flex-col min-h-0' : 'hidden'}
        >
          <TerminalPage
            sessionId={session.id}
            onStateChange={(state) => updateSessionState(session.id, state)}
          />
        </div>
      ))}

      {/* Delete confirmation dialog */}
      {sessionToDelete && (
        <ConfirmDeleteDialog
          sessionName={sessionToDelete.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
}
