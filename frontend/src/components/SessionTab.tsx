import { useRef } from 'react';
import type { SessionState } from '../../../shared/types';

interface SessionTabProps {
  id: string;
  name: string;
  state: SessionState;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onDelete: (id: string) => void;
}

const stateColors: Record<SessionState, string> = {
  idle: 'bg-green-500',
  working: 'bg-yellow-500',
  waiting_input: 'bg-red-500',
  waiting_permission: 'bg-red-500',
  disconnected: 'bg-gray-500',
};

export function SessionTab({ id, name, state, isActive, onSelect, onClose, onDelete }: SessionTabProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const handleClose = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    onClose(id);
  };

  // Long press to delete
  const startLongPress = () => {
    longPressFiredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onDelete(id);
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchStart = () => {
    startLongPress();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left click
    if (e.button !== 0) return;
    startLongPress();
  };

  const handleTouchEnd = () => {
    cancelLongPress();
    // If long press fired, don't trigger select
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
  };

  const handleMouseUp = () => {
    cancelLongPress();
  };

  const handleMouseLeave = () => {
    cancelLongPress();
  };

  const handleTouchCancel = () => {
    cancelLongPress();
    longPressFiredRef.current = false;
  };

  const handleClick = () => {
    // Don't select if long press just fired
    if (!longPressFiredRef.current) {
      onSelect(id);
    }
  };

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      className={`
        flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors
        border-b-2 min-w-0
        ${isActive
          ? 'bg-gray-800 border-blue-500 text-white'
          : 'bg-gray-900 border-transparent text-gray-400 hover:bg-gray-800 hover:text-gray-200'
        }
      `}
    >
      {/* State indicator */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${stateColors[state]}`} />

      {/* Session name */}
      <span className="truncate text-sm">{name}</span>

      {/* Close tab button */}
      <button
        onClick={handleClose}
        onTouchEnd={(e) => e.stopPropagation()}
        className="p-1 rounded hover:bg-gray-700 active:bg-gray-600 text-gray-500 hover:text-gray-300 shrink-0"
        title="タブを閉じる"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
