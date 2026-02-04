import { useState, useEffect, useCallback } from 'react';
import type { HistorySession, ConversationMessage } from '../../../shared/types';
import { authFetch } from '../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface ProjectInfo {
  dirName: string;
  projectPath: string;
  projectName: string;
  sessionCount: number;
  latestModified?: string;
}

interface UseSessionHistoryResult {
  // Project-level data (fast initial load)
  projects: ProjectInfo[];
  isLoadingProjects: boolean;

  // Session-level data (lazy loaded per project)
  sessionsByProject: Map<string, HistorySession[]>;
  loadingProjects: Set<string>;
  fetchProjectSessions: (dirName: string, forceRefresh?: boolean) => Promise<void>;
  refreshAllLoadedProjects: () => Promise<void>;

  // Legacy: all sessions (for backward compatibility)
  sessions: HistorySession[];
  isLoading: boolean;
  error: string | null;

  // Actions
  refresh: () => Promise<void>;
  resumeSession: (sessionId: string, projectPath: string) => Promise<{ tmuxSessionId: string } | null>;
  fetchConversation: (sessionId: string, projectDirName?: string) => Promise<ConversationMessage[]>;
}

export function useSessionHistory(): UseSessionHistoryResult {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [sessionsByProject, setSessionsByProject] = useState<Map<string, HistorySession[]>>(new Map());
  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Fetch project list (fast)
  const fetchProjects = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setIsLoadingProjects(true);
        setError(null);
      }
      const response = await authFetch(`${API_BASE}/api/sessions/history/projects`);
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }
      const data = await response.json();
      // Only update state if data has changed to prevent unnecessary re-renders
      setProjects(prev => {
        const newJson = JSON.stringify(data.projects || []);
        const prevJson = JSON.stringify(prev);
        return newJson === prevJson ? prev : (data.projects || []);
      });
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (!silent) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  // Fetch sessions for a specific project (lazy)
  const fetchProjectSessions = useCallback(async (dirName: string, forceRefresh = false) => {
    // Skip if already loaded or loading (unless forceRefresh)
    if (!forceRefresh && (sessionsByProject.has(dirName) || loadingProjects.has(dirName))) {
      return;
    }

    try {
      setLoadingProjects(prev => new Set(prev).add(dirName));

      const response = await authFetch(`${API_BASE}/api/sessions/history/projects/${encodeURIComponent(dirName)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch project sessions');
      }
      const data = await response.json();

      setSessionsByProject(prev => {
        const next = new Map(prev);
        next.set(dirName, data.sessions || []);
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch project sessions:', err);
    } finally {
      setLoadingProjects(prev => {
        const next = new Set(prev);
        next.delete(dirName);
        return next;
      });
    }
  }, [sessionsByProject, loadingProjects]);

  // Refresh all loaded projects (after resume, etc.)
  const refreshAllLoadedProjects = useCallback(async () => {
    const loadedDirNames = Array.from(sessionsByProject.keys());
    // Clear cache
    setSessionsByProject(new Map());
    // Re-fetch all
    await Promise.all(loadedDirNames.map(dirName => fetchProjectSessions(dirName, true)));
  }, [sessionsByProject, fetchProjectSessions]);

  const resumeSession = useCallback(async (sessionId: string, projectPath: string) => {
    try {
      const response = await authFetch(`${API_BASE}/api/sessions/history/resume`, {
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

  const fetchConversation = useCallback(async (sessionId: string, projectDirName?: string): Promise<ConversationMessage[]> => {
    try {
      const url = new URL(`${API_BASE}/api/sessions/history/${sessionId}/conversation`, window.location.origin);
      if (projectDirName) {
        url.searchParams.set('projectDirName', projectDirName);
      }
      const response = await authFetch(url.toString(), {
        cache: 'no-store',
      });
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

  // Initial load: projects only
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Compute all sessions for backward compatibility
  const sessions = Array.from(sessionsByProject.values()).flat();
  const isLoading = isLoadingProjects;

  return {
    projects,
    isLoadingProjects,
    sessionsByProject,
    loadingProjects,
    fetchProjectSessions,
    refreshAllLoadedProjects,
    sessions,
    isLoading,
    error,
    refresh: fetchProjects,
    resumeSession,
    fetchConversation,
  };
}
