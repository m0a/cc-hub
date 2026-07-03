import { Box, Text } from 'ink';

/** カテゴリ見出し → [キー, 説明] の並び。herdr 風にグループ分けして見通しを良くする。 */
const GROUPS: Array<[string, Array<[string, string]>]> = [
  ['移動', [['↑↓ / j k', '選択を移動']]],
  [
    'セッション操作',
    [
      ['Enter', '入室（tmux attach）'],
      ['n', '新規セッションを作成'],
      ['r', '再開（claude -r 等）'],
      ['c', '選択セッションに /compact を送信'],
      ['x / d', '終了（y / n で確認）'],
    ],
  ],
  [
    '入室中（prefix 不要）',
    [
      ['F11', 'popup サイドバーでセッション切替'],
      ['F12', '一覧へ戻る'],
    ],
  ],
  [
    '履歴・その他',
    [
      ['/', '履歴検索'],
      ['?', 'このヘルプの開閉'],
      ['q / Ctrl-C', '終了'],
    ],
  ],
];

/** status-bar のエージェント状態ドット凡例（`@cchub_state` と対応）。 */
const STATE_LEGEND: Array<[string, string]> = [
  ['🟡', '作業中'],
  ['🔴', '入力待ち'],
  ['🔵', '完了'],
  ['🟢', 'アイドル'],
];

export function Help() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        キーバインド
      </Text>
      {GROUPS.map(([title, bindings]) => (
        <Box key={title} flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            {title}
          </Text>
          {bindings.map(([key, desc]) => (
            <Box key={key}>
              <Box width={14}>
                <Text color="yellow">{key}</Text>
              </Box>
              <Text>{desc}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text bold dimColor>
          状態ドット
        </Text>
        <Box>
          {STATE_LEGEND.map(([dot, desc]) => (
            <Text key={desc}>
              {dot} <Text dimColor>{desc}</Text>
              {'   '}
            </Text>
          ))}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>何かキーを押して閉じる</Text>
      </Box>
    </Box>
  );
}
