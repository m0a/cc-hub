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

// In-memory store (intentionally lost on restart)
const tokens = new Map<string, StoredToken>();

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

function isExpired(t: StoredToken): boolean {
  return t.expiresAt.getTime() < Date.now();
}

/** Purge expired tokens */
function cleanup() {
  for (const [key, val] of tokens) {
    if (isExpired(val)) tokens.delete(key);
  }
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
  return tokens.delete(token);
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
