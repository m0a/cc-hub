import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { AuthService } from '../../src/services/auth';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DATA_DIR = join(import.meta.dir, '.test-data');

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(async () => {
    await mkdir(TEST_DATA_DIR, { recursive: true });
    authService = new AuthService(TEST_DATA_DIR, 'test-jwt-secret');
  });

  afterEach(async () => {
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('register', () => {
    test('should register a new user and return token', async () => {
      const result = await authService.register('testuser', 'password123');

      expect(result.user.username).toBe('testuser');
      expect(result.user.id).toBeDefined();
      expect(result.token).toBeDefined();
    });

    test('should reject duplicate username', async () => {
      await authService.register('testuser', 'password123');

      await expect(
        authService.register('testuser', 'differentpass')
      ).rejects.toThrow('Username already exists');
    });

    test('should hash password (not store plaintext)', async () => {
      await authService.register('testuser', 'password123');
      const users = await authService.getUsers();
      const user = users.find((u) => u.username === 'testuser');

      expect(user?.passwordHash).not.toBe('password123');
      expect(user?.passwordHash).toContain('$'); // bcrypt format
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await authService.register('testuser', 'password123');
    });

    test('should login with correct credentials', async () => {
      const result = await authService.login('testuser', 'password123');

      expect(result.user.username).toBe('testuser');
      expect(result.token).toBeDefined();
    });

    test('should reject incorrect password', async () => {
      await expect(
        authService.login('testuser', 'wrongpassword')
      ).rejects.toThrow('Invalid credentials');
    });

    test('should reject non-existent user', async () => {
      await expect(
        authService.login('nobody', 'password123')
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('verifyToken', () => {
    test('should verify valid token', async () => {
      const { token, user } = await authService.register('testuser', 'password123');
      const payload = await authService.verifyToken(token);

      expect(payload.userId).toBe(user.id);
      expect(payload.username).toBe('testuser');
    });

    test('should reject invalid token', async () => {
      await expect(
        authService.verifyToken('invalid-token')
      ).rejects.toThrow();
    });
  });
});
