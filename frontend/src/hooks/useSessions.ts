import { useState, useCallback } from 'react';
import type { SessionResponse } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseSessionsReturn {
  sessions: SessionResponse[];
  isLoading: boolean;
  error: string | null;
  fetchSessions: (silent?: boolean) => Promise<void>;
  createSession: (name?: string, workingDir?: string) => Promise<SessionResponse | null>;
  deleteSession: (id: string) => Promise<boolean>;
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
      const response = await fetch(`${API_BASE}/api/sessions`);
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      const data = await response.json();
      // Only update state if data has changed to prevent unnecessary re-renders
      setSessions(prev => {
        const newJson = JSON.stringify(data.sessions);
        const prevJson = JSON.stringify(prev);
        return newJson === prevJson ? prev : data.sessions;
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

    try {
      const response = await fetch(`${API_BASE}/api/sessions`, {
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

    try {
      const response = await fetch(`${API_BASE}/api/sessions/${id}`, {
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

  return {
    sessions,
    isLoading,
    error,
    fetchSessions,
    createSession,
    deleteSession,
  };
}
