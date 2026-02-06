import { useState, useCallback } from 'react';
import type { SessionResponse, SessionTheme } from '../../../shared/types';
import { authFetch } from '../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Module-level request deduplication: all useSessions instances share the same in-flight request
let pendingFetch: Promise<SessionResponse[]> | null = null;
let cachedSessions: { data: SessionResponse[]; timestamp: number } | null = null;
const FETCH_CACHE_TTL = 2000; // 2 seconds - matches backend cache TTL

async function fetchSessionsShared(): Promise<SessionResponse[]> {
  // Return cached data if still fresh
  if (cachedSessions && Date.now() - cachedSessions.timestamp < FETCH_CACHE_TTL) {
    return cachedSessions.data;
  }

  // Deduplicate concurrent requests
  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = (async () => {
    try {
      const response = await authFetch(`${API_BASE}/api/sessions`);
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      const data = await response.json();
      cachedSessions = { data: data.sessions, timestamp: Date.now() };
      return data.sessions as SessionResponse[];
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

/** Invalidate the shared sessions cache (call after create/delete) */
function invalidateSessionsCache() {
  cachedSessions = null;
}

interface UseSessionsReturn {
  sessions: SessionResponse[];
  isLoading: boolean;
  error: string | null;
  fetchSessions: (silent?: boolean) => Promise<void>;
  createSession: (name?: string, workingDir?: string) => Promise<SessionResponse | null>;
  deleteSession: (id: string) => Promise<boolean>;
  updateSessionTheme: (id: string, theme: SessionTheme | null) => Promise<boolean>;
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async (silent = false) => {
    // Only show loading state on initial fetch, not on polling
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const newSessions = await fetchSessionsShared();
      // Only update state if data has changed to prevent unnecessary re-renders
      setSessions(prev => {
        const newJson = JSON.stringify(newSessions);
        const prevJson = JSON.stringify(prev);
        return newJson === prevJson ? prev : newSessions;
      });
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  const createSession = useCallback(async (name?: string, workingDir?: string): Promise<SessionResponse | null> => {
    setError(null);
    invalidateSessionsCache();

    try {
      const response = await authFetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workingDir }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const session = await response.json();
      setSessions(prev => [session, ...prev]);
      return session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  const deleteSession = useCallback(async (id: string): Promise<boolean> => {
    setError(null);
    invalidateSessionsCache();

    try {
      const response = await authFetch(`${API_BASE}/api/sessions/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete session');
      }

      setSessions(prev => prev.filter(s => s.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const updateSessionTheme = useCallback(async (id: string, theme: SessionTheme | null): Promise<boolean> => {
    setError(null);

    try {
      const response = await authFetch(`${API_BASE}/api/sessions/${id}/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      });

      if (!response.ok) {
        throw new Error('Failed to update session theme');
      }

      // Update local state
      setSessions(prev => prev.map(s => s.id === id ? { ...s, theme: theme ?? undefined } : s));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  return {
    sessions,
    isLoading,
    error,
    fetchSessions,
    createSession,
    deleteSession,
    updateSessionTheme,
  };
}
