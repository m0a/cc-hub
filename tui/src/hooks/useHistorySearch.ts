import { useEffect, useState } from 'react';
import { type HistoryEntry, streamHistorySearch } from '../api/history';

const DEBOUNCE_MS = 250;

/** クエリをデバウンスし、SSE で履歴検索結果を逐次蓄積する（クエリ変更で前回を中断）。 */
export function useHistorySearch(baseUrl: string, token: string | null) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HistoryEntry[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (query.trim() === '') {
      setResults([]);
      setStreaming(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStreaming(true);
      setResults([]);
      const acc: HistoryEntry[] = [];
      streamHistorySearch({
        baseUrl,
        token,
        query,
        signal: controller.signal,
        onResult: (entry) => {
          acc.push(entry);
          setResults([...acc]);
        },
        onDone: () => setStreaming(false),
        onError: () => setStreaming(false),
      });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, baseUrl, token]);

  return { query, setQuery, results, streaming };
}
