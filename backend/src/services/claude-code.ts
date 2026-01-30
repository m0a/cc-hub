import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface ClaudeCodeSession {
  sessionId: string;
  summary?: string;
  firstPrompt?: string;
  messageCount?: number;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
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
   * Get the latest Claude Code session info for a given working directory
   */
  async getSessionForPath(workingDir: string): Promise<ClaudeCodeSession | null> {
    try {
      // Try exact path first, then parent directories
      let currentPath = workingDir;

      while (currentPath && currentPath !== '/') {
        const projectName = this.pathToProjectName(currentPath);
        const indexPath = join(this.claudeDir, projectName, 'sessions-index.json');

        try {
          const content = await readFile(indexPath, 'utf-8');
          const index: SessionsIndex = JSON.parse(content);

          if (index.entries && index.entries.length > 0) {
            // Find the most recently modified session
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
