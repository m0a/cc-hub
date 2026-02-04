import { useState, useCallback } from 'react';
import { authFetch } from '../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface PromptResult {
  display: string;
  timestamp: string;
  project: string;
  projectName: string;
  sessionId: string;
}

interface PromptSearchProps {
  onSelectPrompt?: (prompt: PromptResult) => void;
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '今';
  if (diffMins < 60) return `${diffMins}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  if (diffDays < 7) return `${diffDays}日前`;
  return date.toLocaleDateString('ja-JP');
}

export function PromptSearch({ onSelectPrompt }: PromptSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PromptResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    setIsLoading(true);
    setHasSearched(true);

    try {
      const url = query.trim()
        ? `${API_BASE}/api/sessions/prompts/search?q=${encodeURIComponent(query)}&limit=30`
        : `${API_BASE}/api/sessions/prompts/search?limit=30`;

      const response = await authFetch(url);
      if (response.ok) {
        const data = await response.json();
        setResults(data.prompts || []);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="px-2 py-1.5 border-b border-gray-700 shrink-0">
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="プロンプトを検索..."
            className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded"
          >
            {isLoading ? '...' : '検索'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!hasSearched ? (
          <div className="p-4 text-center text-gray-500 text-xs">
            検索ワードを入力するか、空欄で検索して最近のプロンプトを表示
          </div>
        ) : isLoading ? (
          <div className="p-4 text-center text-gray-500 text-xs">
            検索中...
          </div>
        ) : results.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-xs">
            結果なし
          </div>
        ) : (
          results.map((prompt, index) => (
            <div
              key={`${prompt.sessionId}-${index}`}
              onClick={() => onSelectPrompt?.(prompt)}
              className="px-3 py-2 border-b border-gray-700/50 hover:bg-gray-700/50 cursor-pointer"
            >
              <div className="text-sm text-gray-200 break-words line-clamp-2">
                {prompt.display}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                <span>{formatRelativeTime(prompt.timestamp)}</span>
                <span className="text-gray-600">|</span>
                <span className="truncate">{prompt.projectName}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
