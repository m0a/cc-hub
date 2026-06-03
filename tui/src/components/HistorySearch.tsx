import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { HistoryEntry } from '../api/history';
import { useHistorySearch } from '../hooks/useHistorySearch';
import { HistoryRow } from './HistoryRow';
import { StatusBar } from './StatusBar';

export function HistorySearch({
  baseUrl,
  token,
  onPick,
  onCancel,
}: {
  baseUrl: string;
  token: string | null;
  onPick: (entry: HistoryEntry) => void;
  onCancel: () => void;
}) {
  const { query, setQuery, results, streaming } = useHistorySearch(baseUrl, token);
  const [selected, setSelected] = useState(0);
  const count = results.length;
  const clamped = count === 0 ? 0 : Math.min(selected, count - 1);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (count > 0) {
        const target = results[clamped];
        if (target) onPick(target);
      }
      return;
    }
    if (key.upArrow) {
      setSelected(Math.max(0, clamped - 1));
    } else if (key.downArrow) {
      setSelected(Math.min(Math.max(0, count - 1), clamped + 1));
    } else if (key.backspace || key.delete) {
      setQuery(query.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setQuery(query + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        履歴検索
      </Text>
      <Box>
        <Text>🔎 </Text>
        <Text>{query}</Text>
        <Text dimColor>{streaming ? ' …検索中' : ''}</Text>
      </Box>
      {count === 0 ? (
        <Box marginY={1}>
          <Text dimColor>{query.trim() ? '該当なし' : 'キーワードを入力してください'}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginY={1}>
          {results.map((entry, i) => (
            <HistoryRow key={entry.sessionId} entry={entry} selected={i === clamped} />
          ))}
        </Box>
      )}
      <StatusBar
        baseUrl={baseUrl}
        keys="入力で検索 · ↑↓ 選択 · Enter 再開 · Esc 戻る"
        sessionCount={count}
      />
    </Box>
  );
}
