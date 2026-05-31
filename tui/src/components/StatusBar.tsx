import { Box, Text } from 'ink';

export function StatusBar({
  baseUrl,
  keys,
  sessionCount,
  error,
}: {
  baseUrl: string;
  keys: string;
  sessionCount?: number;
  error?: string | null;
}) {
  return (
    <Box justifyContent="space-between" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>{keys}</Text>
      <Text>
        {error ? <Text color="red">● {error} </Text> : <Text color="green">● connected </Text>}
        {sessionCount !== undefined ? <Text dimColor>{sessionCount} sessions · </Text> : null}
        <Text dimColor>{baseUrl}</Text>
      </Text>
    </Box>
  );
}
