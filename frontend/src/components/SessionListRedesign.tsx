/**
 * SessionList Redesign Prototype
 *
 * Design: "Quiet Confidence" — Linear × Arc Browser
 * - Segmented tab control (top, not bottom)
 * - Sessions grouped by state (active first, then idle)
 * - Frosted glass header
 * - Card-based layout with generous spacing
 * - Status expressed through left accent bar + subtle glow
 * - Compact metadata row with icons
 *
 * This is a visual prototype file for review.
 * After approval, changes will be integrated into the real SessionList.tsx
 */
import { useState } from 'react';
import {
  Plus, Search,
  Terminal, Clock, MessageCircle, GitBranch,
  ChevronRight, Zap, Pause,
  Play, X, FolderOpen
} from 'lucide-react';

// ─── Mock data for prototype ────────────────────────────────────
const MOCK_SESSIONS = [
  { id: '1', name: 'CC Hub開発', path: '~/cchub-work-1', prompt: '今のシステムの見た目を抜本的に変えたい...', status: 'processing' as const, theme: 'blue' as const, panes: 2 },
  { id: '2', name: 'AI開発入門（小説）', path: '~/novels/ai-dev-intro-novel', prompt: 'おまかせします', status: 'idle' as const, theme: null, panes: 1 },
  { id: '3', name: '彗星衝突小説', path: '~/tmp/novel/c2027k4', prompt: '良い。けどもっと近寄ってほしい見下ろす感じに...', status: 'idle' as const, theme: 'amber' as const, panes: 1 },
  { id: '4', name: '確定申告', path: '~/repos/freee', prompt: 'エージェントブラウザでfreeeにアクセスしてください', status: 'waiting' as const, theme: null, panes: 1 },
  { id: '5', name: 'Haskell入門執筆', path: '~/repos/haskel', prompt: 'よさそうですコミットを', status: 'idle' as const, theme: 'purple' as const, panes: 1 },
  { id: '6', name: 'linuxメンテナンス', path: '~/linux', prompt: '改めて状態チェックを', status: 'disconnected' as const, theme: null, panes: 1 },
];

type SessionStatus = 'processing' | 'waiting' | 'idle' | 'disconnected';
type ThemeColor = 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'blue' | 'indigo' | 'purple' | 'pink' | null;

const STATUS_CONFIG: Record<SessionStatus, { color: string; glow: string; label: string; icon: typeof Zap }> = {
  processing: { color: 'bg-blue-500', glow: 'shadow-[0_0_8px_rgba(59,130,246,0.4)]', label: '処理中', icon: Zap },
  waiting: { color: 'bg-amber-400', glow: 'shadow-[0_0_8px_rgba(251,191,36,0.4)]', label: '入力待ち', icon: Pause },
  idle: { color: 'bg-zinc-600', glow: '', label: '', icon: Terminal },
  disconnected: { color: 'bg-zinc-700', glow: '', label: '', icon: Terminal },
};

// ─── Mock history data ──────────────────────────────────────────
const MOCK_PROJECTS = [
  {
    name: 'cchub-work-1',
    sessionCount: 12,
    sessions: [
      { id: 'h1', prompt: 'UIリデザインのプラン作成', time: '2時間前', duration: '45分', messages: 32, branch: 'feat/ui-redesign' },
      { id: 'h2', prompt: 'WebSocket接続のデバッグ', time: '5時間前', duration: '1時間20分', messages: 58, branch: 'fix/ws-reconnect' },
      { id: 'h3', prompt: 'ダッシュボードのチャート実装', time: '昨日', duration: '2時間', messages: 45, branch: 'feat/dashboard' },
    ],
  },
  {
    name: 'novels/ai-dev-intro-novel',
    sessionCount: 8,
    sessions: [
      { id: 'h4', prompt: '第3章の執筆とレビュー', time: '3時間前', duration: '1時間', messages: 24, branch: null },
      { id: 'h5', prompt: 'キャラクター設定の見直し', time: '昨日', duration: '30分', messages: 15, branch: null },
    ],
  },
  {
    name: 'repos/freee',
    sessionCount: 3,
    sessions: [
      { id: 'h6', prompt: '確定申告データの入力自動化', time: '2日前', duration: '50分', messages: 20, branch: null },
    ],
  },
  {
    name: 'repos/haskel',
    sessionCount: 5,
    sessions: [],
  },
  {
    name: 'linux',
    sessionCount: 2,
    sessions: [],
  },
];

const ACCENT_COLORS: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', green: '#22c55e',
  teal: '#14b8a6', blue: '#3b82f6', indigo: '#6366f1', purple: '#a855f7', pink: '#ec4899',
};

// ─── Session Card ────────────────────────────────────────────────
function SessionCard({
  session,
  isActive
}: {
  session: typeof MOCK_SESSIONS[0];
  isActive: boolean;
}) {
  const config = STATUS_CONFIG[session.status];
  const accentColor = session.theme ? ACCENT_COLORS[session.theme] : undefined;
  const isLive = session.status === 'processing' || session.status === 'waiting';

  return (
    <div
      className={`
        group relative rounded-lg transition-all duration-200 cursor-pointer
        ${isActive
          ? 'bg-white/[0.07] ring-1 ring-white/[0.08]'
          : 'hover:bg-white/[0.04]'
        }
      `}
    >
      {/* Accent bar */}
      {accentColor && (
        <div
          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
          style={{ backgroundColor: accentColor }}
        />
      )}

      <div className={`px-4 py-3 ${accentColor ? 'pl-5' : ''}`}>
        {/* Top row: title + status */}
        <div className="flex items-center gap-2 mb-1">
          <h3 className={`text-[15px] font-medium truncate flex-1 tracking-[-0.01em] ${
            isLive ? 'text-white' : 'text-zinc-300'
          }`}>
            {session.name}
          </h3>

          {/* Status badge */}
          {isLive && (
            <span className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
              ${session.status === 'processing'
                ? 'bg-blue-500/15 text-blue-400'
                : 'bg-amber-500/15 text-amber-400'
              }
            `}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.color} ${
                session.status === 'waiting' ? 'animate-pulse' : ''
              }`} />
              {config.label}
            </span>
          )}

          {session.status === 'disconnected' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-zinc-500">
              <Play className="w-3 h-3" />
              再開
            </span>
          )}
        </div>

        {/* Path */}
        <div className="flex items-center gap-3 text-[12px] text-zinc-500">
          <span className="truncate font-mono">{session.path}</span>
          {session.panes > 1 && (
            <span className="shrink-0 tabular-nums">{session.panes} panes</span>
          )}
        </div>

        {/* Last prompt - only on larger cards */}
        {session.prompt && (
          <p className="mt-1.5 text-[12px] text-zinc-600 truncate leading-relaxed">
            {session.prompt}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── History Session Item ─────────────────────────────────────────
function HistorySessionItem({ session }: { session: typeof MOCK_PROJECTS[0]['sessions'][0] }) {
  return (
    <div className="group px-3 py-2.5 hover:bg-white/[0.04] rounded-md cursor-pointer transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-zinc-300 leading-snug truncate">
            {session.prompt}
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-600">
            <span>{session.time}</span>
            {session.duration && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {session.duration}
              </span>
            )}
            {session.messages > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                {session.messages}
              </span>
            )}
            {session.branch && (
              <span className="inline-flex items-center gap-1 text-purple-500 truncate max-w-[120px]">
                <GitBranch className="w-3 h-3" />
                {session.branch}
              </span>
            )}
          </div>
        </div>
        <button className="shrink-0 mt-0.5 px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] rounded-md transition-colors opacity-0 group-hover:opacity-100">
          再開
        </button>
      </div>
    </div>
  );
}

// ─── History Project Group ────────────────────────────────────────
function ProjectGroup({ project }: { project: typeof MOCK_PROJECTS[0] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] rounded-md transition-colors"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-zinc-600 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <FolderOpen className="w-3.5 h-3.5 text-zinc-600" />
        <span className="flex-1 text-left text-[13px] text-zinc-400 truncate">
          {project.name}
        </span>
        <span className="text-[11px] text-zinc-600 tabular-nums">
          {project.sessionCount}
        </span>
      </button>

      {isExpanded && (
        <div className="ml-5 border-l border-white/[0.06] mb-1">
          {project.sessions.length > 0 ? (
            <div className="md:grid md:grid-cols-2 md:gap-x-2">
              {project.sessions.map(session => (
                <HistorySessionItem key={session.id} session={session} />
              ))}
            </div>
          ) : (
            <p className="px-3 py-2 text-[12px] text-zinc-700">セッションなし</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── History Tab ──────────────────────────────────────────────────
function HistoryTab() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="px-3 py-3">
      {/* Search */}
      <div className="relative mb-3 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="履歴を検索..."
          className="w-full pl-9 pr-3 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md text-[13px] text-white placeholder:text-zinc-700 focus:outline-none focus:border-white/[0.12] transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-600 hover:text-zinc-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Project list */}
      <div className="space-y-0.5">
        {MOCK_PROJECTS.map(project => (
          <ProjectGroup key={project.name} project={project} />
        ))}
      </div>
    </div>
  );
}

// ─── Tab Bar (Segmented Control) ─────────────────────────────────
function SegmentedTabs({
  activeTab,
  onChangeTab
}: {
  activeTab: string;
  onChangeTab: (tab: string) => void;
}) {
  const tabs = [
    { id: 'sessions', label: 'セッション' },
    { id: 'history', label: '履歴' },
  ];

  return (
    <div className="inline-flex bg-white/[0.04] rounded-lg p-0.5">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChangeTab(tab.id)}
          className={`
            px-5 py-1.5 text-[13px] font-medium rounded-md transition-all duration-200
            ${activeTab === tab.id
              ? 'bg-white/[0.09] text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-400'
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
export function SessionListRedesign() {
  const [activeTab, setActiveTab] = useState('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Group sessions by state
  const activeSessions = MOCK_SESSIONS.filter(s => s.status === 'processing' || s.status === 'waiting');
  const otherSessions = MOCK_SESSIONS.filter(s => s.status !== 'processing' && s.status !== 'waiting');

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* ─── Header: frosted glass ─── */}
      <div className="shrink-0 px-4 pt-3 pb-2 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-white/[0.06] sticky top-0 z-10">
        <div className="max-w-lg">
          {/* Top row: title + actions */}
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
              Sessions
            </h1>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowSearch(!showSearch)}
                className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
              >
                <Search className="w-[18px] h-[18px]" />
              </button>
              <button className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors">
                <Plus className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

          {/* Search bar (expandable) */}
          {showSearch && (
            <div className="mb-2">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="セッションを検索..."
                  className="w-full pl-9 pr-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-500 hover:text-zinc-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Segmented tabs */}
          <SegmentedTabs activeTab={activeTab} onChangeTab={setActiveTab} />
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {activeTab === 'sessions' && (
          <div className="px-3 py-3">
            {/* Tablet: 2-column layout / Mobile: single column */}
            <div className="md:grid md:grid-cols-2 md:gap-4">
              {/* Active group */}
              {activeSessions.length > 0 && (
                <div className="mb-4 md:mb-0">
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                      Active
                    </span>
                    <span className="text-[11px] tabular-nums text-zinc-600">
                      {activeSessions.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {activeSessions.map(session => (
                      <SessionCard key={session.id} session={session} isActive={false} />
                    ))}
                  </div>
                </div>
              )}

              {/* Other sessions */}
              <div>
                {activeSessions.length > 0 && (
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                      Sessions
                    </span>
                    <span className="text-[11px] tabular-nums text-zinc-600">
                      {otherSessions.length}
                    </span>
                  </div>
                )}
                <div className="space-y-1">
                  {otherSessions.map(session => (
                    <SessionCard key={session.id} session={session} isActive={false} />
                  ))}
                </div>
              </div>
            </div>

            {/* New session button at bottom */}
            <button className="mt-4 md:mt-3 md:w-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-white/[0.08] text-zinc-500 hover:text-zinc-400 hover:border-white/[0.12] hover:bg-white/[0.02] transition-all max-md:w-full max-md:justify-center">
              <Plus className="w-4 h-4" />
              <span className="text-[13px]">新規セッション</span>
            </button>
          </div>
        )}

        {activeTab === 'history' && (
          <HistoryTab />
        )}
      </div>
    </div>
  );
}
