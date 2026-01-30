import { useEffect, useState, useCallback } from 'react';
import { useFileViewer } from '../../hooks/useFileViewer';
import { FileBrowser } from './FileBrowser';
import { CodeViewer } from './CodeViewer';
import { ImageViewer } from './ImageViewer';
import { DiffViewer } from './DiffViewer';
import type { FileInfo, FileChange } from '../../../../shared/types';

type ViewMode = 'browser' | 'file' | 'changes' | 'diff';

interface FileViewerProps {
  sessionWorkingDir: string;
  onClose: () => void;
  initialPath?: string;
}

// Language map for syntax highlighting
const LANGUAGE_MAP: Record<string, string> = {
  // Web
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.vue': 'html',
  '.svelte': 'html',
  // Config
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.env': 'ini',
  '.conf': 'nginx',
  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  // Scripting
  '.py': 'python',
  '.rb': 'ruby',
  '.pl': 'perl',
  '.php': 'php',
  '.lua': 'lua',
  '.r': 'r',
  // Systems
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.cs': 'csharp',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.m': 'objectivec',
  '.mm': 'objectivec',
  // Data/Query
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  // Markup
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.xml': 'xml',
  '.svg': 'xml',
  '.plist': 'xml',
  '.xhtml': 'xml',
  // DevOps
  '.dockerfile': 'dockerfile',
  '.nginx': 'nginx',
  '.tf': 'hcl',
  // Other
  '.diff': 'diff',
  '.patch': 'diff',
  '.makefile': 'makefile',
  '.cmake': 'cmake',
  '.gradle': 'groovy',
  '.groovy': 'groovy',
  '.scala': 'scala',
  '.hs': 'haskell',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.clj': 'clojure',
  '.lisp': 'lisp',
  '.el': 'lisp',
  '.vim': 'vim',
  '.proto': 'protobuf',
};

// Image extensions
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
]);

// Filename-based language detection
const FILENAME_MAP: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'cmakelists.txt': 'cmake',
  'gemfile': 'ruby',
  'rakefile': 'ruby',
  'vagrantfile': 'ruby',
  '.gitignore': 'ini',
  '.dockerignore': 'ini',
  '.editorconfig': 'ini',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  '.babelrc': 'json',
  'tsconfig.json': 'json',
  'package.json': 'json',
  'composer.json': 'json',
  'cargo.toml': 'ini',
  'go.mod': 'go',
  'go.sum': 'plaintext',
};

function getLanguageFromPath(path: string): string {
  const fileName = path.split('/').pop()?.toLowerCase() || '';

  // Check filename first
  if (FILENAME_MAP[fileName]) {
    return FILENAME_MAP[fileName];
  }

  // Then check extension
  const ext = fileName.match(/\.[^.]+$/)?.[0];
  return ext ? (LANGUAGE_MAP[ext] || 'plaintext') : 'plaintext';
}

function isImageFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function FileViewer({ sessionWorkingDir, onClose, initialPath }: FileViewerProps) {
  const {
    currentPath,
    files,
    parentPath,
    selectedFile,
    changes,
    isLoading,
    error,
    listDirectory,
    readFile,
    getChanges,
    navigateTo,
    navigateUp,
    clearSelectedFile,
  } = useFileViewer(sessionWorkingDir);

  const [viewMode, setViewMode] = useState<ViewMode>('browser');
  const [showHidden, setShowHidden] = useState(false);
  const [selectedChange, setSelectedChange] = useState<FileChange | null>(null);

  // Initialize
  useEffect(() => {
    const initPath = initialPath || sessionWorkingDir;
    listDirectory(initPath);
  }, [initialPath, sessionWorkingDir, listDirectory]);

  // Handle file selection
  const handleSelectFile = useCallback(async (file: FileInfo) => {
    await readFile(file.path);
    setViewMode('file');
  }, [readFile]);

  // Handle back from file view
  const handleBackFromFile = useCallback(() => {
    if (viewMode === 'diff') {
      setSelectedChange(null);
      setViewMode('changes');
    } else {
      clearSelectedFile();
      setViewMode('browser');
    }
  }, [clearSelectedFile, viewMode]);

  // Handle changes tab
  const handleShowChanges = useCallback(async () => {
    await getChanges();
    setViewMode('changes');
  }, [getChanges]);

  // Handle change file click - show diff view
  const handleChangeFileClick = useCallback((change: FileChange) => {
    setSelectedChange(change);
    setViewMode('diff');
  }, []);

  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewMode === 'file' || viewMode === 'changes') {
          handleBackFromFile();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, handleBackFromFile, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="bg-gray-900 w-full h-full lg:w-[90%] lg:h-[90%] lg:max-w-5xl lg:rounded-lg lg:shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-2">
            {viewMode !== 'browser' && (
              <button
                onClick={handleBackFromFile}
                className="p-1.5 hover:bg-gray-700 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-sm font-medium">
              {viewMode === 'browser' ? 'ファイルブラウザ'
                : viewMode === 'changes' ? '変更ファイル'
                : viewMode === 'diff' && selectedChange ? getFileName(selectedChange.path)
                : selectedFile ? getFileName(selectedFile.path)
                : 'ファイル'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab buttons */}
            <div className="flex items-center bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('browser')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === 'browser' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                ブラウザ
              </button>
              <button
                onClick={handleShowChanges}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === 'changes' || viewMode === 'diff' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                変更
              </button>
            </div>

            {/* Hidden files toggle */}
            {viewMode === 'browser' && (
              <button
                onClick={() => setShowHidden(!showHidden)}
                className={`p-1.5 rounded transition-colors ${showHidden ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
                title="隠しファイルを表示"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 bg-red-900/50 text-red-300 text-sm border-b border-red-800">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {viewMode === 'browser' && (
            <FileBrowser
              files={files}
              currentPath={currentPath}
              parentPath={parentPath}
              isLoading={isLoading}
              onNavigate={navigateTo}
              onNavigateUp={navigateUp}
              onSelectFile={handleSelectFile}
              showHidden={showHidden}
            />
          )}

          {viewMode === 'file' && selectedFile && (
            isImageFile(selectedFile.path) ? (
              <ImageViewer
                content={selectedFile.content}
                mimeType={selectedFile.mimeType}
                fileName={getFileName(selectedFile.path)}
                size={selectedFile.size}
              />
            ) : (
              <CodeViewer
                content={selectedFile.content}
                language={getLanguageFromPath(selectedFile.path)}
                fileName={getFileName(selectedFile.path)}
                truncated={selectedFile.truncated}
              />
            )
          )}

          {viewMode === 'changes' && (
            <ChangesView
              changes={changes}
              isLoading={isLoading}
              onSelectChange={handleChangeFileClick}
            />
          )}

          {viewMode === 'diff' && selectedChange && (
            <DiffViewer
              oldContent={selectedChange.oldContent}
              newContent={selectedChange.newContent}
              fileName={getFileName(selectedChange.path)}
              toolName={selectedChange.toolName}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Changes list view
function ChangesView({
  changes,
  isLoading,
  onSelectChange,
}: {
  changes: FileChange[];
  isLoading: boolean;
  onSelectChange: (change: FileChange) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div>変更されたファイルはありません</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="divide-y divide-gray-800">
        {changes.map((change, i) => (
          <div
            key={`${change.path}-${i}`}
            onClick={() => onSelectChange(change)}
            className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800 active:bg-gray-700 cursor-pointer transition-colors"
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${
              change.toolName === 'Write' ? 'bg-green-500' : 'bg-yellow-500'
            }`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{getFileName(change.path)}</div>
              <div className="text-xs text-gray-500 truncate">
                {change.path.replace(/^\/home\/[^/]+\//, '~/')}
              </div>
            </div>
            <div className="text-xs text-gray-500 shrink-0">
              {change.toolName === 'Write' ? '作成' : '編集'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
