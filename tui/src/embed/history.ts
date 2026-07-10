import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface HistoryEntry {
  sessionId: string;
  projectPath: string;
  title: string;
  mtimeMs: number;
}


/**
 * Extracts plain text from a message content field.
 * Content can be a string or an array of { type: 'text', text: string } objects.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { type: string; text: string } => {
        return typeof item === 'object' && item !== null && 'type' in item && 'text' in item;
      })
      .map((item) => item.text)
      .join('\n');
  }
  return '';
}

/**
 * Checks if text looks like command or caveat noise and should be skipped as a title.
 */
function isNoiseText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('<local-command') ||
    trimmed.startsWith('<command-name') ||
    trimmed.startsWith('Caveat:')
  );
}

/**
 * Extracts and cleans a title string: trim, collapse whitespace, cap at ~80 chars.
 */
function cleanTitle(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

/**
 * Parses a single JSONL file to extract title and projectPath.
 * Returns { title, projectPath } or null if parsing fails.
 */
function parseSessionFile(filePath: string): { title: string; projectPath: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let aiTitle: string | null = null;
    let lastPrompt: string | null = null;
    let firstUserText: string | null = null;
    let projectPath: string | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;

      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      // Extract cwd if present
      if (!projectPath && typeof entry.cwd === 'string' && entry.cwd.length > 0) {
        projectPath = entry.cwd;
      }

      // Extract ai-title
      if (!aiTitle && entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
        aiTitle = entry.aiTitle;
      }

      // Extract last-prompt
      if (
        !lastPrompt &&
        entry.type === 'last-prompt' &&
        typeof entry.lastPrompt === 'string'
      ) {
        lastPrompt = entry.lastPrompt;
      }

      // Extract first user message (skip noise)
      if (!firstUserText && entry.type === 'user' && entry.message) {
        const message = entry.message as Record<string, unknown>;
        const messageContent = extractTextContent(message.content);
        if (messageContent && !isNoiseText(messageContent)) {
          firstUserText = messageContent;
        }
      }

      // Early exit if we have enough data
      if (aiTitle && projectPath && lastPrompt) {
        break;
      }
    }

    // Choose title with priority: ai-title > last-prompt > first-user-text
    const title = aiTitle || lastPrompt || firstUserText || '(untitled)';

    return {
      title: cleanTitle(title),
      projectPath: projectPath || '(unknown)',
    };
  } catch {
    return null;
  }
}

/**
 * Lists Claude Code session history, most-recent first.
 * @param limit - Maximum number of entries to return (default 50).
 * @returns Array of HistoryEntry sorted by mtime descending.
 */
export function listHistory(limit: number = 50): HistoryEntry[] {
  const projectsRoot = join(process.env.HOME || '/root', '.claude', 'projects');

  let dirEntries: string[];
  try {
    dirEntries = readdirSync(projectsRoot);
  } catch {
    return [];
  }

  const sessionFiles: Array<{ path: string; sessionId: string; mtimeMs: number }> = [];

  // First pass: collect all .jsonl files with their mtimes
  for (const dirName of dirEntries) {
    const dirPath = join(projectsRoot, dirName);
    let sessionFiles_: string[];
    try {
      sessionFiles_ = readdirSync(dirPath);
    } catch {
      continue;
    }

    for (const fileName of sessionFiles_) {
      if (!fileName.endsWith('.jsonl')) continue;

      const filePath = join(dirPath, fileName);
      let stats: ReturnType<typeof statSync> | undefined;
      try {
        stats = statSync(filePath);
      } catch {
        continue;
      }

      const sessionId = fileName.slice(0, -6);
      sessionFiles.push({
        path: filePath,
        sessionId,
        mtimeMs: stats.mtimeMs || 0,
      });
    }
  }

  // Sort by mtime descending
  sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Second pass: read only the top N files to extract title and projectPath
  const result: HistoryEntry[] = [];
  for (const { path, sessionId, mtimeMs } of sessionFiles.slice(0, limit)) {
    const parsed = parseSessionFile(path);
    if (parsed) {
      result.push({
        sessionId,
        projectPath: parsed.projectPath,
        title: parsed.title,
        mtimeMs,
      });
    }
  }

  return result;
}

/**
 * Generates a shell command to resume the session in an interactive shell.
 * Format: cd '<projectPath>' && claude -r '<sessionId>'
 */
export function resumeCommand(entry: HistoryEntry): string {
  // Escape single quotes in paths and sessionId
  const escapePath = entry.projectPath.replace(/'/g, "'\\''");
  const escapeId = entry.sessionId.replace(/'/g, "'\\''");
  return `cd '${escapePath}' && claude -r '${escapeId}'`;
}
