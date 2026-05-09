# Changelog

All notable changes to this project will be documented in this file.

## [0.1.105] - 2026-05-09

### Added
- ターミナル遅延の end-to-end 計測用 instrumentation を追加（ssh+termux との比較用、本番動作には影響なし）
  - `CCHUB_BENCH=1` で起動するとバックエンドが WebSocket 送信ごとにフレームサイズ・送信所要時間・タイムスタンプをログ出力
  - フロントエンドに `window.__cchub_bench` を公開: `start()` で計測開始、受信フレーム数・xterm.js parse 時間 (P50/P95/Max)・スループットを記録
  - 受信ストリームに `__BENCH_END__` マーカーが現れると自動で集計レポートを `console.table` 出力
  - `scripts/prepare-bench-data.sh` で 4 種類のベンチ用データ (`/tmp/bench-{plain,color,jp,redraw}.txt`) を生成

## [0.1.104] - 2026-05-09

### Fixed
- Lost セッションの Resume ボタンを押しても新しい tmux セッションへ自動で切り替わらない問題を修正
  - `useCallback` クロージャ内で古い `sessions` 配列を `find` していたため、resume API で作成された新セッションが見つからず navigation が呼ばれなかった
  - API レスポンスと lost セッションのメタデータから直接セッションオブジェクトを組み立てて即座に遷移するよう変更
- Claude セッションでアクティブな Resume バッジ条件が壊れていた回帰を修正
  - `d4d570d` (Codex MVP) で `!isClaudeRunning` を `!supportsConversationMetadata` に取り違えていたため、Claude では絶対にバッジが出ない状態だった
  - agent プロセス検出ベースで条件を再構築

### Added
- Codex 使用量ダッシュボードに limit 到達予測時刻 (`estimatedHitTime`) を追加
  - Anthropic と同じ計算ロジックで、現在のペースから 100% 到達時刻を予測
  - 予測がある場合は status を `danger` に格上げし、チャートのマーカーと文言を一致させる

## [0.1.103] - 2026-05-08

### Fixed
- Codex 使用量ダッシュボードで 5h cycle の reset 時刻を過ぎても exhausted 状態が残り、制限超過表示が継続していた問題を修正 (#136)
  - `credits.has_credits === false` の exceeded 上書きは、5h cycle の `resetsAt` が未来の場合だけ適用
  - reset 後は最新の windowed rate limit を優先し、古い no-credits イベントで 100% 表示に戻さない
- Usage チャートが cycle start に人工的な 0% 点を追加していたため、履歴が少ない cycle で縦方向のスパイクが描画される問題を修正 (#136)
  - 実サンプルのみを時系列ソートして描画

## [0.1.102] - 2026-05-08

### Fixed
- Lost セッション（再起動などで tmux から消えたセッション）の Resume ボタンが Codex セッションでも Claude として復活していた問題を修正 (#134)
  - `LastKnownSession` に `agentSessionId` を追加し、再起動を跨いで Codex thread id を保持
  - Resume 時は `session.agent` に応じて conversation id を選択（Codex → `agentSessionId`、Claude → `ccSessionId`）し、`/sessions/history/resume` に渡す
  - conversation id が無い場合のフォールバックも `createSession` に元の agent を渡すように変更（旧挙動: claude 固定）

## [0.1.101] - 2026-05-08

### Added
- Codex セッションの会話履歴ビューア (#132)
  - ペインヘッダーの Terminal ↔ Chat トグル（既存ボタン）を Codex セッションでも有効化
  - `~/.codex/sessions/.../rollout-*.jsonl` を読み取り、`user_message` / `agent_message` をテキストとして、`function_call` / `function_call_output` を toolUse / toolResult として Claude 互換の `ConversationMessage[]` に変換
  - HTTP polling (5秒間隔) で会話を取得・更新（Codex 側に WebSocket hook がないため）
  - ConversationViewer の役割ラベルを agent 別に切替（Codex セッションでは "Codex" 表示）
- 各 agent の会話取得方式を統一する `useAgentConversation` ファサード hook
  - Claude → WebSocket stream / Codex → HTTP polling / 不明な agent → 明示的なエラー表示
  - 新しい agent を足すときは ChatView を触らずファサードに分岐を追加するだけ

### Fixed
- DesktopLayout のセッション merge で `agent` / `agentSessionId` がコピーされず、Codex セッションの会話表示が同じ cwd の Claude jsonl にフォールバックしていた問題を修正
- ChatView が `agent` 未指定時に暗黙的に Claude WebSocket にフォールバックしていた挙動を撤廃。未対応 agent は中央寄せのエラーメッセージを表示

## [0.1.100] - 2026-05-07

### Added
- ダッシュボードに Codex 用の使用量リミット表示を追加 (#130)
  - `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` の `token_count` イベントに含まれる `rate_limits` を読み取り、Anthropic Usage Limits と同じ形のチャートで表示
  - `primary` / `secondary` を `window_minutes` で 5h/7d に振り分け（24h 未満は短期サイクル扱い）
  - ダッシュボード上部に `Claude` / `Codex` の agent タブを追加（両方のデータが存在するときのみ表示）。片方しか無い環境では自動でそちら側を表示
  - `UsageLimits` コンポーネントを optional cycle 対応にリファクタし、未対応 cycle を「現在のプランでは未対応」プレースホルダで表示
  - plan_type を見出し横にバッジ表示（free / plus 等）
- Codex のレート制限到達検知 (#130)
  - `credits.has_credits === false` を検出すると `rateLimitExceeded` フラグを立て、5h cycle を 100% / exceeded で上書き、ダッシュボードに赤いバナーを表示
  - OpenAI はリミット到達時に primary/secondary を null で返すため、その後の rollout イベントで誤って古いデータを表示してしまう問題への対処も兼ねる

### Fixed
- プラン遷移後に rate_limits が空イベントになる問題への対処 (#130)
  - 例: free → plus に upgrade した直後の rollout は windows が null だが plan_type は更新済み。windows が populated されている最新イベントを別途追跡して、グラフ用データと plan/credits 用データを独立に取得する構造に変更

## [0.1.99] - 2026-05-07

### Fixed
- Codex セッションの resume が Claude セッションとして起動してしまう問題を修正 (#128)
  - `POST /sessions/:id/resume` と `POST /sessions/history/resume` が `claude -r` 固定だったため、Codex セッションを resume すると claude が起動していた
  - `AGENT_PROVIDERS` に `resumeCommand` を追加し、`agentResumeCommand(agent, sessionId)` ヘルパー経由で組み立てる構造に統一
  - active セッションの resume は tmux ペインで検出された agent を採用（リクエストボディでの override も可能）
  - 履歴からの resume はリクエストボディの `agent` フィールドを参照
  - フロント (App.tsx / SessionList.tsx) は resume API 呼び出し時に `session.agent` を渡すよう変更

## [0.1.98] - 2026-05-07

### Added
- Codex (OpenAI) を agent provider として追加 (#127)
  - セッション作成時に `agent: codex` を指定可能（デフォルトは claude）
  - セッション一覧/メタデータ行に agent badge を表示（Lost セッションも含む）
  - `~/.codex/state_5.sqlite` から Codex thread のメタデータ（タイトル、初回プロンプト、git branch）を読み取り表示
  - rollout ファイル末尾を tail して Codex の context token 使用量を読み取り、Claude と同等のメトリクス表示に対応
  - 同一ディレクトリで同じ agent が走っているかどうかをチェックする重複判定ロジックを追加

## [0.1.97] - 2026-05-01

### Fixed
- Model Usage チャートで Opus 4.5 / 4.6 / 4.7 の色がほぼ同じで判別できなかった問題を修正
  - Opus 4.7 が `startsWith('Opus')` のフォールバックで Opus 4.6 と同じ `bg-purple-500` になっていた
  - Opus 4.5 → `bg-fuchsia-500`、Opus 4.6 → `bg-violet-400`、Opus 4.7 → `bg-indigo-500` と色相段階に分散して識別性を改善

## [0.1.96] - 2026-05-01

### Fixed
- セッションリストの `ctx` インジケーターが macOS で常に 100%(赤)になる問題を修正 (#125)
  - `anthropic-models.ts` が `~/.claude/.credentials.json` のみ参照しており、Keychain にトークンを保存している新しい Claude Code 環境で `/v1/models` 取得に失敗
  - 結果として `contextMaxTokens` が fallback の 200,000 になり、Opus 4.7 (1M context) のような実際の上限が大きいセッションで `contextPercent` が 100 で頭打ちになっていた
  - file → Keychain のトークン取得ロジックを `utils/claude-credentials.ts` に共通化し、`anthropic-models.ts` / `anthropic-usage.ts` 両方で利用
  - `anthropic-models.ts` の User-Agent も `cchub/<version>` に変更(v0.1.93 で `anthropic-usage.ts` に行った変更を踏襲)
  - Linux は元から `.credentials.json` ベースで動いていたため挙動変更なし

## [0.1.95] - 2026-04-30

### Fixed
- 会話履歴ボタンが macOS で常に disabled になる問題を修正 (#123)
  - 非標準パス(`~/.local/bin/claude`、`/opt/homebrew/bin/claude` 等)で起動した Claude Code を `isClaudeProcess` が認識できず、ペインの `currentCommand` が tmux の `pane_current_command` (バージョン番号 `2.1.123` 等) のまま伝搬していた
  - `isClaudeProcess` の判定を `/(?:^|\/)claude(?:\s|$)/` 正規表現ベースに変更し、フルパス起動を含む全パターンを検出
  - `buildSessionsList` で ps ベースの検出結果を使ってペインレベルの `currentCommand` も `'claude'` に正規化(従来は session レベルのみ正規化されていた)
  - Linux の挙動は変更なし(元から `pane_current_command` が `claude` を正しく返す)

## [0.1.94] - 2026-04-30

### Added
- macOS Keychain によるパスワード保存 (#121)
  - `cchub setup -P pass` で渡されたパスワードを `~/Library/LaunchAgents/com.cchub.server.plist` に直接埋め込む代わりに、macOS Keychain (`service: cchub`) に保存
  - `cchub` 起動時の優先順位: `-P` CLI 引数 → `CCHUB_PASSWORD` 環境変数 → Keychain
  - 起動ログにパスワード取得元を表示 (`(Keychain)` / `(env)`)
  - `cchub uninstall` で Keychain エントリも削除
  - 既存インストールは plist の `-P` がそのまま使われるため互換性あり。Keychain への移行は次回の `cchub setup -P pass` で自動的に行われる
  - Linux はヘッドレスサービス向けの信頼できる secret store がないため従来の `EnvironmentFile` 方式を維持

### Fixed
- `cchub --help` で `setup` の説明が常に「systemd service setup」となっていたのを「Register service (systemd on Linux, launchd on macOS)」に変更
- launchd plist の文字列補間に XML エスケープを追加（`<`, `>`, `&`, `"`, `'` を含むパスワードでも plist が壊れない）

## [0.1.93] - 2026-04-30

### Fixed
- セッションリストのステータス表示が macOS で正しく動作するよう修正 (#119)
  - `/api/notify/hook-status` が必須4イベント（Stop / PreToolUse / UserPromptSubmit / PostToolUse[AskUserQuestion]）を個別検証するように変更
  - 設定不足時のセットアップバナーが「全くないとき」だけでなく「不足があるとき」に表示されるように
  - セットアップ用プロンプトが4イベントすべてをカバー、`prompt-recorder.sh` 等の既存 hook を保持するよう Claude へ指示
- 手動 `/recap` slash command の出力がセッションリストに反映されるように修正
  - `readLastAwaySummary` → `readLastRecap` にリネームし、`subtype:'local_command'` も `<command-name>/recap</command-name>` を直前の user entry に持つ場合は recap として採用
  - 自動 `away_summary` と手動 `/recap` のうち最新を採用
- `readLastLines` のバッファ推定不足を修正
  - 200 バイト/行 → 2KB/行スタートで不足時は 4倍ずつリトライ（2K → 8K → 32K）、最終手段は全読み
  - Claude Code の JSONL は tool result 埋め込みで平均 2KB/行のため、`300` 指定でも実質 28 行しか読めていなかった
- `cchub status` が macOS で `systemctl not found` で落ちる問題を修正
  - `platform()` で OS 判定し、`darwin` では `launchctl list com.cchub.server` を使用、PID と LastExitStatus を表示

### Added
- Anthropic API の使用量取得エラーをダッシュボードに表示
  - エラー種別（rate-limited / no-credentials / unauthorized / fetch-failed / unknown）に応じたメッセージ
  - レート制限中はキャッシュ値を `(showing cached value)` バッジ付きで表示し、再試行までのカウントダウンを表示
  - 429 レスポンスの `Retry-After` ヘッダーを尊重（5分〜1時間にクランプ）
- macOS Keychain からの OAuth トークン取得をサポート
  - 新しい Claude Code が `~/.claude/.credentials.json` ではなく Keychain (`Claude Code-credentials`) に資格情報を保存するため、フォールバックを追加
- `User-Agent` を `cchub/<version>` に変更（旧 `claude-code/2.0.32` は Claude Code への impersonation だったため）
- DashboardPanel の幅を画面サイズに応じて拡張（xl: 420px、2xl: 480px）

### Changed
- `.gitignore` に `.claude-user-prompts/`、`.playwright-mcp/`、ルート直下 `*.png` を追加（ローカル開発の副産物を除外）

## [0.1.92] - 2026-04-29

### Changed
- 会話履歴ビューの背景色をセッションテーマカラーに同期
  - ターミナル背景と一致した色（pink / indigo / teal 等）でチャットビュー全体（コンテナ・エコー行・ローディング表示）を着色
  - 視覚的な一体感を向上、セッション切替時のテーマも追従

## [0.1.91] - 2026-04-29

### Added
- 会話履歴ビュー（chat mode）を追加 (#116)
  - ターミナルの xterm 領域を Claude の会話履歴に置き換える別表示モード。`fs.watch` で JSONL を監視しリアルタイム更新（150ms debounce）
  - WebSocket プロトコルに `subscribe-conversation` / `initial-conversation` / `conversation-update` / `unsubscribe-conversation` を追加
  - ペインヘッダーの単一アイコントグルでターミナル⇄会話履歴を切替（Claude 起動中のみ有効）
  - ペインごと・セッションごとの表示モードを localStorage に永続化（split/再マウントでも維持）
  - 「処理中」「入力待ち」バッジを `indicatorState` ベースに統一（接続状態ではなく Claude の実状態を反映）
- インライン画像のライトボックス表示
  - 会話履歴・Read 等のツール結果に含まれる画像をタップで全画面表示。背景タップ／×ボタン／Esc で閉じる
- 会話履歴のフォントサイズ調整
  - ピンチズーム / 左下のフォントコントロール（−／A／＋）でサイズ変更、localStorage に永続化
  - 通常時は `Aa` の小トリガーのみ表示、変更時のみフルコントロール表示
- 入力エコー行
  - FloatingKeyboard / InputBar から送信した文字を会話履歴下部にプロンプト風表示。送信先（ターミナル）が隠れていても入力中の文字を確認可能
- 入力フォーム（デスクトップ）
  - PC では会話履歴の下に textarea + 送信ボタンを表示。モバイルは Terminal InputBar、タブレットは FloatingKeyboard を流用

### Changed
- 会話履歴ビューの情報密度を向上（メッセージ間隔・行高・マージンの全体的な詰め）
- ペインヘッダーのターミナル/チャット切替を 2 アイコンから単一アイコン（切替先表示）方式に変更
- ペインが 1 つしかない時は close（×）と zoom（最大化）ボタンを非表示
- スクロール時のキーボード制御
  - 会話履歴を上にスクロールするとソフトキーボードを自動非表示にし表示領域を拡大
  - 一番下まで戻るとキーボードを再表示（タッチ駆動 + 600ms クールダウンでレイアウトシフトの振動を防止）

## [0.1.90] - 2026-04-28

### Fixed
- モバイル端末で FileViewer の Copy Prompt ボタンを押してもプロンプトテキストが入力欄に挿入されない不具合を修正 (#114)
  - 6 週間前の Terminal.tsx 分割リファクタで失われていた InputBar へのテキスト注入経路を復元
  - InputBar に forwardRef + useImperativeHandle で `setText(text)` を公開

## [0.1.89] - 2026-04-27

### Changed
- セッションカードの recap テキスト色を `text-zinc-400` (灰) → `text-amber-200` (薄い琥珀) に変更し、暗背景での視認性とカードの華やかさを改善
- recap タイムスタンプを `text-zinc-600` → `text-zinc-500` に微調整

## [0.1.88] - 2026-04-27

### Fixed
- macOS で `/api/sessions` のレスポンスから `currentPath` / `panes` / `ccSummary` 等が欠落していた問題を修正 (#110)
  - `ps -eo tty,args --no-headers` (GNU 専用) を `ps -A -o tty,args` + ユーザー空間でのヘッダースキップに変更し、BSD ps と GNU ps の両方で動作するように
  - `tmux list-panes` のフィールドセパレータを `\x1f` から ASCII の `||~~||` に変更（macOS + Bun.spawn で 0x1f が `_` に化ける問題を回避）

## [0.1.87] - 2026-04-27

### Changed
- デスクトップ表示のヘッダーアイコンとペインヘッダーアイコンを 14-16px から 18px に拡大、余白も `p-1` → `p-1.5` に調整して視認性を改善
- ペインヘッダーのタイトル文字サイズを `text-xs` (12px) → `text-base` (16px) に拡大

### Removed
- ペインヘッダーの黄色「キャッシュクリア & リロード」ボタンを削除（通常リロードと紛らわしいため）

## [0.1.86] - 2026-04-26

### Fixed
- 未知の拡張子のテキストファイルが File Viewer で開けず base64 化されていた問題を修正
  - NUL バイト / 制御文字のヒューリスティックで判定し、テキストっぽければ UTF-8 で返す
  - バイナリファイルは引き続き base64 で返却

## [0.1.85] - 2026-04-26

### Fixed
- ConversationViewer で Read ツールが画像を返した際に「(出力なし)」と表示されていた不具合を修正
  - jsonl パース時に `tool_result` の content array から `type: "image"` ブロックを抽出し、base64 画像をインライン表示

### Changed
- `formatRelativeTime` を `frontend/src/utils/format.ts` に集約し、SessionList / SessionHistory / PromptSearch の重複実装を統一
- 秒単位の相対時刻表示に対応（`time.secondsAgo` キー追加）
- 未使用の `UsageTracker` サービスと `PromptSearch` コンポーネント、deprecated な `getSessionIdFromTty` を削除（-356 行）
- リリーススキルを PR ベースのフローに変更し、リリース専用ブランチ (`release/vX.X.X`) を切る運用に統一

## [0.1.84] - 2026-04-25

### Fixed
- 日本語入力モードの InputBar 下段ボタン (履歴 / ファイル / クリア / ↑ / ↓ / 送信) の幅を `w-9` (36px) → `w-14` (56px) に拡大
  - スマートフォンでタップしづらかった状態を解消

## [0.1.83] - 2026-04-25

### Fixed
- File Viewer の Markdown プレビューで相対パス画像 (`![](docs/foo.png)` 等) が読み込めず壊れていた問題を修正
  - `<img src>` をそのままブラウザに渡していたため、フロントエンドのオリジン (`/docs/foo.png`) として解決され 404 になっていた
  - Markdown ファイルのディレクトリを基準に解決し、`/api/files/raw` 経由で配信するよう変更
  - `http(s)://`、`data:`、`blob:` 等の絶対 URL は従来通りパススルー

### Added
- README にスクリーンショット (タブレット全景・セッション一覧・モバイル端末) を追加 (`docs/images/`)

## [0.1.82] - 2026-04-25

### Changed
- セッション一覧カードのレイアウトを圧縮
  - タイトルとパスを同じ行に並べる (例: `ホーム  /home/m0a`)
  - recap タイムスタンプ (`2h ago` 等) を recap 本文の末尾にインライン配置
  - recap ブロックの枠線・背景・"RECAP" ラベルを削除しフラット化
  - recap が表示されているセッションでは last-prompt サマリを非表示 (recap が同じ情報を含むため)

## [0.1.81] - 2026-04-25

### Added
- セッション一覧の各セッションカードに Claude Code の auto-recap (`away_summary`) を表示
  - Claude Code が端末をアンフォーカス後 3 分以上経つと自動生成する 1〜3 文のサマリ (「今何やってるか + 次のアクション」) をカード上部に表示
  - `RECAP · 2h ago` のラベル + 相対タイムスタンプ + 本文 (3行で line-clamp)
  - recap が無いセッションでは表示されず、既存の last-prompt サマリのみ
  - セッション検索 (Ctrl+B のフィルタ) でも recap 本文がヒット対象に
  - `~/.claude/projects/<dir>/<session>.jsonl` 内の `system/away_summary` エントリを末尾から拾う実装。既存の jsonl 読み取りキャッシュ (5秒 TTL) に乗るためオーバーヘッドなし

## [0.1.80] - 2026-04-25

### Refactored
- デッドコード掃除 (-981 行)
  - 未使用ファイル7個を削除: `UrlMenu.tsx`, `SessionListMini.tsx`, `SessionTabs.tsx`, `SessionTab.tsx`, `LanguageSwitcher.tsx`, `dashboard/CostEstimate.tsx`, `dashboard/LimitWarning.tsx`
  - 未使用 state/関数/prop の削除 (Terminal/InputBar の URL menu dead state、`onReload`、`hideDashboardTab` 等)
  - 未使用 import の削除 (`Settings`, `PaneInfo`, `UrlMenu`, `symlink`)
  - 未使用 npm パッケージ削除: `@xterm/addon-web-links`, `qrcode.react`
- 機能変更なし。dev 環境で sessions/dashboard/file browser の動作確認済み

## [0.1.79] - 2026-04-25

### Fixed
- WS 再接続時に Claude Code の入力プロンプト (permission / plan / AskUserQuestion 等) が画面に表示されない問題を修正
  - v0.1.78 で追加した「再接続時 initial-content 破棄」が副作用となり、再接続中に到着したプロンプト UI が xterm に書き込まれず、ユーザーがリロードするまで気づかない状態を引き起こしていた
  - `onInitialContent` を v0.1.77 動作に戻し、wasExpected=false でも書き込む。clear sequence は visible のみ (ESC[2J + ESC[H) でユーザーのスクロール位置は保持
  - scrollback 二重化は再現するが、上流の [Claude Code TUI redraw バグ](https://github.com/anthropics/claude-code/issues/49086) が支配的のため許容
- v0.1.78 で導入した CJK の `rescaleOverlappingGlyphs: true` (文字重なり対策) は維持

## [0.1.78] - 2026-04-25

### Fixed
- ターミナル表示の不安定さを2点修正
  - **scrollback 二重化**: WebSocket 再接続時に古い履歴と新しい initial-content が重複し、スクロールアップで同じ出力が2回表示される問題を解消。再接続時は initial-content を破棄して live %output に任せる方式に変更
  - **CJK グリフの重なり**: 日本語+ASCII 混在出力で文字が隣接セルに侵食する問題を `rescaleOverlappingGlyphs: true` で解消

## [0.1.77] - 2026-04-24

### Fixed
- コンテキスト使用率が正しく計測されない問題を修正
  - モデルの context window max をハードコード (200k) から Anthropic `/v1/models` API 経由の動的取得に変更
  - Opus 4.7 (1M context) で 100% cap されていた問題を解消、`/context` コマンドと ±1% 以内で一致

### Changed
- トークン使用量表示を output のみから累計 used (input + cache_creation + output) に変更
  - cache_read は billing 10% なので除外、実質のレート制限寄与度に近い値を表示
  - UI ラベル `out` → `used`、tooltip に内訳 (in / cache_create / cache_read / out)

### Added
- `backend/src/services/anthropic-models.ts` 新規
  - OAuth トークンで `/v1/models` を叩き、`model_id → max_input_tokens` を 24h キャッシュ

## [0.1.76] - 2026-04-24

### Fixed
- メモリメトリクスを macOS でも取得可能に
  - `/proc` 依存の実装を `ps -A -o pid=,ppid=,rss=` に統一（Linux/macOS 共通）
  - 1 秒 TTL のプロセステーブルキャッシュを追加し、複数セッション間で `ps` spawn を共有

## [0.1.75] - 2026-04-24

### Added
- セッション一覧の各カードにメトリクス表示を追加
  - **コンテキスト使用率**: .jsonl の最新 usage から算出、200k max に対する % をプログレスバーで可視化 (緑 <60% / アンバー 60-80% / 赤 ≥80%)
  - **メモリ使用率**: tmux pane_pid から /proc ツリーを走査して RSS 合計を算出
  - **トークン使用量**: .jsonl 全スキャンで output トークン累計を算出
- mtime+size ベースのキャッシュで 2 回目以降 56-83ms の応答
- デスクトップ (SessionList) とモバイル/タブレット (SessionListMini) 両方に対応

### Changed
- セッションカードの要約/プロンプト表示を `truncate` (1行+...) から `line-clamp-2` (最大2行) に変更し、読みやすさを向上

## [0.1.74] - 2026-04-22

### Added
- TypeScript 7.0 beta (tsgo) による型チェック基盤を導入（tsc 5.9.3 比で約6.8倍高速化）
- 各 workspace に `typecheck` スクリプト追加、root から `bun run typecheck` で一括実行可能
- CI (`.github/workflows/test.yml`) に typecheck ステップを追加

### Fixed
- backend/frontend で検出されなかった既存型エラー 13 件を修正
  - `SessionState` の narrow 解除、lost session の必須プロパティ補完
  - テストコードの optional chaining 化
  - frontend の CSS module 宣言（`vite-env.d.ts`）
  - `SessionResponse` 型の import 漏れ
- `backend/tsconfig.json`: `bun-types` → `bun`（`@types/bun` に整合）

## [0.1.73] - 2026-04-12

### Added
- File Viewer: ファイルアップロード/ダウンロード機能（動画など大きいファイルも対応）
- `POST /files/upload` — 複数ファイル一括アップロード、ストリーミング書き込み（Bun.write）
- `GET /files/download` — 添付ダウンロード、ストリーミング配信（Bun.file）
- `GET /files/raw` — 画像/動画/音声の直接ストリーミング配信（Range request対応）
- 動画再生（MP4, WebM, MOV等）と音声再生（MP3, WAV, FLAC等）をFileViewerに追加
- アップロード成功/失敗のトースト通知
- モバイルレイアウトにもアップロード/ダウンロードボタンを追加

### Fixed
- 大きい画像が1MB制限で崩れて表示される問題を修正（/files/raw ストリーミングに変更）
- サーバーの最大リクエストボディサイズを10GBに拡張
- モバイルPWAでFileオブジェクト参照が切れる問題にBlob変換で対応
- 動画シーク・プログレッシブ再生対応（Range request / 206 Partial Content）
- 動画プレーヤーの画面サイズ自動調整（object-contain, playsInline）

## [0.1.65] - 2026-04-11

### Added
- 会話ビューアーでツールブロックにdescription要約を表示（折りたたみ時に「Bash: コマンドの説明」のように表示）
- G2 Glasses: 同じくツール名にdescriptionを併記

## [0.1.64] - 2026-04-10

### Fixed
- ゾンビWebSocket接続の検出と切断（60秒間pingがない接続を閉じる）
- デバイススリープ/ネットワーク切断でcloseイベントが発火しないケースに対応

## [0.1.63] - 2026-04-10

### Fixed
- ダッシュボードの使用量データがレートリミット(429)で表示されない問題を修正
- Anthropic usage APIのレスポンスを60秒キャッシュし、429時は5分バックオフ

## [0.1.62] - 2026-04-10

### Fixed
- セッションインジケーターが許可待ち/入力待ちなのに「処理中」と表示される問題を修正
- hookオーバーライドTTLを24時間に統一（許可プロンプトで長時間待ってもステータスが消えなくなった）
- jsonlからPendingTool状態を検出（新しいtool_useがjsonl未記録でもバッジ表示）

### Added
- G2 Glasses: requestContentAndWait でターミナルコンテンツ取得の信頼性向上

## [0.1.61] - 2026-04-09

### Added
- glasses-upload スキル（EVEN Hubへのビルド・アップロード・Beta切替を自動化）

## [0.1.60] - 2026-04-09

### Fixed
- G2 Glasses: 会話ページネーションのページ数計算を行数ベースに統一（最終ページに到達できない問題を修正）

## [0.1.59] - 2026-04-09

### Added
- G2 Glasses: 行数ベースのページネーション（文字幅計算でCJK/ASCII自動判定）
- G2 Glasses: 複数メッセージ表示（短いメッセージを7行に詰め込み）
- G2 Glasses: スワイプ時の表示メッセージ数分ジャンプ

### Changed
- G2 Glasses: 全コンテナからボーダー削除、borderWidth: 0を明示
- G2 Glasses: ヘッダー/フッター高さを36pxに統一
- G2 Glasses: セッションリスト表示を7行に制限（スクロールインジケータ解消）
- G2 Glasses: display.tsリファクタリング（コンテンツヘルパー抽出、DRY化）

## [0.1.58] - 2026-04-09

### Fixed
- G2 Glasses: 会話表示からツール結果のみのメッセージをスキップ、連続アシスタントメッセージをマージ
- G2 Glasses: テキスト内容を先、ツール呼び出しを後に表示するよう改善
- G2 Glasses: conversationモードでtapして会話リフレッシュ＋WS再接続
- G2 Glasses: WS再接続時に自動re-subscribe
- G2 Glasses: EVEN Hub SDK bridge初期化のタイムアウトを5秒に延長
- G2 Glasses: phone UIのWS診断で動的インポートを使用し初期化順エラーを解消
- G2 Glasses: シミュレーター用にdev環境でlocalhost URLを自動設定

## [0.1.57] - 2026-04-08

### Fixed
- G2 Glasses: 選択肢モードでrequest-contentにより最新ターミナル画面を取得するよう修正
- G2 Glasses: セッション再ソートによる意図しないセッション切替を防止
- G2 Glasses: フォールバック選択肢 (y/n/skip) を廃止

### Added
- G2 Glasses: phone UIにWS診断情報を追加
- G2 Glasses: ブラウザデバッグUIにWS状態・バッファ表示を追加
- G2 Glasses: ws-clientにrequestContentメソッドを追加

## [0.1.56] - 2026-04-08

### Changed
- Terminal.txを2397行→1151行に分割（InputBar, SelectionOverlay, UrlMenu, useSelectionMode, terminal-themesを抽出）

## [0.1.55] - 2026-04-08

### Changed
- ソフトキーボードのデフォルトを日本語入力モードに変更
- glasses app.jsonのpackage_id/permissions形式をEVEN Hub仕様に修正

## [0.1.54] - 2026-04-08

### Added
- デスクトップブラウザで長押しによるテキスト選択モードを追加（タブレット/スマホと同じUX）
- 長押し後のドラッグで選択範囲をリアルタイム拡張
- S/Eハンドルのマウスドラッグによる選択範囲の微調整
- Selection Modeバッジ/Copy・Cancelパネルの位置を選択範囲と被らないよう自動調整

### Fixed
- マウスリリース後にxterm.jsが選択範囲を変更する問題を修正（pointer-events制御）
- S/Eハンドルドラッグ後にmouseupが検知されない問題を修正（captureフェーズ使用）

## [0.1.53] - 2026-04-08

### Changed
- any/as型キャストを除去し、ExtendedSessionResponse型を全体で統一
- buildSessionsListの戻り値をobject[]からExtendedSessionResponse[]に変更
- Bun WebSocketハンドラにServerWebSocket<MuxData>型を適用
- CLAUDE.mdのコンポーネント一覧を実ファイルと同期

## [0.1.52] - 2026-04-08

### Added
- lostセッションに削除ボタンを追加（Resumeの横に表示）

## [0.1.51] - 2026-04-07

### Added
- **G2スマートグラス コンパニオンアプリ** (`glasses/` ワークスペース)
  - セッション一覧（ステータスアイコン付き、リングスワイプで選択）
  - 会話表示（ページ送り、リアルタイム更新3秒ポーリング）
  - 選択肢モード（カーソルキー送信でClaude Codeの選択画面を操作）
  - スマホ設定画面（CC Hub紹介、セットアップ手順、URL入力＆自動補完）
  - LocalStorage共有（スマホで設定→メガネが自動検出して接続）
  - ツール実行のコンパクト表示（[Edit] path, [Bash] command 等）
- conversation APIに`?last=N`パラメータ追加

## [0.1.49] - 2026-04-07

### Fixed
- lostセッションのccSessionId無しでのresume対応

## [0.1.47] - 2026-04-06

### Changed
- waitingForInputフィールドを削除（hookベースのindicatorに統一）

## [0.1.44] - 2026-04-05

### Fixed
- AskUserQuestionのPreToolUseでwaiting_inputステータスを表示

## [0.1.42] - 2026-04-04

### Fixed
- PreToolUseイベントのブラウザ通知を抑制（ステータス更新のみ）

## [0.1.41] - 2026-04-04

### Changed
- セッションインジケーターをhookイベント専用に変更（jsonl/ps判定を廃止）
  - PreToolUse/UserPromptSubmit → processing
  - Stop/SubagentStop → completed
  - PostToolUse(AskUserQuestion) → waiting_input
- ~/.claude/settings.jsonにPreToolUse/UserPromptSubmit hookを追加

## [0.1.40] - 2026-04-04

### Changed
- psのwchan解析を廃止（Node.jsでは常にdo_epoll_waitで無意味）
- セッションインジケーターをhook/jsonlベースに変更
- jsonlキャッシュTTLを5s→2sに短縮
- processRunningマップと関連ロジックを完全削除（-81行）

## [0.1.39] - 2026-04-04

### Fixed
- cchub updateがサービス登録パスのバイナリを更新するように修正
- CLIバイナリとサービスバイナリが異なるパスにある場合、両方を更新

## [0.1.38] - 2026-04-04

### Fixed
- メタデータ（テーマ・タイトル）消失のrace condition修正
  - lastKnownSessionsを別ファイル（last-known-sessions.json）に分離
  - 5秒ごとのスナップショット書き込みがmetadata本体を上書きしなくなった

### Changed
- コード健全化
  - フロントエンドlintエラー3件修正（CSS parse, noImportantStyles, noUselessCatch）
  - バックエンドlint修正（parseInt radix, unused param, optional chain）
  - zod統一（shared v3→v4）、ローカルスキーマ重複削除
  - listPanesにisActiveフィールド追加
  - 旧メタデータファイル（session-themes.json, session-titles.json）の自動削除
- 完了済みGitHub issueをクローズ（#1, #2, #12, #47）

## [0.1.37] - 2026-04-04

### Fixed
- リブート後のlostセッションがリフレッシュで消えなくなった
- lostセッションのResume時にclaude -rで会話引き継ぎ

## [0.1.36] - 2026-04-04

### Added
- リブート後のlostセッションにccSessionIdを保存
- lostセッションのResumeでclaude -rによる会話引き継ぎ

## [0.1.35] - 2026-04-04

### Fixed
- デスクトップ版コピペ（テキスト選択、Ctrl+C/V、右クリックメニュー）
- デスクトップ版フォントサイズ変更（Ctrl+=/-/0）
- iPad safe-area-inset-top対応
- マウストラッキングリセット

### Changed
- CLAUDE.md/README全面更新（WebSocket /ws/mux, 全サービス・API・コンポーネント文書化）

## [0.1.5] - 2026-03-20

### Changed
- スマホ日本語入力を二段レイアウトに変更（上:入力欄幅いっぱい、下:ボタン列）
- ボタン配置: 左に履歴/ファイル/ABC/クリア、右にカーソル上下/送信
- ボタンサイズを44pxタッチターゲットに拡大

### Fixed
- UserPromptSubmitフックの不要な通知を抑制

## [0.1.4] - 2026-03-20

### Changed
- Connecting表示を全画面オーバーレイから左上の小さなバナーに変更（接続中もターミナル操作可能に）

## [0.1.3] - 2026-03-20

### Fixed
- ファイルビューアで長押し時にブラウザのコンテキストメニュー（ダウンロード/共有/印刷）が表示される問題を修正

## [0.1.2] - 2026-03-20

### Added
- セッション一覧でペインを長押しして閉じる機能（確認ダイアログ付き）

### Fixed
- zod v4でペイン操作API（close/focus/split/respawn）が500エラーになる問題を修正

## [0.1.1] - 2026-03-19

### Fixed
- macOSでtmux制御モードが動作しない問題を修正（`script`→`expect`でPTYラッパー）

## [0.1.0] - 2026-03-19

### Added
- ターミナル長押しテキスト選択（タッチデバイス対応）
  - 長押しで選択モード開始、ドラッグで文字レベル選択
  - S/Eハンドルで選択範囲をドラッグ調整
  - 選択テキストのプレビューパネル表示
  - Copy/Cancelボタン、クリップボードコピー対応

## [0.0.99] - 2026-03-19

### Added
- FileViewerにCopy Prompt機能（行選択→コメント→ターミナル入力欄にセット）
- 日本語入力に送信ボタン(↵)とクリアボタン(×)を追加（スマホ・タブレット両対応）
- Markdown/HTMLファイルのSource/Preview切替ボタン

### Changed
- FileViewerの行番号を常時表示（ワードラップ時も）
- 行全体をタップで選択可能に（行番号以外も）
- タブレットでFileViewer表示中はFloatingKeyboardを非表示に

## [0.0.98] - 2026-03-18

### Changed
- zod 3→4、@hono/zod-validator 0.5→0.7 にメジャーアップグレード
- vite 6→8、@vitejs/plugin-react 4→6 にメジャーアップグレード

## [0.0.97] - 2026-03-18

### Added
- share-tokenサービスのユニットテスト追加（18テスト）

### Changed
- パッチ/マイナー依存関係更新（hono, react, tailwindcss, i18next等）

## [0.0.96] - 2026-03-18

### Removed
- 非推奨TabletLayoutコンポーネント削除（478行、DesktopLayout+isTabletに統合済み）
- 未使用isExternalフィールド、onReload prop、レガシーsessionsフラット配列
- ext:プレフィックス正規化、旧localStorageキー掃除、旧ペインタイプ変換等のマイグレーションコード

## [0.0.95] - 2026-03-18

### Fixed
- ファイルブラウザでシンタックスハイライトが付かないことがある問題を修正

## [0.0.94] - 2026-03-18

### Fixed
- ソフトキーボードで`/`を押すと`?`が付く問題を修正（タッチ+マウスの二重発火による長押しタイマーの残留）

## [0.0.93] - 2026-03-17

### Changed
- タブレットFloatingKeyboardの日本語入力をスマホと統一（textarea + Enter×2送信 + ブラケットペースト）

## [0.0.92] - 2026-03-17

### Added
- スマホ日本語入力に履歴ボタン追加（FloatingKeyboardと履歴共有）
- スマホ日本語入力を複数行編集対応（textarea化）
- Enter×2で送信、複数行はブラケットペーストモードで一括送信

### Fixed
- ビューアページの縦スクロール有効化

## [0.0.91] - 2026-03-16

### Fixed
- ビューアページで画面下部のターミナル内容が見えない問題を修正（縦スクロール有効化）

## [0.0.90] - 2026-03-16

### Changed
- Funnelをオンデマンド化: 共有トークン生成時にON、全トークン消滅時にOFF
- 起動時の自動Funnel設定を廃止（前回のFunnel残骸はクリーンアップ）

## [0.0.89] - 2026-03-16

### Added
- Tailscale Funnel自動設定: サーバー起動時にポート8443で外部公開を自動セットアップ
- 共有ダイアログのQRコード/URLが自動的にFunnel経由の外部URLを使用

### Fixed
- Funnelとバックエンドのポート競合を修正（別ポート8443で転送）
- ViewerPageのターミナル固定幅レンダリングとフォントサイズ調整

## [0.0.88] - 2026-03-16

### Added
- プレゼンテーションモード: セッションを読み取り専用URLで共有可能に
- 共有トークン管理（生成・一覧・無効化、最大5トークン/セッション、有効期限付き）
- QRコード表示付き共有ダイアログ（デスクトップ/タブレット/モバイル全対応）
- 読み取り専用WebSocketエンドポイント（/ws/view/:token）で入力操作を遮断
- ビューア側フォントサイズ調整（提供側に影響なし）
- 横スクロール対応（タブレットの広い画面をスマホで閲覧可能）
- Tailscale Funnel URL自動検出によるVPN外共有

## [0.0.87] - 2026-03-15

### Fixed
- ターミナルのスクロール不能問題を修正（初期接続時にスクロールバックをxterm.jsに送信）
- Connectingオーバーレイがタッチ操作をブロックしないよう修正

## [0.0.86] - 2026-03-14

### Fixed
- ファイルブラウザのタッチターゲット・フォントサイズを拡大（スマホ操作改善）

## [0.0.85] - 2026-03-14

### Fixed
- バッジ表示を indicatorState ベースに統一（processing→緑cc、waiting_input→黄、idle→なし）

## [0.0.84] - 2026-03-14

### Fixed
- アイドル状態（UserInput/end_turn）を completed として扱い、不要な入力待ちバッジを抑制

## [0.0.83] - 2026-03-14

### Added
- スマホ: セッション長押しでメニューダイアログ（タイトル編集・テーマ変更・削除）
- タブレット: メニューダイアログにカスタムタイトル入力欄を追加

### Fixed
- WebSocket再接続時にスクロール位置を保持（スクロールバッククリア・scrollToBottomをスキップ）
- processing状態のhook TTLを30秒→5分に延長（誤った入力待ち表示を削減）

## [0.0.82] - 2026-03-14

### Fixed
- WebSocket再接続時のターミナルちらつき・スクロールリセットを軽減

## [0.0.81] - 2026-03-14

### Added
- サーバーサイドでのカスタムセッションタイトル保存（session-metadata.jsonに統合）
- セッション一覧を全画面表示（ファイルビューワーと同様）
- タブレット/PCでセッションカード・履歴を2列グリッド表示
- タブレットでfirstPrompt常時表示、summary複数行表示
- hook経由のステータス検知改善（UserPromptSubmit、Stop、AskUserQuestion）

### Fixed
- Bashツール等の許可待ちで「許可待ち」バッジを表示
- スマホ版セッション一覧でカスタムタイトルを表示
- cchub notifyがdev環境にHTTPSで送信するように修正
- 履歴プロジェクトをパス辞書順でソート

## [0.0.29] - 2026-02-07

### Added

- **Git差分ビューア** - ファイルビューアの「変更」タブにClaude/Git切り替えトグルを追加
  - Gitモード: `git status --porcelain` + `git diff` でワーキングツリーの変更を表示
  - Claude変更とGit変更をセグメントボタンで切り替え（デフォルト: Git）
  - 一覧/ツリー表示モード（localStorageで保存）
  - ファイルクリックで既存のDiffViewerにunified diffを表示
  - 新規API: `GET /api/files/git-changes/:workingDir`, `GET /api/files/git-diff/:workingDir`

- **ブラウザバックジェスチャー対応** - FileViewerでhistory.back()によるナビゲーション
  - diff表示 → 変更一覧 → ブラウザビュー → ターミナル の順に戻る
  - `window.history.pushState` / `popstate`イベントで実装

### Fixed

- **Biomeリント設定整備** - `biome.json`でa11y/style系ルールをwarnに設定
  - `useButtonType`, `noSvgWithoutTitle`, `noStaticElementInteractions`等8つのa11yルールをwarn化
  - `noExplicitAny`, `noNonNullAssertion`, `useExhaustiveDependencies`等もwarn化
  - バックエンド16ファイル、フロントエンド14ファイルの自動修正可能なlintエラーを修正
  - DesktopLayout.tsx: `useEffect`の変数宣言順序を修正
  - FloatingKeyboard.tsx: `getDefaultPosition`をモジュールレベルに移動

## [0.0.28] - 2026-02-07

### Added

- **ネットワーク遅延モニター** - ダッシュボードにリアルタイム遅延表示カードを追加
  - WebSocket ping/pong（10秒間隔）とAPI ping（30秒間隔）の2種類を計測
  - CSSベースのスパークラインで過去30データポイントの履歴を可視化
  - 色分け表示: 緑(<50ms), 黄(50-150ms), 赤(>150ms)
  - WS切断時は最後の計測値を薄く表示（20秒以内のpong受信で接続判定）

## [0.0.27] - 2026-02-07

### Performance

- **Sessions API レイテンシ 48.6%削減** (70.84ms → 36.39ms)
  - `capture-pane`の重複呼び出しを統合（2回→1回/セッション）
  - `ps`コマンドをバッチ化（N回→1回で全TTYのClaude検出・プロセス状態チェック）
  - `listSessions` 2秒TTLキャッシュ追加
  - TTY→SessionIDマッピング 10秒TTLキャッシュ追加
  - フロントエンド`useSessions`のfetchリクエスト重複排除

- **ターミナルWebSocketホットパス最適化**
  - デバッグhexログを除去（毎キーストロークで`Array.from`+`map`+`join`+`console.log`が走っていた）
  - PTY切断時に30秒の猶予期間を追加（タブレットのスリープ復帰時に即座再接続）

### Added

- **ターミナルレイテンシベンチマークスイート** (`backend/tests/benchmark/`)
  - Single char echo RTT、コマンド実行RTT、スループット、Sessions APIの4メトリクス計測
  - p95/p99パーセンタイル統計

## [0.0.26] - 2026-02-06

### Added
- **オンボーディングウォークスルー** - 初回ユーザー向けスポットライト式ガイド
  - デスクトップ/タブレット/モバイル各デバイス対応
  - キーボード操作、分割ペイン、セッション一覧の使い方を順に説明
  - `beforeAction`パターンで説明前にUIを自動操作（キーボード表示など）

- **ターミナルリフレッシュ機能** - 表示崩れ時の軽量リカバリー
  - WebSocket経由で`tmux refresh-client -S`を送信
  - WebSocket再接続時に自動リフレッシュ

- **ペインごとの分割ボタン** - デスクトップモードで各ペインヘッダーに分割ボタンを配置

### Changed
- **ハンバーガーメニュー削除** - DesktopLayoutのサイドパネルオーバーレイを廃止（PaneContainer内のセッション一覧サイドバーに統合）
- **サイドバーリサイズハンドル改善** - 透明なオーバーレイ方式に変更、タッチ領域拡大（タブレット24px）
- **サイドバーがターミナル端に被さるレイアウト** - xterm文字幅端数による隙間を軽減
- **タブナビゲーション自動フィット** - フォントサイズ縮小+truncateで狭いパネルでも1行表示
- **リロードボタンをページ全体リロードに変更**

### Fixed
- モバイルターミナルスクロールの不自然な挙動（閾値調整、二重スクロール解消）
- モバイルでキーボードオンボーディングが表示されない問題
- オンボーディングツールチップがナビゲーションバーに隠れる問題
- ペースト時にclipboard.readが空を返す際のフォールバック改善
- 履歴一覧で長いプロジェクトパスが折り返される問題

## [0.0.25] - 2026-02-05

### Added
- **CLI国際化対応**: バックエンド/CLIメッセージの日本語・英語対応
  - 環境変数 `LANG`/`LC_ALL`/`LC_MESSAGES` から言語を自動検出
  - 日本語ロケール (`ja_*`) → 日本語出力、それ以外 → 英語出力
  - シングルバイナリ対応のため翻訳データを埋め込み

### Changed
- CLAUDE.md に国際化（i18n）セクションを追加

## [0.0.24] - 2026-02-05

### Added
- **フロントエンド国際化対応**: react-i18nextによる完全なi18n対応
  - 全UIコンポーネントの日本語・英語翻訳
  - i18next-browser-languagedetectorによるブラウザ言語自動検出
  - 言語切替ボタン（EN/JA）をUIに追加
  - 設定は localStorage (`cchub-language`) に保存
  - 翻訳ファイル: `frontend/src/i18n/locales/{en,ja}.json`

### Changed
- ダッシュボードのステータスメッセージをフロントエンドで生成（翻訳対応）
- 全コンポーネントのハードコードされた日本語を翻訳キーに置換

## [0.0.23] - 2026-02-05

### Added
- **会話履歴の検索機能**
  - 履歴タブに検索ボックスを追加
  - プロジェクト名とユーザーメッセージで検索
  - インクリメンタルサーチ（SSEストリーミング）
  - 全文検索対応（全ユーザーメッセージを検索）
  - マッチ箇所のスニペット表示

## [0.0.22] - 2026-02-05

### Added
- **VSCode風ツリービューファイラー**
  - ディレクトリを展開/折りたたみで表示
  - サブディレクトリの遅延読み込み
  - 深さに応じたインデント表示

- **ファイラーのペインリサイズ機能**
  - 左右ペイン間のディバイダーをドラッグでリサイズ可能
  - マウス/タッチ両対応

- **テキスト選択機能**
  - Markdownプレビューでテキスト選択可能
  - 会話ビューアでテキスト選択可能

### Fixed
- 会話ビューアで画像が表示されない問題
  - 認証不要の画像エンドポイント `/api/images/` を追加
- HTMLプレビューの定期リフレッシュ問題
  - blob URLをメモ化してiframe再読み込みを防止
- ファイラー表示時にキーボードが前面に出る問題
  - キーボードのz-indexを調整
- デスクトップでの日本語IME入力が正しく動作しない問題

## [0.0.21] - 2026-02-05

### Added
- **セッション色テーマ機能**
  - セッションごとに色テーマを設定可能（9色 + なし）
  - セッション一覧で長押し → 色選択メニュー表示
  - ターミナル背景色がテーマに応じて変化
  - 設定は `~/.cchub/session-themes.json` に永続化

- **会話ビューアの改善**
  - システム生成サマリーを「System (Summary)」として区別表示
  - 琥珀色のスタイルで実際のユーザーメッセージと区別

### Changed
- **モバイルキーボード改善**
  - タップ/長押しでカスタムキーボードを表示
  - OSソフトキーボードの起動を防止
  - xterm内部textareaに`inputmode="none"`を設定

### Fixed
- モバイルでセッションテーマ変更が即座に反映されない問題

## [0.0.20] - 2026-02-05

### Added
- **パスワード認証機能**
  - `-P`オプションでサーバー起動時にパスワード認証を有効化
  - 全APIエンドポイントに条件付き認証ミドルウェアを適用
  - WebSocket接続時のトークン認証
  - フロントエンドにログインフォーム追加

- **HTMLファイルプレビュー**
  - ファイルビューアでHTMLファイルをiframeでプレビュー表示

- **開発用コマンド**
  - `bun run dev:auth` - パスワード認証付きで開発環境起動（パスワード: devpass）

### Security
- JWT認証によるAPIアクセス制御
- WebSocketトークン検証
- `authFetch`ヘルパーで認証付きAPI呼び出しを一元化

## [0.0.19] - 2026-02-04

### Added
- **PC版長押し削除対応**
  - デスクトップブラウザでセッション一覧の長押し削除が動作
  - `onMouseDown`/`onMouseUp`/`onMouseLeave`イベントを追加

### Changed
- **Claude Code検出の改善**
  - macOSとLinux両方で動作するTTYプロセスチェック方式を採用
  - `ps -t`コマンドで`claude`プロセスを直接確認
  - `pane_current_command`フォールバックを削除

### Fixed
- 未定義変数`pts`を`ttyName`に修正（セッションマッチングが失敗していた問題）

### UI
- PC版のアイコンボタンサイズを拡大（w-3 h-3 → w-4 h-4）
- ボタンのイベント伝播を修正

## [0.0.18] - 2026-02-04

### Added
- **ダッシュボードにバージョン表示**
  - CC Hubバージョンを画面下部に表示

### Changed
- **バージョン管理の改善**
  - package.jsonを正とするバージョン管理に変更
  - ハードコードされたVERSION定数を削除

### UI
- モバイル版の下部ナビゲーションバーの高さを増加（タッチターゲット改善）

## [0.0.4] - 2026-02-01

### Added
- **CLI強化**
  - `--help` / `--version` オプション
  - `-p, --port` / `-H, --host` / `-P, --password` オプション
  - `cchub setup` - systemdサービス登録コマンド
  - `cchub update` - 自動更新コマンド（GitHub Releases連携）
  - `cchub status` - サービス状態確認コマンド

- **systemd連携**
  - ユーザーサービスファイル自動生成
  - 自動再起動（Restart=always）
  - 毎日の自動更新チェック（timer）

### Changed
- Tailscale必須化（常にHTTPS）
- 環境変数からCLI引数ベースの設定に変更

### Removed
- 自己署名証明書機能（TLS=1）
- カスタム証明書機能（TLS_CERT/TLS_KEY）
- 環境変数による設定（PORT, HOST, TLS）

## [0.0.3] - 2026-02-01

### Added
- **Dashboard機能**
  - 使用量リミット表示（5時間/7日サイクル）
  - リミット到達予測（現在のペースでの予測時間）
  - 日別使用統計グラフ（メッセージ数・セッション数）
  - モデル別トークン使用量（Opus/Sonnet比較）
  - 推定コスト表示

- **セッション履歴機能**
  - 過去のClaude Codeセッション一覧
  - プロジェクト別グループ化
  - 会話内容の表示
  - セッション再開（`claude -r`）

- **会話ビューア強化**
  - Markdownレンダリング（テーブル、コードブロック対応）
  - 画像表示サポート
  - アクティブセッションの自動更新

- **セッション管理強化**
  - PTY-based session matching（同一ディレクトリでの複数セッション識別）
  - セッション状態インジケーター（処理中/入力待ち/アイドル/完了）
  - セッション再開ボタン

### Fixed
- 同じディレクトリで複数のClaude Codeセッション実行時に情報が混在する問題

## [0.0.2] - 2026-02-01

### Added
- GitHub Releaseへのバイナリ自動アップロード

## [0.0.1] - 2026-01-31

### Added
- 初期リリース
- マルチセッション管理
- タブレット最適化UI
- ファイルビューア
- 変更追跡
- TLS対応（自己署名証明書、Tailscale）
