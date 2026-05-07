import { useConversationStream } from './useConversationStream';
import { useCodexConversation } from './useCodexConversation';
import type { AgentProvider, ConversationMessage } from '../../../shared/types';

export interface UseAgentConversationOptions {
  /** Provider for the active session. Drives which underlying source is read. */
  agent: AgentProvider | undefined;
  /** tmux session id (used by the Claude WebSocket subscription). */
  sessionId: string;
  /** Codex thread id (used by the Codex rollout poller). */
  agentSessionId: string | null | undefined;
  enabled?: boolean;
}

export type AgentConversationError = 'missing-agent' | 'unsupported-agent';

export interface UseAgentConversationResult {
  messages: ConversationMessage[];
  isReady: boolean;
  /**
   * Identifier shown in the conversation header subtitle (e.g. last 8 chars).
   * Claude → ccSessionId resolved over the WebSocket; Codex → the rollout
   * thread id; null otherwise.
   */
  conversationId: string | null;
  /**
   * Set when no provider is wired for the requested `agent` value. Consumers
   * should render an inline error rather than a blank conversation.
   */
  error: AgentConversationError | null;
}

/**
 * Single entry point ChatView uses to read a session's conversation.
 *
 * Each provider has its own delivery mechanism (WebSocket push for Claude,
 * HTTP polling for Codex), but the consumer only needs `messages` /
 * `isReady` / `conversationId`. Adding a new provider means adding a new
 * branch here, not editing ChatView.
 */
export function useAgentConversation({
  agent,
  sessionId,
  agentSessionId,
  enabled = true,
}: UseAgentConversationOptions): UseAgentConversationResult {
  const claude = useConversationStream({
    sessionId,
    enabled: enabled && agent === 'claude',
  });
  const codex = useCodexConversation({
    threadId: agentSessionId,
    enabled: enabled && agent === 'codex',
  });

  switch (agent) {
    case 'claude':
      return {
        messages: claude.messages,
        isReady: claude.isReady,
        conversationId: claude.ccSessionId,
        error: null,
      };
    case 'codex':
      return {
        messages: codex.messages,
        isReady: codex.isReady,
        conversationId: agentSessionId ?? null,
        error: null,
      };
    default:
      // `isReady=true` so consumers fall through to their error state instead
      // of showing a loading skeleton that would never resolve.
      return {
        messages: [],
        isReady: true,
        conversationId: null,
        error: agent === undefined ? 'missing-agent' : 'unsupported-agent',
      };
  }
}
