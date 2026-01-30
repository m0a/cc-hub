import { useEffect } from 'react';
import type { FileInfo } from '../../../../shared/types';

interface FileBrowserProps {
  files: FileInfo[];
  currentPath: string;
  parentPath: string | null;
  isLoading: boolean;
  onNavigate: (path: string) => void;
  onNavigateUp: () => void;
  onSelectFile: (file: FileInfo) => void;
  showHidden?: boolean;
}

// File type icons
function FileIcon({ file }: { file: FileInfo }) {
  if (file.type === 'directory') {
    return (
      <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    );
  }

  // File type detection
  const ext = file.extension?.toLowerCase();

  // Code files
  if (['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.scss'].includes(ext || '')) {
    return (
      <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    );
  }

  // Image files
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(ext || '')) {
    return (
      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }

  // Markdown/text
  if (['.md', '.txt', '.yaml', '.yml', '.toml'].includes(ext || '')) {
    return (
      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  // Default file icon
  return (
    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

export function FileBrowser({
  files,
  currentPath,
  parentPath,
  isLoading,
  onNavigate,
  onNavigateUp,
  onSelectFile,
  showHidden = false,
}: FileBrowserProps) {
  // Filter hidden files if needed
  const visibleFiles = showHidden
    ? files
    : files.filter(f => !f.isHidden);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && parentPath) {
        e.preventDefault();
        onNavigateUp();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [parentPath, onNavigateUp]);

  const handleFileClick = (file: FileInfo) => {
    if (file.type === 'directory') {
      onNavigate(file.path);
    } else {
      onSelectFile(file);
    }
  };

  // Get short path for display
  const shortPath = currentPath.replace(/^\/home\/[^/]+\//, '~/');

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Path bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800">
        {parentPath && (
          <button
            onClick={onNavigateUp}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors shrink-0"
            title="上のフォルダへ"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="flex-1 text-sm text-gray-300 truncate font-mono" title={currentPath}>
          {shortPath}
        </div>
      </div>

      {/* File list */}
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
          <div className="divide-y divide-gray-800">
            {visibleFiles.map((file) => (
              <div
                key={file.path}
                onClick={() => handleFileClick(file)}
                className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800 active:bg-gray-700 cursor-pointer transition-colors"
              >
                <FileIcon file={file} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{file.name}</div>
                  {file.type !== 'directory' && (
                    <div className="text-xs text-gray-500">
                      {formatFileSize(file.size)}
                    </div>
                  )}
                </div>
                {file.type === 'directory' && (
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
