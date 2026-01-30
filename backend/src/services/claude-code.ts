import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

interface ClaudeCodeSession {
  sessionId: string;
  summary?: string;
  firstPrompt?: string;
  messageCount?: number;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  waitingForInput?: boolean;
  waitingToolName?: string;
}

interface SessionsIndex {
  version: number;
  entries: Array<{
    sessionId: string;
    fullPath: string;
    fileMtime: number;
    firstPrompt?: string;
    summary?: string;
    messageCount?: number;
    created?: string;
    modified?: string;
    gitBranch?: string;
    projectPath?: string;
    isSidechain?: boolean;
  }>;
  originalPath?: string;
}

export class ClaudeCodeService {
  private claudeDir: string;

  constructor() {
    this.claudeDir = join(homedir(), '.claude', 'projects');
  }

  /**
   * Convert a path to Claude Code project directory name
   * e.g., /home/m0a/cchub -> -home-m0a-cchub
   */
  private pathToProjectName(path: string): string {
    return path.replace(/\//g, '-');
  }

  /**
   * Read the last user message from a session jsonl file (for current conversation)
   */
  private async readLastUserMessage(filePath: string): Promise<string | null> {
    try {
      // Use tail to get last 100 lines efficiently
      const proc = Bun.spawn(['tail', '-n', '100', filePath], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) return null;

      const lines = text.trim().split('\n').reverse();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'user' && entry.message?.content) {
            const content = entry.message.content;
            if (Array.isArray(content)) continue;
            if (typeof content !== 'string' || content.length === 0) continue;
            if (content.startsWith('[Request interrupted')) continue;
            if (content.startsWith('Implement the following plan:')) continue;
            // Skip system-generated messages
            if (content.startsWith('<task-notification>')) continue;
            if (content.startsWith('<system-reminder>')) continue;
            if (content.trim().startsWith('<')) continue; // Skip any XML-like content
            // Return truncated message
            return content.slice(0, 100) + (content.length > 100 ? '...' : '');
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if the session is waiting for user input by reading the jsonl file
   * Returns the tool name if waiting, null otherwise
   */
  private async checkWaitingState(filePath: string): Promise<string | null> {
    try {
      // Use tail to get last 20 lines
      const proc = Bun.spawn(['tail', '-n', '20', filePath], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) return null;

      const lines = text.trim().split('\n');
      const entries: Array<{ type: string; message?: { content?: Array<{ type: string; name?: string; id?: string }> }; toolUseResult?: unknown }> = [];

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Skip invalid JSON
        }
      }

      // Find the last assistant message with tool_use
      let lastToolUse: { name: string; id: string } | null = null;

      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];

        // If we find a tool_result, the tool has been executed
        if (entry.type === 'user' && entry.toolUseResult !== undefined) {
          return null; // Not waiting, tool result received
        }

        // Look for assistant messages with tool_use
        if (entry.type === 'assistant' && entry.message?.content) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_use' && block.name && block.id) {
              lastToolUse = { name: block.name, id: block.id };
              break;
            }
          }
          if (lastToolUse) break;
        }
      }

      // Check if the last tool_use is still pending
      if (lastToolUse) {
        // These tools always wait for user input
        const waitingTools = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'];
        if (waitingTools.includes(lastToolUse.name)) {
          return lastToolUse.name;
        }

        // For other tools, check if there's a tool_result with matching tool_use_id
        const hasResult = entries.some(entry =>
          entry.type === 'user' &&
          entry.message?.content?.some(
            (block: { type: string; tool_use_id?: string }) =>
              block.type === 'tool_result' && block.tool_use_id === lastToolUse!.id
          )
        );

        if (!hasResult) {
          // Tool use is pending - might be waiting for permission
          return lastToolUse.name;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Read the first prompt from a session jsonl file
   */
  private async readFirstPromptFromFile(filePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const stream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        let linesRead = 0;
        const maxLines = 50;
        let resolved = false;

        const done = (value: string | null) => {
          if (resolved) return;
          resolved = true;
          rl.close();
          stream.destroy();
          resolve(value);
        };

        rl.on('line', (line) => {
          if (resolved) return;
          linesRead++;
          if (linesRead > maxLines) {
            done(null);
            return;
          }

          try {
            const entry = JSON.parse(line);
            if (entry.type === 'user' && entry.message?.content) {
              const content = entry.message.content;
              if (Array.isArray(content)) return;
              if (typeof content !== 'string' || content.length === 0) return;
              if (content.startsWith('[Request interrupted')) return;
              if (content.startsWith('Implement the following plan:')) {
                done('(継続セッション)');
                return;
              }
              done(content.slice(0, 100) + (content.length > 100 ? '...' : ''));
              return;
            }
          } catch {
            // Skip invalid JSON lines
          }
        });

        rl.on('close', () => done(null));
        rl.on('error', () => done(null));
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Get the latest Claude Code session info for a given working directory
   */
  async getSessionForPath(workingDir: string): Promise<ClaudeCodeSession | null> {
    try {
      // Try exact path first, then parent directories
      let currentPath = workingDir;

      while (currentPath && currentPath !== '/') {
        const projectName = this.pathToProjectName(currentPath);
        const projectDir = join(this.claudeDir, projectName);
        const indexPath = join(projectDir, 'sessions-index.json');

        try {
          // First, find the most recently modified .jsonl file
          const files = await readdir(projectDir);
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

          // Get stats for all files in parallel
          const fileStats = await Promise.all(
            jsonlFiles.map(async (file) => {
              try {
                const fileStat = await stat(join(projectDir, file));
                return { name: file, mtime: fileStat.mtimeMs };
              } catch {
                return null;
              }
            })
          );

          // Find the most recent file
          const validStats = fileStats.filter((s): s is { name: string; mtime: number } => s !== null);
          const latestFile = validStats.reduce<{ name: string; mtime: number } | null>(
            (latest, current) => (!latest || current.mtime > latest.mtime) ? current : latest,
            null
          );

          // Read the index to get cached info
          let index: SessionsIndex | null = null;
          try {
            const content = await readFile(indexPath, 'utf-8');
            index = JSON.parse(content);
          } catch {
            // Index doesn't exist or is invalid
          }

          // Check if the latest file is newer than what's in the index
          if (latestFile) {
            const sessionId = latestFile.name.replace('.jsonl', '');
            const indexEntry = index?.entries?.find(e => e.sessionId === sessionId);

            // If this file is in the index and not much newer, use cached data
            if (indexEntry && (latestFile.mtime - (indexEntry.fileMtime || 0)) < 60000) {
              return {
                sessionId: indexEntry.sessionId,
                summary: indexEntry.summary,
                firstPrompt: indexEntry.firstPrompt,
                messageCount: indexEntry.messageCount,
                modified: indexEntry.modified,
                gitBranch: indexEntry.gitBranch,
                projectPath: indexEntry.projectPath,
              };
            }

            // For active sessions (not in index or much newer), read directly
            const filePath = join(projectDir, latestFile.name);
            const firstPrompt = await this.readFirstPromptFromFile(filePath);

            // Read the last user message as the current conversation summary
            const lastUserMessage = await this.readLastUserMessage(filePath);

            // Check if waiting for user input
            const waitingToolName = await this.checkWaitingState(filePath);

            return {
              sessionId,
              summary: lastUserMessage || indexEntry?.summary,
              firstPrompt: firstPrompt || indexEntry?.firstPrompt,
              messageCount: indexEntry?.messageCount,
              modified: new Date(latestFile.mtime).toISOString(),
              gitBranch: indexEntry?.gitBranch,
              projectPath: indexEntry?.projectPath,
              waitingForInput: waitingToolName !== null,
              waitingToolName: waitingToolName || undefined,
            };
          }

          // Fallback to index-only data
          if (index?.entries && index.entries.length > 0) {
            const sortedEntries = [...index.entries].sort((a, b) => {
              const aTime = a.fileMtime || 0;
              const bTime = b.fileMtime || 0;
              return bTime - aTime;
            });

            const latest = sortedEntries[0];
            return {
              sessionId: latest.sessionId,
              summary: latest.summary,
              firstPrompt: latest.firstPrompt,
              messageCount: latest.messageCount,
              modified: latest.modified,
              gitBranch: latest.gitBranch,
              projectPath: latest.projectPath,
            };
          }
        } catch {
          // Index doesn't exist for this path, try parent
        }

        // Move to parent directory
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
        if (parentPath === currentPath) break;
        currentPath = parentPath || '/';
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get Claude Code session summaries for multiple paths
   */
  async getSessionsForPaths(paths: string[]): Promise<Map<string, ClaudeCodeSession>> {
    const results = new Map<string, ClaudeCodeSession>();

    await Promise.all(
      paths.map(async (path) => {
        const session = await this.getSessionForPath(path);
        if (session) {
          results.set(path, session);
        }
      })
    );

    return results;
  }
}
