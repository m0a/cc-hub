import { useState, useEffect, useCallback } from 'react';
import type { HistorySession, ConversationMessage } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseSessionHistoryResult {
  sessions: HistorySession[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  resumeSession: (sessionId: string, projectPath: string) => Promise<{ tmuxSessionId: string } | null>;
  fetchConversation: (sessionId: string) => Promise<ConversationMessage[]>;
  fetchSessionMetadata: (sessionIds: string[]) => Promise<void>;
}

export function useSessionHistory(): UseSessionHistoryResult {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch without metadata (fast)
  const fetchHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/sessions/history`);
      if (!response.ok) {
        throw new Error('Failed to fetch session history');
      }
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Lazy load metadata for specific sessions
  const fetchSessionMetadata = useCallback(async (sessionIds: string[]) => {
    if (sessionIds.length === 0) return;

    try {
      const response = await fetch(`${API_BASE}/api/sessions/history/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds }),
      });

      if (!response.ok) return;

      const data = await response.json();
      const metadataMap = new Map<string, Partial<HistorySession>>(
        Object.entries(data.metadata || {})
      );

      // Update sessions with metadata
      setSessions(prev => prev.map(session => {
        const meta = metadataMap.get(session.sessionId);
        if (meta) {
          return { ...session, ...meta };
        }
        return session;
      }));
    } catch (err) {
      console.error('Failed to fetch session metadata:', err);
    }
  }, []);

  const resumeSession = useCallback(async (sessionId: string, projectPath: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/sessions/history/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, projectPath }),
      });
      if (!response.ok) {
        throw new Error('Failed to resume session');
      }
      const data = await response.json();
      return { tmuxSessionId: data.tmuxSessionId };
    } catch (err) {
      console.error('Failed to resume session:', err);
      return null;
    }
  }, []);

  const fetchConversation = useCallback(async (sessionId: string): Promise<ConversationMessage[]> => {
    try {
      const response = await fetch(`${API_BASE}/api/sessions/history/${sessionId}/conversation`);
      if (!response.ok) {
        throw new Error('Failed to fetch conversation');
      }
      const data = await response.json();
      return data.messages || [];
    } catch (err) {
      console.error('Failed to fetch conversation:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    sessions,
    isLoading,
    error,
    refresh: fetchHistory,
    resumeSession,
    fetchConversation,
    fetchSessionMetadata,
  };
}
