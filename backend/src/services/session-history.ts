import { readFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface HistorySession {
  sessionId: string;
  projectPath: string;
  projectName: string;
  firstPrompt?: string;
  summary?: string;
  modified: string;
  // Phase 2 additions
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  messageCount?: number;
  gitBranch?: string;
}

interface SessionMetadata {
  startTime?: string;
  endTime?: string;
  messageCount: number;
  gitBranch?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface SessionsIndex {
  version: number;
  entries: Array<{
    sessionId: string;
    fullPath?: string;
    firstPrompt?: string;
    summary?: string;
    modified?: string;
    projectPath?: string;
  }>;
}

export class SessionHistoryService {
  private projectsDir: string;

  constructor() {
    this.projectsDir = join(homedir(), '.claude', 'projects');
  }

  async getRecentSessions(limit: number = 20, includeMetadata: boolean = false): Promise<HistorySession[]> {
    const sessions: HistorySession[] = [];

    try {
      const projectDirs = await readdir(this.projectsDir);

      for (const dir of projectDirs) {
        const indexPath = join(this.projectsDir, dir, 'sessions-index.json');

        try {
          const content = await readFile(indexPath, 'utf-8');
          const index: SessionsIndex = JSON.parse(content);

          for (const entry of index.entries) {
            // Convert directory name back to path
            const projectPath = entry.projectPath || dir.replace(/-/g, '/').replace(/^\//, '');
            const projectName = projectPath.replace(/^\/home\/[^/]+\//, '~/');

            const session: HistorySession = {
              sessionId: entry.sessionId,
              projectPath,
              projectName,
              firstPrompt: entry.firstPrompt,
              summary: entry.summary,
              modified: entry.modified || new Date().toISOString(),
            };

            // Fetch metadata if requested (Phase 2)
            if (includeMetadata) {
              const jsonlPath = entry.fullPath || join(this.projectsDir, dir, `${entry.sessionId}.jsonl`);
              const metadata = await this.getSessionMetadata(jsonlPath);
              if (metadata) {
                session.startTime = metadata.startTime;
                session.endTime = metadata.endTime;
                session.messageCount = metadata.messageCount;
                session.gitBranch = metadata.gitBranch;

                // Calculate duration in minutes
                if (metadata.startTime && metadata.endTime) {
                  const start = new Date(metadata.startTime).getTime();
                  const end = new Date(metadata.endTime).getTime();
                  session.durationMinutes = Math.round((end - start) / 60000);
                }
              }
            }

            sessions.push(session);
          }
        } catch {
          // Skip if sessions-index.json doesn't exist or is invalid
        }
      }

      // Sort by modified date (newest first) and limit
      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      return sessions.slice(0, limit);
    } catch {
      return [];
    }
  }

  async getConversation(sessionId: string): Promise<ConversationMessage[]> {
    try {
      // Find the session file
      const projectDirs = await readdir(this.projectsDir);

      for (const dir of projectDirs) {
        // First, try to find in sessions-index.json
        const indexPath = join(this.projectsDir, dir, 'sessions-index.json');

        try {
          const content = await readFile(indexPath, 'utf-8');
          const index: SessionsIndex = JSON.parse(content);

          const entry = index.entries.find(e => e.sessionId === sessionId);
          if (entry) {
            const jsonlPath = entry.fullPath || join(this.projectsDir, dir, `${sessionId}.jsonl`);
            return await this.parseJsonlFile(jsonlPath);
          }
        } catch {
          // Continue searching
        }

        // Also check for direct jsonl file (for active sessions not yet in index)
        const directPath = join(this.projectsDir, dir, `${sessionId}.jsonl`);
        const messages = await this.parseJsonlFile(directPath);
        if (messages.length > 0) {
          return messages;
        }
      }
    } catch {
      // Return empty
    }

    return [];
  }

  // Lazy load metadata for specific sessions (Phase 2 optimization)
  async getSessionsMetadata(sessionIds: string[]): Promise<Record<string, SessionMetadata>> {
    const result: Record<string, SessionMetadata> = {};

    try {
      const projectDirs = await readdir(this.projectsDir);

      for (const sessionId of sessionIds) {
        // Find the session file
        for (const dir of projectDirs) {
          const indexPath = join(this.projectsDir, dir, 'sessions-index.json');

          try {
            const content = await readFile(indexPath, 'utf-8');
            const index: SessionsIndex = JSON.parse(content);
            const entry = index.entries.find(e => e.sessionId === sessionId);

            if (entry) {
              const jsonlPath = entry.fullPath || join(this.projectsDir, dir, `${sessionId}.jsonl`);
              const metadata = await this.getSessionMetadata(jsonlPath);
              if (metadata) {
                result[sessionId] = metadata;
              }
              break;
            }
          } catch {
            // Continue searching
          }

          // Also check direct path
          const directPath = join(this.projectsDir, dir, `${sessionId}.jsonl`);
          const metadata = await this.getSessionMetadata(directPath);
          if (metadata && metadata.messageCount > 0) {
            result[sessionId] = metadata;
            break;
          }
        }
      }
    } catch {
      // Return what we have
    }

    return result;
  }

  private async parseJsonlFile(filePath: string): Promise<ConversationMessage[]> {
    const messages: ConversationMessage[] = [];

    try {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        try {
          const entry = JSON.parse(line);

          // Skip non-message entries
          if (entry.type !== 'user' && entry.type !== 'assistant') continue;
          if (!entry.message) continue;

          const role = entry.type as 'user' | 'assistant';
          let content = '';

          // Extract text content from message
          if (typeof entry.message === 'string') {
            content = entry.message;
          } else if (entry.message.content) {
            if (typeof entry.message.content === 'string') {
              content = entry.message.content;
            } else if (Array.isArray(entry.message.content)) {
              // Handle array of content blocks
              content = entry.message.content
                .filter((block: { type: string }) => block.type === 'text')
                .map((block: { text: string }) => block.text)
                .join('\n');
            } else if (entry.message.content.type === 'text') {
              content = entry.message.content.text;
            } else if (entry.message.content.type === 'tool_use') {
              // Tool use - show tool name
              content = `[Tool: ${entry.message.content.name}]`;
            }
          }

          // Skip empty messages and meta messages
          if (!content) continue;
          if (content.startsWith('<command-message>')) continue;
          if (content.startsWith('<system-reminder>')) continue;

          // Clean up long system prompts
          if (content.length > 2000) {
            content = content.substring(0, 500) + '\n...(truncated)...';
          }

          messages.push({
            role,
            content,
            timestamp: entry.timestamp,
          });
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // File not found or read error
    }

    return messages;
  }

  // Get session metadata from jsonl file (Phase 2)
  private async getSessionMetadata(filePath: string): Promise<SessionMetadata | null> {
    try {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let startTime: string | undefined;
      let endTime: string | undefined;
      let messageCount = 0;
      let gitBranch: string | undefined;

      for await (const line of rl) {
        try {
          const entry = JSON.parse(line);

          // Get timestamp for start/end time
          if (entry.timestamp) {
            if (!startTime) {
              startTime = entry.timestamp;
            }
            endTime = entry.timestamp;
          }

          // Count user and assistant messages
          if (entry.type === 'user' || entry.type === 'assistant') {
            messageCount++;
          }

          // Get git branch from init or summary entries
          if (entry.type === 'init' && entry.gitBranch) {
            gitBranch = entry.gitBranch;
          }
          if (entry.type === 'summary' && entry.gitBranch) {
            gitBranch = entry.gitBranch;
          }
        } catch {
          // Skip invalid lines
        }
      }

      return {
        startTime,
        endTime,
        messageCount,
        gitBranch,
      };
    } catch {
      return null;
    }
  }

}
