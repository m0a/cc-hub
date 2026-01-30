import { useState, useRef, useCallback } from 'react';

// Keyboard key definition
interface KeyDef {
  label: string;
  key: string;          // Character to send
  shiftKey?: string;    // Character with Shift
  longKey?: string;     // Character on long press
  longLabel?: string;   // Long press label
  width?: number;       // Relative width (default 1)
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

interface KeyboardProps {
  onSend: (char: string) => void;
  onFilePicker?: () => void;
  onUrlExtract?: () => void;
  onModeSwitch?: () => void;
  isUploading?: boolean;  // Show uploading state on file picker
  compact?: boolean;  // Compact mode for tablet
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
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [altPressed, setAltPressed] = useState(false);
  const [shiftPressed, setShiftPressed] = useState(false);

  // Long press support
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  // Send keyboard key with modifiers
  const sendKeyPress = useCallback((keyDef: KeyDef) => {
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

    onSend(char);
  }, [ctrlPressed, altPressed, shiftPressed, onSend]);

  // Handle long press for alternative characters
  const sendLongPress = useCallback((keyDef: KeyDef) => {
    if (keyDef.longKey) {
      onSend(keyDef.longKey);
      // Reset modifiers
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
          ${compact ? 'py-2 text-sm' : 'py-3 text-base'} text-white font-medium active:bg-gray-600 select-none relative
          border border-gray-700 rounded m-0.5
          ${isActive ? 'bg-blue-600' : 'bg-gray-800'}
          ${keyDef.type === 'modifier' ? 'text-sm' : ''}
        `}
        style={{ flex: width, minWidth: 0 }}
      >
        {displayLabel}
        {keyDef.longLabel && !shiftPressed && (
          <span className={`absolute top-0.5 right-1 ${compact ? 'text-[7px]' : 'text-[9px]'} text-gray-500`}>{keyDef.longLabel}</span>
        )}
      </button>
    );
  };

  return (
    <div className={`bg-black px-0.5 pb-1 ${className}`}>
      {KEYBOARD_ROWS.map((row, rowIndex) => (
        <div key={rowIndex} className="flex">
          {row.map((keyDef, keyIndex) => (
            keyDef.key === 'MODE_SWITCH' ? (
              // Mode switch key
              <button
                key={`${rowIndex}-${keyIndex}`}
                onClick={onModeSwitch}
                className={`${compact ? 'py-2 text-sm' : 'py-3 text-base'} text-white font-medium bg-gray-800 active:bg-gray-600 select-none border border-gray-700 rounded m-0.5 text-center`}
                style={{ flex: keyDef.width || 1, minWidth: 0 }}
              >
                あ
              </button>
            ) : keyDef.key === 'FILE_PICKER' ? (
              // File picker button
              <button
                key={`${rowIndex}-${keyIndex}`}
                onClick={onFilePicker}
                disabled={isUploading}
                className={`${compact ? 'py-2 text-sm' : 'py-3 text-base'} font-medium select-none border border-gray-700 rounded m-0.5 text-center ${
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
                onClick={onUrlExtract}
                className={`${compact ? 'py-2 text-sm' : 'py-3 text-base'} font-medium select-none border border-gray-700 rounded m-0.5 text-center bg-gray-800 text-white active:bg-gray-600`}
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
  );
}
