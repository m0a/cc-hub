import { useEffect, useRef, useState, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { useTerminal } from '../hooks/useTerminal';

interface TerminalProps {
  sessionId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onReady?: (send: (data: string) => void) => void;
}

export const TerminalComponent = memo(function TerminalComponent({
  sessionId,
  onConnect,
  onDisconnect,
  onError,
  onReady,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<(data: string) => void>(() => {});
  const resizeRef = useRef<(cols: number, rows: number) => void>(() => {});
  const [isInitialized, setIsInitialized] = useState(false);
  const [showInputArea, setShowInputArea] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // Use refs to avoid recreating callbacks
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  });

  const { isConnected, connect, send, resize } = useTerminal({
    sessionId,
    onData: (data) => {
      terminalRef.current?.write(data);
    },
    onConnect: () => onConnectRef.current?.(),
    onDisconnect: () => onDisconnectRef.current?.(),
    onError: (err) => onErrorRef.current?.(err),
  });

  // Keep refs updated
  useEffect(() => {
    sendRef.current = send;
    resizeRef.current = resize;
  }, [send, resize]);

  // Fit and resize terminal
  const fitTerminal = () => {
    const fit = fitAddonRef.current;
    const term = terminalRef.current;
    if (fit && term) {
      fit.fit();
      resizeRef.current(term.cols, term.rows);
    }
  };

  // Notify parent when ready and trigger resize on connect
  useEffect(() => {
    if (isConnected) {
      onReadyRef.current?.(send);
      // Send initial resize after connection with small delay for layout
      setTimeout(fitTerminal, 100);
    }
  }, [isConnected, send]);

  // Create terminal - run only once per sessionId
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // High-performance terminal configuration
    const term = new Terminal({
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      lineHeight: 1,
      cursorStyle: 'block',
      cursorBlink: false, // Disable cursor blink for performance
      cursorInactiveStyle: 'outline',
      scrollback: 1000, // Reduced scrollback for performance
      smoothScrollDuration: 0, // Disable smooth scroll
      scrollSensitivity: 3,
      allowProposedApi: true,
      minimumContrastRatio: 1, // Disable contrast calculation
      rescaleOverlappingGlyphs: false, // Disable glyph rescaling
      drawBoldTextInBrightColors: false, // Disable bold color transformation
      convertEol: false,
      ignoreBracketedPasteMode: false,
      theme: {
        background: '#1a1a1a',
        foreground: '#efefef',
        cursor: '#efefef',
        cursorAccent: '#1a1a1a',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);

    // Load WebGL addon for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL not available, use default canvas renderer
    }

    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    setIsInitialized(true);

    // Handle keyboard input - register once, use ref for send
    const onDataDisposable = term.onData((data) => {
      sendRef.current(data);
    });

    // Connect to WebSocket
    connect();

    // Handle resize with debounce
    let resizeTimeout: number | null = null;
    const doResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = window.setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
          resizeRef.current(terminalRef.current.cols, terminalRef.current.rows);
        }
      }, 50);
    };

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(doResize);
    resizeObserver.observe(container);

    // Window resize event
    window.addEventListener('resize', doResize);

    // Visual viewport resize (mobile keyboard)
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', doResize);

    // Focus terminal (only on non-touch devices)
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) {
      term.focus();
    }

    // Touch scroll handling on overlay - optimized for performance
    const overlay = overlayRef.current;
    let touchStartY: number | null = null;
    let touchMoved = false;
    let accumulatedDelta = 0;
    let scrollRafId: number | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
      accumulatedDelta = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartY === null) return;

      const currentY = e.touches[0].clientY;
      const deltaY = touchStartY - currentY;

      // Only start scrolling after moving more than 5px
      if (Math.abs(deltaY) > 5) {
        touchMoved = true;
        e.preventDefault();
        touchStartY = currentY;
        accumulatedDelta += deltaY;

        // Throttle with requestAnimationFrame
        if (scrollRafId === null) {
          scrollRafId = requestAnimationFrame(() => {
            scrollRafId = null;
            const lines = Math.round(accumulatedDelta / 30);
            if (lines !== 0) {
              accumulatedDelta = accumulatedDelta % 30; // Keep remainder

              // Scroll xterm
              term.scrollLines(lines);

              // Send single SGR mouse wheel event for tmux
              const button = lines > 0 ? 65 : 64;
              sendRef.current(`\x1b[<${button};1;1M`);
            }
          });
        }
      }
    };

    const handleTouchEnd = () => {
      // Cancel pending scroll
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = null;
      }
      // Only focus if it was a tap (no movement)
      if (!touchMoved) {
        // Focus hidden input to trigger soft keyboard on mobile
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
      touchStartY = null;
      touchMoved = false;
      accumulatedDelta = 0;
    };

    if (overlay) {
      overlay.addEventListener('touchstart', handleTouchStart, { passive: true });
      overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
      overlay.addEventListener('touchend', handleTouchEnd);
    }

    return () => {
      if (overlay) {
        overlay.removeEventListener('touchstart', handleTouchStart);
        overlay.removeEventListener('touchmove', handleTouchMove);
        overlay.removeEventListener('touchend', handleTouchEnd);
      }
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', doResize);
      viewport?.removeEventListener('resize', doResize);
      onDataDisposable.dispose();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Show input area and focus
  const handleKeyboardButtonClick = () => {
    setShowInputArea(true);
    setInputValue('');
    // Focus after state update
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 50);
  };

  // Send input to terminal
  const handleSendInput = () => {
    if (inputValue) {
      sendRef.current(inputValue);
      setInputValue('');
    }
    // Keep input area open for continuous input
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Handle Enter key in input
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSendInput();
      // Also send Enter key to terminal
      sendRef.current('\r');
    }
  };

  // Close input area
  const handleCloseInputArea = () => {
    setShowInputArea(false);
    setInputValue('');
  };

  return (
    <div className="h-full w-full bg-[#1a1a1a] flex flex-col overflow-hidden">
      {/* Terminal area - shrinks when input area is shown */}
      <div className="flex-1 relative min-h-0">
        {/* Terminal container */}
        <div
          ref={containerRef}
          className="absolute inset-0 p-1"
        />
        {/* Touch overlay for scrolling */}
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10"
          style={{ touchAction: 'none' }}
        />
        {/* Keyboard button for mobile - hidden when input area is shown */}
        {!showInputArea && (
          <button
            onClick={handleKeyboardButtonClick}
            className="absolute bottom-4 right-4 z-20 w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center text-white text-2xl transition-colors"
            style={{ touchAction: 'manipulation' }}
            aria-label="Show keyboard"
          >
            ⌨
          </button>
        )}
        {(!isInitialized || !isConnected) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-30">
            <div className="text-white text-lg">
              {!isInitialized ? 'Loading...' : 'Connecting...'}
            </div>
          </div>
        )}
      </div>
      {/* Input area for mobile - pushes terminal up */}
      {showInputArea && (
        <div className="shrink-0 bg-gray-800 border-t border-gray-600 p-2 flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder="入力してEnter..."
            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            style={{ fontSize: '16px' }} // Prevent iOS zoom
          />
          <button
            onClick={handleCloseInputArea}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white transition-colors"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
});
