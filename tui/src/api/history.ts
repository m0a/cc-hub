// セッション履歴の検索（SSE）と再開（resume）。
import type { AgentProvider } from 'shared';
import { authHeaders, type ApiClient, type FetchLike } from './client';

/** GET /history/search(/stream) の各要素（実機確認済みフィールド）。 */
export interface HistoryEntry {
  sessionId: string;
  projectPath: string;
  projectName?: string;
  firstPrompt?: string;
  lastPrompt?: string;
  gitBranch?: string;
  modified?: string;
  agent?: AgentProvider;
}

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * SSE バッファから完結したイベントを取り出し、未完の残り（次チャンクへ持ち越す）を返す純粋関数。
 * イベント区切りは空行（`\n\n`）。`event:` / `data:` 行を解釈する。
 */
export function parseSSEBuffer(buffer: string): { events: SSEEvent[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SSEEvent[] = [];
  for (const block of blocks) {
    if (block.trim() === '') continue;
    let event: string | undefined;
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    events.push({ event, data });
  }
  return { events, rest };
}

export interface StreamSearchOpts {
  baseUrl: string;
  token?: string | null;
  query: string;
  limit?: number;
  signal?: AbortSignal;
  onResult: (entry: HistoryEntry) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  fetchImpl?: FetchLike;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 履歴検索（SSE）。結果を 1 件ずつ onResult へ流す。signal で中断可能。 */
export async function streamHistorySearch(opts: StreamSearchOpts): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url =
    `${stripTrailingSlash(opts.baseUrl)}/api/sessions/history/search/stream` +
    `?q=${encodeURIComponent(opts.query)}&limit=${opts.limit ?? 50}`;

  let res: Response;
  try {
    res = await doFetch(url, { headers: authHeaders(opts.token), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') opts.onError?.(e as Error);
    return;
  }
  if (!res.ok || !res.body) {
    opts.onError?.(new Error(`search failed (${res.status})`));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSSEBuffer(buffer);
      buffer = rest;
      for (const ev of events) {
        if (ev.event === 'done') {
          opts.onDone?.();
          return;
        }
        if (ev.event === 'error') {
          opts.onError?.(new Error('search error'));
          return;
        }
        if (ev.data) {
          try {
            opts.onResult(JSON.parse(ev.data) as HistoryEntry);
          } catch {
            // 不正な JSON 行はスキップ
          }
        }
      }
    }
    opts.onDone?.();
  } catch (e) {
    if ((e as Error).name !== 'AbortError') opts.onError?.(e as Error);
  }
}

export interface ResumeResult {
  success?: boolean;
  tmuxSessionId: string;
  ccSessionId?: string;
  agent?: AgentProvider;
}

/** 履歴から resume（tmux セッション生成）。返る tmuxSessionId に attach する。 */
export async function resumeHistory(client: ApiClient, entry: HistoryEntry): Promise<ResumeResult> {
  return client.post<ResumeResult>('/api/sessions/history/resume', {
    sessionId: entry.sessionId,
    projectPath: entry.projectPath,
    agent: entry.agent,
  });
}
