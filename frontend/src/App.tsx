import { useState, useCallback, useEffect } from 'react';
import { TerminalPage } from './pages/TerminalPage';
import { SessionList } from './components/SessionList';
import { SessionTabs, type OpenSession } from './components/SessionTabs';
import type { SessionResponse, SessionState } from '../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

export function App() {
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSessionList, setShowSessionList] = useState(false);

  // On mount, fetch sessions and open the most recent one
  useEffect(() => {
    const fetchAndOpenSession = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/sessions`);
        if (response.ok) {
          const data = await response.json();
          if (data.sessions.length > 0) {
            const mostRecent = data.sessions[0] as SessionResponse;
            setOpenSessions([{
              id: mostRecent.id,
              name: mostRecent.name,
              state: mostRecent.state,
            }]);
            setActiveSessionId(mostRecent.id);
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
