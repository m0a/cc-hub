import { useState, useCallback, useEffect, useRef } from 'react';
import { TerminalPage } from './pages/TerminalPage';
import { SessionList } from './components/SessionList';
// TabletLayout is deprecated - now using DesktopLayout with isTablet prop
// import { TabletLayout } from './components/TabletLayout';
import { DesktopLayout } from './components/DesktopLayout';
import { FileViewer } from './components/files/FileViewer';
import { ConversationViewer } from './components/ConversationViewer';
import { useSessionHistory } from './hooks/useSessionHistory';
import type { SessionResponse, SessionState, ConversationMessage } from '../../shared/types';

// Session info type (simplified from SessionTabs)
interface OpenSession {
  id: string;
  name: string;
  state: SessionState;
  currentPath?: string;
  ccSessionId?: string;
  currentCommand?: string;
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
  const [showFileViewer, setShowFileViewer] = useState(false);
  const overlayTimeoutRef = useRef<number | null>(null);

  // Conversation viewer state
  const { fetchConversation } = useSessionHistory();
  const [showConversation, setShowConversation] = useState(false);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);

  // Device type detection
  // - desktop: PC (非タッチデバイス) → ソフトキーボード不要
  // - tablet: タッチデバイスで width >= 640px && height >= 500px
  // - mobile: タッチデバイスでそれ以外
  type DeviceType = 'mobile' | 'tablet' | 'desktop';

  const checkIsTouchDevice = (): boolean => {
    // タッチデバイス判定: タッチイベント対応 かつ 粗いポインター（指）
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    return hasTouch && hasCoarsePointer;
  };

  const checkDeviceType = (): DeviceType => {
    // PCの場合は常にdesktop（ソフトキーボード不要）
    if (!checkIsTouchDevice()) return 'desktop';

    // タッチデバイスの場合はサイズで判定
    const width = window.innerWidth;
    if (width >= 640 && window.innerHeight >= 500) return 'tablet';
    return 'mobile';
  };

  const [deviceType, setDeviceType] = useState<DeviceType>(checkDeviceType);

  // Update device type on resize
  useEffect(() => {
    const handleResize = () => setDeviceType(checkDeviceType());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle browser back navigation - return to terminal from overlays
  useEffect(() => {
    const handlePopState = () => {
      // Close any open overlays and return to terminal
      if (showSessionList) {
        setShowSessionList(false);
        window.history.pushState({ view: 'terminal' }, '', window.location.href);
      } else if (showFileViewer) {
        setShowFileViewer(false);
        window.history.pushState({ view: 'terminal' }, '', window.location.href);
      } else if (showConversation) {
        setShowConversation(false);
        window.history.pushState({ view: 'terminal' }, '', window.location.href);
      } else {
        // Already at terminal, prevent leaving the app
        window.history.pushState({ view: 'terminal' }, '', window.location.href);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showSessionList, showFileViewer, showConversation]);

  // Push history state when opening overlays
  useEffect(() => {
    if (showSessionList || showFileViewer || showConversation) {
      window.history.pushState({ view: 'overlay' }, '', window.location.href);
    }
  }, [showSessionList, showFileViewer, showConversation]);

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
              const extSession = session as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string };
              sessionsToOpen.push({
                id: session.id,
                name: session.name,
                state: session.state,
                currentPath: extSession.currentPath,
                ccSessionId: extSession.ccSessionId,
                currentCommand: extSession.currentCommand,
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
            const mostRecent = allSessions[0] as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string };
            setOpenSessions([{
              id: mostRecent.id,
              name: mostRecent.name,
              state: mostRecent.state,
              currentPath: mostRecent.currentPath,
              ccSessionId: mostRecent.ccSessionId,
              currentCommand: mostRecent.currentCommand,
            }]);
            setActiveSessionId(mostRecent.id);
          } else {
            setShowSessionList(true);
          }
        } else if (allSessions.length > 0) {
          // No saved sessions, open most recent
          const mostRecent = allSessions[0] as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string };
          setOpenSessions([{
            id: mostRecent.id,
            name: mostRecent.name,
            state: mostRecent.state,
            currentPath: mostRecent.currentPath,
            ccSessionId: mostRecent.ccSessionId,
            currentCommand: mostRecent.currentCommand,
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
      const extSession = session as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string };
      setOpenSessions(prev => [...prev, {
        id: extSession.id,
        name: extSession.name,
        state: extSession.state,
        currentPath: extSession.currentPath,
        ccSessionId: extSession.ccSessionId,
        currentCommand: extSession.currentCommand,
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

  // Reload current session (must be before early returns)
  const handleReload = useCallback(() => {
    if (activeSessionId) {
      const currentId = activeSessionId;
      setActiveSessionId(null);
      setTimeout(() => setActiveSessionId(currentId), 50);
    }
  }, [activeSessionId]);

  // Show conversation history for current session
  const handleShowConversation = useCallback(async () => {
    const activeSession = openSessions.find(s => s.id === activeSessionId);
    const ccSessionId = activeSession?.ccSessionId;
    if (!ccSessionId) return;

    setShowConversation(true);
    setLoadingConversation(true);
    setConversation([]);
    setShowOverlay(false);

    try {
      const messages = await fetchConversation(ccSessionId);
      setConversation(messages);
    } finally {
      setLoadingConversation(false);
    }
  }, [openSessions, activeSessionId, fetchConversation]);

  // Refresh conversation (for auto-refresh)
  const handleRefreshConversation = useCallback(async () => {
    const activeSession = openSessions.find(s => s.id === activeSessionId);
    const ccSessionId = activeSession?.ccSessionId;
    if (!ccSessionId) return;

    try {
      const messages = await fetchConversation(ccSessionId);
      setConversation(messages);
    } catch (err) {
      console.error('Failed to refresh conversation:', err);
    }
  }, [openSessions, activeSessionId, fetchConversation]);

  // Keep overlay visible (no auto-hide)
  const startOverlayTimer = useCallback(() => {
    // Disabled: keep overlay always visible
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
      overlayTimeoutRef.current = null;
    }
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

  // Desktop layout: PC向け分割ペインレイアウト
  if (deviceType === 'desktop') {
    return (
      <DesktopLayout
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onSessionStateChange={updateSessionState}
        onShowSessionList={handleShowSessionList}
        onReload={handleReload}
      />
    );
  }

  // Tablet layout: use DesktopLayout with floating keyboard
  if (deviceType === 'tablet') {
    return (
      <DesktopLayout
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onSessionStateChange={updateSessionState}
        onShowSessionList={handleShowSessionList}
        onReload={handleReload}
        isTablet={true}
      />
    );
  }

  // Get current active session
  const activeSession = openSessions.find(s => s.id === activeSessionId);

  // Overlay bar content (shared between positions)
  const overlayBar = (
    <div
      className={`flex items-center justify-between px-2 py-1 bg-black/80 transition-opacity duration-300 ${
        showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Left: Session name */}
      <span className="text-white/70 text-sm truncate max-w-[150px]">
        {activeSession?.name || '-'}
      </span>

      {/* Right: Reload + History + File browser + Session list buttons */}
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
        {activeSession?.ccSessionId && (
          <button
            onClick={handleShowConversation}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="会話履歴"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
        )}
        <button
          onClick={() => {
            setShowFileViewer(true);
            setShowOverlay(false);
          }}
          className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="ファイルブラウザ"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
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
      </div>
    </div>
  );

  // Mobile: Show terminal with overlay (position depends on keyboard state)
  return (
    <div className="h-screen flex flex-col bg-gray-900 relative">
      {/* Terminal - full screen */}
      {activeSession && (
        <div className="flex-1 flex flex-col min-h-0">
          <TerminalPage
            key={activeSessionId}
            sessionId={activeSession.id}
            onStateChange={(state) => updateSessionState(activeSession.id, state)}
            overlayContent={overlayBar}
            onOverlayTap={handleShowOverlay}
            showOverlay={showOverlay}
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

      {/* File Viewer Modal */}
      {showFileViewer && activeSession?.currentPath && (
        <FileViewer
          sessionWorkingDir={activeSession.currentPath}
          onClose={() => setShowFileViewer(false)}
        />
      )}

      {/* Conversation Viewer Modal */}
      {showConversation && (
        <ConversationViewer
          title={activeSession?.name || 'Conversation'}
          subtitle={activeSession?.currentPath?.replace(/^\/home\/[^/]+\//, '~/') || ''}
          messages={conversation}
          isLoading={loadingConversation}
          onClose={() => setShowConversation(false)}
          scrollToBottom={true}
          isActive={activeSession?.currentCommand === 'claude'}
          onRefresh={handleRefreshConversation}
        />
      )}
    </div>
  );
}
