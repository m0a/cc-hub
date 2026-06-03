import { useState } from 'react';
import type { ApiClient } from '../api/client';
import { type HistoryEntry, resumeHistory } from '../api/history';
import { createSession } from '../api/sessions';
import type { ListAction } from '../types';
import { App } from './App';
import { CreateSessionForm } from './CreateSessionForm';
import { HistorySearch } from './HistorySearch';

/**
 * ビュールータ。一覧(App) ↔ 履歴検索(HistorySearch) ↔ 新規作成(CreateSessionForm) を
 * 内部 state で切替える。attach / quit のみループ側（onAction）へ bubble する。
 */
export function Root({
  client,
  baseUrl,
  token,
  onAction,
}: {
  client: ApiClient;
  baseUrl: string;
  token: string | null;
  onAction: (action: ListAction) => void;
}) {
  const [view, setView] = useState<'list' | 'search' | 'create'>('list');

  if (view === 'search') {
    return (
      <HistorySearch
        baseUrl={baseUrl}
        token={token}
        onCancel={() => setView('list')}
        onPick={(entry: HistoryEntry) => {
          void resumeHistory(client, entry)
            .then((res) => onAction({ type: 'attach', sessionName: res.tmuxSessionId }))
            .catch(() => setView('list'));
        }}
      />
    );
  }

  if (view === 'create') {
    return (
      <CreateSessionForm
        onCancel={() => setView('list')}
        onSubmit={(input) => {
          void createSession(client, input).finally(() => setView('list'));
        }}
      />
    );
  }

  return (
    <App
      client={client}
      baseUrl={baseUrl}
      onAction={(action) => {
        if (action.type === 'search') setView('search');
        else if (action.type === 'create') setView('create');
        else onAction(action);
      }}
    />
  );
}
