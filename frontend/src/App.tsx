import { useState, useCallback, useEffect, useRef } from 'react';
import { TerminalPage } from './pages/TerminalPage';
import { SessionList } from './components/SessionList';
import { TabletLayout } from './components/TabletLayout';
import type { SessionResponse, SessionState } from '../../shared/types';

// Session info type (simplified from SessionTabs)
interface OpenSession {
  id: string;
  name: string;
  state: SessionState;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

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
  const [showOverlay, setShowOverlay] = useState(true);
  const overlayTimeoutRef = useRef<number | null>(null);

  // Tablet detection (640px or wider)
  const [isTablet, setIsTablet] = useState(() => window.innerWidth >= 640);

  // Update tablet detection on resize
  useEffect(() => {
    const handleResize = () => setIsTablet(window.innerWidth >= 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // On mount, fetch sessions and restore from localStorage
  useEffect(() => {
    const fetchAndOpenSession = async () => {
      try {
        // Fetch all sessions (including external)
        const sessionsRes = await fetch(`${API_BASE}/api/sessions`);
        const allSessions: SessionResponse[] = sessionsRes.ok
          ? (await sessionsRes.json()).sessions
          : [];

        // Try to restore previously open sessions
        const savedSessionIds = getSavedOpenSessionIds();
        const lastSessionId = getLastSession();

        if (savedSessionIds.length > 0) {
          // Restore saved sessions
          const sessionsToOpen: OpenSession[] = [];

          for (const id of savedSessionIds) {
            // Handle legacy ext: prefix by stripping it
            const normalizedId = id.startsWith('ext:') ? id.slice(4) : id;
            const session = allSessions.find(s => s.id === normalizedId);
            if (session) {
              sessionsToOpen.push({
                id: session.id,
                name: session.name,
                state: session.state,
              });
            }
          }

          // Normalize lastSessionId too
          const normalizedLastId = lastSessionId?.startsWith('ext:')
            ? lastSessionId.slice(4)
            : lastSessionId;

          if (sessionsToOpen.length > 0) {
            setOpenSessions(sessionsToOpen);

            // Set active session: prefer last active, fallback to first open
            const validIds = sessionsToOpen.map(s => s.id);
            const activeId = normalizedLastId && validIds.includes(normalizedLastId)
              ? normalizedLastId
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

  // Save active session to localStorage (only when not loading)
  useEffect(() => {
    // Don't save null during initial load - it would overwrite the saved session
    if (!isLoading && activeSessionId !== null) {
      saveLastSession(activeSessionId);
    }
  }, [activeSessionId, isLoading]);

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

  // Fullscreen toggle (must be before early returns)
  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  // Reload current session (must be before early returns)
  const handleReload = useCallback(() => {
    if (activeSessionId) {
      const currentId = activeSessionId;
      setActiveSessionId(null);
      setTimeout(() => setActiveSessionId(currentId), 50);
    }
  }, [activeSessionId]);

  // Auto-hide overlay after 3 seconds
  const startOverlayTimer = useCallback(() => {
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
    }
    overlayTimeoutRef.current = window.setTimeout(() => {
      setShowOverlay(false);
    }, 3000);
  }, []);

  // Show overlay and restart timer
  const handleShowOverlay = useCallback(() => {
    setShowOverlay(true);
    startOverlayTimer();
  }, [startOverlayTimer]);

  // Start timer when overlay is shown
  useEffect(() => {
    if (showOverlay && !showSessionList && !isLoading) {
      startOverlayTimer();
    }
    return () => {
      if (overlayTimeoutRef.current) {
        clearTimeout(overlayTimeoutRef.current);
      }
    };
  }, [showOverlay, showSessionList, isLoading, startOverlayTimer]);

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

  // Tablet layout: split view with terminal, session list, and keyboard
  if (isTablet) {
    return (
      <TabletLayout
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onSessionStateChange={updateSessionState}
        onShowSessionList={handleShowSessionList}
        onReload={handleReload}
      />
    );
  }

  // Get current active session
  const activeSession = openSessions.find(s => s.id === activeSessionId);

  // Mobile: Show terminal with overlay
  return (
    <div className="h-screen flex flex-col bg-gray-900 relative">
      {/* Tap area to show overlay when hidden */}
      {!showOverlay && (
        <div
          className="absolute top-0 left-0 right-0 h-8 z-40"
          onClick={handleShowOverlay}
        />
      )}

      {/* Semi-transparent overlay bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-2 py-1 bg-black/50 transition-opacity duration-300 ${
          showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Session list button */}
        <button
          onClick={() => {
            handleShowSessionList();
            setShowOverlay(false);
          }}
          className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="セッション一覧"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Center: Session name */}
        <span className="text-white/70 text-sm truncate max-w-[150px]">
          {activeSession?.name || '-'}
        </span>

        {/* Right: Reload + Fullscreen buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleReload}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="リロード"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={handleFullscreen}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="フルスクリーン"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal - full screen */}
      {activeSession && (
        <div className="flex-1 flex flex-col min-h-0">
          <TerminalPage
            key={activeSessionId}
            sessionId={activeSession.id}
            onStateChange={(state) => updateSessionState(activeSession.id, state)}
          />
        </div>
      )}

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
