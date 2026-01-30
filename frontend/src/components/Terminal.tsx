import { useEffect, useRef, useState, memo, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useTerminal } from '../hooks/useTerminal';

const FONT_SIZE_KEY_PREFIX = 'cchub-terminal-font-size-';
const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

const API_BASE = import.meta.env.VITE_API_URL || '';

// Keyboard key definition
interface KeyDef {
  label: string;
  key: string;          // 送信する文字
  shiftKey?: string;    // Shift時の文字
  longKey?: string;     // 長押し時の文字
  longLabel?: string;   // 長押しラベル
  width?: number;       // 相対幅（デフォルト1）
  type?: 'normal' | 'modifier' | 'special';
}

// Full QWERTY keyboard layout (5 rows)
const KEYBOARD_ROWS: KeyDef[][] = [
  // Row 1: ESC, numbers, backspace
  [
    { label: 'ESC', key: '\x1b', width: 1.5, type: 'special' },
    { label: '1', key: '1', shiftKey: '!', longKey: '!', longLabel: '!' },
    { label: '2', key: '2', shiftKey: '@', longKey: '@', longLabel: '@' },
    { label: '3', key: '3', shiftKey: '#', longKey: '#', longLabel: '#' },
    { label: '4', key: '4', shiftKey: '$', longKey: '$', longLabel: '$' },
    { label: '5', key: '5', shiftKey: '%', longKey: '%', longLabel: '%' },
    { label: '6', key: '6', shiftKey: '^', longKey: '^', longLabel: '^' },
    { label: '7', key: '7', shiftKey: '&', longKey: '&', longLabel: '&' },
    { label: '8', key: '8', shiftKey: '*', longKey: '*', longLabel: '*' },
    { label: '9', key: '9', shiftKey: '(', longKey: '(', longLabel: '(' },
    { label: '0', key: '0', shiftKey: ')', longKey: ')', longLabel: ')' },
    { label: '-', key: '-', shiftKey: '_', longKey: '_', longLabel: '_' },
    { label: '=', key: '=', shiftKey: '+', longKey: '+', longLabel: '+' },
    { label: '⌫', key: '\x7f', width: 1.5, type: 'special' },
  ],
  // Row 2: TAB, QWERTY row, brackets, backslash
  [
    { label: 'TAB', key: '\t', width: 1.5, type: 'special' },
    { label: 'q', key: 'q', shiftKey: 'Q' },
    { label: 'w', key: 'w', shiftKey: 'W' },
    { label: 'e', key: 'e', shiftKey: 'E' },
    { label: 'r', key: 'r', shiftKey: 'R' },
    { label: 't', key: 't', shiftKey: 'T' },
    { label: 'y', key: 'y', shiftKey: 'Y' },
    { label: 'u', key: 'u', shiftKey: 'U' },
    { label: 'i', key: 'i', shiftKey: 'I' },
    { label: 'o', key: 'o', shiftKey: 'O' },
    { label: 'p', key: 'p', shiftKey: 'P' },
    { label: '[', key: '[', shiftKey: '{', longKey: '{', longLabel: '{' },
    { label: ']', key: ']', shiftKey: '}', longKey: '}', longLabel: '}' },
    { label: '\\', key: '\\', shiftKey: '|', longKey: '|', longLabel: '|', width: 1.5 },
  ],
  // Row 3: CTRL, ASDF row, semicolon, quote, enter
  [
    { label: 'CTRL', key: 'CTRL', width: 1.75, type: 'modifier' },
    { label: 'a', key: 'a', shiftKey: 'A' },
    { label: 's', key: 's', shiftKey: 'S' },
    { label: 'd', key: 'd', shiftKey: 'D' },
    { label: 'f', key: 'f', shiftKey: 'F' },
    { label: 'g', key: 'g', shiftKey: 'G' },
    { label: 'h', key: 'h', shiftKey: 'H' },
    { label: 'j', key: 'j', shiftKey: 'J' },
    { label: 'k', key: 'k', shiftKey: 'K' },
    { label: 'l', key: 'l', shiftKey: 'L' },
    { label: ';', key: ';', shiftKey: ':', longKey: ':', longLabel: ':' },
    { label: "'", key: "'", shiftKey: '"', longKey: '"', longLabel: '"' },
    { label: '↵', key: '\r', width: 2.25, type: 'special' },
  ],
  // Row 4: SHIFT, ZXCV row, punctuation, arrow up
  [
    { label: 'SHFT', key: 'SHIFT', width: 2, type: 'modifier' },
    { label: 'z', key: 'z', shiftKey: 'Z' },
    { label: 'x', key: 'x', shiftKey: 'X' },
    { label: 'c', key: 'c', shiftKey: 'C' },
    { label: 'v', key: 'v', shiftKey: 'V' },
    { label: 'b', key: 'b', shiftKey: 'B' },
    { label: 'n', key: 'n', shiftKey: 'N' },
    { label: 'm', key: 'm', shiftKey: 'M' },
    { label: ',', key: ',', shiftKey: '<', longKey: '<', longLabel: '<' },
    { label: '.', key: '.', shiftKey: '>', longKey: '>', longLabel: '>' },
    { label: '/', key: '/', shiftKey: '?', longKey: '?', longLabel: '?' },
    { label: '↑', key: '\x1b[A', width: 2, type: 'special' },
  ],
  // Row 5: ALT, space, file picker, URL extract, mode switch, arrows
  [
    { label: 'ALT', key: 'ALT', width: 1.5, type: 'modifier' },
    { label: '`', key: '`', shiftKey: '~', longKey: '~', longLabel: '~' },
    { label: 'SPACE', key: ' ', width: 4, type: 'special' },
    { label: '📁', key: 'FILE_PICKER', width: 1, type: 'special' },
    { label: '🔗', key: 'URL_EXTRACT', width: 1, type: 'special' },
    { label: 'あ', key: 'MODE_SWITCH', width: 1, type: 'special' },
    { label: '←', key: '\x1b[D', type: 'special' },
    { label: '↓', key: '\x1b[B', type: 'special' },
    { label: '→', key: '\x1b[C', type: 'special' },
  ],
];

function loadFontSize(sessionId: string): number {
  const saved = localStorage.getItem(FONT_SIZE_KEY_PREFIX + sessionId);
  if (saved) {
    const size = parseInt(saved, 10);
    if (!isNaN(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
      return size;
    }
  }
  return DEFAULT_FONT_SIZE;
}

function saveFontSize(sessionId: string, size: number): void {
  localStorage.setItem(FONT_SIZE_KEY_PREFIX + sessionId, String(size));
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<(data: string) => void>(() => {});
  const resizeRef = useRef<(cols: number, rows: number) => void>(() => {});
  const closeInputBarRef = useRef<() => void>(() => {});
  const [isInitialized, setIsInitialized] = useState(false);
  const [inputMode, setInputMode] = useState<'hidden' | 'shortcuts' | 'input'>('hidden');
  const [inputValue, setInputValue] = useState('');
  const [fontSize, setFontSize] = useState(() => loadFontSize(sessionId));
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [altPressed, setAltPressed] = useState(false);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [showFontSizeIndicator, setShowFontSizeIndicator] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
  const [showUrlMenu, setShowUrlMenu] = useState(false);
  const [urlPage, setUrlPage] = useState(0);
  const URL_PAGE_SIZE = 5;
  // Detect tablet (larger touch screen)
  const [isTablet, setIsTablet] = useState(() => window.innerWidth >= 640);
  // Keyboard position for tablet
  const [keyboardPosition, setKeyboardPosition] = useState<'left' | 'right'>('right');
  // Show position toggle button (auto-hide after 3 seconds)
  const [showPositionToggle, setShowPositionToggle] = useState(true);
  const positionToggleTimeoutRef = useRef<number | null>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const hintTimeoutRef = useRef<number | null>(null);
  const fontSizeTimeoutRef = useRef<number | null>(null);

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

  // Update tablet detection on resize
  useEffect(() => {
    const handleResize = () => {
      setIsTablet(window.innerWidth >= 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-hide position toggle after 3 seconds
  useEffect(() => {
    if (showPositionToggle && isTablet) {
      if (positionToggleTimeoutRef.current) {
        clearTimeout(positionToggleTimeoutRef.current);
      }
      positionToggleTimeoutRef.current = window.setTimeout(() => {
        setShowPositionToggle(false);
      }, 3000);
    }
    return () => {
      if (positionToggleTimeoutRef.current) {
        clearTimeout(positionToggleTimeoutRef.current);
      }
    };
  }, [showPositionToggle, isTablet, keyboardPosition]);

  // Show position toggle when keyboard position changes
  const handlePositionToggle = () => {
    setKeyboardPosition(p => p === 'right' ? 'left' : 'right');
    setShowPositionToggle(true);
  };

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
    const initialFontSize = loadFontSize(sessionId);
    const term = new Terminal({
      fontSize: initialFontSize,
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

    // Load web links addon for URL detection
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      // Show action menu for URL
      const action = confirm(`URL: ${uri}\n\nコピーしますか？\n(キャンセルでブラウザで開く)`);
      if (action) {
        navigator.clipboard.writeText(uri).then(() => {
          console.log('URL copied:', uri);
        }).catch(console.error);
      } else {
        window.open(uri, '_blank');
      }
    });
    term.loadAddon(webLinksAddon);

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

    // Touch handling on overlay - scroll (1 finger) and pinch zoom (2 fingers)
    const overlay = overlayRef.current;
    let touchStartY: number | null = null;
    let touchMoved = false;
    let accumulatedDelta = 0;
    let scrollRafId: number | null = null;

    // Pinch zoom state
    let initialPinchDistance: number | null = null;
    let initialFontSizeOnPinch: number = initialFontSize;

    const getPinchDistance = (touches: TouchList): number => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch start
        initialPinchDistance = getPinchDistance(e.touches);
        initialFontSizeOnPinch = term.options.fontSize || initialFontSize;
        touchMoved = true; // Prevent keyboard popup
      } else if (e.touches.length === 1) {
        // Scroll start
        touchStartY = e.touches[0].clientY;
        touchMoved = false;
        accumulatedDelta = 0;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Pinch zoom (2 fingers)
      if (e.touches.length === 2 && initialPinchDistance !== null) {
        e.preventDefault();
        touchMoved = true;
        const currentDistance = getPinchDistance(e.touches);
        const scale = currentDistance / initialPinchDistance;
        const newSize = Math.round(initialFontSizeOnPinch * scale);

        if (newSize !== term.options.fontSize) {
          const clampedSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, newSize));
          term.options.fontSize = clampedSize;
          setFontSize(clampedSize);
          fitAddonRef.current?.fit();
          resizeRef.current(term.cols, term.rows);
        }
        return;
      }

      // Scroll (1 finger)
      if (touchStartY === null || e.touches.length !== 1) return;

      const currentY = e.touches[0].clientY;
      const deltaY = touchStartY - currentY;

      // Only start scrolling after moving more than 5px
      if (Math.abs(deltaY) > 5) {
        // Close keyboard when scrolling starts
        if (!touchMoved) {
          closeInputBarRef.current();
        }
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

      // Save font size after pinch zoom
      if (initialPinchDistance !== null) {
        const currentSize = term.options.fontSize || initialFontSize;
        saveFontSize(sessionId, currentSize);
        setFontSize(currentSize);
        initialPinchDistance = null;
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

  // Track visual viewport for soft keyboard offset (mobile fullscreen only)
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateKeyboardOffset = () => {
      // Only apply offset in browser fullscreen mode (not PWA standalone)
      // PWA standalone mode handles viewport automatically
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isBrowserFullscreen = document.fullscreenElement !== null;

      if (isStandalone || !isBrowserFullscreen) {
        setKeyboardOffset(0);
        return;
      }

      // Calculate how much the viewport has shrunk (keyboard height)
      const offset = window.innerHeight - viewport.height;
      setKeyboardOffset(offset > 0 ? offset : 0);
    };

    viewport.addEventListener('resize', updateKeyboardOffset);
    viewport.addEventListener('scroll', updateKeyboardOffset);
    // Initial check
    updateKeyboardOffset();

    return () => {
      viewport.removeEventListener('resize', updateKeyboardOffset);
      viewport.removeEventListener('scroll', updateKeyboardOffset);
    };
  }, []);

  // Show font size indicator when font size changes
  useEffect(() => {
    if (isInitialized) {
      setShowFontSizeIndicator(true);
      if (fontSizeTimeoutRef.current) {
        clearTimeout(fontSizeTimeoutRef.current);
      }
      fontSizeTimeoutRef.current = window.setTimeout(() => {
        setShowFontSizeIndicator(false);
      }, 1500);
    }
    return () => {
      if (fontSizeTimeoutRef.current) {
        clearTimeout(fontSizeTimeoutRef.current);
      }
    };
  }, [fontSize, isInitialized]);

  // Show shortcuts bar
  const handleKeyboardButtonClick = () => {
    setInputMode('shortcuts');
    setCtrlPressed(false);
    setAltPressed(false);
    setShiftPressed(false);
    setShowHint(true);
    // Hide hint after 3 seconds
    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current);
    }
    hintTimeoutRef.current = window.setTimeout(() => {
      setShowHint(false);
    }, 3000);
    // Refit terminal and focus input to show keyboard
    setTimeout(() => {
      fitAddonRef.current?.fit();
      if (terminalRef.current) {
        resizeRef.current(terminalRef.current.cols, terminalRef.current.rows);
      }
      // Focus hidden input to show soft keyboard
      inputRef.current?.focus();
    }, 50);
  };

  // Send keyboard key with modifiers
  const sendKeyPress = (keyDef: KeyDef) => {
    // Handle modifier keys
    if (keyDef.type === 'modifier') {
      if (keyDef.key === 'CTRL') {
        setCtrlPressed(!ctrlPressed);
      } else if (keyDef.key === 'ALT') {
        setAltPressed(!altPressed);
      } else if (keyDef.key === 'SHIFT') {
        setShiftPressed(!shiftPressed);
      }
      return;
    }

    // Determine the character to send
    let char = shiftPressed ? (keyDef.shiftKey || keyDef.key.toUpperCase()) : keyDef.key;

    // Apply Ctrl modifier
    if (ctrlPressed && char.length === 1) {
      const code = char.toLowerCase().charCodeAt(0) - 96;
      if (code > 0 && code < 27) {
        char = String.fromCharCode(code);
      }
      setCtrlPressed(false);
    }

    // Apply Alt modifier (ESC prefix)
    if (altPressed) {
      char = '\x1b' + char;
      setAltPressed(false);
    }

    // Reset shift after use (one-shot)
    if (shiftPressed) {
      setShiftPressed(false);
    }

    sendRef.current(char);
  };

  // Handle long press for alternative characters
  const sendLongPress = (keyDef: KeyDef) => {
    if (keyDef.longKey) {
      sendRef.current(keyDef.longKey);
      // Reset modifiers
      setCtrlPressed(false);
      setAltPressed(false);
      setShiftPressed(false);
    }
  };

  // Handle file selection for image upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be selected again
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
        // Insert the image path at cursor position in terminal
        sendRef.current(result.path);
      } else {
        console.error('Upload failed:', result.error);
        // Show error message in terminal
        sendRef.current(`\r\n[Upload error: ${result.error || 'Unknown error'}]\r\n`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      sendRef.current('\r\n[Upload error: Network error]\r\n');
    } finally {
      setIsUploading(false);
    }
  };

  // Open file picker
  const handleOpenFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Extract URLs from terminal buffer
  const handleExtractUrls = () => {
    const term = terminalRef.current;
    if (!term) return;

    const urls: string[] = [];
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

    // Get visible buffer content
    const buffer = term.buffer.active;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        const text = line.translateToString();
        const matches = text.match(urlRegex);
        if (matches) {
          urls.push(...matches);
        }
      }
    }

    // Remove duplicates and reverse (newest first)
    const uniqueUrls = [...new Set(urls)].reverse();
    setDetectedUrls(uniqueUrls);
    setUrlPage(0);
    setShowUrlMenu(true);
  };

  // Copy URL to clipboard
  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setShowUrlMenu(false);
    }).catch(console.error);
  };

  // Open URL in browser
  const handleOpenUrl = (url: string) => {
    window.open(url, '_blank');
    setShowUrlMenu(false);
  };

  // Handle Enter key in input
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (inputValue) {
        sendRef.current(inputValue);
        setInputValue('');
      }
      sendRef.current('\r');
    } else if (e.key === 'Backspace' && !inputValue && !e.nativeEvent.isComposing) {
      // Send backspace to terminal when input is empty
      e.preventDefault();
      sendRef.current('\x7f');
    } else if (!inputValue && !e.nativeEvent.isComposing) {
      // Send arrow keys to terminal when input is empty
      const arrowKeys: Record<string, string> = {
        'ArrowUp': '\x1b[A',
        'ArrowDown': '\x1b[B',
        'ArrowLeft': '\x1b[D',
        'ArrowRight': '\x1b[C',
      };
      if (arrowKeys[e.key]) {
        e.preventDefault();
        sendRef.current(arrowKeys[e.key]);
      }
    }
  };

  // Close input bar
  const handleCloseInputBar = useCallback(() => {
    setInputMode('hidden');
    setInputValue('');
    setCtrlPressed(false);
    setAltPressed(false);
    setShiftPressed(false);
    // Refit terminal after bar is hidden
    setTimeout(() => {
      fitAddonRef.current?.fit();
      if (terminalRef.current) {
        resizeRef.current(terminalRef.current.cols, terminalRef.current.rows);
      }
    }, 50);
  }, []);

  // Update ref for use in touch handlers
  closeInputBarRef.current = handleCloseInputBar;

  // Swipe handling for input bar
  const inputBarSwipeRef = useRef<{ startX: number; startY: number } | null>(null);

  const handleInputBarTouchStart = (e: React.TouchEvent) => {
    inputBarSwipeRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
    };
  };

  const handleInputBarTouchEnd = (e: React.TouchEvent) => {
    if (!inputBarSwipeRef.current) return;
    const deltaX = e.changedTouches[0].clientX - inputBarSwipeRef.current.startX;
    const deltaY = e.changedTouches[0].clientY - inputBarSwipeRef.current.startY;

    // Horizontal swipe (more horizontal than vertical)
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      // Show hint and reset timer on mode switch
      setShowHint(true);
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
      }
      hintTimeoutRef.current = window.setTimeout(() => {
        setShowHint(false);
      }, 3000);

      if (deltaX > 0) {
        // Swipe right: shortcuts -> input
        if (inputMode === 'shortcuts') {
          setIsAnimating(true);
          setInputMode('input');
          // Focus after animation, then refit terminal when soft keyboard appears
          setTimeout(() => {
            setIsAnimating(false);
            inputRef.current?.focus();
            // Refit after animation completes
            fitTerminal();
            // Refit again after soft keyboard appears
            setTimeout(fitTerminal, 300);
          }, 350);
        }
      } else {
        // Swipe left: input -> shortcuts
        if (inputMode === 'input') {
          setIsAnimating(true);
          setInputMode('shortcuts');
          setInputValue('');
          // Refit after animation and keyboard dismissal
          setTimeout(() => {
            setIsAnimating(false);
            fitTerminal();
          }, 350);
        }
      }
    }
    inputBarSwipeRef.current = null;
  };

  // Long press support for keyboard keys
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  // Keyboard key component for full QWERTY keyboard
  const KeyboardKey = ({ keyDef }: { keyDef: KeyDef }) => {
    const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      longPressFiredRef.current = false;

      if (keyDef.longKey) {
        longPressTimerRef.current = window.setTimeout(() => {
          longPressFiredRef.current = true;
          sendLongPress(keyDef);
        }, 400);
      }
    };

    const handleEnd = (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (!longPressFiredRef.current) {
        sendKeyPress(keyDef);
      }
      longPressFiredRef.current = false;
    };

    const handleCancel = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressFiredRef.current = false;
    };

    // Determine display label based on shift state
    const displayLabel = keyDef.type === 'modifier' || keyDef.type === 'special'
      ? keyDef.label
      : shiftPressed && keyDef.shiftKey
        ? keyDef.shiftKey
        : keyDef.label;

    // Check if this modifier is active
    const isActive = keyDef.type === 'modifier' && (
      (keyDef.key === 'CTRL' && ctrlPressed) ||
      (keyDef.key === 'ALT' && altPressed) ||
      (keyDef.key === 'SHIFT' && shiftPressed)
    );

    const width = keyDef.width || 1;

    return (
      <button
        onMouseDown={handleStart}
        onMouseUp={handleEnd}
        onMouseLeave={handleCancel}
        onTouchStart={handleStart}
        onTouchEnd={handleEnd}
        onTouchCancel={handleCancel}
        className={`
          ${isTablet ? 'py-2 text-sm' : 'py-3 text-base'} text-white font-medium active:bg-gray-600 select-none relative
          border border-gray-700 rounded m-0.5
          ${isActive ? 'bg-blue-600' : 'bg-gray-800'}
          ${keyDef.type === 'modifier' ? 'text-sm' : ''}
        `}
        style={{ flex: width, minWidth: 0 }}
      >
        {displayLabel}
        {keyDef.longLabel && !shiftPressed && (
          <span className={`absolute top-0.5 right-1 ${isTablet ? 'text-[7px]' : 'text-[9px]'} text-gray-500`}>{keyDef.longLabel}</span>
        )}
      </button>
    );
  };

  // Calculate container height based on visual viewport (for mobile keyboard)
  const containerStyle = keyboardOffset > 0
    ? { height: `calc(100% - ${keyboardOffset}px)` }
    : undefined;

  return (
    <div
      className="h-full w-full bg-[#1a1a1a] flex flex-col overflow-hidden"
      style={containerStyle}
    >
      {/* Terminal area - shrinks when input bar is shown */}
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
        {/* Keyboard button for mobile - hidden when input bar is shown */}
        {inputMode === 'hidden' && (
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
        {/* Font size indicator */}
        {showFontSizeIndicator && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-black/70 px-4 py-2 rounded-lg pointer-events-none">
            <span className="text-white text-lg font-medium">{fontSize}px</span>
          </div>
        )}
        {/* URL menu */}
        {showUrlMenu && (() => {
          const totalPages = Math.ceil(detectedUrls.length / URL_PAGE_SIZE);
          const startIdx = urlPage * URL_PAGE_SIZE;
          const pageUrls = detectedUrls.slice(startIdx, startIdx + URL_PAGE_SIZE);
          return (
            <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4">
              <div className="bg-gray-800 rounded-lg w-full max-w-md flex flex-col">
                <div className="flex items-center justify-between p-3 border-b border-gray-700">
                  <span className="text-white font-medium">
                    URL一覧 {detectedUrls.length > 0 && `(${startIdx + 1}-${Math.min(startIdx + URL_PAGE_SIZE, detectedUrls.length)}/${detectedUrls.length})`}
                  </span>
                  <button
                    onClick={() => setShowUrlMenu(false)}
                    className="text-gray-400 hover:text-white text-xl px-2"
                  >
                    ×
                  </button>
                </div>
                <div className="p-2">
                  {detectedUrls.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">URLが見つかりません</p>
                  ) : (
                    pageUrls.map((url, index) => (
                      <div key={startIdx + index} className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded">
                        <span className="flex-1 text-white text-sm truncate">{url}</span>
                        <button
                          onClick={() => handleCopyUrl(url)}
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs"
                        >
                          コピー
                        </button>
                        <button
                          onClick={() => handleOpenUrl(url)}
                          className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-white text-xs"
                        >
                          開く
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 p-3 border-t border-gray-700">
                    <button
                      onClick={() => setUrlPage(p => Math.max(0, p - 1))}
                      disabled={urlPage === 0}
                      className={`px-3 py-1 rounded ${urlPage === 0 ? 'bg-gray-700 text-gray-500' : 'bg-gray-600 text-white hover:bg-gray-500'}`}
                    >
                      ← 前
                    </button>
                    <span className="text-gray-400 text-sm">{urlPage + 1} / {totalPages}</span>
                    <button
                      onClick={() => setUrlPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={urlPage >= totalPages - 1}
                      className={`px-3 py-1 rounded ${urlPage >= totalPages - 1 ? 'bg-gray-700 text-gray-500' : 'bg-gray-600 text-white hover:bg-gray-500'}`}
                    >
                      次 →
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Input bar - pushes terminal up */}
      {inputMode !== 'hidden' && (
        <div
          ref={inputBarRef}
          className="shrink-0 bg-black border-t border-green-500 relative"
          onTouchStart={handleInputBarTouchStart}
          onTouchEnd={handleInputBarTouchEnd}
        >
          {/* Hidden file input for image upload (shared across modes) */}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileSelect}
          />
          {/* Header bar with hint and position toggle */}
          {/* On tablet: hide entire bar after 3 seconds to maximize terminal area */}
          <div
            className={`bg-gray-900 flex justify-between items-center overflow-hidden transition-all duration-300 ${
              isTablet
                ? (showPositionToggle ? 'px-2 py-1' : 'h-0 py-0')
                : 'px-2 py-1'
            }`}
            onClick={() => isTablet && !showPositionToggle && setShowPositionToggle(true)}
          >
            {/* Hint text - only show on mobile or when position toggle is visible */}
            {(!isTablet || showPositionToggle) && (
              <span className="text-xs text-gray-500">
                {showHint && (inputMode === 'shortcuts' ? '「あ」で日本語入力 | スクロールで閉じる' : '「ABC」で英語キーボード | スクロールで閉じる')}
              </span>
            )}
            {isTablet && inputMode === 'shortcuts' && showPositionToggle && (
              <button
                onClick={handlePositionToggle}
                className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded"
              >
                {keyboardPosition === 'right' ? '← 左へ' : '右へ →'}
              </button>
            )}
          </div>

          {/* Tap area to show position toggle when header is hidden */}
          {isTablet && !showPositionToggle && inputMode === 'shortcuts' && (
            <div
              className="h-2 bg-gray-800 flex items-center justify-center"
              onClick={() => setShowPositionToggle(true)}
            >
              <div className="w-8 h-0.5 bg-gray-600 rounded-full" />
            </div>
          )}

          {/* Sliding container for keyboard modes */}
          {isAnimating ? (
            // During animation: render both for slide effect
            <div className="overflow-hidden">
              <div
                className="flex transition-transform duration-300 ease-out"
                style={{ transform: inputMode === 'input' ? 'translateX(-100%)' : 'translateX(0)' }}
              >
                {/* Full QWERTY keyboard mode */}
                <div className={`w-full flex-shrink-0 bg-black px-0.5 pb-1 ${isTablet ? 'flex' : ''} ${isTablet ? (keyboardPosition === 'left' ? 'justify-start' : 'justify-end') : ''}`}>
                  <div className={isTablet ? 'w-1/3 max-w-sm' : 'w-full'}>
                    {KEYBOARD_ROWS.map((row, rowIndex) => (
                      <div key={rowIndex} className="flex">
                        {row.map((keyDef, keyIndex) => (
                          <KeyboardKey key={`${rowIndex}-${keyIndex}`} keyDef={keyDef} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Text input mode */}
                <div className="w-full flex-shrink-0 p-2 bg-black">
                  <input
                    type="text"
                    inputMode="text"
                    lang="ja"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="日本語入力可 - Enterで送信"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                    style={{ fontSize: '16px' }}
                  />
                </div>
              </div>
            </div>
          ) : inputMode === 'shortcuts' ? (
            // Keyboard mode
            <div className={`bg-black px-0.5 pb-1 ${isTablet ? 'flex' : ''} ${isTablet ? (keyboardPosition === 'left' ? 'justify-start' : 'justify-end') : ''}`}>
              {/* Hidden input for English keyboard */}
              <input
                type="text"
                inputMode="none"
                className="absolute opacity-0 w-0 h-0 pointer-events-none"
                tabIndex={-1}
                ref={inputRef}
              />
              <div className={isTablet ? 'w-1/3 max-w-sm' : 'w-full'}>
                {KEYBOARD_ROWS.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex">
                    {row.map((keyDef, keyIndex) => (
                      keyDef.key === 'MODE_SWITCH' ? (
                        // Special "あ" key: just switch to input mode
                        // User will tap input field to show keyboard
                        <button
                          key={`${rowIndex}-${keyIndex}`}
                          onClick={() => {
                            setIsAnimating(true);
                            setInputMode('input');
                            setTimeout(() => {
                              setIsAnimating(false);
                              fitTerminal();
                              setTimeout(fitTerminal, 300);
                            }, 350);
                          }}
                          className={`${isTablet ? 'py-2 text-sm' : 'py-3 text-base'} text-white font-medium bg-gray-800 active:bg-gray-600 select-none border border-gray-700 rounded m-0.5 text-center`}
                          style={{ flex: keyDef.width || 1, minWidth: 0 }}
                        >
                          あ
                        </button>
                      ) : keyDef.key === 'FILE_PICKER' ? (
                        // File picker button
                        <button
                          key={`${rowIndex}-${keyIndex}`}
                          onClick={handleOpenFilePicker}
                          disabled={isUploading}
                          className={`${isTablet ? 'py-2 text-sm' : 'py-3 text-base'} font-medium select-none border border-gray-700 rounded m-0.5 text-center ${
                            isUploading ? 'bg-gray-600 text-gray-400' : 'bg-gray-800 text-white active:bg-gray-600'
                          }`}
                          style={{ flex: keyDef.width || 1, minWidth: 0 }}
                        >
                          {isUploading ? '⏳' : '📁'}
                        </button>
                      ) : keyDef.key === 'URL_EXTRACT' ? (
                        // URL extract button
                        <button
                          key={`${rowIndex}-${keyIndex}`}
                          onClick={handleExtractUrls}
                          className={`${isTablet ? 'py-2 text-sm' : 'py-3 text-base'} font-medium select-none border border-gray-700 rounded m-0.5 text-center bg-gray-800 text-white active:bg-gray-600`}
                          style={{ flex: keyDef.width || 1, minWidth: 0 }}
                        >
                          🔗
                        </button>
                      ) : (
                        <KeyboardKey key={`${rowIndex}-${keyIndex}`} keyDef={keyDef} />
                      )
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // Input mode
            <div className="p-2 bg-black flex gap-2">
              <input
                ref={inputRef}
                type="text"
                inputMode="text"
                lang="ja"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleInputKeyDown}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="send"
                autoFocus
                placeholder="入力欄をタップしてキーボード表示"
                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                style={{ fontSize: '16px' }}
              />
              {/* File picker button */}
              <button
                onClick={handleOpenFilePicker}
                disabled={isUploading}
                className={`px-3 py-2 rounded font-medium ${
                  isUploading
                    ? 'bg-gray-600 text-gray-400'
                    : 'bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white'
                }`}
              >
                {isUploading ? '⏳' : '📁'}
              </button>
              <button
                onClick={() => {
                  setIsAnimating(true);
                  setInputMode('shortcuts');
                  setInputValue('');
                  setTimeout(() => {
                    setIsAnimating(false);
                    fitTerminal();
                  }, 350);
                }}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded text-white font-medium"
              >
                ABC
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
