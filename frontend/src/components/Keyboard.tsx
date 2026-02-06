import { useState, useRef, useCallback } from 'react';

// Keyboard key definition
interface KeyDef {
  label: string;
  key: string;          // Character to send
  shiftKey?: string;    // Character with Shift
  longKey?: string;     // Character on long press
  longLabel?: string;   // Long press label
  width?: number;       // Relative width (default 1)
  type?: 'normal' | 'modifier' | 'special' | 'action' | 'layer';
  color?: 'green' | 'red' | 'blue' | 'default';  // Action button colors
}

// Top action bar for Claude Code specific actions
const ACTION_BAR: KeyDef[] = [
  { label: 'ESC', key: '\x1b', type: 'action' },
  { label: 'TAB', key: '\t', type: 'action' },
  { label: '^C', key: '\x03', type: 'action', color: 'red' },  // Ctrl+C: interrupt
  { label: '^E', key: '\x05', type: 'action' },  // Ctrl+E: end of line
  { label: '^O', key: '\x0f', type: 'action' },  // Ctrl+O
  { label: '📁', key: 'FILE_PICKER', type: 'special' },
  { label: '🔗', key: 'URL_EXTRACT', type: 'special' },
  { label: 'あ', key: 'MODE_SWITCH', type: 'special' },
];

// Main layer: QWERTY with cursors
const MAIN_ROWS: KeyDef[][] = [
  // Row 1: QWERTY top row
  [
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
    { label: '⌫', key: '\x7f', width: 1.5, type: 'special' },
  ],
  // Row 2: ASDF row
  [
    { label: 'a', key: 'a', shiftKey: 'A' },
    { label: 's', key: 's', shiftKey: 'S' },
    { label: 'd', key: 'd', shiftKey: 'D' },
    { label: 'f', key: 'f', shiftKey: 'F' },
    { label: 'g', key: 'g', shiftKey: 'G' },
    { label: 'h', key: 'h', shiftKey: 'H' },
    { label: 'j', key: 'j', shiftKey: 'J' },
    { label: 'k', key: 'k', shiftKey: 'K' },
    { label: 'l', key: 'l', shiftKey: 'L' },
    { label: '↵', key: '\r', width: 1.5, type: 'special' },
  ],
  // Row 3: ZXCV row
  [
    { label: '⇧', key: 'SHIFT', width: 1.5, type: 'modifier' },
    { label: 'z', key: 'z', shiftKey: 'Z' },
    { label: 'x', key: 'x', shiftKey: 'X' },
    { label: 'c', key: 'c', shiftKey: 'C' },
    { label: 'v', key: 'v', shiftKey: 'V' },
    { label: 'b', key: 'b', shiftKey: 'B' },
    { label: 'n', key: 'n', shiftKey: 'N' },
    { label: 'm', key: 'm', shiftKey: 'M' },
    { label: '↑', key: '\x1b[A', type: 'special' },
    { label: '.', key: '.', shiftKey: '>', longKey: '>', longLabel: '>' },
  ],
  // Row 4: Bottom row with cursors
  [
    { label: '123', key: 'LAYER_NUM', width: 1.5, type: 'layer' },
    { label: 'CTRL', key: 'CTRL', type: 'modifier' },
    { label: 'ALT', key: 'ALT', type: 'modifier' },
    { label: '', key: ' ', width: 3, type: 'special' },  // Space bar
    { label: ',', key: ',', shiftKey: '<', longKey: '<', longLabel: '<' },
    { label: '/', key: '/', shiftKey: '?', longKey: '?', longLabel: '?' },
    { label: '←', key: '\x1b[D', type: 'special' },
    { label: '↓', key: '\x1b[B', type: 'special' },
    { label: '→', key: '\x1b[C', type: 'special' },
  ],
];

// Numbers and symbols layer
const NUM_ROWS: KeyDef[][] = [
  // Row 1: Numbers
  [
    { label: '1', key: '1', shiftKey: '!' },
    { label: '2', key: '2', shiftKey: '@' },
    { label: '3', key: '3', shiftKey: '#' },
    { label: '4', key: '4', shiftKey: '$' },
    { label: '5', key: '5', shiftKey: '%' },
    { label: '6', key: '6', shiftKey: '^' },
    { label: '7', key: '7', shiftKey: '&' },
    { label: '8', key: '8', shiftKey: '*' },
    { label: '9', key: '9', shiftKey: '(' },
    { label: '0', key: '0', shiftKey: ')' },
    { label: '⌫', key: '\x7f', width: 1.5, type: 'special' },
  ],
  // Row 2: Symbols
  [
    { label: '-', key: '-', shiftKey: '_' },
    { label: '=', key: '=', shiftKey: '+' },
    { label: '[', key: '[', shiftKey: '{' },
    { label: ']', key: ']', shiftKey: '}' },
    { label: '\\', key: '\\', shiftKey: '|' },
    { label: ';', key: ';', shiftKey: ':' },
    { label: "'", key: "'", shiftKey: '"' },
    { label: '`', key: '`', shiftKey: '~' },
    { label: '↵', key: '\r', width: 1.5, type: 'special' },
  ],
  // Row 3: Shift symbols
  [
    { label: '⇧', key: 'SHIFT', width: 1.5, type: 'modifier' },
    { label: '!', key: '!' },
    { label: '@', key: '@' },
    { label: '#', key: '#' },
    { label: '$', key: '$' },
    { label: '%', key: '%' },
    { label: '^', key: '^' },
    { label: '&', key: '&' },
    { label: '↑', key: '\x1b[A', type: 'special' },
    { label: '*', key: '*' },
  ],
  // Row 4: Bottom with cursors
  [
    { label: 'ABC', key: 'LAYER_MAIN', width: 1.5, type: 'layer' },
    { label: 'CTRL', key: 'CTRL', type: 'modifier' },
    { label: 'ALT', key: 'ALT', type: 'modifier' },
    { label: '', key: ' ', width: 3, type: 'special' },
    { label: '(', key: '(' },
    { label: ')', key: ')' },
    { label: '←', key: '\x1b[D', type: 'special' },
    { label: '↓', key: '\x1b[B', type: 'special' },
    { label: '→', key: '\x1b[C', type: 'special' },
  ],
];

type Layer = 'main' | 'num';

interface KeyboardProps {
  onSend: (char: string) => void;
  onFilePicker?: () => void;
  onUrlExtract?: () => void;
  onModeSwitch?: () => void;
  isUploading?: boolean;
  compact?: boolean;
  className?: string;
}

export function Keyboard({
  onSend,
  onFilePicker,
  onUrlExtract,
  onModeSwitch,
  isUploading = false,
  compact = false,
  className = ''
}: KeyboardProps) {
  const [layer, setLayer] = useState<Layer>('main');
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [altPressed, setAltPressed] = useState(false);
  const [shiftPressed, setShiftPressed] = useState(false);

  // Long press support
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  // Get current keyboard rows based on layer
  const getCurrentRows = (): KeyDef[][] => {
    switch (layer) {
      case 'num': return NUM_ROWS;
      default: return MAIN_ROWS;
    }
  };

  // Send keyboard key with modifiers
  const sendKeyPress = useCallback((keyDef: KeyDef) => {
    // Handle layer switching
    if (keyDef.type === 'layer') {
      if (keyDef.key === 'LAYER_MAIN') setLayer('main');
      else if (keyDef.key === 'LAYER_NUM') setLayer('num');
      return;
    }

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

    // Handle Shift+Enter for multiline input (send backslash + enter)
    if (shiftPressed && keyDef.key === '\r') {
      onSend('\\\r');  // Backslash + Enter for line continuation
      setShiftPressed(false);
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

    onSend(char);
  }, [ctrlPressed, altPressed, shiftPressed, onSend, layer]);

  // Handle long press for alternative characters
  const sendLongPress = useCallback((keyDef: KeyDef) => {
    if (keyDef.longKey) {
      onSend(keyDef.longKey);
      setCtrlPressed(false);
      setAltPressed(false);
      setShiftPressed(false);
    }
  }, [onSend]);

  // Keyboard key component
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
    const displayLabel = keyDef.type === 'modifier' || keyDef.type === 'special' || keyDef.type === 'layer' || keyDef.type === 'action'
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

    // Large icon for Enter key
    const isEnterKey = keyDef.label === '↵';
    const isSpaceKey = keyDef.key === ' ' && keyDef.type === 'special';

    // Get background color
    const getBgColor = () => {
      if (isActive) return 'bg-blue-600';
      if (keyDef.color === 'green') return 'bg-green-700 active:bg-green-600';
      if (keyDef.color === 'red') return 'bg-red-700 active:bg-red-600';
      if (keyDef.color === 'blue') return 'bg-blue-700 active:bg-blue-600';
      if (keyDef.type === 'layer') return 'bg-gray-700';
      return 'bg-gray-800';
    };

    // SVG Enter icon
    const EnterIcon = () => (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={compact ? 'w-5 h-5' : 'w-6 h-6'}
      >
        <polyline points="6,15 3,12 6,9" />
        <path d="M3 12h11V3" />
      </svg>
    );

    return (
      <button
        onMouseDown={handleStart}
        onMouseUp={handleEnd}
        onMouseLeave={handleCancel}
        onTouchStart={handleStart}
        onTouchEnd={handleEnd}
        onTouchCancel={handleCancel}
        onContextMenu={(e) => e.preventDefault()}
        className={`
          ${compact ? 'py-2 text-sm' : 'py-3 text-base'} text-white font-medium active:bg-gray-600 select-none relative
          border border-gray-700 rounded m-0.5 flex items-center justify-center
          ${getBgColor()}
          ${keyDef.type === 'modifier' || keyDef.type === 'layer' ? 'text-xs' : ''}
        `}
        style={{ flex: width, minWidth: 0 }}
      >
        {isEnterKey ? <EnterIcon /> : isSpaceKey ? '' : displayLabel}
        {keyDef.longLabel && !shiftPressed && !isEnterKey && (
          <span className={`absolute top-0.5 right-1 ${compact ? 'text-[7px]' : 'text-[9px]'} text-gray-500`}>{keyDef.longLabel}</span>
        )}
      </button>
    );
  };

  // Action button component
  const ActionButton = ({ keyDef }: { keyDef: KeyDef }) => {
    const handleClick = () => {
      if (keyDef.key === 'FILE_PICKER') {
        onFilePicker?.();
      } else if (keyDef.key === 'URL_EXTRACT') {
        onUrlExtract?.();
      } else if (keyDef.key === 'MODE_SWITCH') {
        onModeSwitch?.();
      } else {
        onSend(keyDef.key);
      }
    };

    const getBgColor = () => {
      if (keyDef.color === 'green') return 'bg-green-700 active:bg-green-600';
      if (keyDef.color === 'red') return 'bg-red-700 active:bg-red-600';
      return 'bg-gray-700 active:bg-gray-600';
    };

    const width = keyDef.width || 1;

    // Handle uploading state for file picker
    if (keyDef.key === 'FILE_PICKER' && isUploading) {
      return (
        <button
          disabled
          className={`${compact ? 'py-1.5 text-xs' : 'py-2 text-sm'} font-medium select-none border border-gray-700 rounded m-0.5 text-center bg-gray-600 text-gray-400`}
          style={{ flex: width, minWidth: 0 }}
          data-onboarding="image-upload"
        >
          ⏳
        </button>
      );
    }

    // Add data-onboarding attributes for special buttons
    const getOnboardingAttr = () => {
      if (keyDef.key === 'FILE_PICKER') return 'image-upload';
      if (keyDef.key === 'URL_EXTRACT') return 'url-extract';
      return undefined;
    };

    return (
      <button
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
        className={`${compact ? 'py-1.5 text-xs' : 'py-2 text-sm'} font-medium select-none border border-gray-700 rounded m-0.5 text-center text-white ${getBgColor()}`}
        style={{ flex: width, minWidth: 0 }}
        data-onboarding={getOnboardingAttr()}
      >
        {keyDef.label}
      </button>
    );
  };

  return (
    <div className={`bg-black px-0.5 pb-1 ${className}`}>
      {/* Action bar */}
      <div className="flex mb-0.5">
        {ACTION_BAR.map((keyDef, index) => (
          <ActionButton key={index} keyDef={keyDef} />
        ))}
      </div>

      {/* Main keyboard */}
      {getCurrentRows().map((row, rowIndex) => (
        <div key={rowIndex} className="flex">
          {row.map((keyDef, keyIndex) => (
            <KeyboardKey key={`${rowIndex}-${keyIndex}`} keyDef={keyDef} />
          ))}
        </div>
      ))}
    </div>
  );
}
