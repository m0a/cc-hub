import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ConversationMessage, ToolUseInfo, ToolResultInfo } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Convert [Image: source: /tmp/cchub-images/xxx.png] to actual image
function processImageReferences(content: string): string {
  return content.replace(
    /\[Image: source: \/tmp\/cchub-images\/([^\]]+)\]/g,
    (_, filename) => `![Screenshot](${API_BASE}/api/images/${filename})`
  );
}

// Check if a message is a system-generated summary (context continuation)
function isSystemSummary(content: string): boolean {
  return content.startsWith('This session is being continued from a previous conversation that ran out of context');
}

// Collapsible section component
function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
  variant = 'default',
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  variant?: 'default' | 'thinking' | 'tool' | 'result' | 'error';
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const variantStyles = {
    default: 'bg-th-surface-hover/50 border-th-border',
    thinking: 'bg-purple-900/30 border-purple-600',
    tool: 'bg-blue-900/30 border-blue-600',
    result: 'bg-green-900/30 border-green-600',
    error: 'bg-red-900/30 border-red-600',
  };

  return (
    <div className={`my-2 border rounded ${variantStyles[variant]}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-2 text-xs text-th-text-secondary hover:bg-th-surface-hover/50"
      >
        <span className="transform transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        <span>{icon}</span>
        <span className="flex-1 text-left truncate">{title}</span>
      </button>
      {isOpen && (
        <div className="p-2 border-t border-th-border text-xs overflow-x-auto">
          {children}
        </div>
      )}
    </div>
  );
}

// Threshold for auto-expanding short content (characters)
const SHORT_CONTENT_THRESHOLD = 500;

// Check if content is short enough to auto-expand
function isShortContent(content: string): boolean {
  return content.length <= SHORT_CONTENT_THRESHOLD;
}

// Tool use display
function ToolUseDisplay({ tools }: { tools: ToolUseInfo[] }) {
  return (
    <>
      {tools.map((tool, idx) => {
        const inputStr = JSON.stringify(tool.input, null, 2);
        return (
          <CollapsibleSection
            key={idx}
            title={`${tool.name}`}
            icon="🔧"
            variant="tool"
            defaultOpen={isShortContent(inputStr)}
          >
            <pre className="text-green-300 whitespace-pre-wrap break-all">
              {inputStr}
            </pre>
          </CollapsibleSection>
        );
      })}
    </>
  );
}

// Tool result display
function ToolResultDisplay({ results }: { results: ToolResultInfo[] }) {
  const { t } = useTranslation();
  return (
    <>
      {results.map((result, idx) => {
        const maxPreview = 500;
        const isLong = result.output.length > maxPreview;
        const preview = isLong ? `${result.output.substring(0, maxPreview)}...` : result.output;

        return (
          <CollapsibleSection
            key={idx}
            title={result.toolName ? `${result.toolName} ${t('conversation.toolResult')}` : t('conversation.toolResult')}
            icon={result.isError ? '❌' : '📋'}
            variant={result.isError ? 'error' : 'result'}
            defaultOpen={isShortContent(result.output)}
          >
            <pre className={`whitespace-pre-wrap break-all ${result.isError ? 'text-red-300' : 'text-th-text-secondary'}`}>
              {isLong ? (
                <ExpandableText text={result.output} preview={preview} />
              ) : (
                result.output || t('conversation.noOutput')
              )}
            </pre>
          </CollapsibleSection>
        );
      })}
    </>
  );
}

// Expandable text for long outputs
function ExpandableText({ text, preview }: { text: string; preview: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {expanded ? text : preview}
      <button
        onClick={() => setExpanded(!expanded)}
        className="ml-2 text-blue-400 hover:underline"
      >
        {expanded ? t('conversation.collapse') : t('conversation.showAll')}
      </button>
    </>
  );
}

// Thinking display
function ThinkingDisplay({ thinking }: { thinking: string }) {
  const { t } = useTranslation();
  return (
    <CollapsibleSection
      title={t('conversation.thinking')}
      icon="💭"
      variant="thinking"
      defaultOpen={isShortContent(thinking)}
    >
      <div className="text-purple-200 whitespace-pre-wrap">
        {thinking}
      </div>
    </CollapsibleSection>
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

// Markdown components configuration
const markdownComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="bg-th-bg p-2 rounded overflow-x-auto my-2 text-xs">
      {children}
    </pre>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.includes('language-');
    return isBlock ? (
      <code className="text-green-300">{children}</code>
    ) : (
      <code className="bg-th-surface-hover px-1 rounded text-blue-300">{children}</code>
    );
  },
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-1">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc ml-4 my-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal ml-4 my-1">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="my-0.5">{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-lg font-bold my-2">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-base font-bold my-2">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-bold my-1">{children}</h3>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold text-th-text">{children}</strong>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-blue-400 underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-gray-500 pl-2 my-2 text-th-text-secondary">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border border-th-border">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-th-border px-2 py-1 bg-th-surface-hover">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-th-border px-2 py-1">{children}</td>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <img
      src={src}
      alt={alt || 'Screenshot'}
      className="max-w-full h-auto rounded my-2 border border-th-border"
      loading="lazy"
    />
  ),
};

// Memoized message item component
const MessageItem = memo(function MessageItem({ msg }: { msg: ConversationMessage }) {
  const { t } = useTranslation();

  // Determine if this is a tool-result-only message (system response)
  const isToolResultOnly = msg.role === 'user' &&
    msg.toolResult && msg.toolResult.length > 0 &&
    !msg.content;

  // Determine if this is a system-generated summary (context continuation)
  const isSummaryMessage = msg.role === 'user' &&
    msg.content && isSystemSummary(msg.content);

  // Get display role and style
  let displayRole: string;
  let containerStyle: string;

  if (isSummaryMessage) {
    displayRole = t('conversation.systemSummary');
    containerStyle = 'mx-4 bg-amber-900/20 border-l-2 border-amber-500';
  } else if (isToolResultOnly) {
    displayRole = t('conversation.system');
    containerStyle = 'mr-8 bg-th-surface-hover/50 border-l-2 border-gray-500';
  } else if (msg.role === 'user') {
    displayRole = t('conversation.you');
    containerStyle = 'ml-8 bg-blue-900/30 border-l-2 border-blue-500';
  } else {
    displayRole = t('conversation.claude');
    containerStyle = 'mr-8 bg-th-surface border-l-2 border-th-border';
  }

  return (
    <div className={`${containerStyle} p-2 rounded`}>
      <div className="text-xs text-th-text-secondary mb-1">
        {displayRole}
      </div>

      {/* Thinking block (Claude only) */}
      {msg.thinking && <ThinkingDisplay thinking={msg.thinking} />}

      {/* Main text content */}
      {msg.content && (
        <div className="text-sm text-th-text markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {processImageReferences(msg.content)}
          </ReactMarkdown>
        </div>
      )}

      {/* Tool use (Claude only) */}
      {msg.toolUse && msg.toolUse.length > 0 && (
        <ToolUseDisplay tools={msg.toolUse} />
      )}

      {/* Tool result (displayed as System when no user text) */}
      {msg.toolResult && msg.toolResult.length > 0 && (
        <ToolResultDisplay results={msg.toolResult} />
      )}
    </div>
  );
});

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
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [prevMessageCount, setPrevMessageCount] = useState(0);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
  });

  // Scroll to bottom only when NEW messages are added (not on every refresh)
  const scrollToEnd = useCallback(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [virtualizer, messages.length]);

  useEffect(() => {
    if (scrollToBottom && messages.length > 0 && !isLoading) {
      // Only scroll if message count increased (new message added)
      if (messages.length > prevMessageCount) {
        // Use requestAnimationFrame to ensure virtualizer has measured items
        requestAnimationFrame(() => {
          scrollToEnd();
        });
      }
      setPrevMessageCount(messages.length);
    }
  }, [messages.length, isLoading, scrollToBottom, prevMessageCount, scrollToEnd]);

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
    ? 'h-full flex flex-col bg-th-bg'
    : 'fixed inset-0 z-50 flex flex-col bg-th-bg';

  return (
    <div className={containerClass}>
      {/* Messages */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto p-3 select-text"
        style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
      >
        {isLoading ? (
          <div className="text-center text-th-text-muted py-8">
            {t('common.loading')}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-th-text-muted py-8">
            {t('conversation.noMessages')}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="pb-3">
                  <MessageItem msg={messages[virtualRow.index]} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - only show in modal mode */}
      {!inline && (
        <div className="flex items-center px-3 py-2 border-t border-th-border bg-th-surface shrink-0">
          <button
            onClick={onClose}
            className="text-th-text-secondary hover:text-th-text p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0 ml-2">
            <h2 className="text-sm font-medium text-th-text truncate">{title}</h2>
            {subtitle && (
              <p className="text-xs text-th-text-secondary truncate">{subtitle}</p>
            )}
          </div>
          {onResume && (
            <button
              onClick={onResume}
              disabled={isResuming}
              className="ml-2 px-3 py-1 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-th-surface-active text-th-text rounded shrink-0"
            >
              {isResuming ? t('session.resuming') : t('session.resume')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
