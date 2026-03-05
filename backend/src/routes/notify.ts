import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { broadcastToAllClients } from './terminal';
import type { IndicatorState } from '../../../shared/types';

const notify = new Hono();

// hookイベントによるindicatorStateの一時オーバーライド
// ccSessionId → { state, expiresAt }
const stateOverrides = new Map<string, { state: IndicatorState; expiresAt: number }>();
const OVERRIDE_TTL = 30_000; // 30秒後に期限切れ（ポーリング間隔5秒に余裕を持たせる）

function hookEventToState(event: string): IndicatorState | null {
  switch (event) {
    case 'Stop':
    case 'Notification':
      return 'waiting_input';
    case 'UserPromptSubmit':
      return 'processing';
    default:
      return null;
  }
}

/** セッションリスト取得時にオーバーライドを適用する */
export function getIndicatorOverride(ccSessionId: string): IndicatorState | null {
  const override = stateOverrides.get(ccSessionId);
  if (!override) return null;
  if (Date.now() > override.expiresAt) {
    stateOverrides.delete(ccSessionId);
    return null;
  }
  return override.state;
}

/**
 * Claude Code hook イベントを受信して WebSocket 経由で全クライアントにブロードキャストする。
 * Claude Code の Stop, Notification 等のhookから curl で呼ばれる想定。
 *
 * リクエストボディ: Claude Code hook の stdin JSON をそのまま渡す
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
    const { hook_event_name, cwd: _cwd, session_id: _sid, ...rest } = body;

    // indicatorStateオーバーライドを保存
    if (sessionId) {
      const newState = hookEventToState(event);
      if (newState) {
        stateOverrides.set(sessionId, { state: newState, expiresAt: Date.now() + OVERRIDE_TTL });
      }
    }

    broadcastToAllClients({
      type: 'hook-event',
      event,
      cwd,
      sessionId,
      data: Object.keys(rest).length > 0 ? rest : undefined,
    });

    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }
});

/** Check if cchub notify is configured in ~/.claude/settings.json hooks */
notify.get('/hook-status', async (c) => {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const content = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const hooks = settings.hooks || {};

    // Check all hook events for "cchub notify" command
    let configured = false;
    for (const eventHooks of Object.values(hooks) as Array<Array<{ hooks?: Array<{ command?: string }> }>>) {
      for (const entry of eventHooks) {
        for (const hook of entry.hooks || []) {
          if (hook.command && hook.command.includes('cchub notify')) {
            configured = true;
            break;
          }
        }
        if (configured) break;
      }
      if (configured) break;
    }

    return c.json({ configured });
  } catch {
    // settings.json doesn't exist or is invalid
    return c.json({ configured: false });
  }
});

export { notify };
