import type { SessionState } from '../../../shared/types';

interface SessionTabProps {
  id: string;
  name: string;
  state: SessionState;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

const stateColors: Record<SessionState, string> = {
  idle: 'bg-green-500',
  working: 'bg-yellow-500',
  waiting_input: 'bg-red-500',
  waiting_permission: 'bg-red-500',
  disconnected: 'bg-gray-500',
};

export function SessionTab({ id, name, state, isActive, onSelect, onClose }: SessionTabProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(id);
  };

  return (
    <div
      onClick={() => onSelect(id)}
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

      {/* Close button */}
      <button
        onClick={handleClose}
        className="ml-1 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 shrink-0"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
