import { describe, expect, test } from 'bun:test';
import { timingSafeStringEqual } from '../timing-safe-equal';

describe('timingSafeStringEqual', () => {
  test('returns true for identical strings', () => {
    expect(timingSafeStringEqual('s3cret-token', 's3cret-token')).toBe(true);
  });

  test('returns false for different strings of equal length', () => {
    expect(timingSafeStringEqual('aaaaaa', 'aaaaab')).toBe(false);
  });

  test('returns false for different-length strings (no throw)', () => {
    expect(timingSafeStringEqual('short', 'a-much-longer-secret')).toBe(false);
  });

  test('handles empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
    expect(timingSafeStringEqual('', 'x')).toBe(false);
  });

  test('handles non-ASCII content', () => {
    expect(timingSafeStringEqual('パスワード', 'パスワード')).toBe(true);
    expect(timingSafeStringEqual('パスワード', 'ぱすわーど')).toBe(false);
  });
});
