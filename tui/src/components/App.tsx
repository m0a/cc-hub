import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { killSession, resumeSession } from '../api/sessions';
import { useSessions } from '../hooks/useSessions';
import { RETURN_KEY } from '../tmux/attach';
import { sendSubmit } from '../tmux/send';
import type { ListAction, TuiSession } from '../types';
import { Help } from './Help';
import { SessionList } from './SessionList';

const SHORTCUTS = `↑↓ 選択 · Enter 入室(${RETURN_KEY}で戻る) · n 新規 · x 終了 · r 再開 · c compact · / 履歴 · ? ヘルプ · q 終了`;

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
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const count = sessions.length;
  const clamped = count === 0 ? 0 : Math.min(selected, count - 1);

  useInput((input, key) => {
    if (showHelp) {
      setShowHelp(false);
      return;
    }
    if (input === '?') {
      setShowHelp(true);
      return;
    }
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
      if (input === 'c') {
        sendSubmit(target.name, '/compact');
        setNotice(`/compact を送信: ${target.customTitle || target.name}`);
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
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {/* ヘッダ */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          CC Hub TUI — セッション一覧
        </Text>
        <Text>
          {error ? <Text color="red">● {error}</Text> : <Text color="green">● {count} sessions</Text>}
          <Text dimColor> {baseUrl}</Text>
        </Text>
      </Box>

      {/* 本体（カードの入れ子 / ヘルプ） */}
      <Box marginTop={1} flexDirection="column">
        {showHelp ? <Help /> : <SessionList sessions={sessions} selectedIndex={clamped} />}
        {confirmKill ? (
          <Text color="red">「{confirmKill.customTitle || confirmKill.name}」を終了しますか？ y / n</Text>
        ) : null}
        {notice ? <Text color="green">{notice}</Text> : null}
      </Box>

      {/* フッタ（外枠の操作ショートカット） */}
      <Box
        marginTop={1}
        borderStyle="single"
        borderColor="gray"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text dimColor>{SHORTCUTS}</Text>
      </Box>
    </Box>
  );
}
