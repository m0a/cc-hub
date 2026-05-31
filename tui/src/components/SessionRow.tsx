import { Box, Text } from 'ink';
import type { TuiSession } from '../types';
import { deriveRow, indicatorGlyph } from './session-row';

export function SessionRow({ session, selected }: { session: TuiSession; selected: boolean }) {
  const row = deriveRow(session);
  const ind = indicatorGlyph(row.indicator);
  return (
    <Box>
      <Text color="cyan">{selected ? '❯ ' : '  '}</Text>
      <Text color={ind.color}>{ind.glyph} </Text>
      <Text bold={selected}>{row.title}</Text>
      {row.agentLabel ? <Text dimColor> [{row.agentLabel}]</Text> : null}
      <Text dimColor> · {row.paneCount}p</Text>
      {row.path ? <Text dimColor> · {row.path}</Text> : null}
    </Box>
  );
}
