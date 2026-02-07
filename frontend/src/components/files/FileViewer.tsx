import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileViewer } from '../../hooks/useFileViewer';
import { FileBrowser } from './FileBrowser';
import { CodeViewer } from './CodeViewer';
import { ImageViewer } from './ImageViewer';
import { DiffViewer } from './DiffViewer';
import { MarkdownViewer } from './MarkdownViewer';
import { HtmlViewer } from './HtmlViewer';
import { getLanguageFromPath } from './language-detect';
import type { FileInfo, FileChange, GitFileChange } from '../../../../shared/types';

type ViewMode = 'browser' | 'file' | 'changes' | 'diff';
type ListMode = 'browser' | 'changes';
type ChangesSource = 'claude' | 'git';
type ChangesDisplay = 'list' | 'tree';

const CHANGES_SOURCE_KEY = 'cchub-changes-source';
const CHANGES_DISPLAY_KEY = 'cchub-changes-display';

function getStoredChangesSource(): ChangesSource {
  return (localStorage.getItem(CHANGES_SOURCE_KEY) as ChangesSource) || 'git';
}

function getStoredChangesDisplay(): ChangesDisplay {
  return (localStorage.getItem(CHANGES_DISPLAY_KEY) as ChangesDisplay) || 'list';
}

interface FileViewerProps {
  sessionWorkingDir: string;
  onClose: () => void;
  initialPath?: string;
}

// Image extensions
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
]);

// Markdown extensions
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

// HTML extensions (for preview mode)
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

function isImageFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

function isMarkdownFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? MARKDOWN_EXTENSIONS.has(ext) : false;
}

function isHtmlFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? HTML_EXTENSIONS.has(ext) : false;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function FileViewer({ sessionWorkingDir, onClose, initialPath }: FileViewerProps) {
  const { t } = useTranslation();
  const {
    currentPath,
    files,
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
    clearSelectedFile,
  } = useFileViewer(sessionWorkingDir);

  const [viewMode, setViewMode] = useState<ViewMode>('browser');
  const [listMode, setListMode] = useState<ListMode>('browser');
  const [showHidden, setShowHidden] = useState(false);
  const [selectedChange, setSelectedChange] = useState<FileChange | null>(null);
  const [selectedGitDiff, setSelectedGitDiff] = useState<{ path: string; diff: string } | null>(null);

  // View history stack for back navigation
  // Use module-level array to survive React strict mode and re-renders
  const viewHistoryRef = useRef<Array<{
    viewMode: ViewMode;
    listMode: ListMode;
    selectedChange: FileChange | null;
    selectedGitDiff: { path: string; diff: string } | null;
  }>>([]);

  const pushToHistory = useCallback((state: {
    viewMode: ViewMode;
    listMode: ListMode;
    selectedChange: FileChange | null;
    selectedGitDiff: { path: string; diff: string } | null;
  }) => {
    viewHistoryRef.current.push(state);
    window.history.pushState({ fileViewer: true }, '', window.location.href);
  }, []);

  // Store onClose and clearSelectedFile in refs so popstate listener always sees latest
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const clearSelectedFileRef = useRef(clearSelectedFile);
  clearSelectedFileRef.current = clearSelectedFile;

  // handleBack for in-app button
  const handleBack = useCallback(() => {
    if (viewHistoryRef.current.length === 0) {
      onCloseRef.current();
      return;
    }
    window.history.back();
  }, []);

  // Detect wide screen for two-pane layout
  const [isWideScreen, setIsWideScreen] = useState(() => window.innerWidth >= 768);

  // Resizable left pane
  const [leftPaneWidth, setLeftPaneWidth] = useState(300);
  const isResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setIsWideScreen(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle pane resize
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleResizeMove = (e: MouseEvent | TouchEvent) => {
      if (!isResizing.current || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const newWidth = clientX - containerRect.left;

      // Clamp between min and max
      const clampedWidth = Math.max(200, Math.min(newWidth, containerRect.width - 300));
      setLeftPaneWidth(clampedWidth);
    };

    const handleResizeEnd = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    document.addEventListener('touchmove', handleResizeMove);
    document.addEventListener('touchend', handleResizeEnd);

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.removeEventListener('touchmove', handleResizeMove);
      document.removeEventListener('touchend', handleResizeEnd);
    };
  }, []);

  // Cleanup history entries on unmount (e.g. close button)
  useEffect(() => {
    return () => {
      const remaining = viewHistoryRef.current.length;
      viewHistoryRef.current = [];
      if (remaining > 0) {
        window.history.go(-remaining);
      }
    };
  }, []);

  // Initialize
  useEffect(() => {
    const initPath = initialPath || sessionWorkingDir;
    listDirectory(initPath);
  }, [initialPath, sessionWorkingDir, listDirectory]);

  // Handle file selection
  const handleSelectFile = useCallback(async (file: FileInfo) => {
    pushToHistory({ viewMode, listMode, selectedChange, selectedGitDiff });
    await readFile(file.path);
    setViewMode('file');
  }, [readFile, viewMode, listMode, selectedChange, selectedGitDiff]);

  // Handle browser back gesture / back button
  // Register ONCE with empty deps - use refs to access latest callbacks
  // Use capture phase so this runs BEFORE App.tsx's bubble phase handler
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const stack = viewHistoryRef.current;
      if (stack.length > 0) {
        e.stopImmediatePropagation();
        const prev = stack.pop()!;
        setViewMode(prev.viewMode);
        setListMode(prev.listMode);
        setSelectedChange(prev.selectedChange);
        setSelectedGitDiff(prev.selectedGitDiff);
        if (prev.viewMode !== 'file') {
          clearSelectedFileRef.current();
        }
      } else {
        e.stopImmediatePropagation();
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState, true); // capture phase
    return () => window.removeEventListener('popstate', handlePopState, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle changes tab - fetch both Claude and Git changes
  const handleShowChanges = useCallback(async () => {
    pushToHistory({ viewMode, listMode, selectedChange, selectedGitDiff });
    await Promise.all([getChanges(), getGitChanges()]);
    setListMode('changes');
    if (!isWideScreen) {
      setViewMode('changes');
    }
  }, [getChanges, getGitChanges, isWideScreen, viewMode, listMode, selectedChange, selectedGitDiff]);

  // Handle browser tab
  const handleShowBrowser = useCallback(() => {
    pushToHistory({ viewMode, listMode, selectedChange, selectedGitDiff });
    setListMode('browser');
    if (!isWideScreen) {
      setViewMode('browser');
    }
  }, [isWideScreen, viewMode, listMode, selectedChange, selectedGitDiff]);

  // Handle change file click - show diff view (Claude changes)
  const handleChangeFileClick = useCallback((change: FileChange) => {
    pushToHistory({ viewMode, listMode, selectedChange, selectedGitDiff });
    setSelectedChange(change);
    setSelectedGitDiff(null);
    setViewMode('diff');
  }, [viewMode, listMode, selectedChange, selectedGitDiff]);

  // Handle git file click - fetch diff and show
  const handleGitFileClick = useCallback(async (change: GitFileChange) => {
    pushToHistory({ viewMode, listMode, selectedChange, selectedGitDiff });
    const diff = await getGitDiff(change.path, change.staged);
    setSelectedGitDiff({ path: change.path, diff });
    setSelectedChange(null);
    setViewMode('diff');
  }, [getGitDiff, viewMode, listMode, selectedChange, selectedGitDiff]);

  // Handle open file from diff (wide screen)
  const handleOpenFileFromDiff = useCallback(async () => {
    const filePath = selectedChange?.path || (selectedGitDiff ? `${sessionWorkingDir}/${selectedGitDiff.path}` : null);
    if (filePath) {
      pushToHistory({ viewMode, listMode, selectedChange, selectedGitDiff });
      await readFile(filePath);
      setSelectedChange(null);
      setSelectedGitDiff(null);
      setViewMode('file');
    }
  }, [selectedChange, selectedGitDiff, readFile, sessionWorkingDir, viewMode, listMode]);

  // Keyboard handling - Escape always goes back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  // Current diff display name
  const currentDiffFileName = viewMode === 'diff'
    ? (selectedChange ? getFileName(selectedChange.path) : selectedGitDiff ? getFileName(selectedGitDiff.path) : '')
    : '';

  // Check if content is showing
  const hasContent = viewMode === 'file' || viewMode === 'diff';

  // Two-pane layout for wide screens
  if (isWideScreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
        <div className="bg-gray-900 w-full h-full lg:w-[95%] lg:h-[90%] lg:max-w-6xl lg:rounded-lg lg:shadow-2xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800">
            <div className="flex items-center gap-2">
              <button
                onClick={handleBack}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-sm font-medium">{t('files.title')}</h2>
            </div>

            <div className="flex items-center gap-2">
              {/* Tab buttons */}
              <div className="flex items-center bg-gray-700 rounded-lg p-0.5">
                <button
                  onClick={handleShowBrowser}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    listMode === 'browser' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {t('files.browser')}
                </button>
                <button
                  onClick={handleShowChanges}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    listMode === 'changes' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {t('files.changes')}
                </button>
              </div>

              {/* Hidden files toggle */}
              {listMode === 'browser' && (
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  className={`p-1.5 rounded transition-colors ${showHidden ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
                  title={t('files.showHidden')}
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

          {/* Two-pane content */}
          <div ref={containerRef} className="flex-1 flex overflow-hidden">
            {/* Left pane: File list or Changes */}
            <div
              className="overflow-hidden flex flex-col shrink-0"
              style={{ width: leftPaneWidth }}
            >
              {listMode === 'browser' ? (
                <FileBrowser
                  files={files}
                  currentPath={currentPath}
                  sessionWorkingDir={sessionWorkingDir}
                  isLoading={isLoading}
                  onSelectFile={handleSelectFile}
                  showHidden={showHidden}
                />
              ) : (
                <ChangesView
                  claudeChanges={changes}
                  gitChanges={gitChanges}
                  gitBranch={gitBranch}
                  isLoading={isLoading}
                  onSelectClaudeChange={handleChangeFileClick}
                  onSelectGitChange={handleGitFileClick}
                  selectedPath={selectedChange?.path || selectedGitDiff?.path}
                />
              )}
            </div>

            {/* Resize handle */}
            <div
              className="w-1 bg-gray-700 hover:bg-blue-500 cursor-col-resize transition-colors shrink-0 touch-none"
              onMouseDown={handleResizeStart}
              onTouchStart={handleResizeStart}
            />

            {/* Right pane: Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {hasContent ? (
                <>
                  {/* Content header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800/50">
                    <span className="text-sm text-gray-300 truncate flex-1">
                      {viewMode === 'diff'
                        ? currentDiffFileName
                        : selectedFile
                        ? getFileName(selectedFile.path)
                        : ''}
                    </span>
                    {viewMode === 'diff' && (
                      <button
                        onClick={handleOpenFileFromDiff}
                        className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                      >
                        {t('files.openFile')}
                      </button>
                    )}
                  </div>
                  {/* Content body */}
                  <div className="flex-1 overflow-hidden">
                    {viewMode === 'file' && selectedFile && (
                      isImageFile(selectedFile.path) ? (
                        <ImageViewer
                          content={selectedFile.content}
                          mimeType={selectedFile.mimeType}
                          fileName={getFileName(selectedFile.path)}
                          size={selectedFile.size}
                        />
                      ) : isMarkdownFile(selectedFile.path) ? (
                        <MarkdownViewer
                          content={selectedFile.content}
                          fileName={getFileName(selectedFile.path)}
                          truncated={selectedFile.truncated}
                        />
                      ) : isHtmlFile(selectedFile.path) ? (
                        <HtmlViewer
                          content={selectedFile.content}
                          fileName={getFileName(selectedFile.path)}
                        />
                      ) : (
                        <CodeViewer
                          content={selectedFile.content}
                          language={getLanguageFromPath(selectedFile.path)}
                          fileName={getFileName(selectedFile.path)}
                          truncated={selectedFile.truncated}
                          showLineNumbers={true}
                        />
                      )
                    )}
                    {viewMode === 'diff' && selectedChange && (
                      <DiffViewer
                        oldContent={selectedChange.oldContent}
                        newContent={selectedChange.newContent}
                        fileName={getFileName(selectedChange.path)}
                        toolName={selectedChange.toolName}
                      />
                    )}
                    {viewMode === 'diff' && selectedGitDiff && (
                      <DiffViewer
                        unifiedDiff={selectedGitDiff.diff}
                        fileName={getFileName(selectedGitDiff.path)}
                        toolName="git"
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>{t('files.selectFile')}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single-pane layout for narrow screens (mobile)
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="bg-gray-900 w-full h-full lg:w-[90%] lg:h-[90%] lg:max-w-5xl lg:rounded-lg lg:shadow-2xl overflow-hidden flex flex-col">
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
              sessionWorkingDir={sessionWorkingDir}
              isLoading={isLoading}
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
            ) : isMarkdownFile(selectedFile.path) ? (
              <MarkdownViewer
                content={selectedFile.content}
                fileName={getFileName(selectedFile.path)}
                truncated={selectedFile.truncated}
              />
            ) : isHtmlFile(selectedFile.path) ? (
              <HtmlViewer
                content={selectedFile.content}
                fileName={getFileName(selectedFile.path)}
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
              claudeChanges={changes}
              gitChanges={gitChanges}
              gitBranch={gitBranch}
              isLoading={isLoading}
              onSelectClaudeChange={handleChangeFileClick}
              onSelectGitChange={handleGitFileClick}
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

          {viewMode === 'diff' && selectedGitDiff && (
            <DiffViewer
              unifiedDiff={selectedGitDiff.diff}
              fileName={getFileName(selectedGitDiff.path)}
              toolName="git"
            />
          )}
        </div>

        {/* Footer controls - at bottom for easier touch access */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-700 bg-gray-800">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBack}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-sm font-medium">
              {viewMode === 'browser' ? t('files.title')
                : viewMode === 'changes' ? t('files.changes')
                : viewMode === 'diff' ? currentDiffFileName
                : selectedFile ? getFileName(selectedFile.path)
                : t('files.title')}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab buttons */}
            <div className="flex items-center bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={handleShowBrowser}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === 'browser' || viewMode === 'file' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t('files.browser')}
              </button>
              <button
                onClick={handleShowChanges}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === 'changes' || viewMode === 'diff' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t('files.changes')}
              </button>
            </div>

            {/* Hidden files toggle */}
            {viewMode === 'browser' && (
              <button
                onClick={() => setShowHidden(!showHidden)}
                className={`p-1.5 rounded transition-colors ${showHidden ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
                title={t('files.showHidden')}
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
      </div>
    </div>
  );
}

// Git status label helper
function gitStatusLabel(status: string): { label: string; color: string; dotColor: string } {
  switch (status) {
    case 'A': return { label: 'Added', color: 'text-green-400', dotColor: 'bg-green-500' };
    case 'D': return { label: 'Deleted', color: 'text-red-400', dotColor: 'bg-red-500' };
    case 'R': return { label: 'Renamed', color: 'text-blue-400', dotColor: 'bg-blue-500' };
    case '??': return { label: 'Untracked', color: 'text-gray-400', dotColor: 'bg-gray-500' };
    case 'U': return { label: 'Conflict', color: 'text-orange-400', dotColor: 'bg-orange-500' };
    default: return { label: 'Modified', color: 'text-yellow-400', dotColor: 'bg-yellow-500' };
  }
}

// Tree node for file tree view
interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  change?: GitFileChange | FileChange;
  isDir: boolean;
}

function buildTree(items: { path: string; change: GitFileChange | FileChange }[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const item of items) {
    const parts = item.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      let existing = current.find(n => n.name === name);
      if (!existing) {
        existing = { name, fullPath, children: [], isDir: !isLast };
        if (isLast) {
          existing.change = item.change;
        }
        current.push(existing);
      }
      current = existing.children;
    }
  }

  return root;
}

function TreeView({
  nodes,
  depth,
  onSelectGitChange,
  onSelectClaudeChange,
  selectedPath,
}: {
  nodes: TreeNode[];
  depth: number;
  onSelectGitChange?: (change: GitFileChange) => void;
  onSelectClaudeChange?: (change: FileChange) => void;
  selectedPath?: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleDir = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <>
      {nodes.map(node => {
        const isCollapsed = collapsed.has(node.fullPath);

        if (node.isDir) {
          return (
            <div key={node.fullPath}>
              <div
                onClick={() => toggleDir(node.fullPath)}
                className="flex items-center gap-1 px-2 py-1 hover:bg-gray-800 cursor-pointer text-sm text-gray-400"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
              >
                <svg className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="truncate">{node.name}</span>
                <span className="text-xs text-gray-600 ml-auto shrink-0">
                  {countLeaves(node)}
                </span>
              </div>
              {!isCollapsed && (
                <TreeView
                  nodes={node.children}
                  depth={depth + 1}
                  onSelectGitChange={onSelectGitChange}
                  onSelectClaudeChange={onSelectClaudeChange}
                  selectedPath={selectedPath}
                />
              )}
            </div>
          );
        }

        // Leaf node (file)
        const isGitChange = node.change && 'status' in node.change;
        const statusInfo = isGitChange ? gitStatusLabel((node.change as GitFileChange).status) : null;
        const isClaudeChange = node.change && 'toolName' in node.change;

        return (
          <div
            key={node.fullPath}
            onClick={() => {
              if (isGitChange && onSelectGitChange) {
                onSelectGitChange(node.change as GitFileChange);
              } else if (isClaudeChange && onSelectClaudeChange) {
                onSelectClaudeChange(node.change as FileChange);
              }
            }}
            className={`flex items-center gap-2 px-2 py-1 hover:bg-gray-800 active:bg-gray-700 cursor-pointer transition-colors ${
              selectedPath === node.fullPath ? 'bg-gray-800' : ''
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${
              statusInfo ? statusInfo.dotColor
                : isClaudeChange && (node.change as FileChange).toolName === 'Write' ? 'bg-green-500'
                : 'bg-yellow-500'
            }`} />
            <span className="text-sm truncate flex-1">{node.name}</span>
            <span className={`text-xs shrink-0 ${statusInfo?.color || 'text-gray-500'}`}>
              {statusInfo ? statusInfo.label
                : isClaudeChange && (node.change as FileChange).toolName === 'Write' ? 'Created'
                : 'Edited'}
            </span>
          </div>
        );
      })}
    </>
  );
}

function countLeaves(node: TreeNode): number {
  if (!node.isDir) return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

// Changes list view with Claude/Git toggle and list/tree display
function ChangesView({
  claudeChanges,
  gitChanges,
  gitBranch,
  isLoading,
  onSelectClaudeChange,
  onSelectGitChange,
  selectedPath,
}: {
  claudeChanges: FileChange[];
  gitChanges: GitFileChange[];
  gitBranch: string;
  isLoading: boolean;
  onSelectClaudeChange: (change: FileChange) => void;
  onSelectGitChange: (change: GitFileChange) => void;
  selectedPath?: string;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<ChangesSource>(getStoredChangesSource);
  const [display, setDisplay] = useState<ChangesDisplay>(getStoredChangesDisplay);

  const handleSourceChange = (newSource: ChangesSource) => {
    setSource(newSource);
    localStorage.setItem(CHANGES_SOURCE_KEY, newSource);
  };

  const handleDisplayChange = (newDisplay: ChangesDisplay) => {
    setDisplay(newDisplay);
    localStorage.setItem(CHANGES_DISPLAY_KEY, newDisplay);
  };

  // Deduplicate git changes by path (prefer unstaged)
  const uniqueGitChanges = useMemo(() => {
    const seen = new Map<string, GitFileChange>();
    for (const change of gitChanges) {
      if (!seen.has(change.path) || !change.staged) {
        seen.set(change.path, change);
      }
    }
    return Array.from(seen.values());
  }, [gitChanges]);

  const treeNodes = useMemo(() => {
    if (source === 'git') {
      return buildTree(uniqueGitChanges.map(c => ({ path: c.path, change: c })));
    }
    return buildTree(claudeChanges.map(c => ({
      path: c.path.replace(/^\/home\/[^/]+\/[^/]+\//, ''),
      change: c,
    })));
  }, [source, uniqueGitChanges, claudeChanges]);

  const currentChanges = source === 'git' ? uniqueGitChanges : claudeChanges;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Controls bar */}
      <div className="px-2 py-1.5 border-b border-gray-700 bg-gray-800/50 flex items-center gap-2 flex-wrap">
        {/* Source toggle: Claude / Git */}
        <div className="flex items-center bg-gray-700 rounded p-0.5">
          <button
            onClick={() => handleSourceChange('claude')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              source === 'claude' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Claude{claudeChanges.length > 0 ? `(${claudeChanges.length})` : ''}
          </button>
          <button
            onClick={() => handleSourceChange('git')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              source === 'git' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Git{uniqueGitChanges.length > 0 ? `(${uniqueGitChanges.length})` : ''}
          </button>
        </div>

        {/* Display toggle: List / Tree */}
        <div className="flex items-center bg-gray-700 rounded p-0.5">
          <button
            onClick={() => handleDisplayChange('list')}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              display === 'list' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title={t('files.listView')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => handleDisplayChange('tree')}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              display === 'tree' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title={t('files.treeView')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        </div>

        {/* Branch indicator for git */}
        {source === 'git' && gitBranch && (
          <span className="text-xs text-gray-500 truncate ml-auto">
            {gitBranch}
          </span>
        )}
      </div>

      {/* Content */}
      {currentChanges.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-500">
          <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div>{t('files.noChanges')}</div>
        </div>
      ) : display === 'tree' ? (
        <div className="flex-1 overflow-y-auto py-1">
          <TreeView
            nodes={treeNodes}
            depth={0}
            onSelectGitChange={source === 'git' ? onSelectGitChange : undefined}
            onSelectClaudeChange={source === 'claude' ? onSelectClaudeChange : undefined}
            selectedPath={selectedPath}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-gray-800">
            {source === 'git' ? (
              uniqueGitChanges.map((change, i) => {
                const statusInfo = gitStatusLabel(change.status);
                return (
                  <div
                    key={`${change.path}-${i}`}
                    onClick={() => onSelectGitChange(change)}
                    className={`flex items-center gap-3 px-3 py-2 hover:bg-gray-800 active:bg-gray-700 cursor-pointer transition-colors ${
                      selectedPath === change.path ? 'bg-gray-800' : ''
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusInfo.dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{getFileName(change.path)}</div>
                      <div className="text-xs text-gray-500 truncate">{change.path}</div>
                    </div>
                    <div className={`text-xs shrink-0 ${statusInfo.color}`}>
                      {statusInfo.label}
                    </div>
                  </div>
                );
              })
            ) : (
              claudeChanges.map((change, i) => (
                <div
                  key={`${change.path}-${i}`}
                  onClick={() => onSelectClaudeChange(change)}
                  className={`flex items-center gap-3 px-3 py-2 hover:bg-gray-800 active:bg-gray-700 cursor-pointer transition-colors ${
                    selectedPath === change.path ? 'bg-gray-800' : ''
                  }`}
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
                    {change.toolName === 'Write' ? t('files.created') : t('files.edited')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
