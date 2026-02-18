import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TerminalPage } from './pages/TerminalPage';
import type { TerminalRef } from './components/Terminal';
import { SessionList } from './components/SessionList';
// TabletLayout is deprecated - now using DesktopLayout with isTablet prop
// import { TabletLayout } from './components/TabletLayout';
import { DesktopLayout } from './components/DesktopLayout';
import { FileViewer } from './components/files/FileViewer';
import { ConversationViewer } from './components/ConversationViewer';
import { LoginForm } from './components/LoginForm';
import { Onboarding, useOnboarding } from './components/Onboarding';
import { useSessionHistory } from './hooks/useSessionHistory';
import { useAuth } from './hooks/useAuth';
import { useSessions } from './hooks/useSessions';
import { authFetch, isTransientNetworkError } from './services/api';
import type { SessionResponse, SessionState, ConversationMessage, SessionTheme, PaneInfo } from '../../shared/types';

// Loading screen with phase display and timeout detection
function LoadingScreen({
  phase,
  error,
  onRetry,
}: {
  phase: 'auth' | 'sessions';
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset timer when phase changes
  useEffect(() => {
    setElapsed(0);
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const phaseText = phase === 'auth'
    ? t('loading.checkingAuth')
    : t('loading.fetchingSessions');

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-th-bg gap-3">
      {error ? (
        <>
          <div className="text-red-400 text-sm">{error}</div>
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded text-th-text text-sm transition-colors"
          >
            {t('loading.retry')}
          </button>
        </>
      ) : (
        <>
          <div className="w-6 h-6 border-2 border-th-surface-active border-t-emerald-400 rounded-full animate-spin" />
          <div className="text-th-text-secondary text-sm">{phaseText}</div>
          {elapsed >= 5 && (
            <div className="text-th-text-muted text-xs">
              {t('loading.slow', { seconds: elapsed })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Session info type (simplified from SessionTabs)
interface OpenSession {
  id: string;
  name: string;
  state: SessionState;
  currentPath?: string;
  ccSessionId?: string;
  currentCommand?: string;
  theme?: SessionTheme;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-backdrop-in">
      <div className="bg-th-surface rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl animate-modal-in">
        <h3 className="text-lg font-bold text-th-text mb-2">セッションを削除</h3>
        <p className="text-th-text-secondary mb-4">
          <span className="font-medium text-th-text">{sessionName}</span> を削除しますか？
        </p>
        <p className="text-sm text-red-400 mb-6">
          この操作は取り消せません。
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-th-surface-active hover:bg-th-surface-hover rounded font-medium transition-colors text-th-text"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-medium transition-colors text-th-text"
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
  const { t } = useTranslation();
  // Auth state
  const auth = useAuth();
  // Onboarding state
  const {
    showOnboarding,
    completeOnboarding,
    showSessionListOnboarding,
    completeSessionListOnboarding,
  } = useOnboarding();

  // Terminal ref for mobile view refresh
  const mobileTerminalRef = useRef<TerminalRef>(null);

  // Keyboard control ref for onboarding (tablet: FloatingKeyboard via DesktopLayout)
  const keyboardControlRef = useRef<{ open: () => void; close: () => void } | null>(null);
  const keyboardOpenedByOnboarding = useRef(false);

  // Tablet: control FloatingKeyboard via ref
  const handleTabletStepAction = useCallback((action: string) => {
    if (action === 'open-keyboard') {
      keyboardControlRef.current?.open();
      keyboardOpenedByOnboarding.current = true;
    } else if (action === 'close-keyboard') {
      keyboardControlRef.current?.close();
      keyboardOpenedByOnboarding.current = false;
    } else if (action === 'cleanup') {
      if (keyboardOpenedByOnboarding.current) {
        keyboardControlRef.current?.close();
        keyboardOpenedByOnboarding.current = false;
      }
    }
  }, []);

  // Mobile: control Terminal's built-in keyboard via ref
  const handleMobileStepAction = useCallback((action: string) => {
    if (action === 'open-keyboard') {
      mobileTerminalRef.current?.showKeyboard();
      keyboardOpenedByOnboarding.current = true;
    } else if (action === 'close-keyboard') {
      mobileTerminalRef.current?.hideKeyboard();
      keyboardOpenedByOnboarding.current = false;
    } else if (action === 'cleanup') {
      if (keyboardOpenedByOnboarding.current) {
        mobileTerminalRef.current?.hideKeyboard();
        keyboardOpenedByOnboarding.current = false;
      }
    }
  }, []);

  const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
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

  // Mobile pane tabs state
  const [mobilePanes, setMobilePanes] = useState<{ paneId: string; width: number; height: number }[]>([]);
  const [mobileActivePaneId, setMobileActivePaneId] = useState<string | null>(null);

  // Session API state (for theme updates in mobile view)
  const { sessions: apiSessions, fetchSessions: fetchApiSessions } = useSessions();

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

  // Both tablet and mobile need keyboard control during onboarding
  const onboardingStepAction = deviceType === 'tablet' ? handleTabletStepAction
    : deviceType === 'mobile' ? handleMobileStepAction
    : undefined;

  // Update device type on resize
  useEffect(() => {
    const handleResize = () => setDeviceType(checkDeviceType());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [checkDeviceType]);

  // Periodically fetch sessions for mobile view (to get theme updates)
  useEffect(() => {
    if (deviceType !== 'mobile') return;
    fetchApiSessions();
    const interval = setInterval(() => fetchApiSessions(true), 5000);
    return () => clearInterval(interval);
  }, [deviceType, fetchApiSessions]);

  // Update openSessions theme from API (for mobile view)
  useEffect(() => {
    if (deviceType !== 'mobile' || apiSessions.length === 0) return;
    setOpenSessions(prev => prev.map(session => {
      const apiSession = apiSessions.find(s => s.id === session.id);
      if (apiSession && apiSession.theme !== session.theme) {
        return { ...session, theme: apiSession.theme };
      }
      return session;
    }));
  }, [deviceType, apiSessions]);

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

  // Create initial session for first-time users
  const createInitialSession = async (): Promise<OpenSession | null> => {
    try {
      const response = await authFetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Welcome',
          workingDir: '~',
          initialPrompt: t('onboarding.welcomePrompt'),
        }),
      });
      if (response.ok) {
        const session = await response.json();
        const extSession = session as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string; theme?: SessionTheme };
        return {
          id: session.id,
          name: session.name,
          state: session.state,
          currentPath: extSession.currentPath,
          ccSessionId: extSession.ccSessionId,
          currentCommand: extSession.currentCommand,
          theme: extSession.theme,
        };
      }
    } catch (err) {
      console.error('Failed to create initial session:', err);
    }
    return null;
  };

  // Retry handler for loading screen
  const handleRetry = useCallback(() => {
    setLoadError(null);
    setIsLoading(true);
    setRetryCount(c => c + 1);
  }, []);

  // On mount (and retry), fetch sessions and restore from localStorage
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryCount triggers re-fetch on retry
  useEffect(() => {
    const fetchAndOpenSession = async () => {
      setLoadError(null);
      try {
        // Fetch all sessions (including external)
        const sessionsRes = await authFetch(`${API_BASE}/api/sessions`);
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
              const extSession = session as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string; theme?: SessionTheme };
              sessionsToOpen.push({
                id: session.id,
                name: session.name,
                state: session.state,
                currentPath: extSession.currentPath,
                ccSessionId: extSession.ccSessionId,
                currentCommand: extSession.currentCommand,
                theme: extSession.theme,
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
            const mostRecent = allSessions[0] as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string; theme?: SessionTheme };
            setOpenSessions([{
              id: mostRecent.id,
              name: mostRecent.name,
              state: mostRecent.state,
              currentPath: mostRecent.currentPath,
              ccSessionId: mostRecent.ccSessionId,
              currentCommand: mostRecent.currentCommand,
              theme: mostRecent.theme,
            }]);
            setActiveSessionId(mostRecent.id);
          } else {
            // No sessions at all - create initial session for first-time users
            const initialSession = await createInitialSession();
            if (initialSession) {
              setOpenSessions([initialSession]);
              setActiveSessionId(initialSession.id);
            } else {
              setShowSessionList(true);
            }
          }
        } else if (allSessions.length > 0) {
          // No saved sessions, open most recent
          const mostRecent = allSessions[0] as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string; theme?: SessionTheme };
          setOpenSessions([{
            id: mostRecent.id,
            name: mostRecent.name,
            state: mostRecent.state,
            currentPath: mostRecent.currentPath,
            ccSessionId: mostRecent.ccSessionId,
            currentCommand: mostRecent.currentCommand,
            theme: mostRecent.theme,
          }]);
          setActiveSessionId(mostRecent.id);
        } else {
          // No sessions at all - create initial session for first-time users
          const initialSession = await createInitialSession();
          if (initialSession) {
            setOpenSessions([initialSession]);
            setActiveSessionId(initialSession.id);
          } else {
            setShowSessionList(true);
          }
        }
      } catch (err) {
        if (isTransientNetworkError(err)) {
          setLoadError(t('loading.connectionFailed'));
        } else {
          setShowSessionList(true);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndOpenSession();
  }, [createInitialSession, retryCount, t]);

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
      const extSession = session as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string; theme?: SessionTheme };
      setOpenSessions(prev => [...prev, {
        id: extSession.id,
        name: extSession.name,
        state: extSession.state,
        currentPath: extSession.currentPath,
        ccSessionId: extSession.ccSessionId,
        currentCommand: extSession.currentCommand,
        theme: extSession.theme,
      }]);
      setActiveSessionId(session.id);
    }
    setShowSessionList(false);
    setMobileActivePaneId(null);
  }, [openSessions]);

  // Select a specific pane within a session (mobile)
  const handleSelectPane = useCallback((session: SessionResponse, paneId: string) => {
    // Open session without resetting paneId (handleSelectSession sets it to null)
    const existing = openSessions.find(s => s.id === session.id);
    if (!existing) {
      const extSession = session as SessionResponse & { currentPath?: string; ccSessionId?: string; currentCommand?: string; theme?: SessionTheme };
      setOpenSessions(prev => [...prev, {
        id: extSession.id,
        name: extSession.name,
        state: extSession.state,
        currentPath: extSession.currentPath,
        ccSessionId: extSession.ccSessionId,
        currentCommand: extSession.currentCommand,
        theme: extSession.theme,
      }]);
    }
    setActiveSessionId(session.id);
    setShowSessionList(false);
    // Set pane directly - don't go through handleSelectSession which resets it
    setMobileActivePaneId(paneId);
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
      const response = await authFetch(`${API_BASE}/api/sessions/${sessionToDelete.id}`, {
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

  // Refresh current terminal display (must be before early returns)
  const handleReload = useCallback(() => {
    if (mobileTerminalRef.current?.refreshTerminal) {
      mobileTerminalRef.current.refreshTerminal();
    }
  }, []);

  // Show conversation history for current session
  const handleShowConversation = useCallback(async () => {
    const activeSession = openSessions.find(s => s.id === activeSessionId);
    const ccSessionId = activeSession?.ccSessionId;
    if (!ccSessionId) return;

    setShowConversation(true);
    setLoadingConversation(true);
    setConversation([]);

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

  // Diagnostic: log render state for debugging black screen issues
  useEffect(() => {
    console.log(`[App] Render state: device=${deviceType} authLoading=${auth.isLoading} loading=${isLoading} authRequired=${auth.authRequired} authenticated=${auth.isAuthenticated} sessions=${openSessions.length} active=${activeSessionId} showList=${showSessionList}`);
  }, [deviceType, auth.isLoading, isLoading, auth.authRequired, auth.isAuthenticated, openSessions.length, activeSessionId, showSessionList]);

  // Show loading (including auth check)
  if (auth.isLoading || isLoading) {
    return (
      <LoadingScreen
        phase={auth.isLoading ? 'auth' : 'sessions'}
        error={loadError}
        onRetry={handleRetry}
      />
    );
  }

  // Show login form if auth required but not authenticated
  if (auth.authRequired && !auth.isAuthenticated) {
    return (
      <LoginForm
        onLogin={auth.login}
        isLoading={auth.isLoading}
        error={auth.error}
      />
    );
  }

  // Show session list
  if (showSessionList) {
    return (
      <>
        <SessionList
          onSelectSession={handleSelectSession}
          onSelectPane={handleSelectPane}
          onBack={openSessions.length > 0 ? handleBackFromList : undefined}
          isOnboarding={showSessionListOnboarding}
        />
        {showSessionListOnboarding && (
          <Onboarding type="sessionList" onComplete={completeSessionListOnboarding} />
        )}
      </>
    );
  }

  // Desktop layout: PC向け分割ペインレイアウト
  if (deviceType === 'desktop') {
    return (
      <>
        <DesktopLayout
          sessions={openSessions}
          activeSessionId={activeSessionId}
          onSessionStateChange={updateSessionState}
          onReload={handleReload}
        />
        {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
      </>
    );
  }

  // Tablet layout: use DesktopLayout with floating keyboard
  if (deviceType === 'tablet') {
    return (
      <>
        <DesktopLayout
          sessions={openSessions}
          activeSessionId={activeSessionId}
          onSessionStateChange={updateSessionState}
          onReload={handleReload}
          isTablet={true}
          keyboardControlRef={keyboardControlRef}
        />
        {showOnboarding && <Onboarding onComplete={completeOnboarding} onStepAction={onboardingStepAction} />}
      </>
    );
  }

  // Get current active session
  const activeSession = openSessions.find(s => s.id === activeSessionId);

  // Overlay bar content (shared between positions)
  const overlayBar = (
    <div
      className={`flex items-center justify-between px-2 py-0.5 bg-[var(--color-overlay)] transition-opacity duration-300 ${
        showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Left: Session name */}
      <span className="text-th-text-secondary text-sm truncate max-w-[150px]">
        {activeSession?.name || '-'}
      </span>

      {/* Right: Reload + History + File browser + Session list buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleReload}
          className="p-2.5 text-emerald-400/70 hover:text-emerald-300 active:text-emerald-200 hover:bg-th-surface-hover active:bg-th-surface-active rounded-lg transition-colors"
          title="リロード"
          data-onboarding="reload"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        {activeSession?.ccSessionId && (
          <button
            onClick={handleShowConversation}
            className="p-2.5 text-sky-400/70 hover:text-sky-300 active:text-sky-200 hover:bg-th-surface-hover active:bg-th-surface-active rounded-lg transition-colors"
            title="会話履歴"
            data-onboarding="conversation"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
        )}
        <button
          onClick={() => {
            setShowFileViewer(true);
          }}
          className="p-2.5 text-amber-400/70 hover:text-amber-300 active:text-amber-200 hover:bg-th-surface-hover active:bg-th-surface-active rounded-lg transition-colors"
          title="ファイルブラウザ"
          data-onboarding="file-browser"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
        <button
          onClick={() => {
            handleShowSessionList();
          }}
          className="p-2.5 text-violet-400/70 hover:text-violet-300 active:text-violet-200 hover:bg-th-surface-hover active:bg-th-surface-active rounded-lg transition-colors"
          title={t('session.list')}
          data-onboarding="session-list"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </div>
  );

  // Mobile: Show terminal with overlay (position depends on keyboard state)
  return (
    <div className="h-screen flex flex-col bg-th-bg relative">
      {/* Terminal - full screen */}
      {activeSession ? (
        <div className="flex-1 flex flex-col min-h-0" data-onboarding="terminal">
          <TerminalPage
            ref={mobileTerminalRef}
            key={activeSessionId}
            sessionId={activeSession.id}
            onStateChange={(state) => updateSessionState(activeSession.id, state)}
            overlayContent={overlayBar}
            onOverlayTap={handleShowOverlay}
            showOverlay={showOverlay}
            theme={activeSession.theme}
            onPanesChange={(panes) => {
              setMobilePanes(panes);
              // If active pane was removed, clear it so TerminalPage picks the first
              if (mobileActivePaneId && !panes.some(p => p.paneId === mobileActivePaneId)) {
                setMobileActivePaneId(null);
              }
            }}
            externalActivePaneId={mobileActivePaneId}
          />
          {/* Pane tab bar - only shown when multiple panes exist */}
          {mobilePanes.length > 1 && (() => {
            // Get pane command info from API sessions data
            const apiSession = apiSessions.find(s => s.id === activeSessionId);
            const apiPanes = (apiSession as SessionResponse & { panes?: PaneInfo[] })?.panes;
            // Agent color to Tailwind text class
            const agentColorClass: Record<string, string> = {
              red: 'text-red-400', orange: 'text-orange-400', amber: 'text-amber-400',
              green: 'text-green-400', teal: 'text-teal-400', blue: 'text-blue-400',
              cyan: 'text-cyan-400', indigo: 'text-indigo-400', purple: 'text-purple-400',
              pink: 'text-pink-400',
            };
            return (
              <div className="flex bg-th-surface border-t border-th-border shrink-0 overflow-x-auto">
                {mobilePanes.map((pane) => {
                  const isActive = mobileActivePaneId
                    ? pane.paneId === mobileActivePaneId
                    : pane.paneId === mobilePanes[0]?.paneId;
                  const apiPane = apiPanes?.find(p => p.paneId === pane.paneId);
                  // Priority: agentName > paneTitle (stripped) > command > paneId
                  const paneTitle = apiPane?.title?.replace(/^[✳★●◆⠂⠈⠐⠠⠄⠁✻✽⏳]\s*/, '').trim();
                  const label = apiPane?.agentName || paneTitle || apiPane?.currentCommand || pane.paneId;
                  const colorCls = apiPane?.agentColor && agentColorClass[apiPane.agentColor];
                  return (
                    <button
                      key={pane.paneId}
                      onClick={() => setMobileActivePaneId(pane.paneId)}
                      className={`px-3 py-1.5 text-xs font-mono whitespace-nowrap transition-colors ${
                        isActive
                          ? `${colorCls || 'text-th-text'} bg-th-surface-hover border-t-2 border-emerald-400`
                          : `${colorCls || 'text-th-text-secondary'} hover:text-th-text hover:bg-th-surface-hover/50`
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center" data-onboarding="terminal">
          <p className="text-th-text-muted">{t('pane.selectSession')}</p>
          <button
            onClick={handleShowSessionList}
            className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-th-text rounded transition-colors"
            data-onboarding="session-list"
          >
            {t('session.list')}
          </button>
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

      {/* Onboarding overlay */}
      {showOnboarding && <Onboarding onComplete={completeOnboarding} onStepAction={onboardingStepAction} />}
    </div>
  );
}
