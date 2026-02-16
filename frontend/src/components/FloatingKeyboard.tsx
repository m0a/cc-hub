import { useRef, useCallback, useState, useEffect } from 'react';
import { Keyboard } from './Keyboard';

const POSITION_KEY_KEYBOARD = 'cchub-floating-keyboard-position-keyboard-v2';
const POSITION_KEY_INPUT = 'cchub-floating-keyboard-position-input-v2';
const MINIMIZED_KEY = 'cchub-floating-keyboard-minimized';
const TRANSPARENT_KEY = 'cchub-floating-keyboard-transparent';

const getPositionKey = (mode: 'keyboard' | 'input') =>
  mode === 'keyboard' ? POSITION_KEY_KEYBOARD : POSITION_KEY_INPUT;

// Clean up old position keys
const cleanupOldKeys = () => {
  try {
    localStorage.removeItem('cchub-floating-keyboard-position');
    localStorage.removeItem('cchub-floating-keyboard-position-keyboard');
    localStorage.removeItem('cchub-floating-keyboard-position-input');
  } catch {}
};
cleanupOldKeys();

interface Position {
  x: number;
  y: number;
}

const getDefaultPosition = (): Position => ({
  x: window.innerWidth / 2 - 200,
  y: window.innerHeight - 300,
});

interface FloatingKeyboardProps {
  visible: boolean;
  onClose: () => void;
  onSend: (char: string) => void;
  onFilePicker?: () => void;
  onUrlExtract?: () => void;
  isUploading?: boolean;
  elevated?: boolean; // Raise z-index above onboarding overlay
}

export function FloatingKeyboard({
  visible,
  onClose,
  onSend,
  onFilePicker,
  onUrlExtract,
  isUploading = false,
  elevated = false,
}: FloatingKeyboardProps) {
  const [inputMode, setInputMode] = useState<'keyboard' | 'input'>('keyboard');
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Helper to load position for a mode
  const loadPositionForMode = useCallback((mode: 'keyboard' | 'input'): Position => {
    try {
      const saved = localStorage.getItem(getPositionKey(mode));
      if (saved) return JSON.parse(saved);
    } catch {}
    return getDefaultPosition();
  }, []);

  // Position state
  const [position, setPosition] = useState<Position>(() => loadPositionForMode('keyboard'));

  // Minimized state
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem(MINIMIZED_KEY) === 'true';
    } catch {}
    return false;
  });

  // Transparent state
  const [transparent, setTransparent] = useState(() => {
    try {
      return localStorage.getItem(TRANSPARENT_KEY) === 'true';
    } catch {}
    return false;
  });

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef<Position>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Save position to localStorage (mode-specific)
  useEffect(() => {
    localStorage.setItem(getPositionKey(inputMode), JSON.stringify(position));
  }, [position, inputMode]);

  // Save minimized state to localStorage
  useEffect(() => {
    localStorage.setItem(MINIMIZED_KEY, String(minimized));
  }, [minimized]);

  // Save transparent state to localStorage
  useEffect(() => {
    localStorage.setItem(TRANSPARENT_KEY, String(transparent));
  }, [transparent]);

  // Drag start handler
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    dragOffset.current = {
      x: clientX - position.x,
      y: clientY - position.y,
    };
    setIsDragging(true);
  }, [position]);

  // Drag move/end handlers
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const newX = clientX - dragOffset.current.x;
      const newY = clientY - dragOffset.current.y;

      // Clamp to viewport
      const maxX = window.innerWidth - (containerRef.current?.offsetWidth || 400);
      const maxY = window.innerHeight - (containerRef.current?.offsetHeight || 200);

      setPosition({
        x: Math.max(0, Math.min(maxX, newX)),
        y: Math.max(0, Math.min(maxY, newY)),
      });
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

  // Mode switch handler (keyboard -> input)
  const handleModeSwitch = useCallback(() => {
    // Save current position for keyboard mode, then load input mode position
    localStorage.setItem(getPositionKey('keyboard'), JSON.stringify(position));
    const newPosition = loadPositionForMode('input');
    setPosition(newPosition);
    setInputMode('input');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [position, loadPositionForMode]);

  // Mode switch handler (input -> keyboard)
  const handleSwitchToKeyboard = useCallback(() => {
    // Save current position for input mode, then load keyboard mode position
    localStorage.setItem(getPositionKey('input'), JSON.stringify(position));
    const newPosition = loadPositionForMode('keyboard');
    setPosition(newPosition);
    setInputMode('keyboard');
    setInputValue('');
  }, [position, loadPositionForMode]);

  // Input key handler
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (inputValue) {
        onSend(inputValue);
        setInputValue('');
      }
      onSend('\r');
    } else if (e.key === 'Backspace' && !inputValue && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend('\x7f');
    } else if (!inputValue && !e.nativeEvent.isComposing) {
      const arrowKeys: Record<string, string> = {
        'ArrowUp': '\x1b[A',
        'ArrowDown': '\x1b[B',
        'ArrowLeft': '\x1b[D',
        'ArrowRight': '\x1b[C',
      };
      if (arrowKeys[e.key]) {
        e.preventDefault();
        onSend(arrowKeys[e.key]);
      }
    }
  };

  // Toggle minimized
  const toggleMinimize = useCallback(() => {
    setMinimized(prev => !prev);
  }, []);

  // Toggle transparent
  const toggleTransparent = useCallback(() => {
    setTransparent(prev => !prev);
  }, []);

  if (!visible) return null;

  // Minimized mini keyboard with arrow up/down and enter
  if (minimized) {
    const miniKeyClass = "p-3 text-white hover:bg-gray-700 active:bg-gray-600 transition-colors select-none";
    return (
      <div
        ref={containerRef}
        className={`fixed ${elevated ? 'z-[10002]' : 'z-[60]'}`}
        style={{ left: position.x, top: position.y }}
      >
        <div
          className="flex items-center bg-gray-800 border border-gray-600 rounded-lg shadow-lg cursor-move"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          {/* Drag handle + Expand */}
          <div className="flex items-center rounded-l-lg">
            <div className="flex items-center gap-0.5 px-2 py-3">
              <div className="w-1 h-4 bg-gray-500 rounded-full" />
              <div className="w-1 h-4 bg-gray-500 rounded-full" />
            </div>
            <button
              onClick={toggleMinimize}
              className={`${miniKeyClass} rounded-l-lg`}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
          {/* Divider */}
          <div className="w-px h-6 bg-gray-600" />
          {/* Arrow Up */}
          <button
            onClick={() => onSend('\x1b[A')}
            className={miniKeyClass}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          {/* Arrow Down */}
          <button
            onClick={() => onSend('\x1b[B')}
            className={miniKeyClass}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {/* Enter */}
          <button
            onClick={() => onSend('\r')}
            className={miniKeyClass}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6,15 3,12 6,9" />
              <path d="M3 12h11V3" />
            </svg>
          </button>
          {/* Divider */}
          <div className="w-px h-6 bg-gray-600" />
          {/* Close */}
          <button
            onClick={onClose}
            className={`${miniKeyClass} text-gray-400 hover:text-white rounded-r-lg`}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Expanded keyboard
  return (
    <div
      ref={containerRef}
      className={`fixed ${elevated ? 'z-[10002]' : 'z-[60]'} ${transparent ? '' : 'bg-gray-900'} border border-gray-700 rounded-lg shadow-2xl overflow-hidden`}
      style={{
        left: position.x,
        top: position.y,
        width: 420,
        backgroundColor: transparent ? 'rgba(17, 24, 39, 0.18)' : undefined,
        backdropFilter: transparent ? 'blur(1px)' : undefined,
        WebkitBackdropFilter: transparent ? 'blur(1px)' : undefined,
      }}
    >
      {/* Header - drag handle */}
      <div
        className={`flex items-center justify-between px-2 py-1.5 ${transparent ? 'bg-transparent' : isDragging ? 'bg-gray-700' : 'bg-gray-800'} border-b border-gray-700 cursor-move select-none`}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <div className="w-1 h-4 bg-gray-600 rounded-full" />
            <div className="w-1 h-4 bg-gray-600 rounded-full" />
          </div>
          <span className="text-xs text-gray-400">Keyboard</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Transparent toggle */}
          <button
            onClick={toggleTransparent}
            className={`p-2 ${transparent ? 'text-blue-400' : 'text-gray-400'} hover:text-white hover:bg-gray-600 rounded transition-colors`}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {transparent ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" />
              )}
            </svg>
          </button>
          <button
            onClick={toggleMinimize}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={transparent ? 'bg-transparent' : 'bg-black'}>
        {inputMode === 'keyboard' ? (
          <Keyboard
            onSend={onSend}
            onModeSwitch={handleModeSwitch}
            onFilePicker={onFilePicker}
            onUrlExtract={onUrlExtract}
            isUploading={isUploading}
            compact={true}
            transparent={transparent}
          />
        ) : (
          <div className="p-2">
            <div className="flex gap-2">
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
  );
}
