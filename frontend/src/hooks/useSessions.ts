import { useState, useCallback } from 'react';
import type { SessionResponse } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseSessionsReturn {
  sessions: SessionResponse[];
  externalSessions: SessionResponse[];
  isLoading: boolean;
  error: string | null;
  fetchSessions: () => Promise<void>;
  fetchExternalSessions: () => Promise<void>;
  createSession: (name?: string) => Promise<SessionResponse | null>;
  deleteSession: (id: string) => Promise<boolean>;
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [externalSessions, setExternalSessions] = useState<SessionResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/sessions`);
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      const data = await response.json();
      setSessions(data.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchExternalSessions = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sessions/external`);
      if (!response.ok) {
        throw new Error('Failed to fetch external sessions');
      }
      const data = await response.json();
      setExternalSessions(data.sessions);
    } catch (err) {
      console.error('Failed to fetch external sessions:', err);
      setExternalSessions([]);
    }
  }, []);

  const createSession = useCallback(async (name?: string): Promise<SessionResponse | null> => {
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
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
    externalSessions,
    isLoading,
    error,
    fetchSessions,
    fetchExternalSessions,
    createSession,
    deleteSession,
  };
}
