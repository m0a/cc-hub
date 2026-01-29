import { useState, useCallback, useEffect } from 'react';
import { TerminalPage } from './pages/TerminalPage';
import { SessionList } from './components/SessionList';
import { SessionTabs, type OpenSession } from './components/SessionTabs';
import type { SessionResponse, SessionState } from '../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

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

  // On mount, fetch sessions and restore from localStorage
  useEffect(() => {
    const fetchAndOpenSession = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/sessions`);
        if (response.ok) {
          const data = await response.json();
          const allSessions = data.sessions as SessionResponse[];

          if (allSessions.length > 0) {
            // Try to restore previously open sessions
            const savedSessionIds = getSavedOpenSessionIds();
            const lastSessionId = getLastSession();

            // Filter to only sessions that still exist
            const validSavedIds = savedSessionIds.filter(id =>
              allSessions.some(s => s.id === id)
            );

            if (validSavedIds.length > 0) {
              // Restore saved open sessions
              const sessionsToOpen = validSavedIds
                .map(id => allSessions.find(s => s.id === id))
                .filter((s): s is SessionResponse => s !== undefined);

              setOpenSessions(sessionsToOpen.map(s => ({
                id: s.id,
                name: s.name,
                state: s.state,
              })));

              // Set active session: prefer last active, fallback to first open
              const activeId = lastSessionId && validSavedIds.includes(lastSessionId)
                ? lastSessionId
                : validSavedIds[0];
              setActiveSessionId(activeId);
            } else {
              // No saved sessions, open most recent
              const mostRecent = allSessions[0];
              setOpenSessions([{
                id: mostRecent.id,
                name: mostRecent.name,
                state: mostRecent.state,
              }]);
              setActiveSessionId(mostRecent.id);
            }
          } else {
            setShowSessionList(true);
          }
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
    </div>
  );
}
