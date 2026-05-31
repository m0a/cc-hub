import { Box, Text } from 'ink';
import type { ConnectionInfo } from '../types';

const STATE_LABEL: Record<ConnectionInfo['state'], { text: string; color: string }> = {
  connected: { text: '● connected', color: 'green' },
  'server-down': { text: '● server-down', color: 'red' },
  unauthorized: { text: '● unauthorized', color: 'yellow' },
};

export function StatusBar({ connection, keys }: { connection: ConnectionInfo; keys: string }) {
  const state = STATE_LABEL[connection.state];
  return (
    <Box justifyContent="space-between" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>{keys}</Text>
      <Text>
        <Text color={state.color}>{state.text}</Text>
        <Text dimColor> {connection.baseUrl}</Text>
      </Text>
    </Box>
  );
}
