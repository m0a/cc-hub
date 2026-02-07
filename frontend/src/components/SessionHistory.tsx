import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionHistory, type ProjectInfo } from '../hooks/useSessionHistory';
import { authFetch } from '../services/api';
import type { HistorySession, ConversationMessage, SessionResponse } from '../../../shared/types';
import { ConversationViewer } from './ConversationViewer';

// Extended session type with ccSessionId
interface ActiveSession extends SessionResponse {
  ccSessionId?: string;
}

interface SessionHistoryProps {
  onSessionResumed?: () => void;
  onSelectSession?: (session: SessionResponse) => void;
  activeSessions?: ActiveSession[];
}

function formatRelativeTime(isoDate: string, t: (key: string, options?: Record<string, unknown>) => string, locale: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t('time.now');
  if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
  const dateLocale = locale === 'ja' ? 'ja-JP' : 'en-US';
  return date.toLocaleDateString(dateLocale);
}

function formatDuration(minutes: number | undefined, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return t('time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? t('time.hoursMinutes', { hours, minutes: mins }) : t('time.hours', { count: hours });
}

function HistoryItem({
  session,
  onTap,
  onResume,
  onNavigate,
  isResuming,
  isActive,
}: {
  session: HistorySession;
  onTap: () => void;
  onResume: () => void;
  onNavigate: () => void;
  isResuming: boolean;
  isActive: boolean;
}) {
  const { t, i18n } = useTranslation();
  const displayText = session.firstPrompt || session.summary || 'No description';
  const truncatedText = displayText.length > 60
    ? `${displayText.substring(0, 60)}...`
    : displayText;

  const duration = formatDuration(session.durationMinutes, t);
  const messageCount = session.messageCount;
  const gitBranch = session.gitBranch;

  return (
    <div
      onClick={onTap}
      className="px-3 py-2 hover:bg-gray-700/50 transition-colors border-l-2 border-gray-700 ml-2 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-200 break-words">
            {truncatedText}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-gray-500">
            <span>{formatRelativeTime(session.modified, t, i18n.language)}</span>
            {duration && (
              <span className="text-gray-400">
                <svg className="w-3 h-3 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {duration}
              </span>
            )}
            {messageCount !== undefined && messageCount > 0 && (
              <span className="text-gray-400">
                <svg className="w-3 h-3 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {messageCount}
              </span>
            )}
            {gitBranch && (
              <span className="text-purple-400 truncate max-w-[100px]">
                <svg className="w-3 h-3 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {gitBranch}
              </span>
            )}
          </div>
        </div>
        {isActive ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate();
            }}
            className="shrink-0 px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
          >
            {t('session.navigate')}
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResume();
            }}
            disabled={isResuming}
            className="shrink-0 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded transition-colors"
          >
            {isResuming ? '...' : t('session.resume')}
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectGroupItem({
  project,
  sessions,
  isLoading,
  onExpand,
  onTap,
  onResume,
  onNavigate,
  resumingId,
  activeCcSessionIds,
}: {
  project: ProjectInfo;
  sessions: HistorySession[] | undefined;
  isLoading: boolean;
  onExpand: () => void;
  onTap: (session: HistorySession, projectDirName: string) => void;
  onResume: (session: HistorySession) => void;
  onNavigate: (session: HistorySession) => void;
  resumingId: string | null;
  activeCcSessionIds: Set<string>;
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);

    if (newExpanded && !sessions) {
      onExpand();
    }
  };

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={handleToggle}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-700/50 transition-colors text-left"
      >
        <svg
          className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-200 break-all">
            {project.projectName}
          </div>
        </div>
        <span className="text-xs text-gray-500 shrink-0">
          {project.sessionCount}
        </span>
      </button>

      {isExpanded && (
        <div className="bg-gray-900/50">
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-gray-500">{t('common.loading')}</div>
          ) : sessions && sessions.length > 0 ? (
            sessions.map((session) => (
              <HistoryItem
                key={session.sessionId}
                session={session}
                onTap={() => onTap(session, project.dirName)}
                onResume={() => onResume(session)}
                onNavigate={() => onNavigate(session)}
                isResuming={resumingId === session.sessionId}
                isActive={activeCcSessionIds.has(session.sessionId)}
              />
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-gray-500">{t('history.noSessionsInProject')}</div>
          )}
        </div>
      )}
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export function SessionHistory({ onSessionResumed, onSelectSession, activeSessions = [] }: SessionHistoryProps) {
  const { t } = useTranslation();
  const {
    projects,
    isLoadingProjects,
    sessionsByProject,
    loadingProjects,
    fetchProjectSessions,
    refreshAllLoadedProjects,
    searchResults,
    isSearching,
    searchQuery,
    searchSessions,
    clearSearch,
    resumeSession,
    fetchConversation,
    error,
  } = useSessionHistory();

  const [searchInput, setSearchInput] = useState('');

  const [resumingId, setResumingId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<HistorySession | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);

  // Create a Set of active ccSessionIds for quick lookup
  const activeCcSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of activeSessions) {
      if (s.ccSessionId) {
        ids.add(s.ccSessionId);
      }
    }
    return ids;
  }, [activeSessions]);

  // Create a Map from ccSessionId to SessionResponse for navigation
  const sessionsByCcId = useMemo(() => {
    const map = new Map<string, SessionResponse[]>();
    for (const s of activeSessions) {
      if (s.ccSessionId) {
        const list = map.get(s.ccSessionId) || [];
        list.push(s);
        map.set(s.ccSessionId, list);
      }
    }
    return map;
  }, [activeSessions]);

  const findActiveSession = (historySession: HistorySession): SessionResponse | undefined => {
    const candidates = sessionsByCcId.get(historySession.sessionId);
    if (!candidates || candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    const projectBasename = historySession.projectPath.split('/').pop() || '';
    return candidates.find(s => s.name === projectBasename) || candidates[0];
  };

  const handleResume = async (session: HistorySession) => {
    setResumingId(session.sessionId);
    setResumeError(null);
    try {
      const result = await resumeSession(session.sessionId, session.projectPath);

      if (result) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const response = await authFetch(`${API_BASE}/api/sessions`);
        let foundSession: SessionResponse | undefined;
        if (response.ok) {
          const data = await response.json();
          foundSession = data.sessions?.find((s: { id: string }) => s.id === result.tmuxSessionId);
        }

        if (onSelectSession && foundSession) {
          onSelectSession(foundSession);
        }

        if (onSessionResumed) {
          onSessionResumed();
        }

        // Refresh loaded projects to show updated session info
        await refreshAllLoadedProjects();
      }
      setSelectedSession(null);
    } catch (err) {
      const error = err as Error & { data?: { error?: string; existingSession?: string } };
      if (error.data?.error === 'duplicate_working_dir') {
        setResumeError(t('session.duplicateWorkingDir', { name: error.data.existingSession || '' }));
      } else {
        setResumeError(t('session.resumeFailed'));
      }
    } finally {
      setResumingId(null);
    }
  };

  const handleNavigate = (session: HistorySession) => {
    const activeSession = findActiveSession(session);
    if (activeSession && onSelectSession) {
      onSelectSession(activeSession);
      if (onSessionResumed) {
        onSessionResumed();
      }
    }
  };

  const handleTap = async (session: HistorySession, projectDirName: string) => {
    setSelectedSession(session);
    setLoadingConversation(true);
    setConversation([]);
    try {
      const messages = await fetchConversation(session.sessionId, projectDirName);
      setConversation(messages);
    } finally {
      setLoadingConversation(false);
    }
  };

  if (isLoadingProjects) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        {t('history.loadingHistory')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-400 text-sm">
        {t('common.error')}: {error}
      </div>
    );
  }

  // Handle search input
  const handleSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      searchSessions(searchInput.trim());
    }
  };

  const handleClearSearch = () => {
    setSearchInput('');
    clearSearch();
  };

  // Handle tap on search result
  const handleSearchResultTap = async (session: HistorySession) => {
    setSelectedSession(session);
    setLoadingConversation(true);
    setConversation([]);
    try {
      const messages = await fetchConversation(session.sessionId);
      setConversation(messages);
    } finally {
      setLoadingConversation(false);
    }
  };

  if (projects.length === 0 && !searchQuery) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        {t('history.noSessions')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <form onSubmit={handleSearchSubmit} className="p-2 border-b border-gray-700">
        <div className="relative">
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchInput}
            placeholder={t('history.searchPlaceholder')}
            className="w-full px-3 py-1.5 pl-8 text-sm bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-blue-500 text-gray-200 placeholder-gray-500"
          />
          <svg
            className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {(searchInput || searchQuery) && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </form>

      {/* Resume error banner */}
      {resumeError && (
        <div className="px-3 py-2 bg-red-900/50 text-red-300 text-xs flex items-center justify-between border-b border-gray-700">
          <span>{resumeError}</span>
          <button onClick={() => setResumeError(null)} className="text-red-400 hover:text-red-200 ml-2">×</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Search results */}
        {searchQuery ? (
          <div>
            <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
              {isSearching ? (
                t('history.searching')
              ) : (
                t('history.searchResults', { query: searchQuery, count: searchResults.length })
              )}
            </div>
            {searchResults.map((session) => (
              <HistoryItem
                key={session.sessionId}
                session={session}
                onTap={() => handleSearchResultTap(session)}
                onResume={() => handleResume(session)}
                onNavigate={() => handleNavigate(session)}
                isResuming={resumingId === session.sessionId}
                isActive={activeCcSessionIds.has(session.sessionId)}
              />
            ))}
            {!isSearching && searchResults.length === 0 && (
              <div className="p-4 text-center text-gray-500 text-sm">
                {t('history.noSearchResults')}
              </div>
            )}
          </div>
        ) : (
          /* Project list */
          projects.map((project) => (
            <ProjectGroupItem
              key={project.dirName}
              project={project}
              sessions={sessionsByProject.get(project.dirName)}
              isLoading={loadingProjects.has(project.dirName)}
              onExpand={() => fetchProjectSessions(project.dirName)}
              onTap={handleTap}
              onResume={handleResume}
              onNavigate={handleNavigate}
              resumingId={resumingId}
              activeCcSessionIds={activeCcSessionIds}
            />
          ))
        )}
      </div>

      {selectedSession && (
        <ConversationViewer
          title={selectedSession.summary || selectedSession.firstPrompt || 'No title'}
          subtitle={selectedSession.projectName}
          messages={conversation}
          isLoading={loadingConversation}
          onClose={() => setSelectedSession(null)}
          onResume={() => handleResume(selectedSession)}
          isResuming={resumingId === selectedSession.sessionId}
          scrollToBottom={true}
        />
      )}
    </div>
  );
}
