import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionResponse, IndicatorState, ConversationMessage, FileInfo, SessionTheme, PaneInfo } from '../../../shared/types';
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
  onSelectPane?: (session: SessionResponse, paneId: string) => void;
  onBack?: () => void;
  inline?: boolean;  // true for side panel, false for fullscreen
  contentScale?: number;  // Scale factor for content (tabs remain fixed)
  isOnboarding?: boolean;  // Show dummy session for onboarding
  hideDashboardTab?: boolean;  // Hide dashboard tab (used in modal)
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-backdrop-in">
        <div className="bg-th-surface rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl animate-modal-in">
          <h3 className="text-lg font-bold text-th-text mb-2">{t('session.deleteSession')}</h3>
          <p className="text-th-text-secondary mb-4">
            {t('session.deleteConfirm', { name: session.name })}
          </p>
          <p className="text-sm text-red-400 mb-6">
            {t('session.deleteWarning')}
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 bg-th-surface-active hover:bg-th-surface-active rounded font-medium transition-colors"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-backdrop-in" onClick={onCancel}>
      <div className="bg-th-surface rounded-lg p-4 max-w-sm w-full mx-4 shadow-xl animate-modal-in" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-th-text mb-3">{session.name}</h3>

        {/* Color picker */}
        <div className="mb-4">
          <p className="text-sm text-th-text-secondary mb-2">{t('session.colorTheme')}</p>
          <div className="flex flex-wrap gap-2">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme ?? 'none'}
                onClick={() => onChangeTheme(theme)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  theme === null
                    ? 'bg-th-surface-active border-gray-500'
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
        <div className="flex gap-3 justify-between pt-3 border-t border-th-border">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded font-medium transition-colors"
          >
            {t('common.delete')}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-th-surface-active hover:bg-th-surface-active rounded font-medium transition-colors"
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 bg-[var(--color-overlay)] animate-backdrop-in">
      <div className="bg-th-surface rounded-lg p-4 max-w-md w-full mx-4 shadow-xl max-h-[70vh] flex flex-col animate-modal-in">
        <h3 className="text-lg font-bold text-th-text mb-3">{t('session.newSession')}</h3>

        {/* Session name input */}
        <div className="mb-3">
          <label className="text-xs text-th-text-secondary mb-1 block">{t('session.sessionName')}</label>
          <input
            ref={inputRef}
            type="text"
            placeholder={t('session.sessionNamePlaceholder')}
            value={name}
            onChange={handleNameChange}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="w-full px-3 py-2 bg-th-bg border border-th-border rounded text-th-text placeholder-th-text-muted focus:outline-none focus:border-emerald-500 text-sm"
          />
        </div>

        {/* Directory picker */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-th-text-secondary">{t('session.workingDirectory')}</label>
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
          <div className="text-xs text-th-text-secondary bg-th-bg px-2 py-1.5 rounded mb-2 truncate">
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
                className="flex-1 px-2 py-1 bg-th-bg border border-th-border rounded text-th-text placeholder-th-text-muted focus:outline-none focus:border-emerald-500 text-sm"
                disabled={creatingFolder}
              />
              <button
                onClick={handleCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-th-surface-active rounded text-sm transition-colors"
              >
                {creatingFolder ? '...' : t('common.create')}
              </button>
              <button
                onClick={() => {
                  setShowNewFolderInput(false);
                  setNewFolderName('');
                }}
                className="px-2 py-1 bg-th-surface-active hover:bg-th-surface-active rounded text-sm transition-colors"
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
          <div className="flex-1 overflow-y-auto bg-th-bg rounded border border-th-border">
            {isLoading ? (
              <div className="p-4 text-center text-th-text-muted text-sm">{t('common.loading')}</div>
            ) : (
              <div className="divide-y divide-gray-800">
                {/* Parent directory */}
                {parentPath && (
                  <button
                    onClick={handleGoUp}
                    className="w-full px-3 py-2 text-left hover:bg-th-surface flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4 text-th-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="text-th-text-secondary">..</span>
                  </button>
                )}

                {/* Directories (hide hidden directories) */}
                {directories.filter(dir => !dir.isHidden).map((dir) => (
                  <button
                    key={dir.path}
                    onClick={() => handleDirectoryClick(dir)}
                    className="w-full px-3 py-2 text-left hover:bg-th-surface flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className={`truncate ${dir.isHidden ? 'text-th-text-muted' : 'text-th-text'}`}>
                      {dir.name}
                    </span>
                  </button>
                ))}

                {directories.length === 0 && !parentPath && (
                  <div className="p-4 text-center text-th-text-muted text-sm">
                    {t('session.noSubdirectories')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-end mt-3 pt-3 border-t border-th-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-th-surface-active hover:bg-th-surface-active rounded font-medium transition-colors text-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded font-medium transition-colors text-sm"
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
  onSelectPane,
  onShowMenu,
  onResume,
}: {
  session: SessionResponse;
  onSelect: (session: SessionResponse) => void;
  onSelectPane?: (session: SessionResponse, paneId: string) => void;
  onShowMenu: (session: SessionResponse) => void;
  onResume?: (sessionId: string, ccSessionId?: string) => void;
  onShowConversation?: (ccSessionId: string, title: string, subtitle: string, isActive: boolean) => void;
  onPaneAction?: (sessionId: string, action: 'focus' | 'close' | 'split', paneId: string, direction?: 'h' | 'v') => void;
}) {
  const { t } = useTranslation();
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const startLongPress = () => {
    longPressFiredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
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
    startLongPress();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left click
    if (e.button !== 0) return;
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
    cancelLongPress();
  };

  const handleTouchCancel = () => {
    cancelLongPress();
    longPressFiredRef.current = false;
  };

  const [panesExpanded, setPanesExpanded] = useState(false);

  const handleClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    longPressFiredRef.current = false;

    // Multi-pane session: toggle pane list to show per-pane status
    const extSess = session as SessionResponse & { panes?: PaneInfo[] };
    if (extSess.panes && extSess.panes.length > 1) {
      setPanesExpanded(prev => !prev);
      return;
    }

    onSelect(session);
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
    panes?: PaneInfo[];
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

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResume?.(session.id, extSession.ccSessionId);
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

  // Status dot color
  const statusDotClass = isWaiting
    ? 'bg-yellow-400 animate-status-glow'
    : isClaudeRunning
      ? 'bg-emerald-400'
      : 'bg-gray-500';

  // Show long-press hint only for first few visits
  const hintKey = 'cchub-longpress-hint-seen';
  const hintSeen = typeof localStorage !== 'undefined' && localStorage.getItem(hintKey);
  if (!hintSeen && typeof localStorage !== 'undefined') {
    localStorage.setItem(hintKey, '1');
  }

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
          ? `bg-th-surface hover:bg-th-surface-hover active:bg-th-surface-active ${getBorderClass()}`
          : `bg-th-surface/60 hover:bg-th-surface-hover/70 active:bg-th-surface-active/70 ${getBorderClass()}`
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass}`} />
        <span className={`font-medium truncate flex-1 ${!isClaudeRunning ? 'text-th-text-secondary' : ''}`}>{displayTitle}</span>
        {/* Primary badge: status (max 1) */}
        {isWaiting && extSession.waitingToolName ? (
          <span className="text-xs text-yellow-400 bg-yellow-900/50 px-1.5 py-0.5 rounded shrink-0">{waitingLabel}</span>
        ) : isClaudeRunning ? (
          <span className="text-xs text-emerald-400 bg-emerald-900/50 px-1.5 py-0.5 rounded shrink-0">{t('session.processing')}</span>
        ) : showResumeButton ? (
          <button
            onClick={handleResume}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="text-xs text-emerald-400 bg-emerald-900/50 px-1.5 py-0.5 rounded shrink-0 hover:bg-emerald-800/50"
          >
            {t('session.resume')}
          </button>
        ) : null}
        {/* Secondary badge: pane count (only if > 1) */}
        {extSession.panes && extSession.panes.length > 1 && (() => {
          const deadCount = extSession.panes.filter(p => p.isDead).length;
          return (
            <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
              deadCount > 0
                ? 'text-red-400 bg-red-900/50'
                : 'text-cyan-400 bg-cyan-900/50'
            }`}>
              {deadCount > 0
                ? `${extSession.panes.length} (${deadCount} ${t('pane.dead')})`
                : extSession.panes.length}
            </span>
          );
        })()}
      </div>
      {shortPath && (
        <div className="text-xs text-th-text-muted mt-1 truncate pl-4">
          {shortPath}
        </div>
      )}
      {(extSession.ccSummary || extSession.ccFirstPrompt) && (
        <div className="text-xs text-th-text-secondary mt-1 truncate pl-4">
          {extSession.ccSummary || extSession.ccFirstPrompt}
        </div>
      )}
      {!hintSeen && (
        <div className="text-xs text-th-text-muted mt-1 pl-4">
          {t('session.longPressHint')}
        </div>
      )}

      {/* Pane list (expandable, shows per-pane status indicators) */}
      {panesExpanded && extSession.panes && extSession.panes.length > 1 && (
        <div
          className="mt-2 pt-2 border-t border-th-border space-y-1"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {extSession.panes.map((pane) => {
            const cmd = pane.currentCommand || 'shell';
            const isClaudePane = cmd === 'claude' || !!pane.agentName;
            // Use pane title (set by Claude Code) for display, strip status icons
            const paneTitle = pane.title?.replace(/^[✳★●◆⠂⠈⠐⠠⠄⠁✻✽⏳]\s*/, '').trim();
            // Priority: agentName > paneTitle > command
            const displayName = pane.agentName || paneTitle || cmd;
            // Agent color mapping
            const agentColorMap: Record<string, string> = {
              red: 'text-red-300', orange: 'text-orange-300', amber: 'text-amber-300',
              green: 'text-green-300', teal: 'text-teal-300', blue: 'text-blue-300',
              cyan: 'text-cyan-300', indigo: 'text-indigo-300', purple: 'text-purple-300',
              pink: 'text-pink-300',
            };
            const nameColor = pane.agentColor && agentColorMap[pane.agentColor]
              ? agentColorMap[pane.agentColor]
              : isClaudePane ? 'text-green-300' : 'text-th-text';
            // Per-pane status styling
            const paneIndicator = pane.indicatorState;
            const paneDotClass = pane.isDead
              ? 'bg-red-400'
              : paneIndicator === 'processing'
                ? 'bg-emerald-400'
                : paneIndicator === 'waiting_input'
                  ? 'bg-yellow-400 animate-status-glow'
                  : 'bg-gray-500';
            const paneBgClass = pane.isDead
              ? 'bg-red-900/30 active:bg-red-800/40'
              : isClaudePane
                ? 'bg-green-900/30 active:bg-green-800/40'
                : 'bg-th-surface-hover/40 active:bg-th-surface-active/50';

            return (
              <button
                key={pane.paneId}
                onClick={() => {
                  if (onSelectPane) {
                    onSelectPane(session, pane.paneId);
                  } else {
                    onSelect(session);
                  }
                }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded text-left transition-colors active:scale-[0.98] ${paneBgClass}`}
              >
                {/* Per-pane status dot */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${paneDotClass}`} />
                <span className={`text-sm font-medium truncate ${nameColor}`}>
                  {displayName}
                </span>
                {pane.agentName && paneTitle && (
                  <span className="text-th-text-muted text-xs truncate flex-1">{paneTitle}</span>
                )}
                {!pane.agentName && !paneTitle && (
                  <span className="text-th-text-muted text-xs truncate flex-1" />
                )}
                {/* Per-pane status badge */}
                {pane.isDead ? (
                  <span className="text-[10px] text-red-400 bg-red-900/40 px-1 rounded shrink-0">{t('pane.dead')}</span>
                ) : paneIndicator === 'processing' ? (
                  <span className="text-[10px] text-emerald-400 bg-emerald-900/40 px-1 rounded shrink-0">{t('session.processing')}</span>
                ) : paneIndicator === 'waiting_input' ? (
                  <span className="text-[10px] text-yellow-400 bg-yellow-900/40 px-1 rounded shrink-0">{t('session.waitingInputShort')}</span>
                ) : null}
                {pane.isActive && !pane.isDead && (
                  <span className="text-[10px] text-cyan-400 bg-cyan-900/40 px-1 rounded shrink-0">active</span>
                )}
                <svg className="w-4 h-4 text-th-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SessionList({ onSelectSession, onSelectPane, onBack, inline = false, contentScale, isOnboarding = false, hideDashboardTab = false }: SessionListProps) {
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

  // Pane operations
  const handlePaneAction = useCallback(async (sessionId: string, action: 'focus' | 'close' | 'split', paneId: string, direction?: 'h' | 'v') => {
    try {
      const endpoint = action === 'split'
        ? `${API_BASE}/api/sessions/${sessionId}/panes/split`
        : `${API_BASE}/api/sessions/${sessionId}/panes/${action}`;
      const body = action === 'split'
        ? { paneId, direction }
        : { paneId };
      const response = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        // Refresh sessions after pane operation
        setTimeout(() => fetchSessions(true), 500);
      }
    } catch (err) {
      console.error(`Pane ${action} failed:`, err);
    }
  }, [fetchSessions]);

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
    ? "h-full flex flex-col bg-th-bg text-th-text overflow-hidden"
    : "h-screen flex flex-col bg-th-bg text-th-text";

  // Don't show loading screen during onboarding (need to show UI elements)
  if (isLoading && sessions.length === 0 && !isOnboarding) {
    return (
      <div className={`flex items-center justify-center bg-th-bg ${inline ? 'h-full' : 'h-screen'}`}>
        <div className="text-th-text-secondary">{t('common.loading')}</div>
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
                <div className="text-center text-th-text-muted py-8">
                  {t('session.noSessions')} {t('session.noSessionsHint')}
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session, index) => (
                    <div key={session.id} data-onboarding={index === 0 ? 'session-item' : undefined}>
                      <SessionItem
                        session={session}
                        onSelect={onSelectSession}
                        onSelectPane={onSelectPane}
                        onShowMenu={handleShowMenu}
                        onResume={handleResume}
                        onShowConversation={handleShowConversation}
                        onPaneAction={handlePaneAction}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="h-full overflow-y-auto">
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
      <div className="border-t border-th-border bg-[var(--color-overlay)] shrink-0 mt-auto">
        {/* Action buttons (only for sessions tab) */}
        {activeTab === 'sessions' && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-th-border">
            {onBack ? (
              <button
                onClick={onBack}
                className="p-2 text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover rounded transition-colors"
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
              className="p-2 text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover rounded transition-colors"
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
                ? 'text-th-text bg-th-surface border-t-2 border-emerald-400'
                : 'text-th-text-secondary hover:text-th-text-secondary'
            }`}
          >
            {t('session.title')}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 min-w-0 px-1 py-2 text-xs font-medium truncate transition-colors ${
              activeTab === 'history'
                ? 'text-th-text bg-th-surface border-t-2 border-emerald-400'
                : 'text-th-text-secondary hover:text-th-text-secondary'
            }`}
            data-onboarding="history-tab"
          >
            {t('history.title')}
          </button>
          {!hideDashboardTab && (
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex-1 min-w-0 px-1 py-2 text-xs font-medium truncate transition-colors ${
                activeTab === 'dashboard'
                  ? 'text-th-text bg-th-surface border-t-2 border-emerald-400'
                  : 'text-th-text-secondary hover:text-th-text-secondary'
              }`}
              data-onboarding="dashboard-tab"
            >
              {t('dashboard.title')}
            </button>
          )}
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
