import { useState, useRef, useEffect } from 'react';

interface PromptComposerProps {
  filePath: string;
  startLine: number;
  endLine: number;
  selectedCode: string;
  language?: string;
  onSubmit: (formattedPrompt: string) => void;
  onClose: () => void;
}

export function PromptComposer({
  filePath,
  startLine,
  endLine,
  selectedCode,
  language,
  onSubmit,
  onClose,
}: PromptComposerProps) {
  const [comment, setComment] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const lineRange = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;

  const handleSubmit = () => {
    const lang = language && language !== 'plaintext' ? language : '';
    const parts = [
      `${filePath}:${lineRange}`,
      '```' + lang,
      selectedCode,
      '```',
    ];
    if (comment.trim()) {
      parts.push(comment.trim());
    }
    onSubmit(parts.join('\n'));
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-th-surface border-t border-th-border shadow-2xl p-3 animate-slide-up">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-th-text-secondary font-mono">
            {filePath}:{lineRange}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-th-text-muted hover:text-th-text p-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Selected code preview */}
        <pre className="text-xs bg-th-bg rounded p-2 mb-2 max-h-24 overflow-auto text-th-text-secondary font-mono">
          {selectedCode}
        </pre>

        {/* Comment textarea */}
        <textarea
          ref={textareaRef}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="コメントを追加..."
          rows={2}
          className="w-full px-3 py-2 bg-th-bg border border-th-border rounded text-th-text placeholder-th-text-muted focus:outline-none focus:border-emerald-500 resize-none text-sm"
        />

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-th-text-secondary hover:text-th-text rounded transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition-colors"
          >
            Copy Prompt
          </button>
        </div>
      </div>
    </div>
  );
}
