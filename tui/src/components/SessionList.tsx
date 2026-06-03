import { Box, Text } from 'ink';
import type { TuiSession } from '../types';
import { SessionRow } from './SessionRow';

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

  return (
    <Box flexDirection="column" marginY={1}>
      {sessions.map((session, i) => (
        <SessionRow key={session.id} session={session} selected={i === selectedIndex} />
      ))}
    </Box>
  );
}
