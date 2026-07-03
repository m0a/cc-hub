// 常時表示サイドバー（`cchub tui --sidebar`）用のコンパクト表示。
// 狭幅（~34桁）で崩れないよう、1 セッション = 1 行（ドット + タイトル）に畳む。
// カード表示の App とは別物で、目的は「一覧を眺めて選んで switch」に絞る。
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ApiClient } from '../api/client';
import { useSessions } from '../hooks/useSessions';
import type { ListAction, TuiSession } from '../types';
import { deriveRow, indicatorGlyph } from './session-row';

/** 1 セッション = 1 行（選択中は ▸ + cyan bold）。純粋な presentational でテスト対象。 */
export function SidebarRow({ session, selected }: { session: TuiSession; selected: boolean }) {
  const row = deriveRow(session);
  const ind = indicatorGlyph(row.indicator);
  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined}>{selected ? '▸' : ' '}</Text>
      <Text color={ind.color}>{`${ind.glyph} `}</Text>
      <Text bold={selected} color={selected ? 'cyan' : undefined} wrap="truncate-end">
        {row.title}
      </Text>
    </Box>
  );
}

/** サイドバー本体（presentational）。選択位置を props で受けるのでテストしやすい。 */
export function SidebarList({
  sessions,
  selectedIndex,
}: {
  sessions: TuiSession[];
  selectedIndex: number;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        ≡ sessions
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.length === 0 ? (
          <Text dimColor>セッションがありません</Text>
        ) : (
          sessions.map((s, i) => <SidebarRow key={s.id} session={s} selected={i === selectedIndex} />)
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ 選択 · Enter 切替 · q 閉じる</Text>
      </Box>
    </Box>
  );
}

/** サイドバーの状態＋入力を担うコンテナ。Enter で attach、q で quit を bubble する。 */
export function SidebarApp({
  client,
  onAction,
}: {
  client: ApiClient;
  onAction: (action: ListAction) => void;
}) {
  const { sessions } = useSessions(client);
  const [selected, setSelected] = useState(0);
  const count = sessions.length;
  const clamped = count === 0 ? 0 : Math.min(selected, count - 1);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onAction({ type: 'quit' });
      return;
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

  return <SidebarList sessions={sessions} selectedIndex={clamped} />;
}
