import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { authFetch } from '../services/api';
import type { ShareTokenInfo } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface ShareDialogProps {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
}

export function ShareDialog({ sessionId, sessionName, onClose }: ShareDialogProps) {
  const [tokens, setTokens] = useState<ShareTokenInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [externalBaseUrl, setExternalBaseUrl] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/shares`);
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens);
        if (data.externalBaseUrl) {
          setExternalBaseUrl(data.externalBaseUrl);
        }
      }
    } catch {
      // ignore
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await authFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInHours }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.externalBaseUrl) {
          setExternalBaseUrl(data.externalBaseUrl);
        }
        await fetchTokens();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (token: string) => {
    await authFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/share/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    });
    await fetchTokens();
  };

  const getShareUrl = (token: string) => {
    // Prefer external (Funnel) URL for sharing outside VPN
    const base = externalBaseUrl || window.location.origin;
    return `${base}/view/${token}`;
  };

  const handleCopy = async (token: string) => {
    const url = getShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const formatRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-backdrop-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-surface rounded-lg p-5 max-w-md w-full mx-4 shadow-xl animate-modal-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-th-text">Share Session</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-th-text-muted hover:text-th-text p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-th-text-secondary text-sm mb-4">
          Read-only link for <span className="font-medium text-th-text">{sessionName}</span>
          {externalBaseUrl && (
            <span className="block text-xs text-emerald-400 mt-1">External access via Tailscale Funnel</span>
          )}
        </p>

        {/* Create new token */}
        <div className="flex items-center gap-2 mb-4">
          <select
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
            className="bg-th-surface-active text-th-text rounded px-2 py-1.5 text-sm border border-th-border"
          >
            <option value={1}>1h</option>
            <option value={6}>6h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={72}>72h</option>
          </select>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || tokens.length >= 5}
            className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white text-sm font-medium transition-colors"
          >
            {creating ? 'Creating...' : 'Create Share Link'}
          </button>
        </div>

        {tokens.length >= 5 && (
          <p className="text-amber-400 text-xs mb-3">Max 5 links per session</p>
        )}

        {/* Token list */}
        {tokens.length === 0 ? (
          <p className="text-th-text-muted text-sm text-center py-4">No active share links</p>
        ) : (
          <div className="space-y-3">
            {tokens.map((t) => (
              <div key={t.token} className="bg-th-surface-active rounded-lg p-3">
                {/* QR Code */}
                <div className="flex justify-center mb-3 bg-white rounded p-2">
                  <QRCodeSVG
                    value={getShareUrl(t.token)}
                    size={160}
                    level="M"
                  />
                </div>

                {/* URL + Copy */}
                <div className="flex items-center gap-2 mb-2">
                  <code className="flex-1 text-xs text-th-text-secondary truncate bg-th-bg rounded px-2 py-1">
                    {getShareUrl(t.token)}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(t.token)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors shrink-0 ${
                      copied === t.token
                        ? 'bg-emerald-600 text-white'
                        : 'bg-th-surface-hover text-th-text hover:bg-th-surface-active'
                    }`}
                  >
                    {copied === t.token ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                {/* Info + Revoke */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-th-text-muted">
                    {formatRemaining(t.expiresAt)} remaining
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRevoke(t.token)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
