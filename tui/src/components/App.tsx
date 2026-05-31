import { Box, Text, useApp, useInput } from 'ink';
import type { ConnectionInfo } from '../types';
import { StatusBar } from './StatusBar';

export function App({ connection }: { connection: ConnectionInfo }) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        CC Hub TUI
      </Text>

      {connection.state === 'connected' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">接続済み</Text>
          <Text>
            稼働中セッション: <Text bold>{connection.sessionCount ?? 0}</Text> 件
          </Text>
          <Text dimColor>（セッション一覧の描画・入室は次フェーズ US1 で実装）</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">{connection.error ?? '接続に問題があります'}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <StatusBar connection={connection} keys="q: 終了" />
      </Box>
    </Box>
  );
}
