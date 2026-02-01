import { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConversationMessage } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Convert [Image: source: /tmp/cchub-images/xxx.png] to actual image
function processImageReferences(content: string): string {
  return content.replace(
    /\[Image: source: \/tmp\/cchub-images\/([^\]]+)\]/g,
    (_, filename) => `![Screenshot](${API_BASE}/api/files/images/${filename})`
  );
}

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
  inline?: boolean;  // If true, render inline instead of fullscreen modal
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
  inline = false,
}: ConversationViewerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [prevMessageCount, setPrevMessageCount] = useState(0);

  // Scroll to bottom only when NEW messages are added (not on every refresh)
  useEffect(() => {
    if (scrollToBottom && messages.length > 0 && !isLoading) {
      // Only scroll if message count increased (new message added)
      if (messages.length > prevMessageCount) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
      setPrevMessageCount(messages.length);
    }
  }, [messages, isLoading, scrollToBottom, prevMessageCount]);

  // Auto-refresh when session is active (silently in background)
  useEffect(() => {
    if (!isActive || !onRefresh) return;

    const interval = setInterval(() => {
      onRefresh();
    }, 3000); // Refresh every 3 seconds

    return () => {
      clearInterval(interval);
    };
  }, [isActive, onRefresh]);

  // Container class based on inline mode
  const containerClass = inline
    ? 'h-full flex flex-col bg-gray-900'
    : 'fixed inset-0 z-50 flex flex-col bg-gray-900';

  return (
    <div className={containerClass}>
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
                <div className="text-sm text-gray-200 markdown-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre: ({ children }) => (
                        <pre className="bg-gray-900 p-2 rounded overflow-x-auto my-2 text-xs">
                          {children}
                        </pre>
                      ),
                      code: ({ children, className }) => {
                        const isBlock = className?.includes('language-');
                        return isBlock ? (
                          <code className="text-green-300">{children}</code>
                        ) : (
                          <code className="bg-gray-700 px-1 rounded text-blue-300">{children}</code>
                        );
                      },
                      p: ({ children }) => <p className="my-1">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc ml-4 my-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal ml-4 my-1">{children}</ol>,
                      li: ({ children }) => <li className="my-0.5">{children}</li>,
                      h1: ({ children }) => <h1 className="text-lg font-bold my-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-bold my-2">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-bold my-1">{children}</h3>,
                      strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                      a: ({ href, children }) => (
                        <a href={href} className="text-blue-400 underline" target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-gray-500 pl-2 my-2 text-gray-400">
                          {children}
                        </blockquote>
                      ),
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-2">
                          <table className="min-w-full text-xs border border-gray-600">{children}</table>
                        </div>
                      ),
                      th: ({ children }) => (
                        <th className="border border-gray-600 px-2 py-1 bg-gray-700">{children}</th>
                      ),
                      td: ({ children }) => (
                        <td className="border border-gray-600 px-2 py-1">{children}</td>
                      ),
                      img: ({ src, alt }) => (
                        <img
                          src={src}
                          alt={alt || 'Screenshot'}
                          className="max-w-full h-auto rounded my-2 border border-gray-600"
                          loading="lazy"
                        />
                      ),
                    }}
                  >
                    {processImageReferences(msg.content)}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Footer - only show in modal mode */}
      {!inline && (
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
      )}
    </div>
  );
}
