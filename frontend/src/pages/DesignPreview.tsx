/**
 * Design Preview Page — temporary route for reviewing redesign prototypes
 * Access at: /preview
 */
import { useState } from 'react';
import { SessionListRedesign } from '../components/SessionListRedesign';
import {
  Settings, ChevronDown, RotateCw, Maximize2,
  SplitSquareHorizontal, SplitSquareVertical, X, Share2,
  FileText, MessageSquare, BarChart3, Wifi,
  Sun, Globe, Keyboard as KeyboardIcon,
  CornerDownLeft, Eye, Minus, Clock, ChevronUp
} from 'lucide-react';

// ─── Screen Selector ─────────────────────────────────────────────
function ScreenSelector({ current, onChange }: { current: string; onChange: (s: string) => void }) {
  const screens = [
    { id: 'sessions', label: 'セッション' },
    { id: 'terminal', label: 'ターミナル' },
    { id: 'dashboard', label: 'ダッシュボード' },
    { id: 'keyboard', label: 'キーボード' },
    { id: 'floating-kb', label: 'フローティングKB' },
    { id: 'input-mode', label: '入力モード' },
  ];

  return (
    <div className="fixed top-2 right-2 z-[100] flex gap-1 bg-zinc-900 border border-zinc-700 rounded-lg p-1 shadow-xl">
      {screens.map(s => (
        <button
          key={s.id}
          onClick={() => onChange(s.id)}
          className={`px-3 py-1 text-[11px] rounded-md transition-colors ${
            current === s.id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ─── Terminal Screen Prototype ────────────────────────────────────
function TerminalScreenProto() {
  const [activePane, setActivePane] = useState(0);
  const panes = [{ id: 0, label: 'main' }, { id: 1, label: 'sub' }];

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* ─── Top bar: session info + minimal actions ─── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0a] border-b border-white/[0.06]">
        {/* Session selector (left) */}
        <button className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-[13px] font-medium text-white truncate max-w-[140px]">CC Hub開発</span>
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        </button>

        <div className="flex-1" />

        {/* Core actions (right) - icon-only, compact */}
        <div className="flex items-center">
          <button className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors" title="会話履歴">
            <MessageSquare className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors" title="ファイル">
            <FileText className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors" title="ダッシュボード">
            <BarChart3 className="w-4 h-4" />
          </button>

          {/* Divider */}
          <div className="w-px h-4 bg-white/[0.06] mx-1" />

          <button className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors" title="リロード">
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors" title="共有">
            <Share2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ─── Pane tabs (only when multi-pane) ─── */}
      {panes.length > 1 && (
        <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 bg-white/[0.02] border-b border-white/[0.04]">
          {panes.map(pane => (
            <button
              key={pane.id}
              onClick={() => setActivePane(pane.id)}
              className={`px-2.5 py-0.5 text-[11px] rounded transition-colors ${
                activePane === pane.id
                  ? 'bg-white/[0.08] text-zinc-300'
                  : 'text-zinc-600 hover:text-zinc-400'
              }`}
            >
              {pane.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-0.5">
            <button className="p-1 text-zinc-600 hover:text-zinc-400 rounded transition-colors" title="縦分割">
              <SplitSquareVertical className="w-3 h-3" />
            </button>
            <button className="p-1 text-zinc-600 hover:text-zinc-400 rounded transition-colors" title="横分割">
              <SplitSquareHorizontal className="w-3 h-3" />
            </button>
            <button className="p-1 text-zinc-600 hover:text-zinc-400 rounded transition-colors" title="ズーム">
              <Maximize2 className="w-3 h-3" />
            </button>
            <button className="p-1 text-zinc-600 hover:text-zinc-400 rounded transition-colors" title="閉じる">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Terminal content (mock) ─── */}
      <div className="flex-1 bg-[#0c0c0c] font-mono text-[13px] text-zinc-300 p-3 overflow-hidden leading-relaxed">
        <div className="text-zinc-600">m0a@beelink-arch ~/cchub-work-1</div>
        <div className="mt-1"><span className="text-blue-400">❯</span> claude</div>
        <div className="mt-3 text-zinc-500">╭─────────────────────────────────────╮</div>
        <div className="text-zinc-500">│  <span className="text-white">Claude Code</span> <span className="text-zinc-600">v2.1.81</span>                  │</div>
        <div className="text-zinc-500">╰─────────────────────────────────────╯</div>
        <div className="mt-3 text-zinc-400">
          <span className="text-yellow-500/80">⏺</span> I'll redesign the UI with a modern clean style.
        </div>
        <div className="mt-2 text-zinc-600">
          Reading frontend/src/components/SessionList.tsx...
        </div>
        <div className="mt-1 text-zinc-600">
          Reading frontend/src/index.css...
        </div>
        <div className="mt-3">
          <span className="text-zinc-600">  </span>
          <span className="inline-block w-2 h-4 bg-zinc-500 animate-pulse" />
        </div>
      </div>

      {/* ─── Bottom status / keyboard trigger ─── */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-[#0a0a0a] border-t border-white/[0.06]">
        <div className="flex items-center gap-2 text-[11px] text-zinc-600">
          <span className="inline-flex items-center gap-1">
            <Wifi className="w-3 h-3" />
            12ms
          </span>
          <span>•</span>
          <span>Opus 4.6</span>
        </div>
        <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded-md hover:bg-white/[0.06] transition-colors">
          <KeyboardIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard Screen Prototype ──────────────────────────────────
function DashboardProto() {
  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between max-w-lg">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
            Dashboard
          </h1>
          <div className="flex items-center gap-1">
            <button className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors">
              <Settings className="w-[18px] h-[18px]" />
            </button>
            <button className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors">
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="md:grid md:grid-cols-2 md:gap-4 space-y-3 md:space-y-0">
          {/* Network latency card */}
          <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
            <h3 className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              ネットワーク
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-400">WebSocket</span>
                <span className="text-[13px] text-white font-mono tabular-nums">12ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-400">API</span>
                <span className="text-[13px] text-white font-mono tabular-nums">15ms</span>
              </div>
            </div>
          </div>

          {/* Usage card - will use existing UsageLimits/UsageChart component */}
          <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
            <h3 className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              使用量リミット
            </h3>
            <p className="text-[11px] text-zinc-600 mb-2">
              ※ 統合時は既存の UsageLimits コンポーネントをそのまま使用
            </p>
            {/* Faithful mockup of existing UsageChart for both cycles */}
            {[
              { label: '5時間サイクル', pct: 15, status: 'safe', msg: '余裕十分（リセットまで1h49m）', nowX: 140, points: '28,60 60,58 90,55 120,50 140,47' },
              { label: '7日間サイクル', pct: 11, status: 'safe', msg: '余裕十分（リセットまで4d 20h49m）', nowX: 140, points: '28,60 60,59 90,57 120,55 140,53' },
            ].map((cycle, ci) => (
              <div key={ci} className="mb-3 last:mb-0">
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-zinc-400">{cycle.label}</span>
                  <span className="text-zinc-400">{cycle.pct}%</span>
                </div>
                <svg viewBox="0 0 300 80" className="w-full" preserveAspectRatio="xMidYMid meet">
                  {/* Chart background */}
                  <rect x="28" y="4" width="264" height="60" fill="#1f2937" rx="2" />
                  {/* Y grid lines + labels */}
                  {[0, 50, 100].map(v => {
                    const y = 4 + 60 - (v / 110) * 60;
                    return (
                      <g key={v}>
                        <line x1="28" y1={y} x2="292" y2={y} stroke="#374151" strokeWidth="0.5" />
                        <text x="25" y={y + 3} textAnchor="end" fill="#6b7280" fontSize="7">{v}%</text>
                      </g>
                    );
                  })}
                  {/* Ideal pace line (diagonal) */}
                  <line x1="28" y1={4 + 60} x2="292" y2={4 + 60 - (100/110)*60} stroke="#6b7280" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />
                  {/* Gradient area */}
                  <defs><linearGradient id={`g${ci}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity="0.2" /><stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" /></linearGradient></defs>
                  <polygon points={`28,64 ${cycle.points} ${cycle.nowX},64`} fill={`url(#g${ci})`} />
                  {/* Actual line */}
                  <polyline points={`28,64 ${cycle.points}`} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" />
                  {/* Projection dashed line */}
                  {(() => {
                    const lastParts = cycle.points.split(' ').pop()?.split(',');
                    const lx = Number(lastParts?.[0]); const ly = Number(lastParts?.[1]);
                    const projY = Math.max(4, ly - (ly - 4) * 0.6);
                    return <line x1={lx} y1={ly} x2="292" y2={projY} stroke="#22c55e" strokeWidth="1" strokeDasharray="3,2" opacity="0.6" />;
                  })()}
                  {/* Current dot */}
                  {(() => {
                    const lastParts = cycle.points.split(' ').pop()?.split(',');
                    return <circle cx={Number(lastParts?.[0])} cy={Number(lastParts?.[1])} r="2.5" fill="#22c55e" stroke="#111827" strokeWidth="1" />;
                  })()}
                  {/* Now label */}
                  <text x={cycle.nowX} y="78" textAnchor="middle" fill="#9ca3af" fontSize="6">現在</text>
                  {/* Reset label */}
                  <text x="292" y="78" textAnchor="end" fill="#6b7280" fontSize="6">リセット</text>
                </svg>
                <div className="text-[10px] mt-0.5 text-green-400">{cycle.msg}</div>
              </div>
            ))}
          </div>

          {/* Daily activity card */}
          <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
            <h3 className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              日別アクティビティ
            </h3>
            <div className="flex items-end gap-2 h-20">
              {[65, 72, 30, 10, 45, 90, 55].map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-blue-500/80 rounded-sm min-h-[2px]"
                    style={{ height: `${v}%` }}
                  />
                  <span className="text-[9px] text-zinc-600">
                    {['月','火','水','木','金','土','日'][i]}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-zinc-600 text-center mt-2">今日: 1,391 メッセージ</div>
          </div>

          {/* Model usage card */}
          <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
            <h3 className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Model Usage
            </h3>
            {/* Stacked bar */}
            <div className="h-3 flex rounded-full overflow-hidden mb-3">
              <div className="bg-purple-500" style={{ width: '25%' }} />
              <div className="bg-blue-500" style={{ width: '35%' }} />
              <div className="bg-cyan-500" style={{ width: '40%' }} />
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="text-zinc-400">Opus 4.5</span>
                <span className="text-zinc-600">3.9M</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-zinc-400">Opus 4.6</span>
                <span className="text-zinc-600">4.3M</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-500" />
                <span className="text-zinc-400">Sonnet</span>
                <span className="text-zinc-600">2.3M</span>
              </span>
            </div>
          </div>
        </div>

        {/* Settings section */}
        <div className="mt-6 pt-4 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-2 max-w-lg">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 bg-white/[0.04] hover:bg-white/[0.06] rounded-md transition-colors">
              <Sun className="w-3.5 h-3.5" />
              ライト
            </button>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 bg-white/[0.04] hover:bg-white/[0.06] rounded-md transition-colors">
              <Globe className="w-3.5 h-3.5" />
              EN
            </button>
            <button className="text-[12px] text-zinc-600 hover:text-zinc-400 px-3 py-1.5 transition-colors">
              チュートリアルを再表示
            </button>
            <button className="text-[12px] text-zinc-600 hover:text-red-400 px-3 py-1.5 transition-colors">
              キャッシュクリア
            </button>
          </div>
          <div className="text-[11px] text-zinc-700 mt-3">CC Hub v0.1.6</div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared keyboard layout (matching existing Keyboard.tsx exactly) ──
type KType = 'normal' | 'modifier' | 'special' | 'action' | 'layer' | 'space';
type KColor = 'red' | 'default';
interface KKey { label: string; type?: KType; color?: KColor; flex?: number; icon?: boolean }

const ACTION_ROW: KKey[] = [
  { label: 'ESC', type: 'action' },
  { label: 'TAB', type: 'action' },
  { label: '^C', type: 'action', color: 'red' },
  { label: '^E', type: 'action' },
  { label: '^O', type: 'action' },
  { label: '📁', type: 'action' },
  { label: '🔗', type: 'action' },
];

const QWERTY_ROWS: KKey[][] = [
  // Row 1
  [...'qwertyuiop'.split('').map(k => ({ label: k })), { label: '⌫', type: 'special' as KType, flex: 1.5 }],
  // Row 2
  [...'asdfghjkl'.split('').map(k => ({ label: k })), { label: '↵', type: 'special' as KType, flex: 1.5, icon: true }],
  // Row 3
  [{ label: '⇧', type: 'modifier' as KType, flex: 1.5 }, ...'zxcvbnm'.split('').map(k => ({ label: k })), { label: '↑', type: 'special' as KType }, { label: '.' }],
  // Row 4
  [
    { label: '123', type: 'layer' as KType, flex: 1.5 },
    { label: 'CTRL', type: 'modifier' as KType },
    { label: 'ALT', type: 'modifier' as KType },
    { label: '', type: 'space' as KType, flex: 3 },
    { label: ',' },
    { label: '/' },
    { label: '←', type: 'special' as KType },
    { label: '↓', type: 'special' as KType },
    { label: '→', type: 'special' as KType },
  ],
];

function KeyBtn({ k, compact }: { k: KKey; compact?: boolean }) {
  const h = compact ? 'h-8' : 'h-[38px]';
  const text = compact ? 'text-[11px]' : 'text-[13px]';

  const cls = (() => {
    switch (k.type) {
      case 'modifier': return `bg-white/[0.06] text-blue-400 ${compact ? 'text-[9px]' : 'text-[10px]'}`;
      case 'layer': return `bg-white/[0.06] text-blue-400 ${compact ? 'text-[9px]' : 'text-[10px]'}`;
      case 'special': return 'bg-white/[0.08] text-zinc-300';
      case 'space': return 'bg-white/[0.04]';
      default: return 'bg-white/[0.08] text-white';
    }
  })();

  return (
    <button
      className={`${h} flex items-center justify-center rounded-md ${text} font-medium select-none active:bg-white/[0.15] transition-colors ${cls}`}
      style={{ flex: k.flex || 1, minWidth: 0 }}
    >
      {k.icon ? <CornerDownLeft className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> : k.label}
    </button>
  );
}

function ActionBtn({ k, compact }: { k: KKey; compact?: boolean }) {
  const h = compact ? 'h-[26px]' : 'h-[30px]';
  const text = compact ? 'text-[10px]' : 'text-[11px]';
  const bg = k.color === 'red' ? 'bg-red-500/15 text-red-400' : 'bg-white/[0.06] text-zinc-400';
  return (
    <button className={`${h} min-w-[34px] px-1.5 flex items-center justify-center rounded-md ${text} font-medium select-none ${bg} active:bg-white/[0.12]`}>
      {k.label}
    </button>
  );
}

function KeyboardLayout({ compact }: { compact?: boolean }) {
  return (
    <>
      {/* Action bar */}
      <div className="flex gap-1 px-0.5 py-1 overflow-x-auto">
        {ACTION_ROW.map((k, i) => <ActionBtn key={i} k={k} compact={compact} />)}
      </div>
      <div className="h-px bg-white/[0.04] mx-0.5" />
      {/* QWERTY */}
      <div className="px-0.5 py-1 space-y-[3px]">
        {QWERTY_ROWS.map((row, ri) => (
          <div key={ri} className="flex gap-[3px]">
            {row.map((k, ki) => <KeyBtn key={ki} k={k} compact={compact} />)}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Keyboard Prototype (Mobile) ─────────────────────────────────
function KeyboardProto() {
  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Terminal area (compressed) */}
      <div className="flex-1 bg-[#0c0c0c] font-mono text-[13px] text-zinc-300 p-3 overflow-hidden">
        <div className="text-zinc-600">m0a@beelink-arch ~/cchub-work-1</div>
        <div className="mt-1"><span className="text-blue-400">❯</span> claude</div>
        <div className="mt-3 text-zinc-400">
          <span className="text-yellow-500/80">⏺</span> Working on the redesign...
        </div>
        <div className="mt-2">
          <span className="inline-block w-2 h-4 bg-zinc-500 animate-pulse" />
        </div>
      </div>
      {/* ─── Keyboard area ─── */}
      <div className="shrink-0 bg-[#111111] border-t border-white/[0.06] pb-1">
        {/* Mode toggle header */}
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/[0.04]">
          <div className="inline-flex bg-white/[0.04] rounded-md p-0.5">
            <button className="px-3 py-1 text-[11px] bg-white/[0.08] text-zinc-300 rounded font-medium">キーボード</button>
            <button className="px-3 py-1 text-[11px] text-zinc-600 rounded font-medium">入力</button>
          </div>
          <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <KeyboardLayout />
      </div>
    </div>
  );
}

// ─── Floating Keyboard Prototype (Tablet) ─────────────────────────
function FloatingKeyboardProto() {
  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Terminal area */}
      <div className="flex-1 bg-[#0c0c0c] font-mono text-[13px] text-zinc-300 p-3 overflow-visible relative">
        <div className="text-zinc-600">m0a@beelink-arch ~/cchub-work-1</div>
        <div className="mt-1"><span className="text-blue-400">❯</span> claude</div>
        <div className="mt-3 text-zinc-400">
          <span className="text-yellow-500/80">⏺</span> Working on the redesign...
        </div>

        {/* Floating keyboard overlay */}
        <div className="absolute top-[30%] left-4 max-w-[420px] w-[calc(100%-2rem)] bg-[#111111]/95 backdrop-blur-md border border-white/[0.08] rounded-lg shadow-2xl overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] cursor-move">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                <div className="w-1 h-3 bg-zinc-700 rounded-full" />
                <div className="w-1 h-3 bg-zinc-700 rounded-full" />
              </div>
              <div className="inline-flex bg-white/[0.04] rounded p-0.5 ml-1">
                <button className="px-2 py-0.5 text-[10px] bg-white/[0.08] text-zinc-300 rounded">キーボード</button>
                <button className="px-2 py-0.5 text-[10px] text-zinc-600">入力</button>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {/* Same keyboard layout, compact mode */}
          <KeyboardLayout compact />
        </div>
      </div>
    </div>
  );
}

// ─── Input Mode Prototype (Tablet floating) ───────────────────────
function InputModeProto() {
  const [inputValue, setInputValue] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const mockHistory = ['おまかせします', 'コミットしてください', '確認お願いします', 'レビューして'];

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Terminal area */}
      <div className="flex-1 bg-[#0c0c0c] font-mono text-[13px] text-zinc-300 p-3 overflow-visible relative">
        <div className="text-zinc-600">m0a@beelink-arch ~/cchub-work-1</div>
        <div className="mt-1"><span className="text-blue-400">❯</span> claude</div>
        <div className="mt-3 text-zinc-400">
          <span className="text-yellow-500/80">⏺</span> Working on the redesign...
        </div>

        {/* Floating input mode overlay */}
        <div className="absolute top-[25%] left-4 max-w-[420px] w-[calc(100%-2rem)] bg-[#111111]/95 backdrop-blur-md border border-white/[0.08] rounded-lg shadow-2xl overflow-hidden">
          {/* Header bar - same as keyboard but "入力" is active */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] cursor-move">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                <div className="w-1 h-3 bg-zinc-700 rounded-full" />
                <div className="w-1 h-3 bg-zinc-700 rounded-full" />
              </div>
              <div className="inline-flex bg-white/[0.04] rounded p-0.5 ml-1">
                <button className="px-2 py-0.5 text-[10px] text-zinc-600 rounded">キーボード</button>
                <button className="px-2 py-0.5 text-[10px] bg-white/[0.08] text-zinc-300 rounded">入力</button>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Input content */}
          <div className="p-2.5">
            {/* History dropdown */}
            {showHistory && (
              <div className="max-h-28 overflow-y-auto border border-white/[0.06] rounded-md bg-[#0a0a0a] mb-2">
                {mockHistory.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => { setInputValue(item); setShowHistory(false); }}
                    className="w-full text-left px-3 py-2 text-[12px] text-zinc-300 hover:bg-white/[0.06] border-b border-white/[0.04] last:border-b-0 truncate transition-colors"
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}

            {/* Textarea */}
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="日本語入力 - Enter×2で送信"
              rows={2}
              className="w-full px-3 py-2 bg-[#0a0a0a] border border-white/[0.08] rounded-md text-[13px] text-white placeholder:text-zinc-700 focus:outline-none focus:border-blue-500/50 resize-none mb-1.5"
              style={{ fontSize: '16px' }}
            />

            {/* Bottom button row */}
            <div className="flex items-center gap-1.5">
              {/* Left group: history, file picker */}
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`h-9 w-9 flex items-center justify-center rounded-md transition-colors ${
                  showHistory ? 'bg-blue-600 text-white' : 'bg-white/[0.06] text-zinc-400 active:bg-white/[0.1]'
                }`}
              >
                <Clock className="w-4 h-4" />
              </button>
              <button className="h-9 w-9 flex items-center justify-center rounded-md bg-white/[0.06] text-zinc-400 active:bg-white/[0.1]">
                <FileText className="w-4 h-4" />
              </button>
              {/* Clear (only when has text) */}
              {inputValue && (
                <button
                  onClick={() => setInputValue('')}
                  className="h-9 w-9 flex items-center justify-center rounded-md bg-white/[0.06] text-zinc-500 active:bg-white/[0.1]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              <div className="flex-1" />

              {/* Right group: arrow up, arrow down, send */}
              <button className="h-9 w-9 flex items-center justify-center rounded-md bg-white/[0.06] text-zinc-400 active:bg-white/[0.1]">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button className="h-9 w-9 flex items-center justify-center rounded-md bg-white/[0.06] text-zinc-400 active:bg-white/[0.1]">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button className="h-9 w-9 flex items-center justify-center rounded-md bg-blue-600 active:bg-blue-700 text-white">
                <CornerDownLeft className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Preview ────────────────────────────────────────────────
export function DesignPreview() {
  const [screen, setScreen] = useState('sessions');

  return (
    <div style={{ width: '100%', height: '100dvh', overflow: 'hidden' }}>
      <ScreenSelector current={screen} onChange={setScreen} />
      {screen === 'sessions' && <SessionListRedesign />}
      {screen === 'terminal' && <TerminalScreenProto />}
      {screen === 'dashboard' && <DashboardProto />}
      {screen === 'keyboard' && <KeyboardProto />}
      {screen === 'floating-kb' && <FloatingKeyboardProto />}
      {screen === 'input-mode' && <InputModeProto />}
    </div>
  );
}
