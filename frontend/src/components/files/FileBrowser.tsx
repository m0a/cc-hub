import { useState, useCallback } from 'react';
import type { FileInfo } from '../../../../shared/types';
import { authFetch } from '../../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface FileBrowserProps {
  files: FileInfo[];
  currentPath: string;
  sessionWorkingDir: string;
  isLoading: boolean;
  onSelectFile: (file: FileInfo) => void;
  showHidden?: boolean;
}

// File type icons
function FileIcon({ file, isExpanded }: { file: FileInfo; isExpanded?: boolean }) {
  if (file.type === 'directory') {
    return isExpanded ? (
      <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H2V6zm0 3v5a2 2 0 002 2h12a2 2 0 002-2V9H2z" clipRule="evenodd" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    );
  }

  // File type detection
  const ext = file.extension?.toLowerCase();

  // Code files
  if (['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.scss'].includes(ext || '')) {
    return (
      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    );
  }

  // Image files
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(ext || '')) {
    return (
      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }

  // Markdown/text
  if (['.md', '.txt', '.yaml', '.yml', '.toml'].includes(ext || '')) {
    return (
      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  // Default file icon
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Chevron icon for expand/collapse
function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

interface TreeItemProps {
  file: FileInfo;
  depth: number;
  expandedDirs: Set<string>;
  dirContents: Map<string, FileInfo[]>;
  loadingDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (file: FileInfo) => void;
  showHidden: boolean;
}

function TreeItem({
  file,
  depth,
  expandedDirs,
  dirContents,
  loadingDirs,
  onToggleDir,
  onSelectFile,
  showHidden,
}: TreeItemProps) {
  const isDirectory = file.type === 'directory';
  const isExpanded = expandedDirs.has(file.path);
  const isLoading = loadingDirs.has(file.path);
  const children = dirContents.get(file.path) || [];
  const visibleChildren = showHidden ? children : children.filter(f => !f.isHidden);

  const handleClick = () => {
    if (isDirectory) {
      onToggleDir(file.path);
    } else {
      onSelectFile(file);
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        className="flex items-center gap-1 py-1 px-2 hover:bg-gray-800 active:bg-gray-700 cursor-pointer transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Chevron for directories */}
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {isDirectory && (
            isLoading ? (
              <div className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <ChevronIcon isExpanded={isExpanded} />
            )
          )}
        </div>

        {/* Icon */}
        <FileIcon file={file} isExpanded={isExpanded} />

        {/* Name and size */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm truncate">{file.name}</span>
          {!isDirectory && (
            <span className="text-xs text-gray-500 shrink-0">
              {formatFileSize(file.size)}
            </span>
          )}
        </div>
      </div>

      {/* Children (if expanded) */}
      {isDirectory && isExpanded && visibleChildren.length > 0 && (
        <div>
          {visibleChildren.map((child) => (
            <TreeItem
              key={child.path}
              file={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              dirContents={dirContents}
              loadingDirs={loadingDirs}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              showHidden={showHidden}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function FileBrowser({
  files,
  currentPath,
  sessionWorkingDir,
  isLoading,
  onSelectFile,
  showHidden = false,
}: FileBrowserProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Map<string, FileInfo[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // Filter hidden files if needed
  const visibleFiles = showHidden
    ? files
    : files.filter(f => !f.isHidden);

  // Load directory contents
  const loadDirContents = useCallback(async (path: string) => {
    setLoadingDirs(prev => new Set(prev).add(path));

    try {
      const params = new URLSearchParams({
        path,
        sessionWorkingDir,
      });
      const response = await authFetch(`${API_BASE}/api/files/list?${params}`);

      if (response.ok) {
        const data = await response.json();
        setDirContents(prev => new Map(prev).set(path, data.files));
      }
    } catch (err) {
      console.error('Failed to load directory:', err);
    } finally {
      setLoadingDirs(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [sessionWorkingDir]);

  // Toggle directory expand/collapse
  const handleToggleDir = useCallback(async (path: string) => {
    if (expandedDirs.has(path)) {
      // Collapse
      setExpandedDirs(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } else {
      // Expand
      setExpandedDirs(prev => new Set(prev).add(path));

      // Load contents if not already loaded
      if (!dirContents.has(path)) {
        await loadDirContents(path);
      }
    }
  }, [expandedDirs, dirContents, loadDirContents]);

  // Get short path for display
  const shortPath = currentPath.replace(/^\/home\/[^/]+\//, '~/');

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* File tree */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500">読み込み中...</div>
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500">ファイルがありません</div>
          </div>
        ) : (
          <div className="py-1">
            {visibleFiles.map((file) => (
              <TreeItem
                key={file.path}
                file={file}
                depth={0}
                expandedDirs={expandedDirs}
                dirContents={dirContents}
                loadingDirs={loadingDirs}
                onToggleDir={handleToggleDir}
                onSelectFile={onSelectFile}
                showHidden={showHidden}
              />
            ))}
          </div>
        )}
      </div>

      {/* Path bar - at bottom */}
      <div className="px-3 py-2 border-t border-gray-700 bg-gray-800">
        <div className="text-sm text-gray-300 truncate font-mono" title={currentPath}>
          {shortPath}
        </div>
      </div>
    </div>
  );
}
