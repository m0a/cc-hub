import { Box, Text } from 'ink';
import type { TuiSession } from '../types';
import { SessionCard } from './SessionCard';

// カード 1 枚の概算行数（枠2 + 内容3）と、外枠/ヘッダ/フッタで使う行数。
const CARD_ROWS = 5;
const RESERVED_ROWS = 9;

/**
 * カードを縦に並べ、端末高さに収まる枚数だけ「選択追従のウィンドウ」で描画する。
 * → ↑↓ で選択が端に来るとウィンドウがずれ、実際にスクロールする。
 */
export function SessionList({
  sessions,
  selectedIndex,
}: {
  sessions: TuiSession[];
  selectedIndex: number;
}) {
  if (sessions.length === 0) {
    return (
      <Box marginY={1}>
        <Text dimColor>セッションがありません</Text>
      </Box>
    );
  }

  const termRows = process.stdout.rows || 24;
  const visible = Math.max(1, Math.floor((termRows - RESERVED_ROWS) / CARD_ROWS));
  const total = sessions.length;

  let start = selectedIndex - Math.floor(visible / 2);
  start = Math.max(0, Math.min(start, Math.max(0, total - visible)));
  const end = Math.min(total, start + visible);
  const shown = sessions.slice(start, end);

  return (
    <Box flexDirection="column">
      {start > 0 ? <Text dimColor>{`  ▲ 上に ${start} 件`}</Text> : null}
      {shown.map((session, i) => (
        <SessionCard key={session.id} session={session} selected={start + i === selectedIndex} />
      ))}
      {end < total ? <Text dimColor>{`  ▼ 下に ${total - end} 件`}</Text> : null}
    </Box>
  );
}
