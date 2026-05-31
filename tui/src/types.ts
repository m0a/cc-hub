// TUI ローカル状態の型。サーバ由来の列挙/サブ型は `shared` を再利用する。
import type { AgentProvider, IndicatorState, PaneInfo } from 'shared';

export type ConnectionState = 'connected' | 'server-down' | 'unauthorized';

export interface ConnectionInfo {
  state: ConnectionState;
  /** 接続先 base URL（例: https://127.0.0.1:5923） */
  baseUrl: string;
  /** connected 時: 検出したセッション数 */
  sessionCount?: number;
  /** server-down / unauthorized 時の人間向けメッセージ */
  error?: string;
}

/**
 * GET /api/sessions の各要素。`shared` の SessionResponse は最小定義のため、
 * 実レスポンス（実機確認済み）で使うフィールドを明示した TUI 側の型。
 */
export interface TuiSession {
  id: string;
  name: string;
  state?: string;
  agent?: AgentProvider;
  currentCommand?: string;
  currentPath?: string;
  customTitle?: string;
  paneTitle?: string;
  indicatorState?: IndicatorState;
  panes?: PaneInfo[];
}

/** 一覧 1 行ぶんの表示用導出データ（純粋関数で算出 → テスト対象） */
export interface DerivedRow {
  title: string;
  agentLabel: string;
  indicator?: IndicatorState;
  paneCount: number;
  path: string;
}

/** 一覧ビューがループ側へ返すアクション */
export type ListAction = { type: 'quit' } | { type: 'attach'; sessionName: string };
