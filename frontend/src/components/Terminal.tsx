import { useEffect, useRef, useCallback, useState } from 'react';
import { init, Terminal, FitAddon } from 'ghostty-web';
import { useTerminal } from '../hooks/useTerminal';

interface TerminalProps {
  sessionId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onReady?: (send: (data: string) => void) => void;
}

export function TerminalComponent({ sessionId, onConnect, onDisconnect, onError, onReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const composingRef = useRef(false);
  const sendRef = useRef<(data: string | Uint8Array) => void>(() => {});

  const handleData = useCallback((data: Uint8Array) => {
    if (terminalRef.current) {
      terminalRef.current.write(data);

      // Check for terminal responses (e.g., cursor position reports, device attributes)
      // These need to be sent back to the PTY
      if (terminalRef.current.wasmTerm?.hasResponse()) {
        const response = terminalRef.current.wasmTerm.readResponse();
        if (response) {
          const hex = Array.from(new TextEncoder().encode(response)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          console.log(`[Ghostty] Terminal response: (${hex})`);
          sendRef.current(response);
        }
      }
    }
  }, []);

  const { isConnected, connect, send, resize } = useTerminal({
    sessionId,
    onData: handleData,
    onConnect,
    onDisconnect,
    onError,
  });

  // Keep sendRef updated and notify parent when ready
  useEffect(() => {
    sendRef.current = send;
    if (isConnected && onReady) {
      onReady(send);
    }
  }, [send, isConnected, onReady]);

  // Initialize ghostty-web WASM module
  useEffect(() => {
    let cancelled = false;

    init().then(() => {
      if (!cancelled) {
        setIsInitialized(true);
        console.log('[Ghostty] WASM initialized');
      }
    }).catch((err) => {
      console.error('[Ghostty] Failed to initialize WASM:', err);
      onError?.('Failed to initialize terminal');
    });

    return () => {
      cancelled = true;
    };
  }, [onError]);

  // Handle input from hidden textarea (mobile keyboard)
  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;

    const textarea = e.currentTarget;
    const value = textarea.value;

    if (value) {
      const hex = Array.from(new TextEncoder().encode(value)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`[Input] Sending: "${value}" (${hex})`);
      send(value);
      textarea.value = '';
    }
  }, [send]);

  // Handle keydown for special keys (Enter, Backspace, etc.)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    console.log(`[Input] KeyDown: key="${e.key}" code="${e.code}" composing=${composingRef.current}`);

    if (composingRef.current) return;

    const textarea = e.currentTarget;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        console.log('[Input] Sending Enter (0x0d)');
        send('\r');
        textarea.value = '';
        break;
      case 'Backspace':
        e.preventDefault();
        console.log('[Input] Sending Backspace (0x7f)');
        send('\x7f');
        textarea.value = '';
        break;
      case 'Tab':
        e.preventDefault();
        console.log('[Input] Sending Tab (0x09)');
        send('\t');
        break;
      case 'Escape':
        e.preventDefault();
        console.log('[Input] Sending Escape (0x1b)');
        send('\x1b');
        break;
      case 'ArrowUp':
        e.preventDefault();
        console.log('[Input] Sending Arrow Up');
        send('\x1b[A');
        break;
      case 'ArrowDown':
        e.preventDefault();
        console.log('[Input] Sending Arrow Down');
        send('\x1b[B');
        break;
      case 'ArrowRight':
        e.preventDefault();
        console.log('[Input] Sending Arrow Right');
        send('\x1b[C');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        console.log('[Input] Sending Arrow Left');
        send('\x1b[D');
        break;
      default:
        // For regular characters, let the input event handle it
        // But send immediately if it's a single character without modifiers
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          const hex = e.key.charCodeAt(0).toString(16).padStart(2, '0');
          console.log(`[Input] Sending char: "${e.key}" (${hex})`);
          send(e.key);
          textarea.value = '';
        } else if (e.ctrlKey && e.key.length === 1) {
          // Handle Ctrl+key combinations
          e.preventDefault();
          const charCode = e.key.toUpperCase().charCodeAt(0) - 64;
          if (charCode >= 0 && charCode <= 31) {
            console.log(`[Input] Sending Ctrl+${e.key} (0x${charCode.toString(16).padStart(2, '0')})`);
            send(String.fromCharCode(charCode));
          }
        }
        break;
    }
  }, [send]);

  // Handle composition (for IME input like Japanese)
  const handleCompositionStart = useCallback(() => {
    console.log('[Input] Composition start');
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    console.log(`[Input] Composition end: "${e.data}"`);
    composingRef.current = false;

    // Send the composed text
    if (e.data) {
      const hex = Array.from(new TextEncoder().encode(e.data)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`[Input] Sending composed: "${e.data}" (${hex})`);
      send(e.data);
    }

    // Clear the textarea
    const textarea = e.currentTarget;
    textarea.value = '';
  }, [send]);

  // Focus the hidden input
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Touch scroll handling - use native event for preventDefault
  const touchStartY = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Blur any focused element to prevent keyboard
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (touchStartY.current === null || !terminalRef.current) return;

      const deltaY = touchStartY.current - e.touches[0].clientY;
      touchStartY.current = e.touches[0].clientY;

      // Scroll the terminal - positive delta = scroll up (show older content)
      const lines = Math.round(deltaY / 15); // ~15px per line
      if (lines !== 0 && terminalRef.current.scrollLines) {
        terminalRef.current.scrollLines(lines);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      touchStartY.current = null;
    };

    const handleWheel = (e: WheelEvent) => {
      if (!terminalRef.current) return;
      e.preventDefault();
      const lines = Math.round(e.deltaY / 30);
      if (lines !== 0) {
        terminalRef.current.scrollLines(lines);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [focusInput]);

  // Create terminal after WASM is initialized
  useEffect(() => {
    if (!isInitialized || !containerRef.current) return;

    const container = containerRef.current;

    const term = new Terminal({
      fontSize: 10,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 10000,
      smoothScrollDuration: 0,
      theme: {
        background: '#1a1a1a',
        foreground: '#efefef',
        cursor: '#efefef',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Note: We don't use term.onData for input anymore
    // Input is handled by the hidden textarea for better mobile support

    // Connect to WebSocket
    connect();

    // Handle resize - debounce
    let resizeTimeout: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = window.setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
          const cols = terminalRef.current.cols;
          const rows = terminalRef.current.rows;
          console.log(`[Ghostty] Resize: ${cols}x${rows}`);
          resize(cols, rows);
        }
      }, 100);
    });

    resizeObserver.observe(container);

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isInitialized, sessionId, connect, resize]);

  return (
    <div className="terminal-container h-full w-full bg-[#1a1a1a] flex flex-col relative">
      {/* Hidden textarea for keyboard input */}
      <textarea
        ref={inputRef}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />

      {/* Input button - tap to show keyboard (TOP for visibility) */}
      <button
        type="button"
        className="h-12 border-b-2 border-blue-500 bg-blue-900 px-4 text-left w-full flex-shrink-0"
        onClick={focusInput}
      >
        <span className="text-white text-base font-medium">⌨️ タップして入力...</span>
      </button>

      {/* Terminal display area */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* Actual terminal container */}
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ padding: '4px', pointerEvents: 'none' }}
        />
        {/* Touch overlay - captures all touch events */}
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 touch-none"
          style={{ zIndex: 10 }}
        />
      </div>

      {(!isInitialized || !isConnected) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-white text-lg">
            {!isInitialized ? 'Loading terminal...' : 'Connecting to terminal...'}
          </div>
        </div>
      )}
    </div>
  );
}
