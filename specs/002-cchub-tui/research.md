# Phase 0 Research: CC Hub TUI

調査済みの設計判断を記録する。すべての NEEDS CLARIFICATION は解決済み。

## R1. データ取得方式 — サーバのクライアント vs スタンドアロン

- **Decision**: 起動中のローカル CC Hub サーバの**クライアント**として実装し、既存 HTTP/WS API を消費する。
- **Rationale**: hook 由来の状態インジケータ（processing/waiting_input 等）はサーバプロセスのメモリ（`backend/src/routes/notify.ts` の `stateOverrides` Map）に保持される。別プロセスのスタンドアロンでは参照できない。さらに ps 横断・jsonl 照合・metadata 復元を含む集約（`backend/src/routes/sessions.ts` の buildSessions 相当、~270行）をサーバが既に行っており、クライアント方式なら結果だけ再利用できる。jsonl/ps ベースの状態推定は v0.1.41 で意図的に廃止済みのため、スタンドアロンでの再現は退行になる。
- **Alternatives considered**: スタンドアロン（tmux 直叩き）→ 状態インジケータを失い集約ロジックの再実装が必要。`cchub notify` に状態ファイル出力を足す案 → 追加配線が必要で複雑。

## R2. 配布形態 — サブコマンド vs 独立バイナリ

- **Decision**: 既存 CLI の新サブコマンド `cchub tui`。
- **Rationale**: `backend/src/cli.ts` は各サブコマンドを動的 `import()` で lazy ロードする綺麗なディスパッチャ（`case 'send' → import('./commands/send')` 等）。`case 'tui'` を1つ足すだけで、他コマンドの起動性能に無影響。`shared/types.ts`・version・ビルド・`cchub update` を共有でき、TUI も自動最新化される。インストールは単一バイナリのまま。
- **Alternatives considered**: 独立バイナリ `cchub-tui` → Ink/React 依存を本体から分離できるが、別途インストール/更新運用が増え、ローカル前提では分離の利点が薄い。lazy-import で本体バイナリ肥大も他パスへ無影響。

## R3. TUI 描画ライブラリ

- **Decision**: Ink（React for CLI）を Bun 上で使用。
- **Rationale**: フロントの React 知見をそのまま流用でき、一覧・検索・詳細を宣言的に記述できる。更新頻度 1–5s なら性能は十分。
- **Alternatives considered**: blessed/低レベル ANSI → React と別パラダイムで知見流用が効かない。生 ANSI → 低レベルすぎる。
- **Risk / Spike**: Ink × Bun の raw-mode 入力・alt-screen 復帰・子プロセスハンドオフ時の stdin/stdout 制御に互換懸念。**実装着手前に最小スパイク1本**（キー入力受領 → alt-screen 退出 → 子プロセス起動 → 復帰 → 再描画）で確認する。
- **Spike 結果（2026-05-31, PASS）**: `Bun 1.3.11` + `ink@7.0.5` + `react@19.2.6` で検証。① raw-mode キー入力 ② `Bun.spawnSync({stdio:'inherit'})` での子プロセスへの TTY 委譲 ③ 子終了後の Ink 再描画 ④ 後始末（alt-screen 復帰）すべて成立。ハンドオフ方式は alt-screen トグル（`\x1b[?1049h/l`）+ stdio 継承子プロセス。JSX は Bun が native トランスパイル（tsconfig 非依存）。→ 中核前提（attach 委譲）が実証済み。

## R4. 端末ハンドオフ（入室）

- **Decision**: 入室時に Ink の alt-screen/raw-mode を解除し、`tmux attach -t <name>` を **stdio 継承**で子プロセス起動。終了（detach）で TUI を復帰・再描画する。
- **Rationale**: 端末の完全な忠実度（マウス・スクロール・コピー・TUI アプリ）をゼロ再実装で得られる。Web 版で最重量の viewport プロトコルがローカルでは不要になる。
- **`$TMUX` ネスト対処**: TUI 自身が tmux 内から起動されると `tmux attach` が "sessions should be nested with care" で拒否される（CLAUDE.md 既知）。`process.env.TMUX` を検知し、(a) 既存クライアントなら `tmux switch-client -t <name>`、(b) それ以外は `env -u TMUX` 相当で `attach` を実行、のいずれかにフォールバックする。判定とコマンド構築は純粋関数化して単体テストする。
- **Alternatives considered**: viewport プロトコルの TUI 再実装 → 本機能が排除しようとしている複雑性そのもの。

## R5. データ更新頻度（一覧）

- **Decision**: MVP は `GET /api/sessions` を 2–3s 間隔でポーリング。Phase2 で `/ws/mux` の `sessions-updated`（5s push）+ `hook-event` を購読して状態を即時反映。
- **Rationale**: サーバ側 listSessions は 2s TTL でキャッシュされており、短間隔ポーリングでも実コストは低い。ポーリングは実装が単純で MVP に最適。即時性が要るのは hook-event の状態フリップで、これは Phase2 の WS で改善。
- **Alternatives considered**: 初手から WS → MVP には過剰。

## R6. 認証（ゼロコンフィグ）

- **Decision**: サーバが `CCHUB_PASSWORD` 未設定なら認証不要（API 全開放）。設定済みなら、同一マシン・同一ユーザの利点を使い、データディレクトリの `jwt-secret`（0600）を読んで `AuthService` でローカルトークンを自己発行し Bearer に載せる。パスワードの手入力は不要。
- **Rationale**: `backend/src/middleware/auth.ts` の `conditionalAuthMiddleware` は `CCHUB_PASSWORD` の有無のみで認証要否を切替え、localhost バイパスは無い。だが TUI はサーバと同一ユーザで動くため `jwt-secret`（`getDataDir()` 配下）を読めるので、トークン自己発行でゼロコンフィグを実現できる。
- **Alternatives considered**: パスワード手入力プロンプト（UX 劣化）、サーバ側に localhost バイパス追加（サーバ変更が必要で本機能のスコープ外）。

## R7. 履歴検索

- **Decision**: `GET /api/sessions/history/search`（同期）と `/api/sessions/history/search/stream`（SSE 逐次）を消費。入力はデバウンスし、SSE で結果を逐次表示。`POST /api/sessions/history/resume` で再開し、生成された tmux セッションへ attach。
- **Rationale**: Web の SessionHistory.tsx が使う完成済みエンドポイント群をそのまま再利用できる。SSE はクエリ追従の逐次表示（SC-004）に適する。
- **Alternatives considered**: クライアント側で全履歴を取得して絞り込み → 大量履歴でコスト高、サーバの検索を再発明することになる。

## R8. テスト戦略（原則I: TDD 準拠）

- **Decision**: 純粋ロジック（auth トークン発行 / client 整形 / attach コマンド構築 / `$TMUX` 検知 / 整形・選択）を関数として切り出し、Bun test で Red-Green-Refactor。Ink コンポーネントは ink-testing-library。結合は dev サーバ相手の手動確認。
- **Rationale**: 対話 TUI は完全自動 E2E が難しいため、ロジックを抽出してテスト可能性を最大化する。憲章のカバレッジ 80% を満たす。
