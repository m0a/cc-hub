import { randomBytes } from 'node:crypto';
import type { ShareTokenInfo } from '../../../shared/types';

interface StoredToken {
  token: string;
  sessionId: string;
  sessionName: string;
  createdAt: Date;
  expiresAt: Date;
}

const MAX_TOKENS_PER_SESSION = 5;
const FUNNEL_PORT = 8443;

// In-memory store (intentionally lost on restart)
const tokens = new Map<string, StoredToken>();

// Funnel state
let funnelActive = false;

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

function isExpired(t: StoredToken): boolean {
  return t.expiresAt.getTime() < Date.now();
}

/** Purge expired tokens and disable Funnel if none remain */
function cleanup() {
  for (const [key, val] of tokens) {
    if (isExpired(val)) tokens.delete(key);
  }
  if (tokens.size === 0 && funnelActive) {
    disableFunnel();
  }
}

/** Get active token count (after cleanup) */
export function activeTokenCount(): number {
  cleanup();
  return tokens.size;
}

export function createShareToken(
  sessionId: string,
  sessionName: string,
  expiresInHours = 24,
): ShareTokenInfo {
  cleanup();

  // Check per-session limit
  const sessionTokens = [...tokens.values()].filter(t => t.sessionId === sessionId);
  if (sessionTokens.length >= MAX_TOKENS_PER_SESSION) {
    throw new Error(`Maximum ${MAX_TOKENS_PER_SESSION} share tokens per session`);
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);

  const stored: StoredToken = { token, sessionId, sessionName, createdAt: now, expiresAt };
  tokens.set(token, stored);

  // Enable Funnel if this is the first token
  if (!funnelActive) {
    enableFunnel();
  }

  return toInfo(stored);
}

export function validateShareToken(token: string): StoredToken | null {
  cleanup();
  const stored = tokens.get(token);
  if (!stored || isExpired(stored)) return null;
  return stored;
}

export function listShareTokens(sessionId: string): ShareTokenInfo[] {
  cleanup();
  return [...tokens.values()]
    .filter(t => t.sessionId === sessionId)
    .map(toInfo);
}

export function revokeShareToken(sessionId: string, token: string): boolean {
  const stored = tokens.get(token);
  if (!stored || stored.sessionId !== sessionId) return false;
  const deleted = tokens.delete(token);

  // Disable Funnel if no tokens remain
  cleanup();

  return deleted;
}

function toInfo(t: StoredToken): ShareTokenInfo {
  return {
    token: t.token,
    sessionId: t.sessionId,
    sessionName: t.sessionName,
    createdAt: t.createdAt.toISOString(),
    expiresAt: t.expiresAt.toISOString(),
  };
}

// --- Tailscale Funnel management ---

function enableFunnel() {
  const port = process.env.CCHUB_PORT || '5923';
  try {
    const result = Bun.spawnSync([
      'tailscale', 'funnel', '--bg', '--https', String(FUNNEL_PORT),
      `https+insecure://localhost:${port}`,
    ]);
    if (result.exitCode === 0) {
      funnelActive = true;
      console.log(`🌐 Funnel enabled on port ${FUNNEL_PORT} (share token created)`);
    } else {
      const stderr = result.stderr.toString();
      console.warn(`⚠️  Funnel setup failed: ${stderr.trim()}`);
    }
  } catch {
    console.warn('⚠️  Failed to enable Funnel');
  }
}

function disableFunnel() {
  try {
    const result = Bun.spawnSync([
      'tailscale', 'funnel', `--https=${FUNNEL_PORT}`, 'off',
    ]);
    if (result.exitCode === 0) {
      funnelActive = false;
      console.log(`🔒 Funnel disabled on port ${FUNNEL_PORT} (no active share tokens)`);
    }
  } catch {
    // Best effort
  }
}

/** Check if Funnel is already active on startup (e.g. from previous run) */
export function checkExistingFunnel(): boolean {
  try {
    const result = Bun.spawnSync(['tailscale', 'funnel', 'status', '--json']);
    if (result.exitCode !== 0) return false;
    const status = JSON.parse(result.stdout.toString());
    const allowFunnel = status.AllowFunnel as Record<string, boolean> | undefined;
    if (!allowFunnel) return false;

    for (const hostPort of Object.keys(allowFunnel)) {
      if (allowFunnel[hostPort] && hostPort.endsWith(`:${FUNNEL_PORT}`)) {
        // Funnel is active from previous run but no tokens exist — disable it
        disableFunnel();
        return false;
      }
    }
  } catch {
    // ignore
  }
  return false;
}
