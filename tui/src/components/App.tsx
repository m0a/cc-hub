import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ApiClient } from '../api/client';
import { useSessions } from '../hooks/useSessions';
import type { ListAction } from '../types';
import { SessionList } from './SessionList';
import { StatusBar } from './StatusBar';

export function App({
  client,
  baseUrl,
  onAction,
}: {
  client: ApiClient;
  baseUrl: string;
  onAction: (action: ListAction) => void;
}) {
  const { sessions, error } = useSessions(client);
  const [selected, setSelected] = useState(0);

  const count = sessions.length;
  const clamped = count === 0 ? 0 : Math.min(selected, count - 1);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onAction({ type: 'quit' });
      return;
    }
    if (input === '/') {
      onAction({ type: 'search' });
    } else if (key.upArrow || input === 'k') {
      setSelected(Math.max(0, clamped - 1));
    } else if (key.downArrow || input === 'j') {
      setSelected(Math.min(Math.max(0, count - 1), clamped + 1));
    } else if (key.return && count > 0) {
      const target = sessions[clamped];
      if (target) onAction({ type: 'attach', sessionName: target.name });
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        CC Hub TUI — セッション一覧
      </Text>
      <SessionList sessions={sessions} selectedIndex={clamped} />
      <StatusBar
        baseUrl={baseUrl}
        keys="↑↓/jk 選択 · Enter 入室 · / 履歴検索 · q 終了"
        sessionCount={count}
        error={error}
      />
    </Box>
  );
}
