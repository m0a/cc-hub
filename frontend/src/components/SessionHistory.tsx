import { useState, useMemo } from 'react';
import { useSessionHistory } from '../hooks/useSessionHistory';
import type { HistorySession, ConversationMessage, SessionResponse } from '../../../shared/types';
import { ConversationViewer } from './ConversationViewer';

interface SessionHistoryProps {
  onSessionResumed?: () => void;
  onSelectSession?: (session: SessionResponse) => void;
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '今';
  if (diffMins < 60) return `${diffMins}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  if (diffDays < 7) return `${diffDays}日前`;
  return date.toLocaleDateString('ja-JP');
}

// Format duration in minutes to human-readable
function formatDuration(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
}

// Group sessions by project path
interface ProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: HistorySession[];
  latestModified: string;
}

function groupByProject(sessions: HistorySession[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();

  for (const session of sessions) {
    const existing = groups.get(session.projectPath);
    if (existing) {
      existing.sessions.push(session);
      if (session.modified > existing.latestModified) {
        existing.latestModified = session.modified;
      }
    } else {
      groups.set(session.projectPath, {
        projectPath: session.projectPath,
        projectName: session.projectName,
        sessions: [session],
        latestModified: session.modified,
      });
    }
  }

  // Sort groups by latest modified (newest first)
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.latestModified).getTime() - new Date(a.latestModified).getTime()
  );
}

function HistoryItem({
  session,
  onTap,
  onResume,
  isResuming,
}: {
  session: HistorySession;
  onTap: () => void;
  onResume: () => void;
  isResuming: boolean;
}) {
  const displayText = session.firstPrompt || session.summary || 'No description';
  const truncatedText = displayText.length > 60
    ? displayText.substring(0, 60) + '...'
    : displayText;

  const duration = formatDuration(session.durationMinutes);
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
          {/* Phase 2: Metadata display */}
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-gray-500">
            <span>{formatRelativeTime(session.modified)}</span>
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
        <button
          onClick={(e) => {
            e.stopPropagation();
            onResume();
          }}
          disabled={isResuming}
          className="shrink-0 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded transition-colors"
        >
          {isResuming ? '...' : '再開'}
        </button>
      </div>
    </div>
  );
}

function ProjectGroupItem({
  group,
  onTap,
  onResume,
  resumingId,
  onExpand,
}: {
  group: ProjectGroup;
  onTap: (session: HistorySession) => void;
  onResume: (session: HistorySession) => void;
  resumingId: string | null;
  onExpand?: (sessionIds: string[]) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasLoadedMetadata, setHasLoadedMetadata] = useState(false);

  const handleToggle = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);

    // Lazy load metadata when first expanded
    if (newExpanded && !hasLoadedMetadata && onExpand) {
      const sessionIds = group.sessions.map(s => s.sessionId);
      onExpand(sessionIds);
      setHasLoadedMetadata(true);
    }
  };

  return (
    <div className="border-b border-gray-700">
      {/* Project header */}
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
          <div className="text-sm text-gray-200 truncate">
            {group.projectName}
          </div>
        </div>
        <span className="text-xs text-gray-500 shrink-0">
          {group.sessions.length}件
        </span>
      </button>

      {/* Sessions list */}
      {isExpanded && (
        <div className="bg-gray-900/50">
          {group.sessions.map((session) => (
            <HistoryItem
              key={session.sessionId}
              session={session}
              onTap={() => onTap(session)}
              onResume={() => onResume(session)}
              isResuming={resumingId === session.sessionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export function SessionHistory({ onSessionResumed, onSelectSession }: SessionHistoryProps) {
  const { sessions, isLoading, error, resumeSession, fetchConversation, fetchSessionMetadata } = useSessionHistory();
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<HistorySession | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>('all');

  // Get all unique projects for filter dropdown
  const allProjectGroups = useMemo(() => groupByProject(sessions), [sessions]);

  // Filter sessions by selected project
  const filteredSessions = useMemo(() => {
    if (projectFilter === 'all') return sessions;
    return sessions.filter(s => s.projectPath === projectFilter);
  }, [sessions, projectFilter]);

  const projectGroups = useMemo(() => groupByProject(filteredSessions), [filteredSessions]);

  const handleResume = async (session: HistorySession) => {
    setResumingId(session.sessionId);
    try {
      const result = await resumeSession(session.sessionId, session.projectPath);

      if (result) {
        // Wait for the tmux session to be created
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Fetch the new session
        const response = await fetch(`${API_BASE}/api/sessions`);
        let foundSession: SessionResponse | undefined;
        if (response.ok) {
          const data = await response.json();
          foundSession = data.sessions?.find((s: { id: string }) => s.id === result.tmuxSessionId);
        }

        // Select the new session via onSelectSession prop
        if (onSelectSession && foundSession) {
          onSelectSession(foundSession);
        }

        // Notify parent (for tab switching, etc.)
        if (onSessionResumed) {
          onSessionResumed();
        }
      }
      setSelectedSession(null);
    } finally {
      setResumingId(null);
    }
  };

  const handleTap = async (session: HistorySession) => {
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

  if (isLoading) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        履歴を読み込み中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-400 text-sm">
        エラー: {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        過去のセッションはありません
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Project filter (C2) */}
      {allProjectGroups.length > 1 && (
        <div className="px-2 py-1.5 border-b border-gray-700 shrink-0">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="w-full text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
          >
            <option value="all">すべてのプロジェクト</option>
            {allProjectGroups.map((group) => (
              <option key={group.projectPath} value={group.projectPath}>
                {group.projectName} ({group.sessions.length})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto">
        {projectGroups.map((group) => (
          <ProjectGroupItem
            key={group.projectPath}
            group={group}
            onTap={handleTap}
            onResume={handleResume}
            resumingId={resumingId}
            onExpand={fetchSessionMetadata}
          />
        ))}
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
        />
      )}
    </div>
  );
}
