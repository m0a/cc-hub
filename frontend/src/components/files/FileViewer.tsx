import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, X, Eye, EyeOff, FileText, ChevronRight, ChevronDown, List, FolderTree, GitBranch, MessageSquare, BarChart3, RotateCw, Upload, Download } from 'lucide-react';
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
  onCopyPrompt?: (text: string) => void;
  hidden?: boolean;
  onShowSessions?: () => void;
  // Terminal-style toolbar props
  sessionName?: string;
  sessionStatus?: 'working' | 'waiting_input' | 'waiting_permission' | 'idle' | 'disconnected' | 'lost';
  onShowConversation?: () => void;
  onShowDashboard?: () => void;
  onReload?: () => void;
}

// Image extensions
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
]);

// Markdown extensions
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

// HTML extensions (for preview mode)
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

// Video/audio extensions
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.mov', '.m4v']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma']);

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

function isVideoFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? VIDEO_EXTENSIONS.has(ext) : false;
}

function isAudioFile(path: string): boolean {
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? AUDIO_EXTENSIONS.has(ext) : false;
}

function isMediaFile(path: string): boolean {
  return isVideoFile(path) || isAudioFile(path);
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function FileViewer({ sessionWorkingDir, onClose, initialPath, onCopyPrompt, hidden, onShowSessions, sessionName, sessionStatus, onShowConversation, onShowDashboard, onReload }: FileViewerProps) {
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
  const [previewMode, setPreviewMode] = useState(false);
  // Scroll ratio to preserve scroll position across preview/source toggle
  const scrollRatioRef = useRef(0);
  const handleScrollRatioChange = useCallback((ratio: number) => {
    scrollRatioRef.current = ratio;
  }, []);
  const togglePreviewMode = useCallback(() => {
    setPreviewMode(prev => !prev);
  }, []);
  const enablePreviewMode = useCallback(() => {
    setPreviewMode(true);
  }, []);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedChange, setSelectedChange] = useState<FileChange | null>(null);
  const [selectedGitDiff, setSelectedGitDiff] = useState<{ path: string; diff: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleUploadFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    console.log(`[upload] files selected: ${fileList?.length ?? 0}`);
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    for (const f of Array.from(fileList)) {
      console.log(`[upload] ${f.name} (${f.size}B, ${f.type})`);
    }

    try {
      const formData = new FormData();
      formData.append('path', currentPath);
      formData.append('sessionWorkingDir', sessionWorkingDir);
      // Read files into Blobs first — on some mobile PWAs, the File reference
      // from input[type=file] goes stale before fetch can read it.
      for (const f of Array.from(fileList)) {
        const buf = await f.arrayBuffer();
        formData.append('file', new Blob([buf], { type: f.type || 'application/octet-stream' }), f.name);
      }
      console.log('[upload] sending POST /api/files/upload');
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
      console.log(`[upload] response: ${res.status}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `${res.status}` }));
        setUploadMessage({ text: `Upload failed: ${err.error || res.statusText}`, isError: true });
        return;
      }
      const result = await res.json().catch(() => null);
      const names = result?.files?.map((f: { name: string }) => f.name).join(', ') || '';
      setUploadMessage({ text: `Uploaded: ${names}`, isError: false });
      await listDirectory(currentPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[upload] error: ${msg}`, err);
      setUploadMessage({ text: `Upload failed: ${msg}`, isError: true });
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      // Auto-dismiss toast after 4s
      setTimeout(() => setUploadMessage(null), 4000);
    }
  }, [currentPath, sessionWorkingDir, listDirectory]);

  const handleDownloadFile = useCallback(() => {
    if (!selectedFile) return;
    const url = `/api/files/download?path=${encodeURIComponent(selectedFile.path)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`;
    // Use a temporary anchor to trigger download with proper filename from Content-Disposition
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [selectedFile, sessionWorkingDir]);

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
    setViewMode('file'); setPreviewMode(false);
    scrollRatioRef.current = 0;
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
      setViewMode('file'); setPreviewMode(false);
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
      <div className={`fixed inset-0 z-50 flex items-center justify-center ${hidden ? 'hidden' : ''}`}>
        <div className="bg-[#0a0a0a] w-full h-full overflow-hidden flex flex-col">
          {/* Header - 2 rows: session bar on top, file controls below */}
          <div className="border-b border-white/[0.06]">
            {/* Row 1: Session bar (same as terminal toolbar) */}
            <div className="flex items-center gap-2 px-3 py-1.5">
              <button
                onClick={onShowSessions}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${
                  sessionStatus === 'working' ? 'bg-blue-500' :
                  (sessionStatus === 'waiting_input' || sessionStatus === 'waiting_permission') ? 'bg-amber-400 animate-pulse' :
                  'bg-zinc-600'
                }`} />
                <span className="text-[13px] font-medium text-white truncate max-w-[200px]">
                  {sessionName || '-'}
                </span>
                <ChevronDown className="w-3 h-3 text-zinc-500" />
              </button>

              <div className="flex-1" />

              <div className="flex items-center gap-0.5">
                <button onClick={onClose} className="p-2 text-zinc-300 transition-colors" title="ファイル">
                  <FileText className="w-[18px] h-[18px]" />
                </button>
                {onShowDashboard && (
                  <button onClick={onShowDashboard} className="p-2 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors" title="ダッシュボード">
                    <BarChart3 className="w-[18px] h-[18px]" />
                  </button>
                )}
                <button onClick={() => listDirectory(currentPath)} className="p-2 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors" title="リロード">
                  <RotateCw className="w-[18px] h-[18px]" />
                </button>
              </div>
            </div>

            {/* Row 2: File controls */}
            <div className="flex items-center justify-between px-3 py-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBack}
                  className="p-1 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 rounded transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h2 className="text-[13px] font-medium text-zinc-300">{t('files.title')}</h2>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="inline-flex items-center bg-white/[0.04] rounded-md p-0.5">
                  <button
                    onClick={handleShowBrowser}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                      listMode === 'browser' ? 'bg-white/[0.08] text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {t('files.browser')}
                  </button>
                  <button
                    onClick={handleShowChanges}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                      listMode === 'changes' ? 'bg-white/[0.08] text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {t('files.changes')}
                  </button>
                </div>
                {listMode === 'browser' && (
                  <>
                    <button
                      onClick={handleUploadClick}
                      disabled={uploading}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
                      title={uploading ? 'Uploading…' : `Upload to ${currentPath}`}
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleUploadFiles}
                    />
                    <button
                      onClick={() => setShowHidden(!showHidden)}
                      className={`p-1.5 rounded transition-colors ${showHidden ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                      title={t('files.showHidden')}
                    >
                      {showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2 bg-red-900/50 text-red-300 text-sm border-b border-red-800">
              {error}
            </div>
          )}

          {/* Upload toast */}
          {uploadMessage && (
            <div className={`px-3 py-2 text-sm border-b ${uploadMessage.isError ? 'bg-red-900/50 text-red-300 border-red-800' : 'bg-green-900/50 text-green-300 border-green-800'}`}>
              {uploadMessage.text}
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
              className="w-1 bg-th-surface-hover hover:bg-blue-500 cursor-col-resize transition-colors shrink-0 touch-none"
              onMouseDown={handleResizeStart}
              onTouchStart={handleResizeStart}
            />

            {/* Right pane: Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {hasContent ? (
                <>
                  {/* Content header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-th-border bg-th-surface/50">
                    <span className="text-sm text-th-text-secondary truncate flex-1">
                      {viewMode === 'diff'
                        ? currentDiffFileName
                        : selectedFile
                        ? getFileName(selectedFile.path)
                        : ''}
                    </span>
                    {viewMode === 'file' && selectedFile && (isMarkdownFile(selectedFile.path) || isHtmlFile(selectedFile.path)) && (
                      <button
                        onClick={togglePreviewMode}
                        className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${previewMode ? 'bg-blue-600 text-white' : 'bg-white/[0.04] hover:bg-white/[0.08] text-zinc-500'}`}
                      >
                        {previewMode ? 'Source' : 'Preview'}
                      </button>
                    )}
                    {viewMode === 'file' && selectedFile && (
                      <button
                        onClick={handleDownloadFile}
                        className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="Download file"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    {viewMode === 'diff' && (
                      <button
                        onClick={handleOpenFileFromDiff}
                        className="px-2 py-1 text-xs bg-th-surface-hover hover:bg-th-surface-active rounded transition-colors"
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
                          srcUrl={`/api/files/raw?path=${encodeURIComponent(selectedFile.path)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`}
                        />
                      ) : isMediaFile(selectedFile.path) ? (
                        <div className="flex flex-col h-full bg-th-bg">
                          <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
                            {isVideoFile(selectedFile.path) ? (
                              <video
                                controls
                                playsInline
                                preload="metadata"
                                className="w-full h-full object-contain rounded"
                                src={`/api/files/raw?path=${encodeURIComponent(selectedFile.path)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`}
                              />
                            ) : (
                              <audio
                                controls
                                preload="metadata"
                                className="w-full max-w-md"
                                src={`/api/files/raw?path=${encodeURIComponent(selectedFile.path)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`}
                              />
                            )}
                          </div>
                          <div className="px-3 py-1.5 text-xs text-th-text-muted text-center border-t border-th-border">
                            {getFileName(selectedFile.path)} • {selectedFile.size ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : ''}
                          </div>
                        </div>
                      ) : previewMode && isMarkdownFile(selectedFile.path) ? (
                        <MarkdownViewer
                          content={selectedFile.content}
                          truncated={selectedFile.truncated}
                          initialScrollRatio={scrollRatioRef.current}
                          onScrollRatioChange={handleScrollRatioChange}
                        />
                      ) : previewMode && isHtmlFile(selectedFile.path) ? (
                        <HtmlViewer
                          content={selectedFile.content}
                          fileName={getFileName(selectedFile.path)}
                        />
                      ) : (
                        <CodeViewer onCopyPrompt={onCopyPrompt}
                          content={selectedFile.content}
                          language={getLanguageFromPath(selectedFile.path)}
                          fileName={getFileName(selectedFile.path)}
                          filePath={selectedFile.path}
                          truncated={selectedFile.truncated}
                          showLineNumbers={true}
                          hasPreview={isMarkdownFile(selectedFile.path) || isHtmlFile(selectedFile.path)}
                          onTogglePreview={enablePreviewMode}
                          initialScrollRatio={scrollRatioRef.current}
                          onScrollRatioChange={handleScrollRatioChange}
                        />
                      )
                    )}
                    {viewMode === 'diff' && selectedChange && (
                      <DiffViewer onCopyPrompt={onCopyPrompt}
                        oldContent={selectedChange.oldContent}
                        newContent={selectedChange.newContent}
                        fileName={getFileName(selectedChange.path)}
                        toolName={selectedChange.toolName}
                      />
                    )}
                    {viewMode === 'diff' && selectedGitDiff && (
                      <DiffViewer onCopyPrompt={onCopyPrompt}
                        unifiedDiff={selectedGitDiff.diff}
                        fileName={getFileName(selectedGitDiff.path)}
                        toolName="git"
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-th-text-muted">
                  <div className="text-center">
                    <FileText className="w-12 h-12 mx-auto mb-2" strokeWidth={1.5} />
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
    <div className={`fixed inset-0 z-50 bg-[var(--color-overlay)] flex items-center justify-center ${hidden ? 'hidden' : ''}`}>
      <div className="bg-th-bg w-full h-full overflow-hidden flex flex-col">
        {/* Error */}
        {error && (
          <div className="px-3 py-2 bg-red-900/50 text-red-300 text-sm border-b border-red-800">
            {error}
          </div>
        )}

        {/* Upload toast */}
        {uploadMessage && (
          <div className={`px-3 py-2 text-sm border-b ${uploadMessage.isError ? 'bg-red-900/50 text-red-300 border-red-800' : 'bg-green-900/50 text-green-300 border-green-800'}`}>
            {uploadMessage.text}
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
                srcUrl={`/api/files/raw?path=${encodeURIComponent(selectedFile.path)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`}
              />
            ) : isMediaFile(selectedFile.path) ? (
              <div className="flex flex-col items-center justify-center h-full p-4 bg-th-bg">
                {isVideoFile(selectedFile.path) ? (
                  <video
                    controls
                    className="max-w-full max-h-full rounded"
                    src={`/api/files/raw?path=${encodeURIComponent(selectedFile.path)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`}
                  />
                ) : (
                  <audio
                    controls
                    className="w-full max-w-md"
                    src={`/api/files/raw?path=${encodeURIComponent(selectedFile.path)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`}
                  />
                )}
                <div className="mt-2 text-xs text-th-text-muted">
                  {getFileName(selectedFile.path)} • {selectedFile.size ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : ''}
                </div>
              </div>
            ) : previewMode && isMarkdownFile(selectedFile.path) ? (
              <MarkdownViewer
                content={selectedFile.content}
                truncated={selectedFile.truncated}
                initialScrollRatio={scrollRatioRef.current}
                onScrollRatioChange={handleScrollRatioChange}
              />
            ) : previewMode && isHtmlFile(selectedFile.path) ? (
              <HtmlViewer
                content={selectedFile.content}
                fileName={getFileName(selectedFile.path)}
              />
            ) : (
              <CodeViewer onCopyPrompt={onCopyPrompt}
                content={selectedFile.content}
                language={getLanguageFromPath(selectedFile.path)}
                fileName={getFileName(selectedFile.path)}
                truncated={selectedFile.truncated}
                hasPreview={isMarkdownFile(selectedFile.path) || isHtmlFile(selectedFile.path)}
                onTogglePreview={enablePreviewMode}
                initialScrollRatio={scrollRatioRef.current}
                onScrollRatioChange={handleScrollRatioChange}
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
            <DiffViewer onCopyPrompt={onCopyPrompt}
              oldContent={selectedChange.oldContent}
              newContent={selectedChange.newContent}
              fileName={getFileName(selectedChange.path)}
              toolName={selectedChange.toolName}
            />
          )}

          {viewMode === 'diff' && selectedGitDiff && (
            <DiffViewer onCopyPrompt={onCopyPrompt}
              unifiedDiff={selectedGitDiff.diff}
              fileName={getFileName(selectedGitDiff.path)}
              toolName="git"
            />
          )}
        </div>

        {/* Footer controls - 2 rows for consistency with terminal toolbar */}
        <div className="border-t border-white/[0.06] bg-[#0a0a0a]">
          {/* Row 1: File viewer controls */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <button
                onClick={handleBack}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 rounded transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-[13px] font-medium text-zinc-300 truncate max-w-[120px]">
                {viewMode === 'browser' ? t('files.title')
                  : viewMode === 'changes' ? t('files.changes')
                  : viewMode === 'diff' ? currentDiffFileName
                  : selectedFile ? getFileName(selectedFile.path)
                  : t('files.title')}
              </h2>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Tab buttons */}
              <div className="inline-flex items-center bg-white/[0.04] rounded-md p-0.5">
                <button
                  onClick={handleShowBrowser}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                    viewMode === 'browser' || viewMode === 'file' ? 'bg-white/[0.08] text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {t('files.browser')}
                </button>
                <button
                  onClick={handleShowChanges}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                    viewMode === 'changes' || viewMode === 'diff' ? 'bg-white/[0.08] text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {t('files.changes')}
                </button>
              </div>

              {/* Preview/Source toggle */}
              {viewMode === 'file' && selectedFile && (isMarkdownFile(selectedFile.path) || isHtmlFile(selectedFile.path)) && (
                <button
                  onClick={togglePreviewMode}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${previewMode ? 'bg-blue-600 text-white' : 'bg-white/[0.04] hover:bg-white/[0.08] text-zinc-500'}`}
                >
                  {previewMode ? 'Source' : 'Preview'}
                </button>
              )}

              {/* Upload + Hidden toggle (browser mode) */}
              {viewMode === 'browser' && (
                <>
                  <button
                    onClick={handleUploadClick}
                    disabled={uploading}
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
                    title={uploading ? 'Uploading…' : `Upload to ${currentPath}`}
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleUploadFiles}
                  />
                  <button
                    onClick={() => setShowHidden(!showHidden)}
                    className={`p-1.5 rounded transition-colors ${showHidden ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={t('files.showHidden')}
                  >
                    {showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </>
              )}

              {/* Download button (file view mode) */}
              {viewMode === 'file' && selectedFile && (
                <button
                  onClick={handleDownloadFile}
                  className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}

              {/* Close file viewer */}
              <button
                onClick={onClose}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Row 2: Terminal-style session bar (same as terminal toolbar) */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            {/* Session selector */}
            <button
              onClick={onShowSessions}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
            >
              <div className={`w-2 h-2 rounded-full ${
                sessionStatus === 'working' ? 'bg-blue-500' :
                (sessionStatus === 'waiting_input' || sessionStatus === 'waiting_permission') ? 'bg-amber-400 animate-pulse' :
                'bg-zinc-600'
              }`} />
              <span className="text-[13px] font-medium text-white truncate max-w-[140px]">
                {sessionName || '-'}
              </span>
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            </button>

            <div className="flex-1" />

            {/* Same icons as terminal toolbar */}
            <div className="flex items-center gap-1">
              {onShowConversation && (
                <button onClick={onShowConversation} className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors">
                  <MessageSquare className="w-5 h-5" />
                </button>
              )}
              <button onClick={onClose} className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors" title="ファイル">
                <FileText className="w-5 h-5 text-zinc-300" />
              </button>
              {onShowDashboard && (
                <button onClick={onShowDashboard} className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors">
                  <BarChart3 className="w-5 h-5" />
                </button>
              )}
              <button onClick={() => listDirectory(currentPath)} className="p-2.5 text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors" title="リロード">
                <RotateCw className="w-5 h-5" />
              </button>
            </div>
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
    case '??': return { label: 'Untracked', color: 'text-th-text-secondary', dotColor: 'bg-gray-500' };
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
                className="flex items-center gap-1 px-2 py-1 hover:bg-th-surface cursor-pointer text-sm text-th-text-secondary"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                <span className="truncate">{node.name}</span>
                <span className="text-xs text-th-text-muted ml-auto shrink-0">
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
            className={`flex items-center gap-2 px-2 py-1 hover:bg-th-surface active:bg-th-surface-hover cursor-pointer transition-colors ${
              selectedPath === node.fullPath ? 'bg-th-surface' : ''
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${
              statusInfo ? statusInfo.dotColor
                : isClaudeChange && (node.change as FileChange).toolName === 'Write' ? 'bg-green-500'
                : 'bg-yellow-500'
            }`} />
            <span className="text-sm truncate flex-1">{node.name}</span>
            <span className={`text-xs shrink-0 ${statusInfo?.color || 'text-th-text-muted'}`}>
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
        <div className="text-th-text-muted">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Controls bar */}
      <div className="px-2 py-1.5 border-b border-th-border bg-th-surface/50 flex items-center gap-2 flex-wrap">
        {/* Source toggle: Claude / Git */}
        <div className="flex items-center bg-th-surface-hover rounded p-0.5">
          <button
            onClick={() => handleSourceChange('claude')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              source === 'claude' ? 'bg-th-surface-active text-th-text' : 'text-th-text-secondary hover:text-th-text'
            }`}
          >
            Claude{claudeChanges.length > 0 ? `(${claudeChanges.length})` : ''}
          </button>
          <button
            onClick={() => handleSourceChange('git')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              source === 'git' ? 'bg-th-surface-active text-th-text' : 'text-th-text-secondary hover:text-th-text'
            }`}
          >
            Git{uniqueGitChanges.length > 0 ? `(${uniqueGitChanges.length})` : ''}
          </button>
        </div>

        {/* Display toggle: List / Tree */}
        <div className="flex items-center bg-th-surface-hover rounded p-0.5">
          <button
            onClick={() => handleDisplayChange('list')}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              display === 'list' ? 'bg-th-surface-active text-th-text' : 'text-th-text-secondary hover:text-th-text'
            }`}
            title={t('files.listView')}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleDisplayChange('tree')}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              display === 'tree' ? 'bg-th-surface-active text-th-text' : 'text-th-text-secondary hover:text-th-text'
            }`}
            title={t('files.treeView')}
          >
            <FolderTree className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Branch indicator for git */}
        {source === 'git' && gitBranch && (
          <span className="text-xs text-th-text-muted truncate ml-auto flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            {gitBranch}
          </span>
        )}
      </div>

      {/* Content */}
      {currentChanges.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-th-text-muted">
          <FileText className="w-12 h-12 mb-2" strokeWidth={1.5} />
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
                    className={`flex items-center gap-3 px-3 py-2 hover:bg-th-surface active:bg-th-surface-hover cursor-pointer transition-colors ${
                      selectedPath === change.path ? 'bg-th-surface' : ''
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusInfo.dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{getFileName(change.path)}</div>
                      <div className="text-xs text-th-text-muted truncate">{change.path}</div>
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
                  className={`flex items-center gap-3 px-3 py-2 hover:bg-th-surface active:bg-th-surface-hover cursor-pointer transition-colors ${
                    selectedPath === change.path ? 'bg-th-surface' : ''
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    change.toolName === 'Write' ? 'bg-green-500' : 'bg-yellow-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{getFileName(change.path)}</div>
                    <div className="text-xs text-th-text-muted truncate">
                      {change.path.replace(/^\/home\/[^/]+\//, '~/')}
                    </div>
                  </div>
                  <div className="text-xs text-th-text-muted shrink-0">
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
