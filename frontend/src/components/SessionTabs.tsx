import { useTranslation } from 'react-i18next';
import { SessionTab } from './SessionTab';
import type { SessionState } from '../../../shared/types';

export interface OpenSession {
  id: string;
  name: string;
  state: SessionState;
}

interface SessionTabsProps {
  sessions: OpenSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
  onShowSessionList: () => void;
}

export function SessionTabs({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onDeleteSession,
  onNewSession,
  onShowSessionList,
}: SessionTabsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center bg-gray-900 border-b border-gray-700 overflow-x-auto">
      {/* Session list button */}
      <button
        onClick={onShowSessionList}
        className="px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors shrink-0"
        title={t('session.list')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Tabs */}
      <div className="flex items-center overflow-x-auto">
        {sessions.map((session) => (
          <SessionTab
            key={session.id}
            id={session.id}
            name={session.name}
            state={session.state}
            isActive={session.id === activeSessionId}
            onSelect={onSelectSession}
            onClose={onCloseSession}
            onDelete={onDeleteSession}
          />
        ))}
      </div>

      {/* New session button */}
      <button
        onClick={onNewSession}
        className="px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors shrink-0"
        title="新規セッション"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}
