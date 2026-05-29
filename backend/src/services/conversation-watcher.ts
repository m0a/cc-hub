import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SessionHistoryService } from './session-history';
import { ClaudeCodeService } from './claude-code';
import type { ConversationMessage } from '../../../shared/types';
import { claudeProjectDirName } from '../utils/claude-project-path';

type ConversationListener = (newMessages: ConversationMessage[]) => void;

const sessionHistoryService = new SessionHistoryService();
const claudeCodeService = new ClaudeCodeService();
const claudeProjectsDir = join(homedir(), '.claude', 'projects');

function pathToProjectName(path: string): string {
  return claudeProjectDirName(path);
}

export class ConversationWatcher {
  private watcher: FSWatcher | null = null;
  private filePath: string | null = null;
  private projectDirName: string | null = null;
  private ccSessionId: string | null = null;
  private parsedCount = 0;
  private listeners = new Set<ConversationListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private reparsing = false;
  private pendingReparse = false;
  private lastMtimeMs = 0;

  /**
   * Start watching the conversation jsonl associated with the given working directory.
   * Returns the initial set of conversation messages (may be empty if no session exists yet).
   */
  async start(workingDir: string): Promise<ConversationMessage[]> {
    const session = await claudeCodeService.getSessionForPath(workingDir);
    if (!session?.sessionId) {
      return [];
    }

    const projectDirName = pathToProjectName(session.projectPath || workingDir);
    const filePath = join(claudeProjectsDir, projectDirName, `${session.sessionId}.jsonl`);

    this.filePath = filePath;
    this.projectDirName = projectDirName;
    this.ccSessionId = session.sessionId;

    const messages = await sessionHistoryService.getConversation(session.sessionId, projectDirName);
    this.parsedCount = messages.length;

    try {
      const fileStat = await stat(filePath);
      this.lastMtimeMs = fileStat.mtimeMs;
    } catch {
      this.lastMtimeMs = 0;
    }

    try {
      this.watcher = watch(filePath, { persistent: false }, () => this.onChange());
    } catch (err) {
      console.warn(`[conversation-watcher] failed to watch ${filePath}:`, err);
    }

    return messages;
  }

  onUpdate(listener: ConversationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private onChange() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.reparseAndNotify();
    }, 150);
  }

  private async reparseAndNotify(): Promise<void> {
    if (!this.filePath || !this.ccSessionId || !this.projectDirName) return;
    if (this.reparsing) {
      this.pendingReparse = true;
      return;
    }
    this.reparsing = true;
    try {
      let mtimeMs = 0;
      try {
        const fileStat = await stat(this.filePath);
        mtimeMs = fileStat.mtimeMs;
      } catch {
        return;
      }
      if (mtimeMs === this.lastMtimeMs) {
        return;
      }
      this.lastMtimeMs = mtimeMs;

      const messages = await sessionHistoryService.getConversation(
        this.ccSessionId,
        this.projectDirName,
      );

      if (messages.length <= this.parsedCount) {
        if (messages.length < this.parsedCount) {
          this.parsedCount = messages.length;
        }
        return;
      }

      const newMessages = messages.slice(this.parsedCount);
      this.parsedCount = messages.length;
      for (const listener of this.listeners) {
        try {
          listener(newMessages);
        } catch (err) {
          console.warn('[conversation-watcher] listener error:', err);
        }
      }
    } finally {
      this.reparsing = false;
      if (this.pendingReparse) {
        this.pendingReparse = false;
        void this.reparseAndNotify();
      }
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* ignore */
      }
      this.watcher = null;
    }
    this.listeners.clear();
    this.filePath = null;
    this.projectDirName = null;
    this.ccSessionId = null;
    this.parsedCount = 0;
    this.lastMtimeMs = 0;
  }

  getCcSessionId(): string | null {
    return this.ccSessionId;
  }
}
