import { Box, Text } from 'ink';
import type { HistoryEntry } from '../api/history';

function shortDate(iso?: string): string {
  if (!iso) return '';
  const t = iso.indexOf('T');
  return t > 0 ? iso.slice(0, t) : iso;
}

function summarize(entry: HistoryEntry, max: number): string {
  const text = (entry.firstPrompt ?? entry.lastPrompt ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '(プロンプトなし)';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function HistoryRow({ entry, selected }: { entry: HistoryEntry; selected: boolean }) {
  return (
    <Box>
      <Text color="cyan">{selected ? '❯ ' : '  '}</Text>
      <Text bold={selected}>{summarize(entry, 50)}</Text>
      {entry.agent ? <Text dimColor> [{entry.agent}]</Text> : null}
      <Text dimColor> · {entry.projectName ?? entry.projectPath}</Text>
      {entry.modified ? <Text dimColor> · {shortDate(entry.modified)}</Text> : null}
    </Box>
  );
}
