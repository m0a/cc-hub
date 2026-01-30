import { useRef, useCallback, useState, useEffect } from 'react';
import { TerminalComponent, type TerminalRef } from './Terminal';
import { Keyboard } from './Keyboard';
import { SessionListMini } from './SessionListMini';
import { FileViewer } from './files/FileViewer';
import type { SessionResponse, SessionState } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SPLIT_RATIO_KEY = 'cchub-tablet-split-ratio';
const DEFAULT_SPLIT_RATIO = 50; // percentage

interface OpenSession {
  id: string;
  name: string;
  state: SessionState;
  currentPath?: string;
}

interface TabletLayoutProps {
  sessions: OpenSession[];
  activeSessionId: string | null;
  onSelectSession: (session: SessionResponse) => void;
  onSessionStateChange: (id: string, state: SessionState) => void;
  onShowSessionList: () => void;
  onReload: () => void;
}

export function TabletLayout({
  sessions,
  activeSessionId,
  onSelectSession,
  onSessionStateChange,
  onShowSessionList,
  onReload,
}: TabletLayoutProps) {
  const terminalRef = useRef<TerminalRef>(null);
  const [inputMode, setInputMode] = useState<'keyboard' | 'input'>('keyboard');
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showFileViewer, setShowFileViewer] = useState(false);

  // Resizable split ratio (percentage for left panel)
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = localStorage.getItem(SPLIT_RATIO_KEY);
    return saved ? parseFloat(saved) : DEFAULT_SPLIT_RATIO;
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save split ratio to localStorage
  useEffect(() => {
    localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatio));
  }, [splitRatio]);

  // Handle drag for resizing
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const ratio = ((clientX - rect.left) / rect.width) * 100;
      // Clamp between 30% and 70%
      setSplitRatio(Math.max(30, Math.min(70, ratio)));
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  // Terminal connection handlers
  const handleConnect = useCallback(() => {
    if (activeSessionId) {
      onSessionStateChange(activeSessionId, 'idle');
    }
  }, [activeSessionId, onSessionStateChange]);

  const handleDisconnect = useCallback(() => {
    if (activeSessionId) {
      onSessionStateChange(activeSessionId, 'disconnected');
    }
  }, [activeSessionId, onSessionStateChange]);

  // Helper to exit copy mode
  const exitCopyMode = useCallback(async () => {
    if (activeSessionId) {
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(activeSessionId)}/copy-mode`);
        if (res.ok) {
          const data = await res.json();
          if (data.inCopyMode) {
            terminalRef.current?.sendInput('q');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }, [activeSessionId]);

  const handleKeyboardSend = useCallback(async (char: string) => {
    await exitCopyMode();
    terminalRef.current?.sendInput(char);
  }, [exitCopyMode]);

  const handleModeSwitch = useCallback(() => {
    setInputMode('input');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Exit copy mode when input is focused
  const handleInputFocus = useCallback(async () => {
    await exitCopyMode();
  }, [exitCopyMode]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (inputValue) {
        terminalRef.current?.sendInput(inputValue);
        setInputValue('');
      }
      terminalRef.current?.sendInput('\r');
    } else if (e.key === 'Backspace' && !inputValue && !e.nativeEvent.isComposing) {
      e.preventDefault();
      terminalRef.current?.sendInput('\x7f');
    } else if (!inputValue && !e.nativeEvent.isComposing) {
      const arrowKeys: Record<string, string> = {
        'ArrowUp': '\x1b[A',
        'ArrowDown': '\x1b[B',
        'ArrowLeft': '\x1b[D',
        'ArrowRight': '\x1b[C',
      };
      if (arrowKeys[e.key]) {
        e.preventDefault();
        terminalRef.current?.sendInput(arrowKeys[e.key]);
      }
    }
  };

  const handleSwitchToKeyboard = useCallback(() => {
    setInputMode('keyboard');
    setInputValue('');
  }, []);

  // File picker handler
  const handleFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // File upload handler
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${API_BASE}/api/upload/image`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok && result.path) {
        terminalRef.current?.sendInput(result.path);
      } else {
        console.error('Upload failed:', result.error);
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
    }
  }, []);

  // URL extract - not implemented for tablet layout yet
  const handleUrlExtract = useCallback(() => {
    // TODO: Implement URL extraction from terminal buffer
    // This requires access to the terminal buffer which is not exposed via ref
    console.log('URL extract not yet implemented for tablet layout');
  }, []);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div ref={containerRef} className="h-screen flex bg-gray-900">
      {/* Left: Terminal */}
      <div className="h-full flex flex-col" style={{ width: `${splitRatio}%` }}>
        {/* Session name header */}
        <div className="flex items-center justify-between px-2 py-1 bg-black/50 border-b border-gray-700 shrink-0">
          <button
            onClick={onShowSessionList}
            className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="セッション一覧"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-white/70 text-xs truncate max-w-[120px]">
            {activeSession?.name || '-'}
          </span>
          <button
            onClick={() => setShowFileViewer(true)}
            className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="ファイルブラウザ"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
          <button
            onClick={onReload}
            className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="リロード"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Terminal */}
        <div className="flex-1 min-h-0">
          {activeSessionId && (
            <TerminalComponent
              key={activeSessionId}
              ref={terminalRef}
              sessionId={activeSessionId}
              hideKeyboard={true}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          )}
        </div>
      </div>

      {/* Draggable separator */}
      <div
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        className={`w-2 h-full cursor-col-resize flex items-center justify-center hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors ${
          isDragging ? 'bg-blue-500/50' : 'bg-gray-700'
        }`}
      >
        <div className="w-0.5 h-8 bg-gray-500 rounded-full" />
      </div>

      {/* Right: Session List + Keyboard */}
      <div className="h-full flex flex-col flex-1">
        {/* Top: Session List */}
        <div className="flex-1 min-h-0 border-b border-gray-700">
          <SessionListMini
            activeSessionId={activeSessionId}
            onSelectSession={onSelectSession}
          />
        </div>

        {/* Bottom: Keyboard */}
        <div className="h-[45%] bg-black shrink-0 flex flex-col">
          {/* Hidden file input */}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileSelect}
          />
          {inputMode === 'keyboard' ? (
            <div className="flex-1 flex items-end justify-end">
              <Keyboard
                onSend={handleKeyboardSend}
                onModeSwitch={handleModeSwitch}
                onFilePicker={handleFilePicker}
                onUrlExtract={handleUrlExtract}
                isUploading={isUploading}
                compact={true}
                className="w-[400px] shrink-0"
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-end p-2">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="text"
                  lang="ja"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onFocus={handleInputFocus}
                  onKeyDown={handleInputKeyDown}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  autoFocus
                  placeholder="日本語入力 - Enterで送信"
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                  style={{ fontSize: '16px' }}
                />
                <button
                  onClick={handleSwitchToKeyboard}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded text-white font-medium"
                >
                  ABC
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* File Viewer Modal */}
      {showFileViewer && activeSession?.currentPath && (
        <FileViewer
          sessionWorkingDir={activeSession.currentPath}
          onClose={() => setShowFileViewer(false)}
        />
      )}
    </div>
  );
}
