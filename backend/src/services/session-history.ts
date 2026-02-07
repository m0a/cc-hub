import { readFile, readdir, stat } from 'node:fs/promises';
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
  // For session matching with active sessions
  firstMessageUuid?: string;
}

interface SessionMetadata {
  startTime?: string;
  endTime?: string;
  messageCount: number;
  gitBranch?: string;
  firstMessageUuid?: string;  // For session matching
}

export interface ToolUseInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultInfo {
  toolUseId: string;
  toolName?: string;
  output: string;
  isError?: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  thinking?: string;
  toolUse?: ToolUseInfo[];
  toolResult?: ToolResultInfo[];
}

export interface ProjectInfo {
  dirName: string;  // Directory name for API calls (e.g., "-home-m0a-cchub")
  projectPath: string;
  projectName: string;
  sessionCount: number;
  latestModified?: string;
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

  /**
   * Read last user message from file tail (efficient for large files)
   */
  private async readLastUserMessage(filePath: string): Promise<string | null> {
    try {
      const proc = Bun.spawn(['tail', '-n', '500', filePath], {
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

            // Skip array content (tool_result etc.)
            if (Array.isArray(content)) continue;
            if (typeof content !== 'string' || content.length === 0) continue;

            // Skip system/tool messages
            if (content.startsWith('[Request interrupted')) continue;
            if (content.startsWith('Implement the following plan:')) continue;
            if (content.startsWith('<task-notification>')) continue;
            if (content.startsWith('<system-reminder>')) continue;
            if (content.trim().startsWith('<')) continue;

            return content.slice(0, 100) + (content.length > 100 ? '...' : '');
          }
        } catch {
          // Skip invalid JSON
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Search for a query string within all user messages in a session file
   * Returns the matching message snippet if found, otherwise null
   */
  private async searchInSessionFile(filePath: string, query: string): Promise<string | null> {
    try {
      const fileContent = await readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'user' && entry.message?.content) {
            let content = entry.message.content;
            // Handle array content (tool results, etc.)
            if (Array.isArray(content)) {
              content = content
                .filter((c: { type: string }) => c.type === 'text')
                .map((c: { text: string }) => c.text)
                .join(' ');
            }
            if (typeof content === 'string' && content.toLowerCase().includes(query)) {
              // Return a snippet of the matching content
              const idx = content.toLowerCase().indexOf(query);
              const start = Math.max(0, idx - 20);
              const end = Math.min(content.length, idx + query.length + 60);
              let snippet = content.substring(start, end).replace(/\n/g, ' ').trim();
              if (start > 0) snippet = `...${snippet}`;
              if (end < content.length) snippet = `${snippet}...`;
              return snippet;
            }
          }
        } catch {
          // Skip invalid lines
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Scan a JSONL file to extract basic session info
   * Simplified: reads header for IDs, tail for last prompt
   */
  private async scanJsonlForBasicInfo(filePath: string): Promise<{
    sessionId: string;
    projectPath: string;
    lastPrompt?: string;
    modified: string;
    firstUserUuid?: string;
  } | null> {
    try {
      const fileStat = await stat(filePath);
      const modified = fileStat.mtime.toISOString();

      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let sessionId: string | undefined;
      let projectPath: string | undefined;
      let firstUserUuid: string | undefined;
      let linesRead = 0;
      const maxLines = 30; // Only need header info

      for await (const line of rl) {
        linesRead++;
        if (linesRead > maxLines) break;

        try {
          const entry = JSON.parse(line);

          if (!sessionId && entry.sessionId) {
            sessionId = entry.sessionId;
          }

          if (!projectPath && entry.cwd) {
            projectPath = entry.cwd;
          }

          // Get first user UUID for active session matching
          if (!firstUserUuid && entry.type === 'user' && entry.uuid) {
            firstUserUuid = entry.uuid;
          }

          if (sessionId && projectPath && firstUserUuid) break;
        } catch {
          // Skip invalid JSON lines
        }
      }

      rl.close();
      fileStream.destroy();

      // Fallbacks
      if (!sessionId) {
        const filename = filePath.split('/').pop();
        sessionId = filename?.replace('.jsonl', '') || '';
      }

      if (!projectPath) {
        const dirName = filePath.split('/').slice(-2, -1)[0];
        projectPath = dirName?.replace(/^-/, '/').replace(/-/g, '/') || '/unknown';
      }

      // Get last prompt from tail (efficient)
      const lastPrompt = await this.readLastUserMessage(filePath);

      return {
        sessionId,
        projectPath,
        lastPrompt: lastPrompt || undefined,
        modified,
        firstUserUuid,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get list of projects (directories) with session counts - fast, no file content reading
   */
  async getProjects(): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];

    try {
      const projectDirs = await readdir(this.projectsDir);

      await Promise.all(projectDirs.map(async (dir) => {
        const projectDir = join(this.projectsDir, dir);

        try {
          const dirStat = await stat(projectDir);
          if (!dirStat.isDirectory()) return;

          const files = await readdir(projectDir);
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

          if (jsonlFiles.length === 0) return;

          // Read projectPath from session files (try multiple files until cwd is found)
          let projectPath: string | null = null;

          // Prefer non-agent files first (they have cwd earlier in the file)
          const sortedFiles = [...jsonlFiles].sort((a, b) => {
            const aIsAgent = a.startsWith('agent-');
            const bIsAgent = b.startsWith('agent-');
            if (aIsAgent && !bIsAgent) return 1;
            if (!aIsAgent && bIsAgent) return -1;
            return 0;
          });

          for (const file of sortedFiles) { // Try all files until cwd is found
            if (projectPath) break;
            const filePath = join(projectDir, file);

            try {
              const fileStream = createReadStream(filePath);
              const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
              let linesRead = 0;

              for await (const line of rl) {
                linesRead++;
                if (linesRead > 30) break;
                try {
                  const entry = JSON.parse(line);
                  if (entry.cwd) {
                    projectPath = entry.cwd;
                    break;
                  }
                } catch { /* skip */ }
              }
              rl.close();
              fileStream.destroy();
            } catch { /* try next file */ }
          }

          // Fallback: parse from directory name (may be inaccurate for paths with hyphens)
          if (!projectPath) {
            projectPath = dir.replace(/^-/, '/').replace(/-/g, '/');
          }

          const projectName = projectPath.replace(/^\/home\/[^/]+\//, '~/');
          const latestModified = dirStat.mtime.toISOString();

          projects.push({
            dirName: dir,
            projectPath,
            projectName,
            sessionCount: jsonlFiles.length,
            latestModified,
          });
        } catch {
          // Skip directories that can't be read
        }
      }));

      // Sort by latest modified (newest first)
      projects.sort((a, b) => {
        if (!a.latestModified || !b.latestModified) return 0;
        return new Date(b.latestModified).getTime() - new Date(a.latestModified).getTime();
      });

      return projects;
    } catch {
      return [];
    }
  }

  /**
   * Get sessions for a specific project directory
   */
  async getProjectSessions(projectDirName: string): Promise<HistorySession[]> {
    const sessions: HistorySession[] = [];
    const projectDir = join(this.projectsDir, projectDirName);

    try {
      const files = await readdir(projectDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      for (const file of jsonlFiles) {
        const jsonlPath = join(projectDir, file);
        const basicInfo = await this.scanJsonlForBasicInfo(jsonlPath);

        // Skip sessions with no user messages
        if (basicInfo?.lastPrompt) {
          const projectName = basicInfo.projectPath.replace(/^\/home\/[^/]+\//, '~/');

          sessions.push({
            sessionId: basicInfo.sessionId,
            projectPath: basicInfo.projectPath,
            projectName,
            firstPrompt: basicInfo.lastPrompt,
            modified: basicInfo.modified,
          });
        }
      }

      // Sort by modified date (newest first)
      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      return sessions;
    } catch {
      return [];
    }
  }

  async getRecentSessions(limit: number = 20, includeMetadata: boolean = false): Promise<HistorySession[]> {
    const sessions: HistorySession[] = [];
    const seenSessionIds = new Set<string>();

    try {
      const projectDirs = await readdir(this.projectsDir);

      for (const dir of projectDirs) {
        const projectDir = join(this.projectsDir, dir);

        try {
          const files = await readdir(projectDir);
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

          for (const file of jsonlFiles) {
            const jsonlPath = join(projectDir, file);
            const basicInfo = await this.scanJsonlForBasicInfo(jsonlPath);

            // Skip sessions with no user messages (empty/abandoned sessions)
            if (basicInfo?.lastPrompt && !seenSessionIds.has(basicInfo.sessionId)) {
              seenSessionIds.add(basicInfo.sessionId);

              const projectName = basicInfo.projectPath.replace(/^\/home\/[^/]+\//, '~/');

              const session: HistorySession = {
                sessionId: basicInfo.sessionId,
                projectPath: basicInfo.projectPath,
                projectName,
                firstPrompt: basicInfo.lastPrompt,  // Now using lastPrompt
                modified: basicInfo.modified,
              };

              if (includeMetadata) {
                const metadata = await this.getSessionMetadata(jsonlPath);
                if (metadata) {
                  session.startTime = metadata.startTime;
                  session.endTime = metadata.endTime;
                  session.messageCount = metadata.messageCount;
                  session.gitBranch = metadata.gitBranch;
                  session.firstMessageUuid = metadata.firstMessageUuid;

                  if (metadata.startTime && metadata.endTime) {
                    const start = new Date(metadata.startTime).getTime();
                    const end = new Date(metadata.endTime).getTime();
                    session.durationMinutes = Math.round((end - start) / 60000);
                  }
                }
              }

              sessions.push(session);
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      }

      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      return sessions.slice(0, limit);
    } catch {
      return [];
    }
  }

  async getConversation(sessionId: string, projectDirName?: string): Promise<ConversationMessage[]> {
    try {
      // If projectDirName is provided, look directly in that directory
      if (projectDirName) {
        const projectDir = join(this.projectsDir, projectDirName);
        const directPath = join(projectDir, `${sessionId}.jsonl`);
        const messages = await this.parseJsonlFile(directPath);
        if (messages.length > 0) {
          return messages;
        }
        // Fallback: check sessions-index.json for fullPath
        const indexPath = join(projectDir, 'sessions-index.json');
        try {
          const content = await readFile(indexPath, 'utf-8');
          const index: SessionsIndex = JSON.parse(content);
          const entry = index.entries.find(e => e.sessionId === sessionId);
          if (entry?.fullPath) {
            return await this.parseJsonlFile(entry.fullPath);
          }
        } catch {
          // Index not found or parse error
        }
      }

      // Fallback: search all project directories (legacy behavior)
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
    // Track tool names by tool_use id for tool_result display
    const toolNameMap = new Map<string, string>();

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
          let thinking: string | undefined;
          const toolUse: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          const toolResult: Array<{ toolUseId: string; toolName?: string; output: string; isError?: boolean }> = [];

          // Extract content from message
          if (typeof entry.message === 'string') {
            content = entry.message;
          } else if (entry.message.content) {
            if (typeof entry.message.content === 'string') {
              content = entry.message.content;
            } else if (Array.isArray(entry.message.content)) {
              // Handle array of content blocks - extract all types
              const textParts: string[] = [];
              const thinkingParts: string[] = [];

              for (const block of entry.message.content) {
                if (block.type === 'text') {
                  textParts.push(block.text);
                } else if (block.type === 'thinking') {
                  thinkingParts.push(block.thinking);
                } else if (block.type === 'tool_use') {
                  // Store tool name for later reference
                  toolNameMap.set(block.id, block.name);
                  toolUse.push({
                    id: block.id,
                    name: block.name,
                    input: block.input || {},
                  });
                } else if (block.type === 'tool_result') {
                  // Extract tool result content
                  let output = '';
                  if (typeof block.content === 'string') {
                    output = block.content;
                  } else if (Array.isArray(block.content)) {
                    output = block.content
                      .filter((c: { type: string }) => c.type === 'text')
                      .map((c: { text: string }) => c.text)
                      .join('\n');
                  }
                  toolResult.push({
                    toolUseId: block.tool_use_id,
                    toolName: toolNameMap.get(block.tool_use_id),
                    output,
                    isError: block.is_error,
                  });
                }
              }

              content = textParts.join('\n');
              if (thinkingParts.length > 0) {
                thinking = thinkingParts.join('\n\n');
              }
            } else if (entry.message.content.type === 'text') {
              content = entry.message.content.text;
            } else if (entry.message.content.type === 'tool_use') {
              toolNameMap.set(entry.message.content.id, entry.message.content.name);
              toolUse.push({
                id: entry.message.content.id,
                name: entry.message.content.name,
                input: entry.message.content.input || {},
              });
            }
          }

          // Skip messages with no meaningful content
          const hasContent = content || thinking || toolUse.length > 0 || toolResult.length > 0;
          if (!hasContent) continue;

          // Skip internal meta messages
          if (content.startsWith('<system-reminder>')) continue;
          if (content.startsWith('<local-command-caveat>')) continue;

          // Format command-related messages for readability
          if (content) {
            content = content
              .replace(/<command-name>([^<]*)<\/command-name>/g, '📌 コマンド: $1')
              .replace(/<command-message>([^<]*)<\/command-message>/g, '$1')
              .replace(/<command-args>([^<]*)<\/command-args>/g, '')
              .replace(/<local-command-stdout>([^<]*)<\/local-command-stdout>/g, '💬 $1')
              .replace(/<task-notification>.*?<status>([^<]*)<\/status>.*?<summary>([^<]*)<\/summary>.*?<\/task-notification>.*/gs, '⚙️ タスク ($1): $2')
              .replace(/<bash-notification>.*?<status>([^<]*)<\/status>.*?<summary>([^<]*)<\/summary>.*/gs, '🖥️ バックグラウンド ($1): $2')
              .replace(/<bash-input>([^<]*)<\/bash-input>/g, '⌨️ 入力: $1')
              // Handle incomplete notification fragments
              .replace(/<status>([^<]*)<\/status>/g, '[$1]')
              .replace(/<summary>([^<]*)<\/summary>/g, '$1')
              .replace(/<task-id>[^<]*<\/task-id>/g, '')
              .replace(/<output-file>[^<]*<\/output-file>/g, '')
              .replace(/<shell-id>[^<]*<\/shell-id>/g, '')
              // biome-ignore lint/suspicious/noControlCharactersInRegex: removing terminal escape sequences requires matching ESC char
              .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
              .replace(/\[\?[0-9]+[hl]/g, '');

            // Clean up long content
            if (content.length > 5000) {
              content = `${content.substring(0, 2000)}\n...(truncated)...`;
            }
          }

          messages.push({
            role,
            content,
            timestamp: entry.timestamp,
            thinking,
            toolUse: toolUse.length > 0 ? toolUse : undefined,
            toolResult: toolResult.length > 0 ? toolResult : undefined,
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
      let firstMessageUuid: string | undefined;

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

          // Get first user message uuid (for session matching)
          if (entry.type === 'user' && entry.uuid && !firstMessageUuid) {
            firstMessageUuid = entry.uuid;
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
        firstMessageUuid,
      };
    } catch {
      return null;
    }
  }

  /**
   * Search sessions across all projects
   */
  async searchSessions(query: string, limit: number = 50): Promise<HistorySession[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const results: HistorySession[] = [];

    try {
      const projectDirs = await readdir(this.projectsDir);

      await Promise.all(projectDirs.map(async (dir) => {
        const projectDir = join(this.projectsDir, dir);

        try {
          const dirStat = await stat(projectDir);
          if (!dirStat.isDirectory()) return;

          const files = await readdir(projectDir);
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

          for (const file of jsonlFiles) {
            if (results.length >= limit) break;

            const jsonlPath = join(projectDir, file);
            const basicInfo = await this.scanJsonlForBasicInfo(jsonlPath);

            if (basicInfo?.lastPrompt) {
              // Search in project name and first prompt
              const projectName = basicInfo.projectPath.replace(/^\/home\/[^/]+\//, '~/');
              const searchText = `${projectName} ${basicInfo.lastPrompt}`.toLowerCase();

              if (searchText.includes(normalizedQuery)) {
                results.push({
                  sessionId: basicInfo.sessionId,
                  projectPath: basicInfo.projectPath,
                  projectName,
                  firstPrompt: basicInfo.lastPrompt,
                  modified: basicInfo.modified,
                });
              }
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      }));

      // Sort by modified date (newest first)
      results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      return results.slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Search sessions with streaming results (generator)
   * Yields results as they are found for incremental display
   */
  async *searchSessionsStream(query: string, limit: number = 50): AsyncGenerator<HistorySession> {
    if (!query || query.trim().length === 0) {
      return;
    }

    const normalizedQuery = query.toLowerCase().trim();
    let count = 0;

    try {
      const projectDirs = await readdir(this.projectsDir);

      // Sort by modification time (process newest first)
      const dirStats = await Promise.all(
        projectDirs.map(async (dir) => {
          try {
            const dirPath = join(this.projectsDir, dir);
            const dirStat = await stat(dirPath);
            return { dir, mtime: dirStat.mtime.getTime(), isDir: dirStat.isDirectory() };
          } catch {
            return { dir, mtime: 0, isDir: false };
          }
        })
      );

      dirStats.sort((a, b) => b.mtime - a.mtime);

      for (const { dir, isDir } of dirStats) {
        if (!isDir || count >= limit) continue;

        const projectDir = join(this.projectsDir, dir);

        try {
          const files = await readdir(projectDir);
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

          // Get file stats and sort by modification time
          const fileStats = await Promise.all(
            jsonlFiles.map(async (file) => {
              try {
                const filePath = join(projectDir, file);
                const fileStat = await stat(filePath);
                return { file, mtime: fileStat.mtime.getTime() };
              } catch {
                return { file, mtime: 0 };
              }
            })
          );

          fileStats.sort((a, b) => b.mtime - a.mtime);

          for (const { file } of fileStats) {
            if (count >= limit) break;

            const jsonlPath = join(projectDir, file);
            const basicInfo = await this.scanJsonlForBasicInfo(jsonlPath);

            if (basicInfo) {
              const projectName = basicInfo.projectPath.replace(/^\/home\/[^/]+\//, '~/');

              // Quick search: check project name and last prompt first
              const quickSearchText = `${projectName} ${basicInfo.lastPrompt || ''}`.toLowerCase();
              let matchSnippet: string | null = null;

              if (quickSearchText.includes(normalizedQuery)) {
                matchSnippet = basicInfo.lastPrompt || projectName;
              } else {
                // Full-text search: search through all user messages
                matchSnippet = await this.searchInSessionFile(jsonlPath, normalizedQuery);
              }

              if (matchSnippet) {
                count++;
                yield {
                  sessionId: basicInfo.sessionId,
                  projectPath: basicInfo.projectPath,
                  projectName,
                  firstPrompt: matchSnippet,
                  modified: basicInfo.modified,
                };
              }
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      }
    } catch {
      // Error reading projects directory
    }
  }

}
