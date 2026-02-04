import { hc } from 'hono/client';
import type { AppType } from '../../../backend/src/index';

const API_BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'cc-hub-token';

export const client = hc<AppType>(API_BASE);

// Get auth token from localStorage
export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Authenticated fetch - automatically adds auth header if token exists
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

// Auth API helpers

// Check if authentication is required
export async function isAuthRequired(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth/required`);
  if (!res.ok) {
    return false;
  }
  const data = await res.json();
  return data.required;
}

// Login with password
export async function login(password: string): Promise<{ token: string }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || 'Login failed');
  }

  return res.json();
}

export async function logout(token: string) {
  const res = await fetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error('Logout failed');
  }

  return res.json();
}

export async function getMe(token: string) {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error('Failed to get user info');
  }

  return res.json();
}
