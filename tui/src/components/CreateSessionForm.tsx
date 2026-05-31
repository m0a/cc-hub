import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { AgentProvider } from 'shared';

export function CreateSessionForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: { workingDir: string; agent: AgentProvider }) => void;
  onCancel: () => void;
}) {
  const [workingDir, setWorkingDir] = useState('');
  const [agent, setAgent] = useState<AgentProvider>('claude');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (workingDir.trim()) onSubmit({ workingDir: workingDir.trim(), agent });
      return;
    }
    if (key.tab) {
      setAgent((a) => (a === 'claude' ? 'codex' : 'claude'));
    } else if (key.backspace || key.delete) {
      setWorkingDir((w) => w.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setWorkingDir((w) => w + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        新規セッション
      </Text>
      <Box marginTop={1}>
        <Text>エージェント: </Text>
        <Text color={agent === 'claude' ? 'cyan' : undefined} bold={agent === 'claude'}>
          claude
        </Text>
        <Text dimColor> / </Text>
        <Text color={agent === 'codex' ? 'cyan' : undefined} bold={agent === 'codex'}>
          codex
        </Text>
        <Text dimColor>　(Tab で切替)</Text>
      </Box>
      <Box>
        <Text>作業ディレクトリ: </Text>
        <Text>{workingDir || ' '}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter 作成 · Esc 中止</Text>
      </Box>
    </Box>
  );
}
