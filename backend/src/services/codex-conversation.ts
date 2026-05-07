import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { ConversationMessage, ToolUseInfo, ToolResultInfo } from '../../../shared/types';

interface RolloutEvent {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    message?: string;
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
  };
}

interface ThreadRow {
  rollout_path: string | null;
}

function parseFunctionArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : { value };
  } catch {
    return { raw };
  }
}

/**
 * Reads conversation messages from a Codex thread's rollout JSONL.
 *
 * Codex emits a stream of events; we collapse them into Claude-shaped
 * conversation turns:
 *  - `event_msg/user_message`            → role=user
 *  - `event_msg/agent_message`           → role=assistant content (multiple
 *    agent_messages between tool calls join with blank lines)
 *  - `response_item/function_call`       → ToolUseInfo on the active
 *    assistant turn
 *  - `response_item/function_call_output`→ ToolResultInfo on the next
 *    user turn (toolName is looked up from the matching call_id)
 */
export class CodexConversationService {
  private dbPath: string;

  constructor(dbPath = join(homedir(), '.codex', 'state_5.sqlite')) {
    this.dbPath = dbPath;
  }

  async getConversation(threadId: string): Promise<ConversationMessage[]> {
    const rolloutPath = this.lookupRolloutPath(threadId);
    if (!rolloutPath) return [];
    return this.parseRollout(rolloutPath);
  }

  private lookupRolloutPath(threadId: string): string | null {
    if (!existsSync(this.dbPath)) return null;
    let db: Database | undefined;
    try {
      db = new Database(this.dbPath, { readonly: true });
      const row = db.query<ThreadRow, [string]>(
        'SELECT rollout_path FROM threads WHERE id = ? LIMIT 1',
      ).get(threadId);
      return row?.rollout_path ?? null;
    } catch {
      return null;
    } finally {
      db?.close();
    }
  }

  /** Exposed for tests. */
  parseRollout(rolloutPath: string): ConversationMessage[] {
    if (!existsSync(rolloutPath)) return [];
    let text: string;
    try {
      text = readFileSync(rolloutPath, 'utf8');
    } catch {
      return [];
    }

    const messages: ConversationMessage[] = [];
    let current: ConversationMessage | null = null;
    const callIdToName = new Map<string, string>();

    const flush = () => {
      if (!current) return;
      const hasContent = !!current.content || !!current.toolUse?.length || !!current.toolResult?.length;
      if (hasContent) messages.push(current);
      current = null;
    };

    const ensureRole = (role: 'user' | 'assistant', timestamp?: string): ConversationMessage => {
      if (current?.role !== role) {
        flush();
        current = { role, content: '', timestamp };
      }
      return current as ConversationMessage;
    };

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: RolloutEvent;
      try {
        event = JSON.parse(trimmed) as RolloutEvent;
      } catch {
        continue;
      }

      const payload = event.payload;
      if (!payload) continue;
      const ts = event.timestamp;

      if (event.type === 'event_msg' && payload.type === 'user_message') {
        flush();
        const content = typeof payload.message === 'string' ? payload.message : '';
        if (content) messages.push({ role: 'user', content, timestamp: ts });
        continue;
      }

      if (event.type === 'event_msg' && payload.type === 'agent_message') {
        const content = typeof payload.message === 'string' ? payload.message : '';
        if (!content) continue;
        const turn = ensureRole('assistant', ts);
        turn.content = turn.content ? `${turn.content}\n\n${content}` : content;
        turn.timestamp ??= ts;
        continue;
      }

      if (event.type === 'response_item' && payload.type === 'function_call') {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const name = typeof payload.name === 'string' ? payload.name : 'tool';
        if (callId) callIdToName.set(callId, name);
        const turn = ensureRole('assistant', ts);
        const tool: ToolUseInfo = {
          id: callId,
          name,
          input: parseFunctionArguments(payload.arguments),
        };
        turn.toolUse = turn.toolUse ? [...turn.toolUse, tool] : [tool];
        continue;
      }

      if (event.type === 'response_item' && payload.type === 'function_call_output') {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const output = typeof payload.output === 'string' ? payload.output : '';
        const turn = ensureRole('user', ts);
        const result: ToolResultInfo = {
          toolUseId: callId,
          toolName: callIdToName.get(callId),
          output,
        };
        turn.toolResult = turn.toolResult ? [...turn.toolResult, result] : [result];
        continue;
      }
    }

    flush();
    return messages;
  }
}
