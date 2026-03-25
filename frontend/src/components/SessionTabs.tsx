import { useTranslation } from 'react-i18next';
import { Menu, Plus } from 'lucide-react';
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
    <div className="flex items-center bg-th-bg border-b border-th-border overflow-x-auto">
      {/* Session list button */}
      <button
        onClick={onShowSessionList}
        className="px-3 py-2 text-th-text-secondary hover:text-th-text hover:bg-th-surface transition-colors shrink-0 rounded-md"
        title={t('session.list')}
      >
        <Menu className="w-4 h-4" />
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
        className="px-3 py-2 text-th-text-secondary hover:text-th-text hover:bg-th-surface transition-colors shrink-0 rounded-md"
        title="新規セッション"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
