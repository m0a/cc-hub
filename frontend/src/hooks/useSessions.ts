import { useState, useCallback, useEffect } from 'react';
import type { SessionResponse, SessionTheme, IndicatorState, PaneInfo } from '../../../shared/types';
import { authFetch, isTransientNetworkError } from '../services/api';
import { fireHookNotification } from '../utils/hookNotification';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Module-level cache (shared across all useSessions instances, updated by WS push)
let cachedSessions: SessionResponse[] | null = null;

/** hookイベントでcachedSessionsのindicatorStateを即座に更新する */
export function updateCachedSessionsByHookEvent(event: string, ccSessionId?: string) {
  const newState = hookEventToIndicatorState(event);
  if (!newState || !ccSessionId || !cachedSessions) return;

  cachedSessions = cachedSessions.map(session => {
    const ext = session as SessionResponse & { ccSessionId?: string; panes?: PaneInfo[] };
    if (ext.ccSessionId !== ccSessionId) return session;
    if (!ext.panes) return session;
    return {
      ...session,
      panes: ext.panes.map(pane => ({ ...pane, indicatorState: newState })),
    } as SessionResponse;
  });

  window.dispatchEvent(new CustomEvent('cchub-hook-event'));
}

function hookEventToIndicatorState(event: string): IndicatorState | null {
  switch (event) {
    case 'Stop':
    case 'PostToolUse':
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

function updateSessions(
  setSessions: React.Dispatch<React.SetStateAction<SessionResponse[]>>,
  newSessions: SessionResponse[],
) {
  cachedSessions = newSessions;
  setSessions(prev => {
    const newJson = JSON.stringify(newSessions);
    const prevJson = JSON.stringify(prev);
    return newJson === prevJson ? prev : newSessions;
  });
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionResponse[]>(() => cachedSessions || []);
  const [isLoading, setIsLoading] = useState(() => !cachedSessions);
  const [error, setError] = useState<string | null>(null);

  // Listen for WS push and hook events
  useEffect(() => {
    const hookHandler = () => {
      if (cachedSessions) setSessions(cachedSessions);
    };

    const pushHandler = (e: Event) => {
      const pushed = (e as CustomEvent).detail as SessionResponse[];
      if (pushed) {
        detectAndNotifyTransitions(pushed);
        updateSessions(setSessions, pushed);
        setIsLoading(false);
      }
    };

    window.addEventListener('cchub-hook-event', hookHandler);
    window.addEventListener('cchub-sessions-push', pushHandler);
    return () => {
      window.removeEventListener('cchub-hook-event', hookHandler);
      window.removeEventListener('cchub-sessions-push', pushHandler);
    };
  }, []);

  const createSession = useCallback(async (name?: string, workingDir?: string): Promise<SessionResponse | null> => {
    setError(null);
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
      throw err;
    }
  }, []);

  const deleteSession = useCallback(async (id: string): Promise<boolean> => {
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/api/sessions/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete session');

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

      if (!response.ok) throw new Error('Failed to update session theme');

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
    createSession,
    deleteSession,
    updateSessionTheme,
  };
}
