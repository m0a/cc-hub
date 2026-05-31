// TUI ローカル状態の型。サーバ由来の型は `shared/types.ts` を直接再利用する。

export type ConnectionState = 'connected' | 'server-down' | 'unauthorized';

export interface ConnectionInfo {
  state: ConnectionState;
  /** 接続先 base URL（例: http://127.0.0.1:5923） */
  baseUrl: string;
  /** connected 時: 検出したセッション数（Foundational の疎通確認用） */
  sessionCount?: number;
  /** server-down / unauthorized 時の人間向けメッセージ */
  error?: string;
}
