import { useState } from 'react';
import type { ApiClient } from '../api/client';
import { type HistoryEntry, resumeHistory } from '../api/history';
import type { ListAction } from '../types';
import { App } from './App';
import { HistorySearch } from './HistorySearch';

/**
 * ビュールータ。一覧(App) ↔ 履歴検索(HistorySearch) を内部 state で切替える。
 * attach / quit のみループ側（onAction）へ bubble する（view 切替は remount しない）。
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
  const [view, setView] = useState<'list' | 'search'>('list');

  if (view === 'search') {
    return (
      <HistorySearch
        baseUrl={baseUrl}
        token={token}
        onCancel={() => setView('list')}
        onPick={(entry: HistoryEntry) => {
          // resume（tmux セッション生成）→ 返る tmuxSessionId に attach。失敗は一覧へ戻す。
          void resumeHistory(client, entry)
            .then((res) => onAction({ type: 'attach', sessionName: res.tmuxSessionId }))
            .catch(() => setView('list'));
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
        else onAction(action);
      }}
    />
  );
}
