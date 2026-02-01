import { useRef, useEffect } from 'react';
import type { ConversationMessage } from '../../../shared/types';

interface ConversationViewerProps {
  title: string;
  subtitle?: string;
  messages: ConversationMessage[];
  isLoading: boolean;
  onClose: () => void;
  onResume?: () => void;
  isResuming?: boolean;
  scrollToBottom?: boolean;
  isActive?: boolean;  // Whether the session is actively running
  onRefresh?: () => void;  // Callback to refresh conversation
}

export function ConversationViewer({
  title,
  subtitle,
  messages,
  isLoading,
  onClose,
  onResume,
  isResuming,
  scrollToBottom = false,
  isActive = false,
  onRefresh,
}: ConversationViewerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages load and scrollToBottom is enabled
  useEffect(() => {
    if (scrollToBottom && messages.length > 0 && !isLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [messages, isLoading, scrollToBottom]);

  // Auto-refresh when session is active (silently in background)
  useEffect(() => {
    console.log('[ConversationViewer] Auto-refresh effect:', { isActive, hasOnRefresh: !!onRefresh });
    if (!isActive || !onRefresh) return;

    console.log('[ConversationViewer] Setting up 3s interval');
    const interval = setInterval(() => {
      console.log('[ConversationViewer] Refreshing...');
      onRefresh();
    }, 3000); // Refresh every 3 seconds

    return () => {
      console.log('[ConversationViewer] Clearing interval');
      clearInterval(interval);
    };
  }, [isActive, onRefresh]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <div className="text-center text-gray-500 py-8">
            読み込み中...
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            メッセージがありません
          </div>
        ) : (
          <>
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`${
                  msg.role === 'user'
                    ? 'ml-8 bg-blue-900/30 border-l-2 border-blue-500'
                    : 'mr-8 bg-gray-800 border-l-2 border-gray-600'
                } p-2 rounded`}
              >
                <div className="text-xs text-gray-400 mb-1">
                  {msg.role === 'user' ? 'You' : 'Claude'}
                </div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Footer (moved from header for mobile usability) */}
      <div className="flex items-center px-3 py-2 border-t border-gray-700 bg-gray-800 shrink-0">
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0 ml-2">
          <h2 className="text-sm font-medium text-white truncate">{title}</h2>
          {subtitle && (
            <p className="text-xs text-gray-400 truncate">{subtitle}</p>
          )}
        </div>
        {onResume && (
          <button
            onClick={onResume}
            disabled={isResuming}
            className="ml-2 px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded shrink-0"
          >
            {isResuming ? '再開中...' : '再開'}
          </button>
        )}
      </div>
    </div>
  );
}
