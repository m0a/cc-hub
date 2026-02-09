import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionResponse, IndicatorState, ConversationMessage, FileInfo, SessionTheme } from '../../../shared/types';
import { useSessions } from '../hooks/useSessions';

// Theme color mapping
const THEME_COLORS: Record<SessionTheme, { border: string; bg: string }> = {
  red: { border: 'border-red-500', bg: 'bg-red-500' },
  orange: { border: 'border-orange-500', bg: 'bg-orange-500' },
  amber: { border: 'border-amber-500', bg: 'bg-amber-500' },
  green: { border: 'border-green-500', bg: 'bg-green-500' },
  teal: { border: 'border-teal-500', bg: 'bg-teal-500' },
  blue: { border: 'border-blue-500', bg: 'bg-blue-500' },
  indigo: { border: 'border-indigo-500', bg: 'bg-indigo-500' },
  purple: { border: 'border-purple-500', bg: 'bg-purple-500' },
  pink: { border: 'border-pink-500', bg: 'bg-pink-500' },
};

const THEME_OPTIONS: (SessionTheme | null)[] = [null, 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'];
import { useSessionHistory } from '../hooks/useSessionHistory';
import { authFetch } from '../services/api';
import { Dashboard } from './dashboard/Dashboard';
import { SessionHistory } from './SessionHistory';
import { ConversationViewer } from './ConversationViewer';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Directory browser API functions
async function browseDirectory(path?: string): Promise<{ path: string; files: FileInfo[]; parentPath: string | null }> {
  const url = path
    ? `${API_BASE}/api/files/browse?path=${encodeURIComponent(path)}`
    : `${API_BASE}/api/files/browse`;
  const response = await authFetch(url);
  if (!response.ok) {
    throw new Error('Failed to browse directory');
  }
  return response.json();
}

async function createDirectory(path: string): Promise<{ path: string; success: boolean }> {
  const response = await authFetch(`${API_BASE}/api/files/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create directory');
  }
  return response.json();
}



interface SessionListProps {
  onSelectSession: (session: SessionResponse) => void;
  onBack?: () => void;
  inline?: boolean;  // true for side panel, false for fullscreen
  contentScale?: number;  // Scale factor for content (tabs remain fixed)
  isOnboarding?: boolean;  // Show dummy session for onboarding
}

// Session menu dialog (color change + delete)
function SessionMenuDialog({
  session,
  onChangeTheme,
  onDelete,
  onCancel,
}: {
  session: SessionResponse;
  onChangeTheme: (theme: SessionTheme | null) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (showDeleteConfirm) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
          <h3 className="text-lg font-bold text-white mb-2">{t('session.deleteSession')}</h3>
          <p className="text-gray-300 mb-4">
            {t('session.deleteConfirm', { name: session.name })}
          </p>
          <p className="text-sm text-red-400 mb-6">
            {t('session.deleteWarning')}
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={onDelete}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-medium transition-colors"
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const extSession = session as SessionResponse & { theme?: SessionTheme };
  const getThemeLabel = (theme: SessionTheme | null) => {
    if (theme === null) return t('common.none');
    return t(`theme.${theme}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div className="bg-gray-800 rounded-lg p-4 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white mb-3">{session.name}</h3>

        {/* Color picker */}
        <div className="mb-4">
          <p className="text-sm text-gray-400 mb-2">{t('session.colorTheme')}</p>
          <div className="flex flex-wrap gap-2">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme ?? 'none'}
                onClick={() => onChangeTheme(theme)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  theme === null
                    ? 'bg-gray-600 border-gray-500'
                    : `${THEME_COLORS[theme].bg} border-transparent`
                } ${
                  extSession.theme === theme || (extSession.theme === undefined && theme === null)
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-800'
                    : 'hover:scale-110'
                }`}
                title={getThemeLabel(theme)}
              />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-between pt-3 border-t border-gray-700">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded font-medium transition-colors"
          >
            {t('common.delete')}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Create session modal with directory picker
function CreateSessionModal({
  onConfirm,
  onCancel,
  existingNames,
  externalError,
}: {
  onConfirm: (name: string, workingDir?: string) => void;
  onCancel: () => void;
  existingNames: Set<string>;
  externalError?: string | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [directories, setDirectories] = useState<FileInfo[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const nameManuallyEditedRef = useRef(nameManuallyEdited);
  nameManuallyEditedRef.current = nameManuallyEdited;
  const existingNamesRef = useRef(existingNames);
  existingNamesRef.current = existingNames;

  const loadDirectory = useCallback(async (path?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await browseDirectory(path);
      setCurrentPath(result.path);
      setDirectories(result.files);
      setParentPath(result.parentPath);

      // Auto-suggest session name from directory name (only if not manually edited)
      if (!nameManuallyEditedRef.current) {
        const dirName = result.path.split('/').pop() || '';
        let suggested = dirName;
        let counter = 1;
        while (existingNamesRef.current.has(suggested)) {
          suggested = `${dirName}-${counter++}`;
        }
        setName(suggested);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load initial directory
  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  // Focus new folder input when shown
  useEffect(() => {
    if (showNewFolderInput) {
      newFolderInputRef.current?.focus();
    }
  }, [showNewFolderInput]);

  const handleDirectoryClick = (dir: FileInfo) => {
    loadDirectory(dir.path);
  };

  const handleGoUp = () => {
    if (parentPath) {
      loadDirectory(parentPath);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setNameManuallyEdited(true);
  };

  const handleSubmit = () => {
    onConfirm(name, currentPath);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    setCreatingFolder(true);
    setError(null);
    try {
      const newPath = `${currentPath}/${newFolderName.trim()}`;
      await createDirectory(newPath);
      setShowNewFolderInput(false);
      setNewFolderName('');
      // Navigate to the new directory
      loadDirectory(newPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const shortPath = currentPath.replace(/^\/home\/[^/]+/, '~');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 bg-black/70">
      <div className="bg-gray-800 rounded-lg p-4 max-w-md w-full mx-4 shadow-xl max-h-[70vh] flex flex-col">
        <h3 className="text-lg font-bold text-white mb-3">{t('session.newSession')}</h3>

        {/* Session name input */}
        <div className="mb-3">
          <label className="text-xs text-gray-400 mb-1 block">{t('session.sessionName')}</label>
          <input
            ref={inputRef}
            type="text"
            placeholder={t('session.sessionNamePlaceholder')}
            value={name}
            onChange={handleNameChange}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>

        {/* Directory picker */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-400">{t('session.workingDirectory')}</label>
            <button
              onClick={() => setShowNewFolderInput(true)}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              disabled={showNewFolderInput}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('session.newFolder')}
            </button>
          </div>

          {/* Current path display */}
          <div className="text-xs text-gray-300 bg-gray-900 px-2 py-1.5 rounded mb-2 truncate">
            {shortPath}
          </div>

          {/* New folder input */}
          {showNewFolderInput && (
            <div className="flex gap-2 mb-2">
              <input
                ref={newFolderInputRef}
                type="text"
                placeholder={t('session.folderName')}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') {
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }
                }}
                className="flex-1 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                disabled={creatingFolder}
              />
              <button
                onClick={handleCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-sm transition-colors"
              >
                {creatingFolder ? '...' : t('common.create')}
              </button>
              <button
                onClick={() => {
                  setShowNewFolderInput(false);
                  setNewFolderName('');
                }}
                className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm transition-colors"
              >
                ×
              </button>
            </div>
          )}

          {/* Error display */}
          {(error || externalError) && (
            <div className="text-xs text-red-400 mb-2">{externalError || error}</div>
          )}

          {/* Directory list */}
          <div className="flex-1 overflow-y-auto bg-gray-900 rounded border border-gray-700">
            {isLoading ? (
              <div className="p-4 text-center text-gray-500 text-sm">{t('common.loading')}</div>
            ) : (
              <div className="divide-y divide-gray-800">
                {/* Parent directory */}
                {parentPath && (
                  <button
                    onClick={handleGoUp}
                    className="w-full px-3 py-2 text-left hover:bg-gray-800 flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="text-gray-300">..</span>
                  </button>
                )}

                {/* Directories (hide hidden directories) */}
                {directories.filter(dir => !dir.isHidden).map((dir) => (
                  <button
                    key={dir.path}
                    onClick={() => handleDirectoryClick(dir)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-800 flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className={`truncate ${dir.isHidden ? 'text-gray-500' : 'text-gray-200'}`}>
                      {dir.name}
                    </span>
                  </button>
                ))}

                {directories.length === 0 && !parentPath && (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    {t('session.noSubdirectories')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-end mt-3 pt-3 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition-colors text-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition-colors text-sm"
          >
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Session item with long press to show menu
function SessionItem({
  session,
  onSelect,
  onShowMenu,
  onResume,
  onShowConversation,
}: {
  session: SessionResponse;
  onSelect: (session: SessionResponse) => void;
  onShowMenu: (session: SessionResponse) => void;
  onResume?: (sessionId: string, ccSessionId?: string) => void;
  onShowConversation?: (ccSessionId: string, title: string, subtitle: string, isActive: boolean) => void;
}) {
  const { t } = useTranslation();
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const startLongPress = () => {
    longPressFiredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      console.log('[SessionItem] Long press fired:', session.name);
      longPressFiredRef.current = true;
      onShowMenu(session);
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchStart = () => {
    console.log('[SessionItem] Touch start:', session.name);
    startLongPress();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left click
    if (e.button !== 0) return;
    console.log('[SessionItem] Mouse down:', session.name);
    startLongPress();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Prevent browser context menu on long press
    e.preventDefault();
  };

  const handleTouchEnd = () => {
    cancelLongPress();
  };

  const handleMouseUp = () => {
    cancelLongPress();
  };

  const handleMouseLeave = () => {
    // Cancel long press when mouse leaves the element
    cancelLongPress();
  };

  const handleTouchMove = () => {
    // Cancel long press when touch moves (scrolling)
    console.log('[SessionItem] Touch move - canceling long press');
    cancelLongPress();
  };

  const handleTouchCancel = () => {
    cancelLongPress();
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
    indicatorState?: IndicatorState;
    ccSessionId?: string;
    theme?: SessionTheme;
  };
  const isClaudeRunning = extSession.currentCommand === 'claude';
  const themeColor = extSession.theme ? THEME_COLORS[extSession.theme] : null;
  const isWaiting = extSession.waitingForInput;
  const waitingLabel = extSession.waitingToolName === 'AskUserQuestion' ? t('session.waitingQuestion')
    : extSession.waitingToolName === 'EnterPlanMode' ? t('session.waitingPlan')
    : extSession.waitingToolName === 'ExitPlanMode' ? t('session.waitingPlan')
    : extSession.waitingToolName ? t('session.waitingPermission')
    : t('session.waitingInput');
  const shortPath = extSession.currentPath?.replace(/^\/home\/[^/]+\//, '~/') || '';

  // Use pane title if cc is running and title exists, otherwise use session name
  const displayTitle = isClaudeRunning && extSession.paneTitle
    ? extSession.paneTitle.replace(/^[✳★●◆]\s*/, '')  // Remove status icons
    : session.name;

  // Show resume button only when Claude is not running and we have a ccSessionId
  const showResumeButton = !isClaudeRunning && extSession.ccSessionId;

  // Show conversation button when we have a ccSessionId
  const showConversationButton = !!extSession.ccSessionId;

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResume?.(session.id, extSession.ccSessionId);
  };

  const handleShowConversation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (extSession.ccSessionId) {
      const title = extSession.ccSummary || extSession.ccFirstPrompt || session.name;
      const subtitle = shortPath;
      onShowConversation?.(extSession.ccSessionId, title, subtitle, isClaudeRunning);
    }
  };

  // Determine border class based on theme or claude running state
  const getBorderClass = () => {
    if (themeColor) {
      return `border-l-2 ${themeColor.border}`;
    }
    if (isClaudeRunning) {
      return 'border-l-2 border-green-500';
    }
    return '';
  };

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      className={`p-3 rounded cursor-pointer transition-colors select-none ${
        isClaudeRunning
          ? `bg-gray-800 hover:bg-gray-700 active:bg-gray-600 ${getBorderClass()}`
          : `bg-gray-800/60 hover:bg-gray-700/70 active:bg-gray-600/70 ${getBorderClass()}`
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`font-medium truncate flex-1 ${!isClaudeRunning ? 'text-gray-300' : ''}`}>{displayTitle}</span>
        {isWaiting && extSession.waitingToolName && (
          <span className="text-xs text-yellow-400 bg-yellow-900/50 px-1.5 py-0.5 rounded shrink-0 animate-pulse">{waitingLabel}</span>
        )}
        {isClaudeRunning && !isWaiting && (
          <span className="text-xs text-green-400 bg-green-900/50 px-1.5 py-0.5 rounded shrink-0 animate-pulse">{t('session.processing')}</span>
        )}
        {showConversationButton && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleShowConversation(e);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="text-xs text-gray-300 bg-gray-600/70 px-2 py-0.5 rounded shrink-0 hover:bg-gray-500/70"
          >
            {t('session.history')}
          </button>
        )}
        {showResumeButton && (
          <button
            onClick={handleResume}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="text-xs text-blue-400 bg-blue-900/50 px-1.5 py-0.5 rounded shrink-0 hover:bg-blue-800/50"
          >
            {t('session.resume')}
          </button>
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
          {t('session.longPressHint')}
        </div>
      </div>
    </div>
  );
}

export function SessionList({ onSelectSession, onBack, inline = false, contentScale, isOnboarding = false }: SessionListProps) {
  const { t } = useTranslation();
  const {
    sessions,
    isLoading,
    error,
    fetchSessions,
    createSession,
    deleteSession,
    updateSessionTheme,
  } = useSessions();
  const { fetchConversation } = useSessionHistory();

  const [sessionForMenu, setSessionForMenu] = useState<SessionResponse | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'sessions' | 'history' | 'dashboard'>('sessions');

  // Conversation viewer state
  const [viewingConversation, setViewingConversation] = useState<{
    sessionId: string;
    title: string;
    subtitle: string;
    isActive: boolean;
  } | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);

  useEffect(() => {
    fetchSessions();

    // Poll every 5 seconds for updates (silent to prevent re-renders)
    const interval = setInterval(() => {
      fetchSessions(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Resume a Claude session
  const handleResume = useCallback(async (sessionId: string, ccSessionId?: string) => {
    try {
      const response = await authFetch(`${API_BASE}/api/sessions/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ccSessionId }),
      });
      if (response.ok) {
        // Find and select the session
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          onSelectSession(session);
        }
        // Refresh sessions after a short delay
        setTimeout(fetchSessions, 1000);
      }
    } catch (err) {
      console.error('Failed to resume session:', err);
    }
  }, [sessions, onSelectSession, fetchSessions]);

  // Show conversation for an active session
  const handleShowConversation = useCallback(async (ccSessionId: string, title: string, subtitle: string, isActive: boolean) => {
    setViewingConversation({ sessionId: ccSessionId, title, subtitle, isActive });
    setLoadingConversation(true);
    setConversation([]);
    try {
      const messages = await fetchConversation(ccSessionId);
      setConversation(messages);
    } finally {
      setLoadingConversation(false);
    }
  }, [fetchConversation]);

  // Refresh conversation (for auto-refresh)
  const handleRefreshConversation = useCallback(async () => {
    if (!viewingConversation) return;
    try {
      const messages = await fetchConversation(viewingConversation.sessionId);
      setConversation(messages);
    } catch (err) {
      console.error('Failed to refresh conversation:', err);
    }
  }, [viewingConversation, fetchConversation]);

  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateSession = async (name: string, workingDir?: string) => {
    setCreateError(null);
    try {
      const session = await createSession(name || undefined, workingDir);
      if (session) {
        setShowCreateModal(false);
        onSelectSession(session);
      }
    } catch (err) {
      const error = err as Error & { data?: { error?: string; existingSession?: string } };
      if (error.data?.error === 'duplicate_working_dir') {
        setCreateError(t('session.duplicateWorkingDir', { name: error.data.existingSession || '' }));
      } else {
        setCreateError(error.message || t('common.error'));
      }
    }
  };

  const handleMenuDelete = async () => {
    if (sessionForMenu) {
      await deleteSession(sessionForMenu.id);
      setSessionForMenu(null);
    }
  };

  const handleMenuChangeTheme = async (theme: SessionTheme | null) => {
    if (sessionForMenu) {
      await updateSessionTheme(sessionForMenu.id, theme);
      // 色変更後にセッション情報を再取得
      await fetchSessions(true);
      setSessionForMenu(null);
    }
  };

  const handleMenuClose = () => {
    setSessionForMenu(null);
  };

  const handleShowMenu = (session: SessionResponse) => {
    setSessionForMenu(session);
  };

  // Container class: h-full for inline (side panel), h-screen for fullscreen
  const containerClass = inline
    ? "h-full flex flex-col bg-gray-900 text-white overflow-hidden"
    : "h-screen flex flex-col bg-gray-900 text-white";

  // Don't show loading screen during onboarding (need to show UI elements)
  if (isLoading && sessions.length === 0 && !isOnboarding) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 ${inline ? 'h-full' : 'h-screen'}`}>
        <div className="text-gray-400">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {/* Error message */}
      {error && activeTab === 'sessions' && (
        <div className="p-4 bg-red-900/50 text-red-300 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Tab content - with optional scaling */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          className="h-full"
          style={contentScale ? {
            transform: `scale(${contentScale})`,
            transformOrigin: 'top left',
            width: `${100 / contentScale}%`,
            height: `${100 / contentScale}%`,
          } : undefined}
        >
          {activeTab === 'sessions' && (
            <div className="h-full overflow-y-auto p-4">
              {sessions.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  {t('session.noSessions')} {t('session.noSessionsHint')}
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session, index) => (
                    <div key={session.id} data-onboarding={index === 0 ? 'session-item' : undefined}>
                      <SessionItem
                        session={session}
                        onSelect={onSelectSession}
                        onShowMenu={handleShowMenu}
                        onResume={handleResume}
                        onShowConversation={handleShowConversation}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="h-full overflow-hidden">
              <SessionHistory
                onSelectSession={onSelectSession}
                onSessionResumed={() => {
                  fetchSessions();
                  setActiveTab('sessions');
                }}
                activeSessions={sessions}
              />
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="h-full overflow-y-auto">
              <Dashboard className="h-full" />
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar with tabs */}
      <div className="border-t border-gray-700 bg-black/80 shrink-0 mt-auto">
        {/* Action buttons (only for sessions tab) */}
        {activeTab === 'sessions' && (
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
              data-onboarding="new-session"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex min-w-0">
          <button
            onClick={() => setActiveTab('sessions')}
            className={`flex-1 min-w-0 px-1 py-2 text-xs font-medium truncate transition-colors ${
              activeTab === 'sessions'
                ? 'text-white bg-gray-800 border-t-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {t('session.title')}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 min-w-0 px-1 py-2 text-xs font-medium truncate transition-colors ${
              activeTab === 'history'
                ? 'text-white bg-gray-800 border-t-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
            data-onboarding="history-tab"
          >
            {t('history.title')}
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex-1 min-w-0 px-1 py-2 text-xs font-medium truncate transition-colors ${
              activeTab === 'dashboard'
                ? 'text-white bg-gray-800 border-t-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
            data-onboarding="dashboard-tab"
          >
            {t('dashboard.title')}
          </button>
        </div>
      </div>

      {/* Session menu dialog */}
      {sessionForMenu && (
        <SessionMenuDialog
          session={sessionForMenu}
          onChangeTheme={handleMenuChangeTheme}
          onDelete={handleMenuDelete}
          onCancel={handleMenuClose}
        />
      )}

      {/* Create session modal */}
      {showCreateModal && (
        <CreateSessionModal
          onConfirm={handleCreateSession}
          onCancel={() => { setShowCreateModal(false); setCreateError(null); }}
          existingNames={new Set(sessions.map(s => s.name))}
          externalError={createError}
        />
      )}

      {/* Conversation viewer modal */}
      {viewingConversation && (
        <ConversationViewer
          title={viewingConversation.title}
          subtitle={viewingConversation.subtitle}
          messages={conversation}
          isLoading={loadingConversation}
          onClose={() => setViewingConversation(null)}
          isActive={viewingConversation.isActive}
          onRefresh={handleRefreshConversation}
        />
      )}
    </div>
  );
}
