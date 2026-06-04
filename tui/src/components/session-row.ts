// 一覧 1 行の導出ロジック（純粋関数 / JSX なし → 単体テスト対象）。
import type { IndicatorState } from 'shared';
import type { DerivedRow, TuiSession } from '../types';

// 注意度の高い状態を行の代表に採用する優先度。
const URGENCY: Record<IndicatorState, number> = {
  waiting_input: 3,
  processing: 2,
  completed: 1,
  idle: 0,
};

/** セッションの代表 indicatorState を導出（トップレベル優先 → 無ければペインで最も注意度の高いもの）。 */
export function deriveIndicator(session: TuiSession): IndicatorState | undefined {
  if (session.indicatorState) return session.indicatorState;
  const fromPanes = (session.panes ?? [])
    .map((p) => p.indicatorState)
    .filter((s): s is IndicatorState => Boolean(s));
  if (fromPanes.length === 0) return undefined;
  return fromPanes.reduce((best, cur) => (URGENCY[cur] > URGENCY[best] ? cur : best));
}

export interface IndicatorGlyph {
  glyph: string;
  color: string;
}

/** indicatorState を表示用のグリフ＋色へ。 */
export function indicatorGlyph(indicator: IndicatorState | undefined): IndicatorGlyph {
  switch (indicator) {
    case 'waiting_input':
      return { glyph: '●', color: 'red' };
    case 'processing':
      return { glyph: '◐', color: 'yellow' };
    case 'idle':
      return { glyph: '○', color: 'green' };
    case 'completed':
      return { glyph: '✓', color: 'cyan' };
    default:
      return { glyph: '·', color: 'gray' };
  }
}

/** $HOME を `~` に畳んでパスを短縮。 */
export function shortenPath(path: string | undefined): string {
  if (!path) return '';
  const home = process.env.HOME;
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

/** 分 → 人間向けの経過時間（"45m" / "18h" / "3d"）。 */
export function formatDuration(minutes: number | undefined): string {
  if (!minutes || minutes < 1) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** トークン数 → "12.3k" / "7.2M"。 */
export function formatTokens(n: number | undefined): string {
  if (!n || n <= 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** カードに出す「いま何をしているか」のテキスト（paneTitle 優先、無ければ要約）。 */
export function taskText(session: TuiSession): string {
  const pane = (session.paneTitle ?? '').trim();
  if (pane) return pane;
  return (session.ccSummary ?? '').replace(/\s+/g, ' ').trim();
}

/** セッション → 表示用の行データ。 */
export function deriveRow(session: TuiSession): DerivedRow {
  return {
    title: session.customTitle?.trim() || session.name,
    agentLabel: session.agent ?? '',
    indicator: deriveIndicator(session),
    paneCount: session.panes?.length ?? 0,
    path: shortenPath(session.currentPath),
  };
}
