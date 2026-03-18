import { describe, test, expect, beforeEach } from 'bun:test';
import {
  createShareToken,
  validateShareToken,
  listShareTokens,
  revokeShareToken,
  activeTokenCount,
} from '../share-token';

// Reset tokens between tests by revoking all
function revokeAll(sessionId: string) {
  for (const t of listShareTokens(sessionId)) {
    revokeShareToken(sessionId, t.token);
  }
}

describe('share-token', () => {
  const SESSION_ID = 'test-session';
  const SESSION_NAME = 'Test Session';

  beforeEach(() => {
    revokeAll(SESSION_ID);
    revokeAll('other-session');
  });

  describe('createShareToken', () => {
    test('creates a token with correct fields', () => {
      const info = createShareToken(SESSION_ID, SESSION_NAME, 1);
      expect(info.token).toBeTruthy();
      expect(info.token.length).toBeGreaterThanOrEqual(20);
      expect(info.sessionId).toBe(SESSION_ID);
      expect(info.sessionName).toBe(SESSION_NAME);
      expect(info.createdAt).toBeTruthy();
      expect(info.expiresAt).toBeTruthy();
    });

    test('expiry is correct', () => {
      const info = createShareToken(SESSION_ID, SESSION_NAME, 2);
      const created = new Date(info.createdAt).getTime();
      const expires = new Date(info.expiresAt).getTime();
      const diffHours = (expires - created) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(2, 0);
    });

    test('generates unique tokens', () => {
      const t1 = createShareToken(SESSION_ID, SESSION_NAME);
      const t2 = createShareToken(SESSION_ID, SESSION_NAME);
      expect(t1.token).not.toBe(t2.token);
    });

    test('enforces max 5 tokens per session', () => {
      for (let i = 0; i < 5; i++) {
        createShareToken(SESSION_ID, SESSION_NAME);
      }
      expect(() => createShareToken(SESSION_ID, SESSION_NAME)).toThrow(/Maximum 5/);
    });

    test('max limit is per session', () => {
      for (let i = 0; i < 5; i++) {
        createShareToken(SESSION_ID, SESSION_NAME);
      }
      // Different session should still work
      const other = createShareToken('other-session', 'Other');
      expect(other.token).toBeTruthy();
    });
  });

  describe('validateShareToken', () => {
    test('validates a valid token', () => {
      const info = createShareToken(SESSION_ID, SESSION_NAME, 1);
      const stored = validateShareToken(info.token);
      expect(stored).not.toBeNull();
      expect(stored!.sessionId).toBe(SESSION_ID);
    });

    test('returns null for invalid token', () => {
      expect(validateShareToken('nonexistent')).toBeNull();
    });

    test('returns null for expired token', () => {
      // Create token with very short expiry
      const info = createShareToken(SESSION_ID, SESSION_NAME, 0.0001); // ~0.36 seconds

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 400) {
        // busy wait
      }

      expect(validateShareToken(info.token)).toBeNull();
    });
  });

  describe('listShareTokens', () => {
    test('lists tokens for a session', () => {
      createShareToken(SESSION_ID, SESSION_NAME);
      createShareToken(SESSION_ID, SESSION_NAME);
      const list = listShareTokens(SESSION_ID);
      expect(list).toHaveLength(2);
    });

    test('does not include other sessions', () => {
      createShareToken(SESSION_ID, SESSION_NAME);
      createShareToken('other-session', 'Other');
      const list = listShareTokens(SESSION_ID);
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe(SESSION_ID);
    });

    test('empty for unknown session', () => {
      expect(listShareTokens('unknown')).toHaveLength(0);
    });
  });

  describe('revokeShareToken', () => {
    test('revokes an existing token', () => {
      const info = createShareToken(SESSION_ID, SESSION_NAME);
      expect(revokeShareToken(SESSION_ID, info.token)).toBe(true);
      expect(validateShareToken(info.token)).toBeNull();
    });

    test('returns false for wrong session', () => {
      const info = createShareToken(SESSION_ID, SESSION_NAME);
      expect(revokeShareToken('wrong-session', info.token)).toBe(false);
      // Token should still be valid
      expect(validateShareToken(info.token)).not.toBeNull();
    });

    test('returns false for nonexistent token', () => {
      expect(revokeShareToken(SESSION_ID, 'nonexistent')).toBe(false);
    });

    test('allows creating new token after revoke (below limit)', () => {
      const tokens = [];
      for (let i = 0; i < 5; i++) {
        tokens.push(createShareToken(SESSION_ID, SESSION_NAME));
      }
      revokeShareToken(SESSION_ID, tokens[0].token);
      // Should be able to create one more
      const newToken = createShareToken(SESSION_ID, SESSION_NAME);
      expect(newToken.token).toBeTruthy();
    });
  });

  describe('activeTokenCount', () => {
    test('returns 0 when no tokens', () => {
      expect(activeTokenCount()).toBe(0);
    });

    test('counts active tokens', () => {
      createShareToken(SESSION_ID, SESSION_NAME);
      createShareToken('other-session', 'Other');
      expect(activeTokenCount()).toBe(2);
    });

    test('excludes revoked tokens', () => {
      const t1 = createShareToken(SESSION_ID, SESSION_NAME);
      createShareToken(SESSION_ID, SESSION_NAME);
      revokeShareToken(SESSION_ID, t1.token);
      expect(activeTokenCount()).toBe(1);
    });
  });
});
