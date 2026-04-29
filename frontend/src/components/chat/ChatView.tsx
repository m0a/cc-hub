import { useTranslation } from 'react-i18next';
import { ConversationViewer } from '../ConversationViewer';
import { useConversationStream } from '../../hooks/useConversationStream';
import { useInputEcho } from '../../hooks/useInputEcho';
import { ChatComposer } from './ChatComposer';

interface ChatViewProps {
  sessionId: string;
  title?: string;
  subtitle?: string;
  inline?: boolean;
  enabled?: boolean;
  /** Extra bottom padding (px) so trailing messages aren't covered by floating UI like a soft keyboard. */
  bottomPadding?: number;
  /** When set with a tmux paneId, render an input form below the conversation
   *  (used on desktop where there's no soft keyboard / Terminal InputBar). */
  showComposer?: boolean;
  paneId?: string;
  /** Notified when the user starts a scroll gesture — parent can collapse
   *  the keyboard / input bar to expand the visible area. */
  onScrollGesture?: () => void;
  /** Notified when the conversation transitions to/from the bottom. */
  onAtBottomChange?: (atBottom: boolean) => void;
}

export function ChatView({
  sessionId,
  title,
  subtitle,
  inline = true,
  enabled = true,
  bottomPadding,
  showComposer = false,
  paneId,
  onScrollGesture,
  onAtBottomChange,
}: ChatViewProps) {
  const { t } = useTranslation();
  const { messages, isReady, ccSessionId } = useConversationStream({
    sessionId,
    enabled,
  });
  const echo = useInputEcho(sessionId);

  const resolvedTitle = title ?? t('conversation.claude');
  const resolvedSubtitle = subtitle ?? (ccSessionId ? `cc:${ccSessionId.slice(0, 8)}` : undefined);

  // Avoid showing a "Loading..." flash every time the view opens. Until the
  // initial conversation arrives, render an empty container.
  if (!isReady && messages.length === 0) {
    const emptyClass = inline ? 'h-full bg-[#0a0a0a]' : 'fixed inset-0 z-50 bg-[#0a0a0a]';
    return <div className={emptyClass} />;
  }

  const composer = showComposer ? (
    <ChatComposer sessionId={sessionId} paneId={paneId} />
  ) : null;

  // Prompt-style line at the bottom of the conversation showing what the user
  // is currently typing via FloatingKeyboard / InputBar (terminal echo
  // surrogate). Only relevant when the in-view composer is not present.
  const echoLine = !composer ? (
    <div className="shrink-0 px-3 py-1.5 border-t border-white/[0.06] bg-[#0a0a0a] font-mono text-[13px] text-zinc-300 whitespace-pre overflow-x-auto min-h-[32px] flex items-center">
      <span className="text-blue-400/70 mr-2 select-none">{'>'}</span>
      {echo ? <span>{echo}<span className="inline-block w-[8px] h-[14px] bg-zinc-300 ml-[1px] align-middle animate-pulse" /></span> : <span className="text-zinc-700">入力待ち…</span>}
    </div>
  ) : null;

  const viewer = (
    <ConversationViewer
      title={resolvedTitle}
      subtitle={resolvedSubtitle}
      messages={messages}
      isLoading={false}
      onClose={() => { /* close handled by parent */ }}
      scrollToBottom
      inline={inline}
      onScrollGesture={onScrollGesture}
      onAtBottomChange={onAtBottomChange}
    />
  );

  if (composer || echoLine) {
    return (
      <div className="h-full flex flex-col" style={bottomPadding ? { paddingBottom: bottomPadding } : undefined}>
        <div className="flex-1 min-h-0">{viewer}</div>
        {echoLine}
        {composer}
      </div>
    );
  }

  if (bottomPadding && bottomPadding > 0) {
    return (
      <div className="h-full flex flex-col" style={{ paddingBottom: bottomPadding }}>
        {viewer}
      </div>
    );
  }

  return viewer;
}
