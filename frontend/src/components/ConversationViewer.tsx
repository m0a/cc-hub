import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ConversationMessage, ToolUseInfo, ToolResultInfo, SessionTheme } from '../../../shared/types';
import { getTerminalThemes } from './terminal-themes';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Conversation font size (shared across all sessions)
const CV_FONT_SIZE_KEY = 'cchub-conversation-font-size';
const CV_DEFAULT_FONT_SIZE = 13;
const CV_MIN_FONT_SIZE = 9;
const CV_MAX_FONT_SIZE = 24;

function loadCvFontSize(): number {
  try {
    const saved = localStorage.getItem(CV_FONT_SIZE_KEY);
    if (saved) {
      const n = parseInt(saved, 10);
      if (!Number.isNaN(n) && n >= CV_MIN_FONT_SIZE && n <= CV_MAX_FONT_SIZE) return n;
    }
  } catch {
    // ignore
  }
  return CV_DEFAULT_FONT_SIZE;
}

function saveCvFontSize(n: number) {
  try {
    localStorage.setItem(CV_FONT_SIZE_KEY, String(n));
  } catch {
    // ignore
  }
}

function getPinchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

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
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  variant?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="my-0.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 py-0.5 text-[length:var(--cv-fs-meta,11px)] text-zinc-600 hover:text-zinc-400"
      >
        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        <span>{icon}</span>
        <span className="truncate">{title}</span>
      </button>
      {isOpen && (
        <div className="ml-4 pl-2 border-l border-white/[0.06] text-[length:var(--cv-fs-meta,11px)] text-zinc-500 overflow-x-auto">
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
function getToolSummary(name: string, input: Record<string, unknown>): string {
  // Bash has an explicit description field
  if (typeof input.description === 'string' && input.description) {
    return input.description;
  }
  // File-based tools: show the file path (basename)
  const filePath = input.file_path || input.path || input.notebook_path;
  if (typeof filePath === 'string' && filePath) {
    const parts = filePath.split('/');
    return parts[parts.length - 1] || filePath;
  }
  // Grep/search: show the pattern
  if (typeof input.pattern === 'string' && input.pattern) {
    return input.pattern;
  }
  // Bash without description: show truncated command
  if (name === 'Bash' && typeof input.command === 'string') {
    const cmd = input.command.split('\n')[0];
    return cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd;
  }
  // Task tools
  if (typeof input.prompt === 'string' && input.prompt) {
    const p = input.prompt.split('\n')[0];
    return p.length > 60 ? p.slice(0, 60) + '…' : p;
  }
  return '';
}

function ToolUseDisplay({ tools }: { tools: ToolUseInfo[] }) {
  return (
    <>
      {tools.map((tool, idx) => {
        const inputStr = JSON.stringify(tool.input, null, 2);
        const summary = getToolSummary(tool.name, tool.input);
        const title = summary ? `${tool.name}: ${summary}` : tool.name;
        return (
          <CollapsibleSection
            key={idx}
            title={title}
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
        const hasImages = result.images && result.images.length > 0;
        const hasOutput = result.output.length > 0;

        return (
          <CollapsibleSection
            key={idx}
            title={result.toolName ? `${result.toolName} ${t('conversation.toolResult')}` : t('conversation.toolResult')}
            icon={result.isError ? '❌' : '📋'}
            variant={result.isError ? 'error' : 'result'}
            defaultOpen={isShortContent(result.output) || hasImages}
          >
            {hasOutput && (
              <pre className={`whitespace-pre-wrap break-all ${result.isError ? 'text-red-300' : 'text-th-text-secondary'}`}>
                {isLong ? <ExpandableText text={result.output} preview={preview} /> : result.output}
              </pre>
            )}
            {hasImages && (
              <div className="flex flex-wrap gap-2 mt-1">
                {result.images?.map((img, i) => {
                  const src = `data:${img.mediaType};base64,${img.data}`;
                  return (
                    <img
                      key={i}
                      src={src}
                      alt="Tool result"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('cchub-image-zoom', { detail: { src } }));
                      }}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('cchub-image-zoom', { detail: { src } }));
                      }}
                      className="max-w-[280px] h-auto rounded border border-white/[0.06] cursor-zoom-in"
                      loading="lazy"
                      draggable={false}
                    />
                  );
                })}
              </div>
            )}
            {!hasOutput && !hasImages && (
              <pre className="whitespace-pre-wrap break-all text-th-text-secondary">
                {t('conversation.noOutput')}
              </pre>
            )}
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
  /** Fires once per touch gesture when the user starts scrolling. Used to
   *  collapse the input bar / soft keyboard so more of the conversation is
   *  visible (mirrors Terminal's behavior). */
  onScrollGesture?: () => void;
  /** Fires when the scroll position transitions to / from the bottom. The
   *  parent uses this to hide the keyboard while the user is reading
   *  history and re-show it when they return to the latest message. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Session theme — used to color the background to match the Terminal. */
  theme?: SessionTheme;
  /** Agent that produced these messages. Switches the assistant role label. */
  agent?: string;
}

// Markdown components configuration
const markdownComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="bg-white/[0.03] px-2 py-1 rounded overflow-x-auto my-1 text-[length:var(--cv-fs-meta,11px)]">
      {children}
    </pre>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.includes('language-');
    return isBlock ? (
      <code className="text-zinc-300">{children}</code>
    ) : (
      <code className="bg-white/[0.06] px-1 rounded text-zinc-300">{children}</code>
    );
  },
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-0.5">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc ml-4 my-0.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal ml-4 my-0.5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="my-0">{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-lg font-bold my-1">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-base font-bold my-1">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-bold my-0.5">{children}</h3>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold text-th-text">{children}</strong>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-blue-400 underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-gray-500 pl-2 my-1 text-th-text-secondary">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-1">
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
      onClick={(e) => {
        if (!src) return;
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('cchub-image-zoom', { detail: { src } }));
      }}
      onTouchEnd={(e) => {
        if (!src) return;
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('cchub-image-zoom', { detail: { src } }));
      }}
      className="max-w-[280px] h-auto rounded my-2 border border-white/[0.06] cursor-zoom-in"
      loading="lazy"
      draggable={false}
    />
  ),
};

// Memoized message item component
const MessageItem = memo(function MessageItem({ msg, agent }: { msg: ConversationMessage; agent?: string }) {
  const { t } = useTranslation();

  // Determine if this is a tool-result-only message (system response)
  const isToolResultOnly = msg.role === 'user' &&
    msg.toolResult && msg.toolResult.length > 0 &&
    !msg.content;

  // Determine if this is a system-generated summary (context continuation)
  const isSummaryMessage = msg.role === 'user' &&
    msg.content && isSystemSummary(msg.content);

  // Get display role
  let displayRole: string;

  if (isSummaryMessage) {
    displayRole = t('conversation.systemSummary');
  } else if (isToolResultOnly) {
    displayRole = t('conversation.system');
  } else if (msg.role === 'user') {
    displayRole = t('conversation.you');
  } else {
    displayRole = agent === 'codex' ? t('conversation.codex') : t('conversation.claude');
  }

  const roleColor = msg.role === 'user' ? 'text-blue-400' : isSummaryMessage ? 'text-amber-400' : 'text-zinc-500';

  return (
    <div className="py-1">
      <div className={`text-[length:var(--cv-fs-meta,11px)] font-medium ${roleColor} mb-0.5`}>
        {displayRole}
      </div>

      {/* Thinking block (Claude only) */}
      {msg.thinking && <ThinkingDisplay thinking={msg.thinking} />}

      {/* Main text content */}
      {msg.content && (
        <div className="text-zinc-300 markdown-content leading-snug">
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
  onScrollGesture,
  onAtBottomChange,
  theme,
  agent,
}: ConversationViewerProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [prevMessageCount, setPrevMessageCount] = useState(0);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Inline images (rendered by markdownComponents) dispatch this event when
  // tapped. Listening at the component level (rather than event delegation
  // on the scroll container) sidesteps cases where parent handlers swallow
  // the click on touch devices.
  useEffect(() => {
    const onZoom = (e: Event) => {
      const detail = (e as CustomEvent<{ src: string }>).detail;
      if (detail?.src) setLightboxSrc(detail.src);
    };
    window.addEventListener('cchub-image-zoom', onZoom);
    return () => window.removeEventListener('cchub-image-zoom', onZoom);
  }, []);

  // Esc to close lightbox
  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxSrc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxSrc]);
  const [fontSize, setFontSize] = useState<number>(loadCvFontSize);
  const [showFontSizeIndicator, setShowFontSizeIndicator] = useState(false);
  const fontSizeIndicatorTimerRef = useRef<number | null>(null);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize(prev => {
      const next = Math.max(CV_MIN_FONT_SIZE, Math.min(CV_MAX_FONT_SIZE, prev + delta));
      if (next !== prev) saveCvFontSize(next);
      return next;
    });
  }, []);
  const resetFontSize = useCallback(() => {
    setFontSize(CV_DEFAULT_FONT_SIZE);
    saveCvFontSize(CV_DEFAULT_FONT_SIZE);
  }, []);

  // Briefly show the size indicator after any change
  useEffect(() => {
    setShowFontSizeIndicator(true);
    if (fontSizeIndicatorTimerRef.current) clearTimeout(fontSizeIndicatorTimerRef.current);
    fontSizeIndicatorTimerRef.current = window.setTimeout(() => setShowFontSizeIndicator(false), 1200);
    return () => {
      if (fontSizeIndicatorTimerRef.current) clearTimeout(fontSizeIndicatorTimerRef.current);
    };
  }, [fontSize]);

  // Pinch-zoom on the message scroll container to change font size
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let pinch: { d: number; size: number } | null = null;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinch = { d: getPinchDistance(e.touches), size: fontSize };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch) {
        e.preventDefault();
        const scale = getPinchDistance(e.touches) / pinch.d;
        const next = Math.round(pinch.size * scale);
        const clamped = Math.max(CV_MIN_FONT_SIZE, Math.min(CV_MAX_FONT_SIZE, next));
        setFontSize(prev => (prev === clamped ? prev : clamped));
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinch) {
        pinch = null;
        // Persist the final size after pinch ends
        setFontSize(prev => { saveCvFontSize(prev); return prev; });
      }
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [fontSize]);

  // Track scroll gestures and at-bottom state. The atBottom transition is
  // only reported during/just-after a user touch — otherwise viewport
  // changes from the keyboard showing/hiding would themselves toggle the
  // state and cause the keyboard to oscillate.
  const onScrollGestureRef = useRef(onScrollGesture);
  onScrollGestureRef.current = onScrollGesture;
  const onAtBottomChangeRef = useRef(onAtBottomChange);
  onAtBottomChangeRef.current = onAtBottomChange;
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const BOTTOM_THRESHOLD = 24;
    const computeAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;

    let userTouching = false;
    let userTouchedUntil = 0; // timestamp; treat events within this window as user-driven
    let startY: number | null = null;
    let gestureFired = false;

    let cooldownUntil = 0;
    const reportIfChanged = () => {
      if (Date.now() < cooldownUntil) return;
      const atBottom = computeAtBottom();
      if (atBottom === atBottomRef.current) return;
      atBottomRef.current = atBottom;
      cooldownUntil = Date.now() + 600; // ignore rapid layout-shift re-toggles
      onAtBottomChangeRef.current?.(atBottom);
    };

    const onScroll = () => {
      // Only react when the user is (or recently was) touching, to avoid
      // feedback loops with keyboard show/hide layout shifts.
      if (!userTouching && Date.now() > userTouchedUntil) return;
      reportIfChanged();
    };
    const onStart = (e: TouchEvent) => {
      userTouching = true;
      if (e.touches.length !== 1) { startY = null; gestureFired = false; return; }
      startY = e.touches[0].clientY;
      gestureFired = false;
    };
    const onMove = (e: TouchEvent) => {
      if (gestureFired || startY === null || e.touches.length !== 1) return;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dy > 5) {
        gestureFired = true;
        onScrollGestureRef.current?.();
      }
    };
    const onEnd = () => {
      userTouching = false;
      userTouchedUntil = Date.now() + 350; // momentum scroll window
      startY = null;
      gestureFired = false;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // Better estimate based on content length to reduce scroll jank
      const msg = messages[index];
      if (!msg) return 100;
      const len = msg.content?.length || 0;
      if (len < 100) return 60;
      if (len < 500) return 150;
      if (len < 2000) return 300;
      return 500;
    },
    overscan: 10,
  });

  const scrollToEnd = useCallback(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [virtualizer, messages.length]);

  useEffect(() => {
    if (scrollToBottom && messages.length > 0 && !isLoading) {
      if (messages.length > prevMessageCount) {
        requestAnimationFrame(() => {
          scrollToEnd();
        });
      }
      setPrevMessageCount(messages.length);
    }
  }, [messages.length, isLoading, scrollToBottom, prevMessageCount, scrollToEnd]);

  // Snap to bottom when the container becomes visible (e.g. unhidden after
  // mounting under display:none). Without this, scrollToEnd above runs while
  // the parent has 0 height and silently no-ops.
  const messagesLenRef = useRef(messages.length);
  messagesLenRef.current = messages.length;
  useEffect(() => {
    if (!scrollToBottom) return;
    const el = parentRef.current;
    if (!el) return;
    let prevHeight = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h > 0 && prevHeight === 0 && messagesLenRef.current > 0) {
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(messagesLenRef.current - 1, { align: 'end' });
        });
      }
      prevHeight = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom, virtualizer]);

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
    ? 'h-full flex flex-col relative'
    : 'fixed inset-0 z-50 flex flex-col';
  const themeBg = getTerminalThemes()[theme || 'default'].background;

  return (
    <div className={containerClass} style={{ backgroundColor: themeBg }}>
      {/* Floating font-size controls (bottom-left) — only visible when the
          user is actively changing the size (via pinch / button) or hovering
          the bottom-left hot-zone on desktop. Tap the small "Aa" badge on
          touch devices to reveal. */}
      {inline && (
        <div className="absolute bottom-2 left-2 z-30 group">
          {/* Tiny always-visible trigger */}
          <button
            type="button"
            onClick={() => {
              setShowFontSizeIndicator(true);
              if (fontSizeIndicatorTimerRef.current) clearTimeout(fontSizeIndicatorTimerRef.current);
              fontSizeIndicatorTimerRef.current = window.setTimeout(() => setShowFontSizeIndicator(false), 4000);
            }}
            className={`w-6 h-6 rounded text-[10px] font-medium transition-opacity flex items-center justify-center bg-black/40 text-zinc-500 hover:text-zinc-300 ${
              showFontSizeIndicator ? 'opacity-0' : 'opacity-60 hover:opacity-100'
            }`}
            aria-label="Show font size controls"
            title="Font size"
          >
            Aa
          </button>
          {/* Full controls — shown on hover (desktop) or while indicator active */}
          <div className={`absolute bottom-0 left-0 flex items-center gap-1 transition-opacity duration-150 ${
            showFontSizeIndicator ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}>
            <div className="flex items-center bg-black/70 backdrop-blur-sm rounded-md border border-white/[0.08]">
              <button
                type="button"
                onClick={() => changeFontSize(-1)}
                className="w-7 h-7 text-zinc-300 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-colors text-sm"
                aria-label="Decrease font size"
                title="Decrease font size"
              >
                −
              </button>
              <button
                type="button"
                onClick={resetFontSize}
                className="px-1.5 h-7 text-[10px] text-zinc-400 hover:text-white hover:bg-white/[0.08] border-x border-white/[0.06] transition-colors"
                aria-label="Reset font size"
                title="Reset font size"
              >
                A
              </button>
              <button
                type="button"
                onClick={() => changeFontSize(1)}
                className="w-7 h-7 text-zinc-300 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-colors text-sm"
                aria-label="Increase font size"
                title="Increase font size"
              >
                ＋
              </button>
            </div>
            <div className="bg-black/70 text-white text-[11px] font-medium px-2 py-1 rounded shadow">
              {fontSize}px
            </div>
          </div>
        </div>
      )}
      {/* Messages */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto px-3 py-1 select-text overscroll-contain relative"
        style={{
          WebkitUserSelect: 'text',
          userSelect: 'text',
          WebkitTouchCallout: 'default',
          fontSize: `${fontSize}px`,
          ['--cv-fs-meta' as never]: `${Math.max(8, fontSize - 2)}px`,
        }}
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
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualizer.getVirtualItems()[0]?.start ?? 0}px)`,
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                >
                  <div className="pb-1">
                    <MessageItem msg={messages[virtualRow.index]} agent={agent} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer - only show in modal mode */}
      {!inline && (
        <div className="flex items-center px-3 py-2 border-t border-white/[0.06] shrink-0" style={{ backgroundColor: themeBg }}>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0 ml-2">
            <h2 className="text-[13px] font-medium text-white truncate">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-zinc-500 truncate">{subtitle}</p>
            )}
          </div>
          {onResume && (
            <button
              onClick={onResume}
              disabled={isResuming}
              className="ml-2 px-3 py-1.5 text-[12px] font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md shrink-0 transition-colors"
            >
              {isResuming ? t('session.resuming') : t('session.resume')}
            </button>
          )}
        </div>
      )}

      {/* Image lightbox — tap an inline image to open at full size */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}
          onTouchEnd={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}
            className="absolute top-3 right-3 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightboxSrc}
            alt="Expanded"
            className="max-w-full max-h-full object-contain select-none"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
