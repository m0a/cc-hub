import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, MessageSquare, FileText, BarChart3, ChevronDown, X as XIcon, Terminal as TerminalIcon } from 'lucide-react';
import { Dashboard } from './components/dashboard/Dashboard';
import { TerminalPage } from './pages/TerminalPage';
import type { TerminalRef } from './components/Terminal';
import { SessionList } from './components/SessionList';
import { DesktopLayout } from './components/DesktopLayout';
import { FileViewer } from './components/files/FileViewer';
import { ChatView } from './components/chat/ChatView';
import { getTerminalThemes } from './components/terminal-themes';
import { LoginForm } from './components/LoginForm';
import { Onboarding, useOnboarding } from './components/Onboarding';
import { useAuth } from './hooks/useAuth';
import { useSessions } from './hooks/useSessions';
import { authFetch, isTransientNetworkError } from './services/api';
import type { AgentProvider, SessionResponse, ExtendedSessionResponse, SessionState, SessionTheme, PaneInfo, IndicatorState } from '../../shared/types';

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
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-white text-sm font-medium transition-colors"
          >
            {t('loading.retry')}
          </button>
        </>
      ) : (
        <>
          <div className="w-5 h-5 border-2 border-th-surface-active border-t-blue-500 rounded-full animate-spin" />
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
  agent?: AgentProvider;
  agentSessionId?: string;
  currentCommand?: string;
  theme?: SessionTheme;
  panes?: PaneInfo[];
  indicatorState?: IndicatorState;
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
  const [showMobileDashboard, setShowMobileDashboard] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<OpenSession | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  // FileViewer state: per-session instances kept mounted for state preservation
  const [fileViewerDirs, setFileViewerDirs] = useState<string[]>([]);
  const [activeFileViewerDir, setActiveFileViewerDir] = useState<string | null>(null);
  // Tracks which session dirs have FileViewer "open" (per-session)
  const [fileViewerOpenDirs, setFileViewerOpenDirs] = useState<Set<string>>(new Set());
  const openFileViewer = useCallback((dir: string) => {
    setFileViewerDirs(prev => prev.includes(dir) ? prev : [...prev, dir]);
    setActiveFileViewerDir(dir);
    setFileViewerOpenDirs(prev => { const next = new Set(prev); next.add(dir); return next; });
  }, []);
  const closeFileViewer = useCallback((dir: string) => {
    setFileViewerOpenDirs(prev => { const next = new Set(prev); next.delete(dir); return next; });
  }, []);
  const fileViewerVisible = activeFileViewerDir ? fileViewerOpenDirs.has(activeFileViewerDir) : false;
  const overlayTimeoutRef = useRef<number | null>(null);

  // Conversation viewer state — per-session (each session remembers whether
  // it was last shown in chat mode or terminal mode). Persisted to localStorage.
  const [conversationModeSessions, setConversationModeSessions] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('cchub-conversation-mode-sessions');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const showConversation = activeSessionId ? conversationModeSessions.has(activeSessionId) : false;
  const setShowConversation = useCallback((show: boolean) => {
    if (!activeSessionId) return;
    setConversationModeSessions(prev => {
      const has = prev.has(activeSessionId);
      if (show === has) return prev;
      const next = new Set(prev);
      if (show) next.add(activeSessionId);
      else next.delete(activeSessionId);
      return next;
    });
  }, [activeSessionId]);

  // Persist per-session conversation mode to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('cchub-conversation-mode-sessions', JSON.stringify([...conversationModeSessions]));
    } catch {
      // ignore quota errors
    }
  }, [conversationModeSessions]);

  // Mobile: open the soft keyboard automatically when entering ChatView,
  // since the xterm area (which normally surfaces the keyboard on focus) is hidden.
  // Also re-fire on session switch — when toggling between two chat-mode sessions,
  // `showConversation` stays true but the Terminal is remounted (key=activeSessionId),
  // so the previous showKeyboard() targeted a stale instance.
  useEffect(() => {
    if (!showConversation) return;
    const id = setTimeout(() => mobileTerminalRef.current?.showKeyboard(), 150);
    return () => clearTimeout(id);
  }, [showConversation, activeSessionId]);

  // Mobile pane tabs state
  const [mobilePanes, setMobilePanes] = useState<{ paneId: string; width: number; height: number }[]>([]);
  const [mobileActivePaneId, setMobileActivePaneId] = useState<string | null>(null);

  // Session API state (for theme updates in mobile view)
  const { sessions: apiSessions, createSession } = useSessions();

  // Device type detection
  // - desktop: PC (非タッチデバイス) → ソフトキーボード不要
  // - tablet: タッチデバイスで width >= 640px && height >= 500px
  // - mobile: タッチデバイスでそれ以外
  type DeviceType = 'mobile' | 'tablet' | 'desktop';

  const checkIsTouchDevice = (): boolean => {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    return hasTouch && hasCoarsePointer;
  };

  const checkDeviceType = (): DeviceType => {
    // 実タッチデバイス: 物理解像度の短辺で判定（向きに依存しない）
    if (checkIsTouchDevice()) {
      const shortSide = Math.min(screen.width, screen.height);
      const longSide = Math.max(screen.width, screen.height);
      if (shortSide >= 500 && longSide >= 640) return 'tablet';
      return 'mobile';
    }
    // 非タッチデバイス（PC + DevToolsエミュレーション含む）: ビューポート幅で判定
    const w = window.innerWidth;
    if (w < 640) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
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

  // Sessions are now delivered via WS push (no HTTP polling needed)

  // Update openSessions live fields from API (for mobile view)
  useEffect(() => {
    if (deviceType !== 'mobile' || apiSessions.length === 0) return;
    setOpenSessions(prev => prev.map(session => {
      const apiSession = apiSessions.find(s => s.id === session.id);
      if (!apiSession) return session;
      const next = {
        ...session,
        theme: apiSession.theme,
        currentCommand: apiSession.currentCommand,
        ccSessionId: apiSession.ccSessionId,
        agent: apiSession.agent,
        agentSessionId: apiSession.agentSessionId,
        panes: apiSession.panes,
        indicatorState: apiSession.indicatorState,
      };
      // Skip update if nothing actually changed (avoid extra renders)
      if (
        next.theme === session.theme &&
        next.currentCommand === session.currentCommand &&
        next.ccSessionId === session.ccSessionId &&
        next.agent === session.agent &&
        next.agentSessionId === session.agentSessionId &&
        next.panes === session.panes &&
        next.indicatorState === session.indicatorState
      ) {
        return session;
      }
      return next;
    }));
  }, [deviceType, apiSessions]);

  // Handle browser back navigation - return to terminal from overlays
  useEffect(() => {
    const handlePopState = () => {
      // Close any open overlays and return to terminal
      if (showSessionList) {
        setShowSessionList(false);
        window.history.pushState({ view: 'terminal' }, '', window.location.href);
      } else if (fileViewerVisible) {
        if (activeFileViewerDir) closeFileViewer(activeFileViewerDir);
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
  }, [showSessionList, fileViewerVisible, activeFileViewerDir, closeFileViewer, showConversation]);

  // Push history state when opening overlays
  useEffect(() => {
    if (showSessionList || fileViewerVisible || showConversation) {
      window.history.pushState({ view: 'overlay' }, '', window.location.href);
    }
  }, [showSessionList, fileViewerVisible, showConversation]);

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
        const session: ExtendedSessionResponse = await response.json();
        return {
          id: session.id,
          name: session.name,
          state: session.state,
          currentPath: session.currentPath,
          ccSessionId: session.ccSessionId,
          currentCommand: session.currentCommand,
          theme: session.theme,
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
        const allSessions: ExtendedSessionResponse[] = sessionsRes.ok
          ? (await sessionsRes.json()).sessions
          : [];

        // Try to restore previously open sessions
        const savedSessionIds = getSavedOpenSessionIds();
        const lastSessionId = getLastSession();

        if (savedSessionIds.length > 0) {
          // Restore saved sessions
          const sessionsToOpen: OpenSession[] = [];

          for (const id of savedSessionIds) {
            const session = allSessions.find(s => s.id === id);
            if (session) {
              sessionsToOpen.push({
                id: session.id,
                name: session.name,
                state: session.state,
                currentPath: session.currentPath,
                ccSessionId: session.ccSessionId,
                currentCommand: session.currentCommand,
                theme: session.theme,
              });
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

  const handleSelectSession = useCallback(async (session: ExtendedSessionResponse) => {
    // Lost session: resume with claude -r if ccSessionId available, otherwise recreate
    if (session.state === 'lost') {
      try {
        let newSessionId: string;
        let newSessionName: string;
        if (session.ccSessionId && session.currentPath) {
          // Resume with conversation history via claude -r
          const response = await authFetch(`${API_BASE}/api/sessions/history/resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.ccSessionId, projectPath: session.currentPath, agent: session.agent }),
          });
          if (!response.ok) {
            throw new Error('Failed to resume session');
          }
          const data = await response.json();
          newSessionId = data.tmuxSessionId;
          newSessionName = data.tmuxSessionId;
        } else {
          // No ccSessionId: fallback to new session
          const newSession = await createSession(session.name, session.currentPath);
          if (!newSession) return;
          newSessionId = newSession.id;
          newSessionName = newSession.name;
        }
        setOpenSessions(prev => [...prev, {
          id: newSessionId,
          name: newSessionName,
          state: 'working' as const,
          currentPath: session.currentPath,
          ccSessionId: session.ccSessionId,
          theme: session.theme,
        }]);
        setActiveSessionId(newSessionId);
        if (session.currentPath) setActiveFileViewerDir(session.currentPath);
        setShowSessionList(false);
      } catch (err) {
        console.error('Failed to resume lost session:', err);
      }
      return;
    }

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
        currentPath: session.currentPath,
        ccSessionId: session.ccSessionId,
        currentCommand: session.currentCommand,
        theme: session.theme,
      }]);
      setActiveSessionId(session.id);
    }
    // Update FileViewer active dir to follow session
    if (session.currentPath) {
      setActiveFileViewerDir(session.currentPath);
    }
    setShowSessionList(false);
    setMobileActivePaneId(null);
  }, [openSessions]);

  // Select a specific pane within a session (mobile)
  const handleSelectPane = useCallback((session: ExtendedSessionResponse, paneId: string) => {
    // Open session without resetting paneId (handleSelectSession sets it to null)
    const existing = openSessions.find(s => s.id === session.id);
    if (!existing) {
      setOpenSessions(prev => [...prev, {
        id: session.id,
        name: session.name,
        state: session.state,
        currentPath: session.currentPath,
        ccSessionId: session.ccSessionId,
        currentCommand: session.currentCommand,
        theme: session.theme,
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
    // Clean up per-session conversation mode entry
    setConversationModeSessions(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
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
  const handleShowConversation = useCallback(() => {
    const activeSession = openSessions.find(s => s.id === activeSessionId);
    if (!activeSession?.ccSessionId && !activeSession?.agentSessionId) return;
    setShowConversation(true);
  }, [openSessions, activeSessionId]);

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

  // Navigate to session from notification tap
  // SW client.navigate() reloads page with ?notify-session=<ccSessionId>
  // Store in ref until openSessions loads, then switch once
  const pendingNotifyRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSessionId = params.get('notify-session');
    if (urlSessionId) {
      pendingNotifyRef.current = urlSessionId;
      window.history.replaceState({}, '', '/');
      // Auto-clear after 15s to prevent stale switches
      setTimeout(() => { pendingNotifyRef.current = null; }, 15_000);
    }
  }, []);

  // When openSessions updates, check if we have a pending notification switch
  useEffect(() => {
    const pending = pendingNotifyRef.current;
    if (!pending || openSessions.length === 0) return;
    const match = openSessions.find(s => s.ccSessionId === pending);
    if (match) {
      pendingNotifyRef.current = null;
      setActiveSessionId(match.id);
      setShowSessionList(false);
    }
  }, [openSessions]);

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

  // Show session list (mobile overlay - no early return to keep FileViewer mounted)
  const sessionListOverlay = showSessionList ? (
    <div className="fixed inset-0 z-[60]">
      <SessionList
        onSelectSession={handleSelectSession}
        onSelectPane={handleSelectPane}
        onBack={openSessions.length > 0 ? handleBackFromList : undefined}
        isOnboarding={showSessionListOnboarding}
      />
      {showSessionListOnboarding && (
        <Onboarding type="sessionList" onComplete={completeSessionListOnboarding} />
      )}
    </div>
  ) : null;

  // Desktop layout: PC向け分割ペインレイアウト
  if (deviceType === 'desktop') {
    return (
      <>
        <DesktopLayout
          sessions={openSessions}
          activeSessionId={activeSessionId}
          onSessionStateChange={updateSessionState}
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
      className={`flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0a] border-b border-white/[0.06] transition-opacity duration-300 ${
        showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Left: Session selector */}
      <button
        onClick={() => handleShowSessionList()}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
        data-onboarding="session-list"
      >
        <div className={`w-2 h-2 rounded-full ${
          activeSession?.state === 'working' ? 'bg-blue-500' :
          (activeSession?.state === 'waiting_input' || activeSession?.state === 'waiting_permission') ? 'bg-amber-400 animate-pulse' :
          'bg-zinc-600'
        }`} />
        <span className="text-[13px] font-medium text-white truncate max-w-[140px]">
          {activeSession?.name || '-'}
        </span>
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>

      <div className="flex-1" />

      {/* Right: Core actions */}
      <div className="flex items-center gap-1">
        {activeSession?.ccSessionId && (showConversation ? (
          <button
            onClick={() => setShowConversation(false)}
            className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
            title="ターミナルに切替"
            aria-label="Switch to Terminal"
            data-onboarding="conversation"
          >
            <TerminalIcon className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={handleShowConversation}
            className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
            title="会話履歴に切替"
            aria-label="Switch to Chat"
            data-onboarding="conversation"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        ))}
        <button
          onClick={() => openFileViewer(activeSession?.currentPath || '/')}
          className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
          title="ファイルブラウザ"
          data-onboarding="file-browser"
        >
          <FileText className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowMobileDashboard(true)}
          className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
          title="ダッシュボード"
        >
          <BarChart3 className="w-5 h-5" />
        </button>
        <button
          onClick={handleReload}
          className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
          title="リロード"
          data-onboarding="reload"
        >
          <RotateCw className="w-5 h-5" />
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
          {(() => {
            // Use the session-level Claude indicator (set by hook events / jsonl).
            // `state === 'working'` is unreliable here — it just means the tmux
            // session is attached, so it would always be true once connected.
            const indicator = activeSession.indicatorState;
            const isProcessing = indicator === 'processing';
            const isWaitingInput = indicator === 'waiting_input';
            // Always-mounted chat overlay (visibility controlled via mainOverlayVisible).
            // Keeping ChatView mounted preserves the conversation subscription so
            // messages are pre-loaded by the time the user toggles to chat mode —
            // avoiding the black/loading flash on every open.
            const themeBg = getTerminalThemes()[activeSession.theme || 'default'].background;
            const chatOverlay = activeSession.ccSessionId ? (
              <div className="h-full flex flex-col" style={{ backgroundColor: themeBg }}>
                <div
                  className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0"
                  style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 8px)' }}
                >
                  <button
                    type="button"
                    onClick={() => setShowConversation(false)}
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 shrink-0"
                    title="ターミナルに切替"
                    aria-label="Switch to Terminal"
                  >
                    <TerminalIcon className="w-5 h-5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[13px] font-medium text-white truncate">
                        {activeSession.name || 'Conversation'}
                      </h2>
                      {isProcessing && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-300 bg-blue-500/15 px-1.5 py-0.5 rounded shrink-0">
                          <span className="inline-block w-2 h-2 border border-blue-300 border-t-transparent rounded-full animate-spin" />
                          処理中
                        </span>
                      )}
                      {!isProcessing && isWaitingInput && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded shrink-0">
                          入力待ち
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {activeSession.currentPath?.replace(/^\/home\/[^/]+\//, '~/') || ''}
                    </p>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <ChatView
                    sessionId={activeSession.id}
                    title={activeSession.name}
                    subtitle={activeSession.currentPath?.replace(/^\/home\/[^/]+\//, '~/')}
                    inline
                    enabled
                    theme={activeSession.theme}
                    agent={activeSession.agent}
                    agentSessionId={activeSession.agentSessionId}
                    onScrollGesture={() => mobileTerminalRef.current?.hideKeyboard()}
                    onAtBottomChange={(atBottom) => {
                      if (atBottom) mobileTerminalRef.current?.showKeyboard();
                      else mobileTerminalRef.current?.hideKeyboard();
                    }}
                  />
                </div>
              </div>
            ) : null;
            return (
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
                  if (mobileActivePaneId && !panes.some(p => p.paneId === mobileActivePaneId)) {
                    setMobileActivePaneId(null);
                  }
                }}
                externalActivePaneId={mobileActivePaneId}
                mainOverlay={chatOverlay}
                mainOverlayVisible={showConversation}
              />
            );
          })()}
          {/* Pane tab bar - only shown when multiple panes exist */}
          {mobilePanes.length > 1 && (() => {
            // Get pane command info from API sessions data
            const apiSession = apiSessions.find(s => s.id === activeSessionId);
            const apiPanes = apiSession?.panes;
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
                          ? `${colorCls || 'text-th-text'} bg-th-surface-hover border-t-2 border-blue-400`
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
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-th-text rounded transition-colors"
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

      {/* Mobile Dashboard Overlay */}
      {showMobileDashboard && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] animate-modal-in">
          <div className="shrink-0 px-4 pt-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
                Dashboard
              </h1>
              <button
                onClick={() => setShowMobileDashboard(false)}
                className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Dashboard className="h-full" />
          </div>
        </div>
      )}

      {/* File Viewer Modal - per-session instances kept mounted */}
      {fileViewerDirs.map(dir => (
        <FileViewer
          key={dir}
          sessionWorkingDir={dir}
          onClose={() => closeFileViewer(dir)}
          hidden={!fileViewerOpenDirs.has(dir) || dir !== activeFileViewerDir || showSessionList}
          onCopyPrompt={(text) => {
            mobileTerminalRef.current?.setInputText(text);
            closeFileViewer(dir);
          }}
          onShowSessions={() => {
            setShowSessionList(true);
          }}
          sessionName={activeSession?.name}
          sessionStatus={activeSession?.state}
          onShowConversation={(activeSession?.ccSessionId || activeSession?.agentSessionId) ? handleShowConversation : undefined}
          onShowDashboard={() => setShowMobileDashboard(true)}
        />
      ))}

      {/* Session List Overlay */}
      {sessionListOverlay}

      {/* (Conversation overlay is rendered inside TerminalPage as mainOverlay
          so it replaces the xterm area while keeping the InputBar visible.) */}

      {/* Onboarding overlay */}
      {showOnboarding && <Onboarding onComplete={completeOnboarding} onStepAction={onboardingStepAction} />}
    </div>
  );
}
