import { useRef, useCallback, useState, useEffect } from 'react';
import { TerminalComponent, type TerminalRef } from './Terminal';
import type { SessionState } from '../../../shared/types';

// ペインノード型定義
export type PaneNode =
  | { type: 'terminal'; sessionId: string | null; id: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: PaneNode[]; ratio: number[]; id: string };

interface PaneContainerProps {
  node: PaneNode;
  activePane: string;
  onFocusPane: (paneId: string) => void;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onSessionStateChange: (sessionId: string, state: SessionState) => void;
  onSplitRatioChange: (nodeId: string, ratio: number[]) => void;
  sessions: { id: string; name: string; state: SessionState; currentPath?: string }[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
}

export function PaneContainer({
  node,
  activePane,
  onFocusPane,
  onSelectSession,
  onSessionStateChange,
  onSplitRatioChange,
  sessions,
  terminalRefs,
}: PaneContainerProps) {
  if (node.type === 'terminal') {
    return (
      <TerminalPane
        paneId={node.id}
        sessionId={node.sessionId}
        isActive={activePane === node.id}
        onFocus={() => onFocusPane(node.id)}
        onSelectSession={(sessionId) => onSelectSession(node.id, sessionId)}
        onSessionStateChange={onSessionStateChange}
        sessions={sessions}
        terminalRefs={terminalRefs}
      />
    );
  }

  // Split node
  return (
    <SplitContainer
      node={node}
      activePane={activePane}
      onFocusPane={onFocusPane}
      onSelectSession={onSelectSession}
      onSessionStateChange={onSessionStateChange}
      onSplitRatioChange={onSplitRatioChange}
      sessions={sessions}
      terminalRefs={terminalRefs}
    />
  );
}

interface TerminalPaneProps {
  paneId: string;
  sessionId: string | null;
  isActive: boolean;
  onFocus: () => void;
  onSelectSession: (sessionId?: string) => void;
  onSessionStateChange: (sessionId: string, state: SessionState) => void;
  sessions: { id: string; name: string; state: SessionState; currentPath?: string }[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
}

function TerminalPane({
  paneId,
  sessionId,
  isActive,
  onFocus,
  onSelectSession,
  onSessionStateChange,
  sessions,
  terminalRefs,
}: TerminalPaneProps) {
  const terminalRef = useRef<TerminalRef>(null);

  // Register terminal ref
  useEffect(() => {
    if (sessionId && terminalRef.current) {
      terminalRefs.current.set(paneId, terminalRef.current);
    }
    return () => {
      terminalRefs.current.delete(paneId);
    };
  }, [paneId, sessionId, terminalRefs]);

  const handleConnect = useCallback(() => {
    if (sessionId) {
      onSessionStateChange(sessionId, 'idle');
    }
  }, [sessionId, onSessionStateChange]);

  const handleDisconnect = useCallback(() => {
    if (sessionId) {
      onSessionStateChange(sessionId, 'disconnected');
    }
  }, [sessionId, onSessionStateChange]);

  const session = sessionId ? sessions.find(s => s.id === sessionId) : null;

  return (
    <div
      className={`h-full flex flex-col bg-gray-900 ${isActive ? 'ring-2 ring-blue-500' : ''}`}
      onClick={onFocus}
    >
      {/* Pane header */}
      <div className="flex items-center justify-between px-2 py-1 bg-black/50 border-b border-gray-700 shrink-0 text-xs">
        <span className="text-white/70 truncate max-w-[200px]">
          {session?.name || 'セッション未選択'}
        </span>
        {sessionId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectSession();
            }}
            className="p-0.5 text-white/50 hover:text-white/80 transition-colors"
            title="セッション変更"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </button>
        )}
      </div>

      {/* Terminal or session selector */}
      <div className="flex-1 min-h-0">
        {sessionId ? (
          <TerminalComponent
            key={sessionId}
            ref={terminalRef}
            sessionId={sessionId}
            hideKeyboard={true}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        ) : (
          <SessionSelector
            sessions={sessions}
            onSelect={(session) => {
              // Directly set session ID via callback
              onSelectSession(session.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

interface SessionSelectorProps {
  sessions: { id: string; name: string; state: SessionState; currentPath?: string }[];
  onSelect: (session: { id: string; name: string; state: SessionState; currentPath?: string }) => void;
}

function SessionSelector({ sessions, onSelect }: SessionSelectorProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-gray-900 p-4">
      <p className="text-gray-400 mb-4">セッションを選択してください</p>
      <div className="max-h-64 overflow-y-auto w-full max-w-xs space-y-2">
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session)}
            className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-white text-sm transition-colors"
          >
            <div className="font-medium truncate">{session.name}</div>
            {session.currentPath && (
              <div className="text-xs text-gray-400 truncate">
                {session.currentPath.replace(/^\/home\/[^/]+\//, '~/')}
              </div>
            )}
          </button>
        ))}
        {sessions.length === 0 && (
          <p className="text-gray-500 text-sm text-center">セッションがありません</p>
        )}
      </div>
    </div>
  );
}

interface SplitContainerProps {
  node: Extract<PaneNode, { type: 'split' }>;
  activePane: string;
  onFocusPane: (paneId: string) => void;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onSessionStateChange: (sessionId: string, state: SessionState) => void;
  onSplitRatioChange: (nodeId: string, ratio: number[]) => void;
  sessions: { id: string; name: string; state: SessionState; currentPath?: string }[];
  terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
}

function SplitContainer({
  node,
  activePane,
  onFocusPane,
  onSelectSession,
  onSessionStateChange,
  onSplitRatioChange,
  sessions,
  terminalRefs,
}: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(index);
  }, []);

  useEffect(() => {
    if (isDragging === null) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientPos = 'touches' in e
        ? (node.direction === 'horizontal' ? e.touches[0].clientX : e.touches[0].clientY)
        : (node.direction === 'horizontal' ? e.clientX : e.clientY);

      const containerSize = node.direction === 'horizontal' ? rect.width : rect.height;
      const offset = node.direction === 'horizontal' ? rect.left : rect.top;

      // Calculate new ratios
      const newRatio = [...node.ratio];
      const beforeSum = node.ratio.slice(0, isDragging + 1).reduce((a, b) => a + b, 0);
      const afterSum = node.ratio.slice(isDragging + 1).reduce((a, b) => a + b, 0);

      const position = ((clientPos - offset) / containerSize) * 100;
      const minRatio = 10; // 10% minimum

      // Adjust ratio at drag point
      const newBefore = Math.max(minRatio, Math.min(beforeSum + afterSum - minRatio, position));
      const diff = newBefore - beforeSum;

      if (newRatio[isDragging] !== undefined && newRatio[isDragging + 1] !== undefined) {
        newRatio[isDragging] = newRatio[isDragging] + diff;
        newRatio[isDragging + 1] = newRatio[isDragging + 1] - diff;

        // Clamp values
        if (newRatio[isDragging] >= minRatio && newRatio[isDragging + 1] >= minRatio) {
          onSplitRatioChange(node.id, newRatio);
        }
      }
    };

    const handleEnd = () => {
      setIsDragging(null);
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
  }, [isDragging, node, onSplitRatioChange]);

  const isHorizontal = node.direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`h-full w-full flex ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      {node.children.map((child, index) => (
        <div key={child.id} className="contents">
          {/* Child pane */}
          <div
            style={{
              [isHorizontal ? 'width' : 'height']: `${node.ratio[index]}%`,
              [isHorizontal ? 'height' : 'width']: '100%',
            }}
            className="flex-shrink-0"
          >
            <PaneContainer
              node={child}
              activePane={activePane}
              onFocusPane={onFocusPane}
              onSelectSession={onSelectSession}
              onSessionStateChange={onSessionStateChange}
              onSplitRatioChange={onSplitRatioChange}
              sessions={sessions}
              terminalRefs={terminalRefs}
            />
          </div>

          {/* Divider (not after last child) */}
          {index < node.children.length - 1 && (
            <div
              onMouseDown={handleDragStart(index)}
              onTouchStart={handleDragStart(index)}
              className={`
                ${isHorizontal ? 'w-1 h-full cursor-col-resize' : 'h-1 w-full cursor-row-resize'}
                flex items-center justify-center bg-gray-700 hover:bg-blue-500/50 transition-colors flex-shrink-0
                ${isDragging === index ? 'bg-blue-500/70' : ''}
              `}
            >
              <div className={`
                ${isHorizontal ? 'w-0.5 h-6' : 'h-0.5 w-6'}
                bg-gray-500 rounded-full
              `} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
