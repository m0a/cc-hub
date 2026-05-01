// Read the Claude Code OAuth access token from disk, with macOS Keychain
// fallback for newer Claude Code installations that no longer write
// ~/.claude/.credentials.json.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
  };
}

/**
 * Returns the OAuth access token, or null if not available.
 *
 * Lookup order:
 *   1. ~/.claude/.credentials.json  (older installs)
 *   2. macOS Keychain item "Claude Code-credentials"  (newer installs on darwin)
 */
export async function getClaudeAccessToken(): Promise<string | null> {
  // 1. File-based credential store
  try {
    const content = await readFile(join(homedir(), '.claude', '.credentials.json'), 'utf-8');
    const data = JSON.parse(content) as ClaudeCredentials;
    const token = data?.claudeAiOauth?.accessToken;
    if (token) return token;
  } catch {
    // fall through
  }

  // 2. macOS Keychain
  if (process.platform === 'darwin') {
    try {
      const result = Bun.spawnSync(['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w']);
      if (result.exitCode === 0) {
        const out = result.stdout.toString().trim();
        const data = JSON.parse(out) as ClaudeCredentials;
        return data?.claudeAiOauth?.accessToken ?? null;
      }
    } catch {
      // ignore
    }
  }

  return null;
}
