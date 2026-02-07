import { useState, useCallback } from 'react';
import type { FileInfo, FileContent, FileChange, GitFileChange } from '../../../shared/types';
import { authFetch } from '../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseFileViewerReturn {
  currentPath: string;
  files: FileInfo[];
  parentPath: string | null;
  selectedFile: FileContent | null;
  changes: FileChange[];
  gitChanges: GitFileChange[];
  gitBranch: string;
  isLoading: boolean;
  error: string | null;
  listDirectory: (path: string) => Promise<void>;
  readFile: (path: string, maxSize?: number) => Promise<void>;
  getChanges: () => Promise<void>;
  getGitChanges: () => Promise<void>;
  getGitDiff: (filePath: string, staged?: boolean) => Promise<string>;
  navigateTo: (path: string) => Promise<void>;
  navigateUp: () => Promise<void>;
  clearSelectedFile: () => void;
  getLanguage: (path: string) => Promise<{ language: string; isImage: boolean; isText: boolean }>;
}

export function useFileViewer(sessionWorkingDir: string): UseFileViewerReturn {
  const [currentPath, setCurrentPath] = useState(sessionWorkingDir);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [gitChanges, setGitChanges] = useState<GitFileChange[]>([]);
  const [gitBranch, setGitBranch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        path,
        sessionWorkingDir,
      });
      const response = await authFetch(`${API_BASE}/api/files/list?${params}`);

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || 'Failed to list directory');
      }

      const data = await response.json();
      setFiles(data.files);
      setCurrentPath(data.path);
      setParentPath(data.parentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionWorkingDir]);

  const readFile = useCallback(async (path: string, maxSize?: number) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        path,
        sessionWorkingDir,
      });
      if (maxSize) {
        params.set('maxSize', maxSize.toString());
      }

      const response = await authFetch(`${API_BASE}/api/files/read?${params}`);

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || 'Failed to read file');
      }

      const data = await response.json();
      setSelectedFile(data.file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSelectedFile(null);
    } finally {
      setIsLoading(false);
    }
  }, [sessionWorkingDir]);

  const getChanges = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authFetch(
        `${API_BASE}/api/files/changes/${encodeURIComponent(sessionWorkingDir)}`
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || 'Failed to get changes');
      }

      const data = await response.json();
      setChanges(data.changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setChanges([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionWorkingDir]);

  const getGitChanges = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authFetch(
        `${API_BASE}/api/files/git-changes/${encodeURIComponent(sessionWorkingDir)}`
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || 'Failed to get git changes');
      }

      const data = await response.json();
      setGitChanges(data.changes);
      setGitBranch(data.branch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setGitChanges([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionWorkingDir]);

  const getGitDiff = useCallback(async (filePath: string, staged?: boolean): Promise<string> => {
    try {
      const params = new URLSearchParams({ path: filePath });
      if (staged) params.set('staged', 'true');

      const response = await authFetch(
        `${API_BASE}/api/files/git-diff/${encodeURIComponent(sessionWorkingDir)}?${params}`
      );

      if (!response.ok) {
        return '';
      }

      const data = await response.json();
      return data.diff || '';
    } catch {
      return '';
    }
  }, [sessionWorkingDir]);

  const navigateTo = useCallback(async (path: string) => {
    await listDirectory(path);
  }, [listDirectory]);

  const navigateUp = useCallback(async () => {
    if (parentPath) {
      await listDirectory(parentPath);
    }
  }, [parentPath, listDirectory]);

  const clearSelectedFile = useCallback(() => {
    setSelectedFile(null);
  }, []);

  const getLanguage = useCallback(async (path: string) => {
    const params = new URLSearchParams({ path });
    const response = await authFetch(`${API_BASE}/api/files/language?${params}`);

    if (!response.ok) {
      return { language: 'plaintext', isImage: false, isText: true };
    }

    return response.json();
  }, []);

  return {
    currentPath,
    files,
    parentPath,
    selectedFile,
    changes,
    gitChanges,
    gitBranch,
    isLoading,
    error,
    listDirectory,
    readFile,
    getChanges,
    getGitChanges,
    getGitDiff,
    navigateTo,
    navigateUp,
    clearSelectedFile,
    getLanguage,
  };
}
