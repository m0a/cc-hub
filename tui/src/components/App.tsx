import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ApiClient } from '../api/client';
import { killSession, resumeSession } from '../api/sessions';
import { useSessions } from '../hooks/useSessions';
import type { ListAction, TuiSession } from '../types';
import { Help } from './Help';
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
  const [confirmKill, setConfirmKill] = useState<TuiSession | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const count = sessions.length;
  const clamped = count === 0 ? 0 : Math.min(selected, count - 1);

  useInput((input, key) => {
    // ヘルプ表示中は何かキーで閉じる
    if (showHelp) {
      setShowHelp(false);
      return;
    }
    if (input === '?') {
      setShowHelp(true);
      return;
    }
    // 終了確認モード
    if (confirmKill) {
      if (input === 'y') void killSession(client, confirmKill.id).catch(() => {});
      setConfirmKill(null);
      return;
    }

    if (input === 'q' || (key.ctrl && input === 'c')) {
      onAction({ type: 'quit' });
      return;
    }
    if (input === '/') {
      onAction({ type: 'search' });
      return;
    }
    if (input === 'n') {
      onAction({ type: 'create' });
      return;
    }

    if (count > 0) {
      const target = sessions[clamped];
      if (input === 'x' || input === 'd') {
        setConfirmKill(target);
        return;
      }
      if (input === 'r') {
        void resumeSession(client, target.id)
          .then(() => onAction({ type: 'attach', sessionName: target.name }))
          .catch(() => {});
        return;
      }
    }

    if (key.upArrow || input === 'k') {
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
      {showHelp ? <Help /> : <SessionList sessions={sessions} selectedIndex={clamped} />}
      {confirmKill ? (
        <Text color="red">「{confirmKill.customTitle || confirmKill.name}」を終了しますか？ y / n</Text>
      ) : null}
      <StatusBar
        baseUrl={baseUrl}
        keys="↑↓ Enter:入室 n:新規 x:終了 r:再開 /:履歴 ?:ヘルプ q:終了"
        sessionCount={count}
        error={error}
      />
    </Box>
  );
}
