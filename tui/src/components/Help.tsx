import { Box, Text } from 'ink';

const BINDINGS: Array<[string, string]> = [
  ['↑↓ / j k', '選択を移動'],
  ['Enter', '選択セッションに入室（tmux attach）'],
  ['n', '新規セッションを作成'],
  ['x / d', '選択セッションを終了（y / n で確認）'],
  ['r', '選択セッションを再開（claude -r 等）'],
  ['/', '履歴検索'],
  ['q / Ctrl-C', '終了'],
  ['?', 'このヘルプの開閉'],
];

export function Help() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        キーバインド
      </Text>
      {BINDINGS.map(([key, desc]) => (
        <Box key={key}>
          <Box width={14}>
            <Text color="yellow">{key}</Text>
          </Box>
          <Text>{desc}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>何かキーを押して閉じる</Text>
      </Box>
    </Box>
  );
}
