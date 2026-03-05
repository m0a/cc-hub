import { useState, useCallback, useEffect, useRef } from 'react';
import type { SessionResponse, SessionTheme, IndicatorState, PaneInfo } from '../../../shared/types';
import { authFetch, isTransientNetworkError } from '../services/api';
import { fireHookNotification } from '../utils/hookNotification';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Module-level request deduplication: all useSessions instances share the same in-flight request
let pendingFetch: Promise<SessionResponse[]> | null = null;
let cachedSessions: { data: SessionResponse[]; timestamp: number } | null = null;
const FETCH_CACHE_TTL = 2000; // 2 seconds - matches backend cache TTL
const FETCH_TIMEOUT = 5000; // 5 seconds timeout per request

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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      try {
        const response = await authFetch(`${API_BASE}/api/sessions`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error('Failed to fetch sessions');
        }
        const data = await response.json();
        cachedSessions = { data: data.sessions, timestamp: Date.now() };
        return data.sessions as SessionResponse[];
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
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

/** hookイベントでcachedSessionsのindicatorStateを即座に更新し、キャッシュを無効化する */
export function updateCachedSessionsByHookEvent(event: string, ccSessionId?: string) {
  const newState = hookEventToIndicatorState(event);
  if (!newState || !ccSessionId || !cachedSessions) return;

  cachedSessions = {
    data: cachedSessions.data.map(session => {
      const ext = session as SessionResponse & { ccSessionId?: string; panes?: PaneInfo[] };
      if (ext.ccSessionId !== ccSessionId) return session;
      if (!ext.panes) return session;
      return {
        ...session,
        panes: ext.panes.map(pane => ({ ...pane, indicatorState: newState })),
      } as SessionResponse;
    }),
    timestamp: 0, // キャッシュを期限切れにして次回fetchで最新データ取得
  };

  // 全useSessions インスタンスに即座に反映
  window.dispatchEvent(new CustomEvent('cchub-hook-event'));
}

/** hookイベント名からindicatorStateを決定する */
function hookEventToIndicatorState(event: string): IndicatorState | null {
  switch (event) {
    case 'Stop':
      return 'waiting_input';
    case 'PostToolUse': // AskUserQuestion等
      return 'waiting_input';
    case 'Notification':
      return 'waiting_input';
    case 'UserPromptSubmit':
      return 'processing';
    default:
      return null;
  }
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

/** Track previous indicatorState per session for detecting transitions */
let prevIndicatorStates = new Map<string, IndicatorState>();

/** Detect processing→waiting_input transitions and fire OS notification */
function detectAndNotifyTransitions(newSessions: SessionResponse[]) {
  for (const session of newSessions) {
    const ext = session as SessionResponse & { panes?: PaneInfo[]; ccSessionId?: string };
    // Determine session-level indicator from panes or session
    const currentIndicator = ext.panes?.some(p => p.indicatorState === 'waiting_input')
      ? 'waiting_input' as IndicatorState
      : ext.panes?.some(p => p.indicatorState === 'processing')
        ? 'processing' as IndicatorState
        : (session as SessionResponse & { indicatorState?: IndicatorState }).indicatorState;

    if (!currentIndicator) continue;
    const prevState = prevIndicatorStates.get(session.id);
    if (prevState === 'processing' && currentIndicator === 'waiting_input') {
      const cwd = (session as SessionResponse & { currentPath?: string }).currentPath;
      fireHookNotification('Stop', cwd, ext.ccSessionId);
    }
    prevIndicatorStates.set(session.id, currentIndicator);
  }
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionResponse[]>(() => cachedSessions?.data || []);
  const [isLoading, setIsLoading] = useState(() => !cachedSessions);
  const [error, setError] = useState<string | null>(null);
  const isFirstFetch = useRef(true);

  // hookイベントでキャッシュが更新されたら即座に反映
  useEffect(() => {
    const handler = () => {
      if (cachedSessions) {
        setSessions(cachedSessions.data);
      }
      // キャッシュ無効化済みなので次のポーリングで最新データ取得
      invalidateSessionsCache();
    };
    window.addEventListener('cchub-hook-event', handler);
    return () => window.removeEventListener('cchub-hook-event', handler);
  }, []);

  const fetchSessions = useCallback(async (silent = false) => {
    // Only show loading state on initial fetch, not on polling
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    const maxRetries = silent ? 0 : 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) invalidateSessionsCache(); // Clear cache only before retry
        const newSessions = await fetchSessionsShared();
        // Detect processing→waiting_input transitions for notification (skip initial fetch)
        if (!isFirstFetch.current) {
          detectAndNotifyTransitions(newSessions);
        }
        isFirstFetch.current = false;
        // Only update state if data has changed to prevent unnecessary re-renders
        setSessions(prev => {
          const newJson = JSON.stringify(newSessions);
          const prevJson = JSON.stringify(prev);
          return newJson === prevJson ? prev : newSessions;
        });
        if (!silent) setIsLoading(false);
        return;
      } catch (err) {
        if (attempt < maxRetries) {
          // Wait briefly before retry
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        if (!silent && !isTransientNetworkError(err)) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      }
    }
    if (!silent) setIsLoading(false);
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
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error || 'Failed to create session');
        (err as Error & { data?: unknown }).data = errorData;
        throw err;
      }

      const session = await response.json();
      setSessions(prev => [session, ...prev]);
      return session;
    } catch (err) {
      // Don't setError here — let the caller handle display
      throw err;
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
      if (!isTransientNetworkError(err)) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
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
      if (!isTransientNetworkError(err)) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
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
