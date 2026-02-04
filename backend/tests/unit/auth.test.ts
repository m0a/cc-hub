import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { AuthService } from '../../src/services/auth';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DATA_DIR = join(import.meta.dir, '.test-data');
const JWT_SECRET = 'test-jwt-secret';

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(async () => {
    await mkdir(TEST_DATA_DIR, { recursive: true });
    authService = new AuthService(TEST_DATA_DIR, JWT_SECRET);
  });

  afterEach(async () => {
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('generateTokenForUser', () => {
    test('should generate a valid JWT token', async () => {
      const token = await authService.generateTokenForUser('testuser');

      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    test('should generate token with correct payload', async () => {
      const token = await authService.generateTokenForUser('myuser');
      const payload = await authService.verifyToken(token);

      expect(payload.userId).toBe('myuser');
      expect(payload.username).toBe('myuser');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    test('should generate token with 7 day expiry', async () => {
      const token = await authService.generateTokenForUser('testuser');
      const payload = await authService.verifyToken(token);

      const expectedExpiry = payload.iat + 7 * 24 * 60 * 60;
      expect(payload.exp).toBe(expectedExpiry);
    });
  });

  describe('verifyToken', () => {
    test('should verify valid token', async () => {
      const token = await authService.generateTokenForUser('testuser');
      const payload = await authService.verifyToken(token);

      expect(payload.userId).toBe('testuser');
      expect(payload.username).toBe('testuser');
    });

    test('should reject invalid token format', async () => {
      await expect(
        authService.verifyToken('invalid-token')
      ).rejects.toThrow('Invalid token format');
    });

    test('should reject tampered token', async () => {
      const token = await authService.generateTokenForUser('testuser');
      const parts = token.split('.');
      // Tamper with the payload
      const tamperedToken = `${parts[0]}.${parts[1]}modified.${parts[2]}`;

      await expect(
        authService.verifyToken(tamperedToken)
      ).rejects.toThrow();
    });

    test('should reject token signed with different secret', async () => {
      const otherService = new AuthService(TEST_DATA_DIR, 'different-secret');
      const token = await otherService.generateTokenForUser('testuser');

      await expect(
        authService.verifyToken(token)
      ).rejects.toThrow('Invalid token signature');
    });
  });
});
