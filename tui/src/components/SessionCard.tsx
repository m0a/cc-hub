import { Box, Text } from 'ink';
import type { TuiSession } from '../types';
import { deriveRow, formatDuration, formatTokens, indicatorGlyph, taskText } from './session-row';

/** 1 セッション = カード。選択中は枠を cyan + タイトル bold。 */
export function SessionCard({ session, selected }: { session: TuiSession; selected: boolean }) {
  const row = deriveRow(session);
  const ind = indicatorGlyph(row.indicator);
  const ctx = session.metrics?.contextPercent;
  const dur = formatDuration(session.durationMinutes);
  const tok = formatTokens(session.metrics?.totalTokens);
  const task = taskText(session);

  const meta: string[] = [];
  if (row.path) meta.push(row.path);
  if (row.paneCount) meta.push(`${row.paneCount}p`);
  if (tok) meta.push(`${tok} tok`);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={selected ? 'cyan' : 'gray'} paddingX={1}>
      <Box>
        <Text color={ind.color}>{ind.glyph} </Text>
        <Text bold color={selected ? 'cyan' : undefined}>
          {row.title}
        </Text>
        {row.agentLabel ? <Text dimColor>{`  ${row.agentLabel}`}</Text> : null}
        {ctx !== undefined ? <Text dimColor>{`  ctx ${Math.round(ctx)}%`}</Text> : null}
        {dur ? <Text dimColor>{`  ⏱${dur}`}</Text> : null}
      </Box>
      <Text dimColor wrap="truncate-end">
        {task || '—'}
      </Text>
      <Text dimColor wrap="truncate-end">
        {meta.join(' · ')}
      </Text>
    </Box>
  );
}
