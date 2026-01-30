import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { User, AuthResponse } from 'shared';

export interface JwtPayload {
  userId: string;
  username: string;
  iat: number;
  exp: number;
}

export class AuthService {
  private usersPath: string;
  private jwtSecret: string;

  constructor(dataDir: string, jwtSecret: string) {
    this.usersPath = join(dataDir, 'users.json');
    this.jwtSecret = jwtSecret;
  }

  async getUsers(): Promise<User[]> {
    try {
      const data = await readFile(this.usersPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async saveUsers(users: User[]): Promise<void> {
    const dir = this.usersPath.replace(/\/[^/]+$/, '');
    await mkdir(dir, { recursive: true });
    await writeFile(this.usersPath, JSON.stringify(users, null, 2));
  }

  async register(username: string, password: string): Promise<AuthResponse> {
    const users = await this.getUsers();

    if (users.some((u) => u.username === username)) {
      throw new Error('Username already exists');
    }

    const passwordHash = await Bun.password.hash(password, {
      algorithm: 'bcrypt',
      cost: 10,
    });

    const user: User = {
      id: crypto.randomUUID(),
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    await this.saveUsers(users);

    const token = await this.generateToken(user);

    return {
      token,
      user: { id: user.id, username: user.username },
    };
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const users = await this.getUsers();
    const user = users.find((u) => u.username === username);

    if (!user) {
      throw new Error('Invalid credentials');
    }

    const valid = await Bun.password.verify(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    const token = await this.generateToken(user);

    return {
      token,
      user: { id: user.id, username: user.username },
    };
  }

  private async generateToken(user: User): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      iat: now,
      exp: now + 7 * 24 * 60 * 60, // 7 days
    };

    // Simple JWT implementation using Bun's crypto
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(payload));

    const signature = await this.sign(`${headerB64}.${payloadB64}`);
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = await this.sign(`${headerB64}.${payloadB64}`);

    if (signature !== expectedSig) {
      throw new Error('Invalid token signature');
    }

    const payload: JwtPayload = JSON.parse(this.base64UrlDecode(payloadB64));

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }

    return payload;
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private base64UrlDecode(str: string): string {
    const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  }

  private async sign(data: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.jwtSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(data)
    );

    return this.base64UrlEncode(
      String.fromCharCode(...new Uint8Array(signature))
    );
  }
}
