import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { ConversationMessage } from '../../../shared/types';

interface RolloutEvent {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    message?: string;
    images?: unknown[];
  };
}

interface ThreadRow {
  rollout_path: string | null;
}

/**
 * Reads conversation messages from a Codex thread's rollout JSONL.
 * Codex stores user/assistant text under `event_msg/user_message` and
 * `event_msg/agent_message`; tool calls and other interaction events
 * are intentionally skipped here for a clean text-first view.
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
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: RolloutEvent;
      try {
        event = JSON.parse(trimmed) as RolloutEvent;
      } catch {
        continue;
      }
      if (event.type !== 'event_msg') continue;
      const payload = event.payload;
      if (!payload) continue;
      const role = payload.type === 'user_message' ? 'user' : payload.type === 'agent_message' ? 'assistant' : null;
      if (!role) continue;
      const content = typeof payload.message === 'string' ? payload.message : '';
      if (!content) continue;
      messages.push({
        role,
        content,
        timestamp: event.timestamp,
      });
    }
    return messages;
  }
}
