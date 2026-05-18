import { Hono } from 'hono';
import { broadcastToMuxClients } from './terminal-mux';
import type { IndicatorState } from '../../../shared/types';
import { getHookStatus } from '../services/hook-status';

// Read only the trailing slice of a transcript instead of the whole file.
// Active Claude sessions produce multi-MB .jsonl transcripts; the previous
// "readFile + split('\\n')" path showed up at ~16% of CPU in profiling
// because every hook event re-parsed the entire history.
// 256 KB is enough to comfortably contain 50 trailing JSONL entries even
// for entries with large tool_result blocks.
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

async function readTrailingLines(path: string, lineCount: number): Promise<string[]> {
  const file = Bun.file(path);
  const size = file.size;
  if (size === 0) return [];
  const offset = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
  const slice = offset === 0 ? file : file.slice(offset);
  const content = await slice.text();
  const lines = content.split('\n');
  // The first line may be a partial JSONL record when we sliced mid-file;
  // drop it so JSON.parse below doesn't fail on a truncated entry.
  if (offset > 0) lines.shift();
  return lines.slice(-lineCount);
}

/** transcriptファイルからコンテキストに応じた通知メッセージを生成する */
async function generateSmartMessage(transcriptPath: string, _event: string): Promise<string | undefined> {
  try {
    const recentLines = await readTrailingLines(transcriptPath, 50);
    const entries = [];
    for (const line of recentLines) {
      if (!line) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }

    // 使用されたツールを収集
    const tools: string[] = [];
    for (const entry of entries) {
      if (entry.type === 'assistant') {
        for (const block of entry.message?.content || []) {
          if (block.type === 'tool_use' && block.name && !tools.includes(block.name)) {
            tools.push(block.name);
          }
        }
      }
    }

    // アクション種別を判定
    let action: string;
    if (tools.includes('Edit') || tools.includes('Write')) action = 'ファイル編集完了';
    else if (tools.includes('Bash')) action = 'コマンド実行完了';
    else if (tools.includes('Grep') || tools.includes('Glob') || tools.includes('Read')) action = '調査完了';
    else action = '完了';

    // 最後のアシスタントメッセージのテキストを取得
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type !== 'assistant') continue;
      for (const block of entries[i].message?.content || []) {
        if (block.type !== 'text') continue;
        // コードブロックを除いた最初の有意な行
        let inCodeBlock = false;
        for (const line of (block.text || '').split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
          if (inCodeBlock) continue;
          if (trimmed && trimmed.length > 5) {
            const summary = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
            return `${action}: ${summary}`;
          }
        }
      }
    }

    return action;
  } catch {
    return undefined;
  }
}

const notify = new Hono();

// hookイベントによるindicatorStateの一時オーバーライド
// ccSessionId → { state, expiresAt }
const stateOverrides = new Map<string, { state: IndicatorState; expiresAt: number; toolName?: string }>();
// TTLは安全弁。StopやPostToolUse/PreToolUseで明示的に上書きされる。
const OVERRIDE_TTL = 24 * 60 * 60_000; // 24時間

function hookEventToState(event: string, toolName?: string): IndicatorState | null {
  switch (event) {
    case 'Stop':
    case 'Notification':
    case 'SubagentStop':
      return 'completed';
    case 'PostToolUse':
      if (toolName === 'AskUserQuestion') return 'waiting_input';
      return null;
    case 'PreToolUse':
      if (toolName === 'AskUserQuestion') return 'waiting_input';
      return 'processing';
    case 'UserPromptSubmit':
      return 'processing';
    default:
      return null;
  }
}

/** セッションリスト取得時にオーバーライドを適用する */
export function getIndicatorOverride(ccSessionId: string): { state: IndicatorState; toolName?: string } | null {
  const override = stateOverrides.get(ccSessionId);
  if (!override) return null;
  if (Date.now() > override.expiresAt) {
    stateOverrides.delete(ccSessionId);
    return null;
  }
  return { state: override.state, toolName: override.toolName };
}

/**
 * Claude Code / Codex hook イベントを受信して WebSocket 経由で全クライアントにブロードキャストする。
 * Stop, Notification 等の hook から curl で呼ばれる想定。
 *
 * リクエストボディ: hook の stdin JSON をそのまま渡す
 * {
 *   "hook_event_name": "Stop" | "Notification" | ...,
 *   "session_id": "...",
 *   "cwd": "/path/to/project",
 *   ...その他のhook固有フィールド
 * }
 */
notify.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const event = body.hook_event_name || body.event || 'unknown';
    const cwd = body.cwd as string | undefined;
    const sessionId = body.session_id as string | undefined;

    // hook固有の情報を data に格納
    const { hook_event_name, cwd: _cwd, session_id: _sid, transcript_path: _tp, ...rest } = body;
    const transcriptPath = body.transcript_path as string | undefined;

    // indicatorStateオーバーライドを保存
    if (sessionId) {
      const toolName = body.tool_name as string | undefined;
      const newState = hookEventToState(event, toolName);
      if (newState) {
        const ttl = OVERRIDE_TTL;
        stateOverrides.set(sessionId, { state: newState, expiresAt: Date.now() + ttl, toolName: event === 'PreToolUse' ? toolName : undefined });
      }
    }

    // transcriptからスマートなメッセージを生成
    let message: string | undefined;
    if (transcriptPath) {
      message = await generateSmartMessage(transcriptPath, event);
    }

    // Skip notification for status-only events (no browser notification needed)
    if (event !== 'UserPromptSubmit' && event !== 'PreToolUse') {
      const hookMsg = {
        type: 'hook-event',
        event,
        cwd,
        sessionId,
        message,
        data: Object.keys(rest).length > 0 ? rest : undefined,
      };
      broadcastToMuxClients(hookMsg);
    }

    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }
});

/** Check if cchub notify is configured in ~/.claude or ~/.codex hooks */
notify.get('/hook-status', async (c) => {
  try {
    const status = await getHookStatus();
    return c.json(status);
  } catch {
    // settings / config files don't exist or are invalid
    return c.json({
      configured: false,
      events: { stop: false, preToolUse: false, userPromptSubmit: false, askUserQuestion: false },
      missing: ['stop', 'preToolUse', 'userPromptSubmit', 'askUserQuestion'],
    });
  }
});

export { notify };
