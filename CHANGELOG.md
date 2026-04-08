# Changelog

All notable changes to this project will be documented in this file.

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
