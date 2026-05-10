import { useEffect, useRef, useState, memo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal as WTermReact, type TerminalHandle } from '@wterm/react';
import { GhosttyCore } from '@wterm/ghostty';
import '@wterm/react/css';
import type { SessionTheme } from '../../../shared/types';
import { filterMouseTrackingInput, filterMouseTrackingOutput } from '../utils/terminal-filters';
import {
  getTerminalThemes,
  DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE,
  loadFontSize, saveFontSize,
} from './terminal-themes';
import type { ControlModeConfig, TerminalRef } from './terminal-types';

// Each WTerm instance needs its own core (it owns terminal state), but
// loading the WASM module from the same URL is cheap thanks to browser cache.
// We surface load errors so the UI can fall back to the built-in Zig core.
type CoreInstance = Awaited<ReturnType<typeof GhosttyCore.load>>;

interface TerminalWtermProps {
  sessionId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onReady?: (send: (data: string) => void) => void;
  hideKeyboard?: boolean;
  overlayContent?: React.ReactNode;
  onOverlayTap?: () => void;
  showOverlay?: boolean;
  theme?: SessionTheme;
  controlMode?: ControlModeConfig;
  hideTerminalArea?: boolean;
  terminalAreaOverlay?: React.ReactNode;
}

export const TerminalWtermComponent = memo(forwardRef<TerminalRef, TerminalWtermProps>(function TerminalWtermComponent({
  sessionId,
  onReady,
  theme: sessionTheme,
  controlMode,
  hideTerminalArea,
  terminalAreaOverlay,
}, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const sendRef = useRef<(data: string) => void>(() => {});
  const [size, setSize] = useState<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  const [fontSize, setFontSize] = useState(() => loadFontSize(sessionId));
  const [isReady, setIsReady] = useState(false);
  // ghostty 0.3.0 has a `spacer tail not following wide` page integrity bug
  // that crashes the WASM core when wide chars (e.g. Japanese) are scrolled
  // through. Stay on the built-in Zig core until upstream fixes it.
  const [ghosttyCore] = useState<CoreInstance | null>(null);
  const [coreState] = useState<'loading' | 'ghostty' | 'zig'>('zig');

  const controlModeRef = useRef(controlMode);
  controlModeRef.current = controlMode;

  const isConnected = controlMode?.isConnected ?? false;

  const send = useCallback((data: string) => {
    const filtered = filterMouseTrackingInput(data);
    if (filtered.length > 0) controlModeRef.current?.sendInput(filtered);
  }, []);

  useEffect(() => { sendRef.current = send; }, [send]);

  useImperativeHandle(ref, () => ({
    sendInput: (char: string) => sendRef.current(char),
    focus: () => handleRef.current?.focus(),
    getSelection: () => window.getSelection()?.toString() ?? '',
    clearSelection: () => window.getSelection()?.removeAllRanges(),
    refreshTerminal: () => controlModeRef.current?.requestContent?.(),
    extractUrls: () => {
      const text = wrapRef.current?.innerText ?? '';
      const urls = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) ?? [];
      return [...new Set(urls)].reverse();
    },
    showKeyboard: () => {},
    hideKeyboard: () => {},
    getCellDimensions: () => {
      const el = wrapRef.current?.querySelector('.wterm') as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || DEFAULT_FONT_SIZE;
      return { width: fs * 0.6, height: fs * 1.2 };
    },
    getSize: () => size,
    getProposedSize: () => size,
    setExactSize: (cols: number, rows: number) => {
      // Under autoResize=true wterm decides cell-precise dimensions itself;
      // only forward when the requested size is sensible. Skip; wterm onResize
      // will propagate back the actual cols/rows it picked.
      if (cols <= 0 || rows <= 0) return;
    },
    scrollToBottom: () => {
      const el = wrapRef.current?.querySelector('.wterm') as HTMLElement | null;
      if (el) el.scrollTop = el.scrollHeight;
    },
    setInputText: () => {},
    changeFontSize: (delta: number) => {
      const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize + delta));
      if (next === fontSize) return next;
      setFontSize(next);
      saveFontSize(sessionId, next);
      return next;
    },
    getFontSize: () => fontSize,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [size, fontSize, sessionId]);

  // Bridge: control-mode output -> wterm
  useEffect(() => {
    const cm = controlModeRef.current;
    if (!cm || !isReady) return;
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const cleanup = cm.registerOnData((data) => {
      const str = decoder.decode(data, { stream: true });
      const filtered = filterMouseTrackingOutput(str);
      if (filtered.length > 0) handleRef.current?.write(filtered);
    });
    return () => {
      decoder.decode(new Uint8Array(0), { stream: false });
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, controlMode?.paneId]);

  // Notify parent when ready
  useEffect(() => {
    if (isConnected && isReady) onReady?.(send);
  }, [isConnected, isReady, onReady, send]);

  // Wheel + touch scroll. wterm has its own scrollback (via overflow-y:auto on
  // .has-scrollback), so prefer native scroll first; only escalate to tmux when
  // the user is already pinned at the top edge.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !isReady) return;
    const wtermEl = wrap.querySelector('.wterm') as HTMLElement | null;
    if (!wtermEl) return;

    const linesFromDelta = (deltaY: number) => Math.max(1, Math.ceil(Math.abs(deltaY) / 40));

    const handleWheel = (e: WheelEvent) => {
      // Native scroll handles the case when wterm has scrollback room.
      const canScrollUp = wtermEl.scrollTop > 0;
      const canScrollDown = wtermEl.scrollTop + wtermEl.clientHeight < wtermEl.scrollHeight - 1;
      if (e.deltaY < 0 && canScrollUp) return;
      if (e.deltaY > 0 && canScrollDown) return;
      // Pinned at the edge — push the request through to tmux scrollback.
      e.preventDefault();
      const lines = linesFromDelta(e.deltaY);
      controlModeRef.current?.onScroll?.(e.deltaY > 0 ? lines : -lines);
    };

    let touchStartY: number | null = null;
    let lastTouchY = 0;
    let accumulated = 0;
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { touchStartY = null; return; }
      touchStartY = e.touches[0].clientY;
      lastTouchY = touchStartY;
      accumulated = 0;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartY === null || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = lastTouchY - y;
      lastTouchY = y;
      accumulated += dy;
      const canScrollUp = wtermEl.scrollTop > 0;
      const canScrollDown = wtermEl.scrollTop + wtermEl.clientHeight < wtermEl.scrollHeight - 1;
      if ((dy < 0 && canScrollUp) || (dy > 0 && canScrollDown)) return; // native handles it
      e.preventDefault();
      const cellH = parseFloat(getComputedStyle(wtermEl).getPropertyValue('--term-row-height')) || Math.round(fontSize * 1.2);
      const lines = Math.trunc(accumulated / cellH);
      if (lines !== 0) {
        accumulated -= lines * cellH;
        controlModeRef.current?.onScroll?.(lines);
      }
    };
    const handleTouchEnd = () => { touchStartY = null; };

    wrap.addEventListener('wheel', handleWheel, { passive: false });
    wrap.addEventListener('touchstart', handleTouchStart, { passive: true });
    wrap.addEventListener('touchmove', handleTouchMove, { passive: false });
    wrap.addEventListener('touchend', handleTouchEnd);
    return () => {
      wrap.removeEventListener('wheel', handleWheel);
      wrap.removeEventListener('touchstart', handleTouchStart);
      wrap.removeEventListener('touchmove', handleTouchMove);
      wrap.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isReady, fontSize]);

  const themeColors = getTerminalThemes()[sessionTheme || 'default'];
  const containerStyle: React.CSSProperties = {
    backgroundColor: themeColors.background,
  };

  // Inject session theme overrides into wterm CSS variables.
  // Match xterm.tsx font stack. Don't set `overflow` here — wterm toggles
  // `.has-scrollback` to switch overflow-y between hidden/auto for scrollback.
  const wtermStyle: React.CSSProperties = {
    ['--term-bg' as any]: themeColors.background,
    ['--term-fg' as any]: themeColors.foreground,
    ['--term-cursor' as any]: themeColors.foreground,
    ['--term-font-family' as any]: '"JetBrains Mono", "M PLUS 1 Code", Menlo, Monaco, monospace',
    ['--term-font-size' as any]: `${fontSize}px`,
    ['--term-line-height' as any]: '1.2',
    ['--term-row-height' as any]: `${Math.round(fontSize * 1.2)}px`,
    width: '100%',
    height: '100%',
    boxShadow: 'none',
    borderRadius: 0,
    padding: 4,
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={containerStyle}>
      <div className="flex-1 relative min-h-0">
        <div
          ref={wrapRef}
          className={`absolute inset-0${hideTerminalArea ? ' invisible pointer-events-none' : ''}`}
          style={{ overflow: 'hidden' }}
        >
          {(
            <WTermReact
              ref={(h: TerminalHandle | null) => { handleRef.current = h; }}
              core={ghosttyCore ?? undefined}
              cols={size.cols}
              rows={size.rows}
              autoResize={true}
              cursorBlink={false}
              onData={(d: string) => sendRef.current(d)}
              onResize={(c: number, r: number) => {
                setSize({ cols: c, rows: r });
                controlModeRef.current?.onResize?.(c, r);
              }}
              onReady={() => setIsReady(true)}
              onError={(err: unknown) => console.error('[wterm] init error:', err)}
              style={wtermStyle}
            />
          )}
        </div>
        {terminalAreaOverlay && (
          <div
            className="absolute inset-0 z-20 bg-[#0a0a0a]"
            style={{ display: hideTerminalArea ? 'block' : 'none' }}
          >
            {terminalAreaOverlay}
          </div>
        )}
        {(!isReady || !isConnected) && (
          <div className="absolute top-2 left-2 z-30 pointer-events-none">
            <div className="flex items-center gap-2 bg-yellow-900/80 text-yellow-200 text-xs px-2.5 py-1 rounded-lg shadow">
              <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
              {!isReady ? 'Loading wterm…' : 'Connecting…'}
            </div>
          </div>
        )}
        <div className="absolute top-2 right-2 z-30 pointer-events-none">
          <div className="bg-purple-900/80 text-purple-200 text-[10px] px-2 py-0.5 rounded font-mono">
            wterm v0.3 · {coreState}
          </div>
        </div>
      </div>
    </div>
  );
}));

export default TerminalWtermComponent;
