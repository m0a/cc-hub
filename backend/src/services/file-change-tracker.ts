import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { FileChange } from '../../../shared/types';

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
  };
}

interface AssistantMessage {
  type: 'assistant';
  timestamp?: string;
  message?: {
    content?: Array<ToolUseBlock | { type: string }>;
  };
}

export class FileChangeTracker {
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
   * Find the most recent .jsonl file in a project directory
   */
  private async findLatestJsonl(projectDir: string): Promise<string | null> {
    try {
      const files = await readdir(projectDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      if (jsonlFiles.length === 0) return null;

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

      const validStats = fileStats.filter((s): s is { name: string; mtime: number } => s !== null);
      const latest = validStats.reduce<{ name: string; mtime: number } | null>(
        (best, current) => (!best || current.mtime > best.mtime) ? current : best,
        null
      );

      return latest ? join(projectDir, latest.name) : null;
    } catch {
      return null;
    }
  }

  /**
   * Parse a .jsonl file and extract Write/Edit tool calls
   */
  private async parseJsonlForChanges(filePath: string): Promise<FileChange[]> {
    const changes: FileChange[] = [];

    return new Promise((resolve) => {
      try {
        const stream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });

        rl.on('line', (line) => {
          try {
            const entry = JSON.parse(line) as AssistantMessage;

            if (entry.type !== 'assistant' || !entry.message?.content) {
              return;
            }

            const timestamp = entry.timestamp || new Date().toISOString();

            for (const block of entry.message.content) {
              if (block.type !== 'tool_use') continue;

              const toolBlock = block as ToolUseBlock;

              if (toolBlock.name === 'Write' && toolBlock.input?.file_path) {
                changes.push({
                  path: toolBlock.input.file_path,
                  toolName: 'Write',
                  timestamp,
                  newContent: toolBlock.input.content,
                });
              } else if (toolBlock.name === 'Edit' && toolBlock.input?.file_path) {
                changes.push({
                  path: toolBlock.input.file_path,
                  toolName: 'Edit',
                  timestamp,
                  oldContent: toolBlock.input.old_string,
                  newContent: toolBlock.input.new_string,
                });
              }
            }
          } catch {
            // Skip invalid JSON lines
          }
        });

        rl.on('close', () => resolve(changes));
        rl.on('error', () => resolve(changes));
      } catch {
        resolve(changes);
      }
    });
  }

  /**
   * Get all file changes for a working directory (current Claude Code session)
   */
  async getChangesForWorkingDir(workingDir: string): Promise<FileChange[]> {
    // Try exact path first, then parent directories
    let currentPath = workingDir;

    while (currentPath && currentPath !== '/') {
      const projectName = this.pathToProjectName(currentPath);
      const projectDir = join(this.claudeDir, projectName);

      const latestJsonl = await this.findLatestJsonl(projectDir);
      if (latestJsonl) {
        const changes = await this.parseJsonlForChanges(latestJsonl);
        // Deduplicate by path, keeping the latest change per file
        const changesByPath = new Map<string, FileChange>();
        for (const change of changes) {
          changesByPath.set(change.path, change);
        }
        return Array.from(changesByPath.values())
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      // Move to parent directory
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
      if (parentPath === currentPath) break;
      currentPath = parentPath || '/';
    }

    return [];
  }

  /**
   * Get changes for a specific session ID (jsonl file)
   */
  async getChangesForSessionId(workingDir: string, sessionId: string): Promise<FileChange[]> {
    // Try exact path first, then parent directories
    let currentPath = workingDir;

    while (currentPath && currentPath !== '/') {
      const projectName = this.pathToProjectName(currentPath);
      const projectDir = join(this.claudeDir, projectName);
      const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

      try {
        await stat(jsonlPath);
        return await this.parseJsonlForChanges(jsonlPath);
      } catch {
        // File doesn't exist, try parent
      }

      const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
      if (parentPath === currentPath) break;
      currentPath = parentPath || '/';
    }

    return [];
  }
}
